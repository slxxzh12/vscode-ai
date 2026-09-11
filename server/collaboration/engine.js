import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { CollabPeer } from '@devflow/shared/collab';
import { CollabStore } from './store.js';
import { loadIdentity, toPublicProfile } from './identity.js';
import { signEnvelope, verifyEnvelope, signHash, verifyHash } from './sign.js';
import { packSkill } from './skill-packer.js';
import { installZip } from './skill-installer.js';
import { buildZip } from './zip.js';
import { createOpenCodeRunner } from './remote-runner.js';
import { t } from '../i18n.js';

// 递归收集目录内文件（跳过隐藏/.git）
function collectTree(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) collectTree(full, r, out);
    else if (e.isFile()) out.push({ rel: r, data: fs.readFileSync(full) });
  }
}
function assertSafeRel(name) {
  if (!name || typeof name !== 'string') throw new Error('bad item name');
  if (name.includes('..') || name.startsWith('/') || name.includes('\\')) throw new Error('unsafe item name');
}

// events 注入（便于 web 层广播到浏览器 /ws）；peer 注入（真实 HTTP 或测试直连）
export class CollabEngine {
  constructor({ store, identity, events = null, peer = null, skillsRoot = null, inboxDir = null, uploadDir = null, downloadDir = null, runner = null, logger = console }) {
    this.store = store;
    this.identity = identity;      // { machineId, username, host, port, publicKey, privateKey }
    this.events = events;
    this.peer = peer;              // { post(host, port, envelope) -> Promise<{ok, data?, error?}> }
    this.skillDefaultRoot = skillsRoot;   // opencode 技能根（env 覆盖优先）
    this.uploadDir = uploadDir;           // 发出的 zip 落盘目录
    this.downloadDir = downloadDir || inboxDir;   // 收到的 zip 落盘目录（下载页目录）
    this.runner = runner || createOpenCodeRunner();
    this.log = logger;
    _extendChat(this);
  }
  get pub() { return toPublicProfile(this.identity); }

  // 本机选定的开发工具 → 技能根目录（分发打包源 & 安装目标），默认 opencode
  skillRoot() {
    const t = this.store.getTool();
    if (t.kind === 'custom' && t.customRoot) return path.resolve(t.customRoot);
    if (t.kind === 'claudecode') return path.join(os.homedir(), '.claude', 'skills');
    return this.skillDefaultRoot;
  }
  getToolInfo() { return { tool: this.store.getTool(), root: this.skillRoot() }; }
  setTool(kind, customRoot) {
    const k = kind === 'claudecode' || kind === 'custom' ? kind : 'opencode';
    if (k === 'custom' && !(customRoot && typeof customRoot === 'string' && customRoot.trim())) return { code: 'need-custom-root' };
    this.store.setTool({ kind: k, customRoot: k === 'custom' ? customRoot.trim() : null });
    this._emit('synced', {});
    return { code: 'ok', ...this.getToolInfo() };
  }
  // opencode 配置根（skillRoot 的上一级），command/agent 目录所在
  configRoot() {
    const s = this.skillRoot();
    return s ? path.dirname(s) : null;
  }
  assetDir(kind) {
    if (kind === 'skills') return this.skillRoot();
    if (kind === 'command' || kind === 'agent') {
      const cr = this.configRoot();
      return cr ? path.join(cr, kind) : null;
    }
    return null;
  }
  // 列出可打包资产：skills 目录（含 SKILL.md）/ command、agent 目录内文件
  listAssets() {
    const out = { skills: [], command: [], agent: [] };
    const sk = this.assetDir('skills');
    if (sk && fs.existsSync(sk)) {
      for (const d of fs.readdirSync(sk, { withFileTypes: true })) {
        if (d.isDirectory() && fs.existsSync(path.join(sk, d.name, 'SKILL.md'))) out.skills.push({ name: d.name });
      }
    }
    for (const kind of ['command', 'agent']) {
      const root = this.assetDir(kind);
      if (!root || !fs.existsSync(root)) continue;
      const files = [];
      collectTree(root, '', files);
      for (const f of files) out[kind].push({ name: f.rel });
    }
    return out;
  }
  // 第一步：打包（只生成本地 zip + outbox 未发送记录，不推送）
  async buildPackage({ skills = [], command = [], agent = [] }) {
    const sSel = [...new Set(skills || [])];
    const cSel = [...new Set(command || [])];
    const aSel = [...new Set(agent || [])];
    const files = [];
    for (const n of sSel) {
      assertSafeRel(n);
      const dir = path.join(this.skillRoot(), n);
      if (!fs.existsSync(path.join(dir, 'SKILL.md'))) throw new Error(t('collab.err.not_skill_dir', { name: n }));
      collectTree(dir, `skills/${n}`, files);
    }
    for (const kind of ['command', 'agent']) {
      const list = kind === 'command' ? cSel : aSel;
      const root = this.assetDir(kind);
      if (!root || !list.length) continue;
      for (const n of list) {
        assertSafeRel(n);
        const full = path.join(root, n);
        const rl = path.relative(root, full);
        if (rl.startsWith('..') || path.isAbsolute(rl)) throw new Error(t('collab.err.out_of_range'));
        if (fs.existsSync(full)) {
          if (fs.statSync(full).isDirectory()) collectTree(full, `${kind}/${n}`, files);
          else files.push({ rel: `${kind}/${n}`, data: fs.readFileSync(full) });
        }
      }
    }
    if (!files.length) throw new Error(t('collab.err.no_content'));
    const zip = buildZip(files);
    const hash = crypto.createHash('sha256').update(zip).digest('hex');
    const total = sSel.length + cSel.length + aSel.length;
    const label = `assets-${total}-${hash.slice(0, 6)}.zip`;
    if (!this.uploadDir) throw new Error(t('collab.err.no_upload_dir'));
    fs.mkdirSync(this.uploadDir, { recursive: true });
    fs.writeFileSync(path.join(this.uploadDir, label), zip);
    const rec = this.store.addOutbox({
      id: crypto.randomUUID(), kind: 'file', groupId: null, skillName: null, fileName: label,
      storedFile: label, size: zip.length, hash, createdAt: Date.now(),
      package: { sent: false, skills: sSel, command: cSel, agent: aSel },
    });
    this._emit('synced', {});
    return rec;
  }
  // 第二步：发送——把已打包的任务 zip 推给群成员（FILE_PUSH，等同上传通道）
  async sendPackage(packageId, groupId) {
    const rec = this.store.listOutbox().find((r) => r.id === packageId);
    if (!rec || !rec.storedFile || !this.uploadDir) return { code: 'not-found', pushed: 0, failures: [] };
    const g = this.store.findGroup(groupId);
    if (!g) return { code: 'no-group', pushed: 0, failures: [] };
    const me = g.members.find((m) => m.machineId === this.pub.machineId);
    if (!me) return { code: 'not-member', pushed: 0, failures: [] };
    const abs = path.join(this.uploadDir, path.basename(rec.storedFile));
    if (!fs.existsSync(abs)) return { code: 'file-missing', pushed: 0, failures: [] };
    const data = fs.readFileSync(abs);
    const pkg = rec.package || {};
    const env = this._sign(CollabPeer.FILE_PUSH, {
      groupId, fileName: rec.fileName, hash: rec.hash, size: data.length,
      skills: pkg.skills || [], command: pkg.command || [], agent: pkg.agent || [],
      b64: data.toString('base64'),
    });
    const receipt = this.fileReceiptHeaders(data);
    const failures = [];
    let pushed = 0;
    for (const m of g.members) {
      if (m.machineId === this.pub.machineId) continue;
      const res = await this._post(m.host, m.port, env, receipt);
      if (res.ok) pushed++;
      else failures.push({ machineId: m.machineId, error: res.error || 'push-failed' });
    }
    for (const skillName of (pkg.skills || [])) {
      const existing = this.store.findGroupSkill(groupId, skillName);
      this.store.upsertGroupSkill({ groupId, skillName, hash: rec.hash, distributedBy: this.pub.machineId, installed: existing ? existing.installed : true });
    }
    rec.groupId = groupId;
    if (!rec.package) rec.package = {};
    rec.package.sent = true;
    this.store.save();
    const parts = [];
    if ((pkg.skills || []).length) parts.push(t('collab.sys.part.skills', { names: pkg.skills.join('、') }));
    if ((pkg.command || []).length) parts.push(t('collab.sys.part.command', { names: pkg.command.join('、') }));
    if ((pkg.agent || []).length) parts.push(t('collab.sys.part.agent', { names: pkg.agent.join('、') }));
    this._addSystemMessage(groupId, t('collab.sys.pkg_distributed', { parts: parts.join(t('collab.sys.part_sep')) }));
    this._emit('synced', {});
    return { code: 'ok', pushed, failures };
  }

  _emit(type, payload) { if (this.events) this.events.emit(type, payload); }
  _sign(type, payload) {
    return signEnvelope(this.identity.privateKey, type, this.pub, payload);
  }
  async _post(host, port, env, headers = null) {
    if (!this.peer) { this.log?.warn?.('peer transport not configured'); return { ok: false, error: 'no-transport' }; }
    try { return await this.peer.post(host, port, env, headers); }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }
  // 按公钥反查已知身份（单例群成员），供接收方头部公钥鉴权
  profileByPublicKey(pem) {
    if (!pem) return null;
    const g = this.store.getGroup();
    return g ? (g.members.find((x) => x.publicKey === pem) || null) : null;
  }
  // 文件凭证请求头：对文件 sha256 用本机私钥签名，并附带公钥（base64）供接收方查询
  fileReceiptHeaders(data) {
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    return {
      'x-df-pub': Buffer.from(this.identity.publicKey, 'utf8').toString('base64'),
      'x-df-sha': sha,
      'x-df-sig': signHash(this.identity.privateKey, sha),
    };
  }
  verifyFileReceipt(pubB64, sha, sig) {
    let pub = null;
    try { pub = pubB64 ? Buffer.from(pubB64, 'base64').toString('utf8') : null; } catch { pub = null; }
    if (!pub || !sha || !sig) return { ok: false, error: 'missing-file-receipt' };
    const prof = this.profileByPublicKey(pub);
    if (!prof) return { ok: false, error: 'untrusted-pubkey' };
    if (!verifyHash(pub, sha, sig)) return { ok: false, error: 'bad-sha-signature' };
    return { ok: true, profile: prof };
  }
  // 返回 { ok, error?, data? }
  async handleIncoming(env) {
    // 先从 from 定位已知公钥；首次 friend-request 用 from.publicKey 自证
    const known = this._knownProfile(env && env.from && env.from.machineId);
    const pubKey = known ? known.publicKey : (env && env.from && env.from.publicKey);
    if (!pubKey || !verifyEnvelope(pubKey, env)) return { ok: false, error: 'bad-signature' };
    switch (env.type) {
      case CollabPeer.GROUP_JOIN: return this._inJoin(env);
      case CollabPeer.MEMBER_SYNC: return this._inMemberSync(env);
      case CollabPeer.SKILL_PUSH: return this._inSkillPush(env);
      case CollabPeer.FILE_PUSH: return this._inFilePush(env);
      case CollabPeer.PULL_SYNC: return this._inPullSync(env);
      case CollabPeer.CHAT_SEND: return this._inChatSend(env);
      case CollabPeer.CMD_REQ: return this._inCmdReq(env);
      case CollabPeer.CMD_CONFIRM: return this._inCmdConfirm(env);
      case CollabPeer.CMD_RESULT: return this._inCmdResult(env);
      case CollabPeer.CHAT_PULL: return this._inChatPull(env);
      default: return { ok: false, error: 'unknown-type' };
    }
  }
  _knownProfile(machineId) {
    if (!machineId) return null;
    const g = this.store.getGroup();
    return g ? (g.members.find((m) => m.machineId === machineId) || null) : null;
  }

  // ---- 单例群组（hub = 开启远程访问并分享链接者）----
  ensureGroup() {
    const g = this.store.ensureGroup({ name: t('collab.group.default_name'), hubId: this.pub.machineId, self: this.pub });
    this._emit('synced', {});
    return g;
  }
  joinByLink({ host, port, token }) {
    const env = this._sign(CollabPeer.GROUP_JOIN, { token });
    return this._post(host, port, env).then((res) => {
      if (!res.ok) return { code: res.error === 'bad-token' ? 'bad-token' : 'unreachable', error: res.error };
      const group = res.data && res.data.group;
      if (!group) return { code: 'unreachable' };
      this.store.setGroup(group);
      this._emit('synced', {});
      return { code: 'joined', group };
    });
  }
  async _inJoin(env) {
    if (typeof this.verifyAccessToken !== 'function' || !this.verifyAccessToken(env.payload && env.payload.token)) {
      return { ok: false, error: 'bad-token' };
    }
    const g = this.store.getGroup() || this.ensureGroup();
    this.store.addGroupMember(env.from);
    g.hubId = this.pub.machineId;
    this.store.saveGroup(g);
    await this._broadcastMemberSync(g);
    this._emit('synced', {});
    return { ok: true, data: { group: g } };
  }
  async _broadcastMemberSync(g) {
    const env = this._sign(CollabPeer.MEMBER_SYNC, { group: g });
    for (const m of g.members) {
      if (m.machineId === this.pub.machineId) continue;
      await this._post(m.host, m.port, env);
    }
  }
  _inMemberSync(env) {
    const g = env.payload.group;
    if (!g || !Array.isArray(g.members)) return { ok: false, error: 'bad-payload' };
    const local = this.store.getGroup();
    if (!local) { this.store.setGroup({ ...g }); }
    else {
      for (const m of g.members) if (!local.members.find((x) => x.machineId === m.machineId)) local.members.push(m);
      this.store.saveGroup(local);
    }
    this._emit('synced', {});
    return { ok: true };
  }
  // ---- skill 分发 ----
  async distributeToGroup(groupId, skillNames) {
    const g = this.store.findGroup(groupId);
    if (!g) return { code: 'no-group', failures: [], pushed: 0 };
    const me = g.members.find((m) => m.machineId === this.pub.machineId);
    if (!me) return { code: 'not-member', failures: [], pushed: 0 };
    const failures = [];
    const packedOk = [];
    let pushed = 0;
    for (const skillName of skillNames) {
      const skillDir = path.join(this.skillRoot(), skillName);
      let pkg;
      try { pkg = await packSkill(skillDir); } catch (e) { failures.push({ skillName, error: 'pack:' + (e && e.message) }); continue; }
      if (pkg.skillName !== skillName) { failures.push({ skillName, error: 'name-mismatch' }); continue; }
      packedOk.push(skillName);
      // 我发出的技能 zip 落 upload 目录（留档）
      if (this.uploadDir) {
        fs.mkdirSync(this.uploadDir, { recursive: true });
        const artifact = path.join(this.uploadDir, `${skillName}-${Date.now().toString(36)}.zip`);
        fs.writeFileSync(artifact, pkg.zip);
        this.store.addOutbox({ id: crypto.randomUUID(), kind: 'skill', groupId, skillName, fileName: skillName, storedFile: path.basename(artifact), size: pkg.zip.length, hash: pkg.hash, createdAt: Date.now() });      }
      const env = this._sign(CollabPeer.SKILL_PUSH, {
        groupId, skillName, hash: pkg.hash, zipB64: pkg.zip.toString('base64'),
      });
      for (const m of g.members) {
        if (m.machineId === this.pub.machineId) continue;
        const res = await this._post(m.host, m.port, env);
        if (res.ok) pushed++;
        else failures.push({ machineId: m.machineId, skillName, error: res.error || 'push-failed' });
      }
      const existing = this.store.findGroupSkill(groupId, skillName);
      this.store.upsertGroupSkill({
        groupId, skillName, hash: pkg.hash, distributedBy: this.pub.machineId,
        installed: existing ? existing.installed : true, // 发起者本机已有
      });
    }
    if (packedOk.length) {
      this._addSystemMessage(groupId, t('collab.sys.skills_distributed', { names: packedOk.join('、') }));
    }
    this._emit('synced', {});
    return { code: 'ok', pushed, failures, packed: packedOk };
  }
  async _inSkillPush(env) {
    const p = env.from;
    const { groupId = null, skillName, hash, zipB64 } = env.payload;
    if (!skillName || typeof zipB64 !== 'string' || !hash) return { ok: false, error: 'bad-payload' };
    // 鉴权：群成员或好友
    const known = this._knownProfile(p.machineId);
    if (!known) return { ok: false, error: 'unknown-sender' };
    if (groupId) {
      const g = this.store.findGroup(groupId);
      if (!g || !g.members.find((m) => m.machineId === p.machineId)) return { ok: false, error: 'not-in-group' };
    }
    const zip = Buffer.from(zipB64, 'base64');
    const itemId = crypto.randomUUID();
    fs.mkdirSync(this.downloadDir, { recursive: true });
    const zipPath = path.join(this.downloadDir, `${itemId}.zip`);
    fs.writeFileSync(zipPath, zip);
    const item = { id: itemId, kind: 'skill', fromId: p.machineId, groupId, skillName, fileName: `${skillName}.zip`, hash, size: zip.length, zipPath, status: 'received', receivedAt: Date.now() };
    this.store.addInbox(item);
    const gs = this.store.findGroupSkill(groupId, skillName);
    this.store.upsertGroupSkill({
      groupId, skillName, hash, distributedBy: p.machineId,
      installed: gs ? gs.installed : false,
    });
    this._emit('inbox', { inboxId: item.id });
    return { ok: true };
  }
  async installInbox(itemId) {
    const it = this.store.findInbox(itemId);
    if (!it || it.status !== 'received') return { code: it ? 'not-received' : 'not-found' };
    try {
      installZip({ zip: fs.readFileSync(it.zipPath), skillName: it.skillName, destRoot: this.skillRoot() });
    } catch (e) { this.store.setInboxStatus(itemId, 'invalid'); return { code: 'invalid', error: String(e && e.message || e) }; }
    this.store.setInboxStatus(itemId, 'installed');
    if (it.groupId) {
      const gs = this.store.findGroupSkill(it.groupId, it.skillName);
      if (gs) { gs.installed = true; gs.hash = it.hash; this.store.save(); }
    }
    this._emit('synced', {});
    return { code: 'installed' };
  }

  // ---- 通用文件互传（群内）：上传方落 upload 目录并推送成员 ----
  async sendFileToGroup(groupId, { fileName, data }) {
    const name = path.basename(String(fileName || '')).trim();
    if (!name || name === '.' || name === '..') return { code: 'bad-name', pushed: 0, failures: [] };
    if (!Buffer.isBuffer(data) || data.length === 0) return { code: 'empty-file', pushed: 0, failures: [] };
    if (data.length > 40 * 1024 * 1024) return { code: 'too-large', pushed: 0, failures: [] };
    const r = this._requireMember(groupId);
    if (r.code !== 'ok') return { code: r.code, pushed: 0, failures: [] };
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    if (this.uploadDir) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
      const artifact = path.join(this.uploadDir, `${crypto.randomUUID()}-${name}`);
      fs.writeFileSync(artifact, data);
      this.store.addOutbox({ id: crypto.randomUUID(), kind: 'file', groupId, skillName: null, fileName: name, storedFile: path.basename(artifact), size: data.length, hash, createdAt: Date.now() });
    }
    const env = this._sign(CollabPeer.FILE_PUSH, { groupId, fileName: name, hash, size: data.length, b64: data.toString('base64') });
    const receipt = this.fileReceiptHeaders(data);
    const failures = [];
    let pushed = 0;
    for (const m of r.group.members) {
      if (m.machineId === this.pub.machineId) continue;
      const res = await this._post(m.host, m.port, env, receipt);
      if (res.ok) pushed++;
      else failures.push({ machineId: m.machineId, error: res.error || 'push-failed' });
    }
    this._addSystemMessage(groupId, t('collab.sys.file_sent', { name, kb: (data.length / 1024).toFixed(1) }));
    this._emit('synced', {});
    return { code: 'ok', pushed, failures };
  }
  async _inFilePush(env) {
    const p = env.from;
    const { groupId = null, fileName, hash, size, b64 } = env.payload;
    if (!fileName || typeof b64 !== 'string' || !hash) return { ok: false, error: 'bad-payload' };
    const known = this._knownProfile(p.machineId);
    if (!known) return { ok: false, error: 'unknown-sender' };
    if (groupId) {
      const g = this.store.findGroup(groupId);
      if (!g || !g.members.find((m) => m.machineId === p.machineId)) return { ok: false, error: 'not-in-group' };
    }
    const data = Buffer.from(b64, 'base64');
    if (data.length === 0 || (size != null && size !== data.length)) return { ok: false, error: 'size-mismatch' };
    if (crypto.createHash('sha256').update(data).digest('hex') !== hash) return { ok: false, error: 'hash-mismatch' };
    const itemId = crypto.randomUUID();
    fs.mkdirSync(this.downloadDir, { recursive: true });
    const safeName = path.basename(String(fileName));
    const stored = path.join(this.downloadDir, `${itemId}-${safeName}`);
    fs.writeFileSync(stored, data);
    const item = { id: itemId, kind: 'file', fromId: p.machineId, groupId, skillName: null, fileName: safeName, hash, size: data.length, zipPath: stored, status: 'received', receivedAt: Date.now() };
    this.store.addInbox(item);
    this._emit('inbox', { inboxId: item.id });
    return { ok: true };
  }
  async ignoreInbox(itemId) {
    const it = this.store.findInbox(itemId);
    if (!it) return { code: 'not-found' };
    this.store.setInboxStatus(itemId, 'ignored');
    this._emit('synced', {});
    return { code: 'ignored' };
  }

  // 删除我发出的任务：一并清掉 upload 目录留档
  removeOutbox(id) {
    const rec = this.store.listOutbox().find((r) => r.id === id);
    if (!rec) return { code: 'not-found' };
    if (rec.storedFile && this.uploadDir) {
      try { fs.unlinkSync(path.join(this.uploadDir, rec.storedFile)); } catch { /* 文件可能已不在 */ }
    }
    this.store.removeOutbox(id);
    this._emit('synced', {});
    return { code: 'ok' };
  }

  // 群系统消息留痕：本机落库并广播给全体成员（各成员以本地 seq 入库）
  _addSystemMessage(groupId, text) {
    if (!groupId || !text) return;
    const g = this.store.findGroup(groupId);
    if (!g) return;
    const msg = { id: crypto.randomUUID(), groupId, kind: 'system', fromId: this.pub.machineId, text, toId: null, ts: Date.now(), seq: this.store.nextChatSeq(), meta: null };
    this.store.addChatMessage(msg);
    this._broadcastChat(groupId, msg);
    this._emit('chat', { groupId, msg });
  }

  // ---- pull ----
  async pullSync(fromMachineId, { groupIds = null } = {}) {
    const peerProfile = this._knownProfile(fromMachineId);
    if (!peerProfile) return { code: 'no-peer' };
    const targets = groupIds || this.store.listGroups().map((g) => g.id);
    const res = await this._post(peerProfile.host, peerProfile.port, this._sign(CollabPeer.PULL_SYNC, { groupIds: targets }));
    if (!res.ok) return { code: 'failed', error: res.error };
    return { code: 'ok', data: res.data };
  }
  _inPullSync(env) {
    const p = env.from;
    const wanted = (env.payload.groupIds || []).slice();
    const groups = this.store.listGroups().filter((g) => wanted.includes(g.id) && g.members.find((m) => m.machineId === p.machineId));
    const data = {
      groups: groups.map((g) => ({ ...g })),
      groupSkills: groups.flatMap((g) => this.store.listGroupSkills(g.id).map((s) => ({ ...s }))),
    };
    return { ok: true, data };
  }
  // 把 pull 结果并入本地（供 http-mount /api/collab/pull 调用）
  applyPull(data) {
    if (!data) return;
    for (const g of data.groups || []) {
      const local = this.store.findGroup(g.id);
      if (!local) this.store.upsertGroup({ ...g });
      else {
        for (const m of g.members || []) if (!local.members.find((x) => x.machineId === m.machineId)) local.members.push(m);
        this.store.saveGroup(local);
      }
    }
    for (const s of data.groupSkills || []) {
      const local = this.store.findGroupSkill(s.groupId, s.skillName);
      if (!local) this.store.upsertGroupSkill({ groupId: s.groupId, skillName: s.skillName, hash: s.hash, distributedBy: s.distributedBy, installed: false });
    }
    this._emit('synced', {});
  }
  // 更新本机已注册的 host/port（供 http-mount 启动后刷新公开地址）
  setAdvertised({ host, port }) {
    if (host) this.identity.host = host;
    if (port) this.identity.port = port;
    this.store.data.identity = { ...this.identity };
    this.store.save();
  }
}

// ================= 群聊 与 @ 远程执行（追加到 CollabEngine 的方法以 mixin 形式扩展） =================
// 说明：以下方法经由 _extendChat(engine) 挂载，保持 engine.js 原文件职责清晰、隔离新增逻辑。
export function _extendChat(engine) {
  engine._requireMember = function _requireMember(groupId, machineId = this.pub.machineId) {
    const g = this.store.findGroup(groupId);
    if (!g) return { code: 'no-group', group: null, me: null };
    const me = g.members.find((m) => m.machineId === machineId);
    if (!me) return { code: 'not-member', group: g, me: null };
    return { code: 'ok', group: g, me };
  };
  engine._broadcastChat = async function _broadcastChat(groupId, msg) {
    const g = this.store.findGroup(groupId);
    if (!g) return;
    const env = this._sign(CollabPeer.CHAT_SEND, { msg });
    for (const m of g.members) {
      if (m.machineId === this.pub.machineId) continue;
      await this._post(m.host, m.port, env);
    }
  };
  engine.sendChat = async function sendChat({ groupId, text, toId = null }) {
    const r = this._requireMember(groupId);
    if (r.code !== 'ok') return { code: r.code };
    if (toId && !r.group.members.find((m) => m.machineId === toId)) return { code: 'no-target' };
    const msg = { id: crypto.randomUUID(), groupId, kind: 'text', fromId: this.pub.machineId, text, toId, ts: Date.now(), seq: this.store.nextChatSeq() };
    this.store.addChatMessage(msg);
    this._broadcastChat(groupId, msg);
    this._emit('chat', { groupId, msg });
    return { code: 'ok', msg };
  };
  engine._inChatSend = async function _inChatSend(env) {
    const p = env.from;
    const msg = env.payload.msg;
    if (!msg || msg.groupId == null || typeof msg.text !== 'string') return { ok: false, error: 'bad-msg' };
    const r = this._requireMember(msg.groupId, p.machineId);
    if (r.code !== 'ok') return { ok: false, error: 'not-member' };
    this.store.addChatMessage({ ...msg, seq: this.store.nextChatSeq(), ts: msg.ts ?? Date.now() });
    this._emit('chat', { groupId: msg.groupId, msg });
    return { ok: true };
  };
  engine.requestRemoteExec = async function requestRemoteExec({ groupId, text, toId }) {
    const r = this._requireMember(groupId);
    if (r.code !== 'ok') return { code: r.code };
    const target = r.group.members.find((m) => m.machineId === toId);
    if (!target) return { code: 'no-target' };
    const reqId = crypto.randomUUID();
    const env = this._sign(CollabPeer.CMD_REQ, { groupId, text, toId, reqId });
    const res = await this._post(target.host, target.port, env);
    if (!res.ok) {
      const msg = { id: crypto.randomUUID(), groupId, kind: 'system', fromId: this.pub.machineId, text: t('collab.sys.cmd_undelivered', { name: target.username }), toId, ts: Date.now(), seq: this.store.nextChatSeq(), meta: null };
      this.store.addChatMessage(msg);
      this._emit('chat', { groupId, msg });
      return { code: 'undelivered', reqId };
    }
    return { code: 'sent', reqId };
  };
  engine._inCmdReq = async function _inCmdReq(env) {
    const p = env.from;
    const { groupId, text, toId, reqId } = env.payload;
    if (!groupId || typeof text !== 'string' || !toId || !reqId) return { ok: false, error: 'bad-request' };
    if (toId !== this.pub.machineId) return { ok: true };
    const r = this._requireMember(groupId, p.machineId);
    if (r.code !== 'ok') return { ok: false, error: 'not-member' };
    if (this.store.isAllowed(text)) {
      this._runCmd({ reqId, groupId, fromId: p.machineId, text, auto: true });
      return { ok: true };
    }
    this.store.addPendingCmd({ id: reqId, groupId, fromId: p.machineId, text, receivedAt: Date.now() });
    this._emit('cmd-pending', { reqId, groupId, fromId: p.machineId, text });
    return { ok: true };
  };
  engine._runCmd = async function _runCmd({ reqId, groupId, fromId, text }) {
    let res;
    try { res = await this.runner.execute({ text, cwd: process.cwd() }); }
    catch (e) { res = { stdout: '', stderr: String(e && e.message || e), exitCode: -1, timedOut: false, durationMs: 0, spawnError: true }; }
    const msg = { id: crypto.randomUUID(), groupId, kind: 'cmd-result', fromId: this.pub.machineId,
      text: res.stdout || '(no output)', toId: fromId, ts: Date.now(), seq: this.store.nextChatSeq(),
      meta: { reqId, exitCode: res.exitCode, stderr: res.stderr || '', durationMs: res.durationMs ?? 0 } };
    this.store.addChatMessage(msg);
    this._broadcastChat(groupId, msg);
    this._emit('chat', { groupId, msg });
  };
  engine.approveCmd = async function approveCmd({ reqId, approve }) {
    const pending = this.store.findPendingCmd(reqId);
    if (!pending) return { code: 'not-found' };
    this.store.removePendingCmd(reqId);
    if (!approve) {
      const msg = { id: crypto.randomUUID(), groupId: pending.groupId, kind: 'system', fromId: this.pub.machineId,
        text: t('collab.sys.cmd_denied', { from: pending.fromId }), toId: pending.fromId, ts: Date.now(), seq: this.store.nextChatSeq(), meta: null };
      this.store.addChatMessage(msg);
      this._broadcastChat(pending.groupId, msg);
      this._emit('chat', { groupId: pending.groupId, msg });
      return { code: 'denied' };
    }
    this._runCmd({ reqId: pending.id, groupId: pending.groupId, fromId: pending.fromId, text: pending.text });
    return { code: 'approved' };
  };
  engine._inCmdConfirm = function _inCmdConfirm() {
    return { ok: true };
  };
  engine._inCmdResult = function _inCmdResult(env) {
    const p = env.from;
    const { groupId } = env.payload;
    const r = this._requireMember(groupId, p.machineId);
    if (r.code !== 'ok') return { ok: false, error: 'not-member' };
    const { reqId = null, stdout = '', stderr = '', exitCode = null, durationMs = 0 } = env.payload;
    const msg = { id: crypto.randomUUID(), groupId, kind: 'cmd-result', fromId: p.machineId,
      text: stdout || '(no output)', toId: env.payload.toId ?? null, ts: Date.now(), seq: this.store.nextChatSeq(),
      meta: { reqId, exitCode, stderr, durationMs } };
    this.store.addChatMessage(msg);
    this._emit('chat', { groupId, msg });
    return { ok: true };
  };
  engine.listChat = function listChat(groupId, { afterSeq = 0 } = {}) { return this.store.listChatMessages(groupId, { afterSeq }); };
  engine.pullChatFrom = async function pullChatFrom(fromMachineId, { groupId }) {
    const peerProfile = this._knownProfile(fromMachineId);
    if (!peerProfile) return { code: 'no-peer' };
    const afterSeq = this.store.lastSeqOf(groupId);
    const res = await this._post(peerProfile.host, peerProfile.port, this._sign(CollabPeer.CHAT_PULL, { groupId, afterSeq }));
    if (!res.ok) return { code: 'failed', error: res.error };
    return { code: 'ok', messages: res.data?.messages || [] };
  };
  engine.applyChatPull = function applyChatPull({ groupId, messages }) {
    if (!groupId || !Array.isArray(messages)) return;
    const existing = new Set(this.store.listChatMessages(groupId).map((m) => m.id));
    for (const m of messages) {
      if (existing.has(m.id)) continue;
      this.store.addChatMessage({ ...m, seq: this.store.nextChatSeq(), ts: m.ts ?? Date.now() });
    }
    this._emit('chat', { groupId, msg: null });
  };
  engine._inChatPull = function _inChatPull(env) {
    const p = env.from;
    const { groupId, afterSeq = 0 } = env.payload;
    const r = this._requireMember(groupId, p.machineId);
    if (r.code !== 'ok') return { ok: false, error: 'not-member' };
    const messages = this.store.listChatMessages(groupId, { afterSeq });
    return { ok: true, data: { messages } };
  };
  engine.listPendingCmds = function listPendingCmds() { return this.store.listPendingCmds(); };
  engine.listAllowlist = function listAllowlist() { return this.store.listAllowlist(); };
  engine.allowCmd = function allowCmd(prefix) { if (typeof prefix === 'string' && prefix) { this.store.addAllowEntry(prefix.trim()); return { code: 'ok' }; } return { code: 'bad' }; };
  engine.disallowCmd = function disallowCmd(prefix) { this.store.removeAllowEntry(prefix); return { code: 'ok' }; };
  return engine;
}

// ---- 测试双节点 harness（直连 transport，不走 http）----
export async function createPairHarness({ skipSkills = false, dir = null } = {}) {
  const base = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'collab-pair-'));
  const ports = [39991, 39992];
  async function makeNode(idx, name) {
    const nodeDir = path.join(base, name);
    const skillsRoot = path.join(nodeDir, 'skills');
    const uploadDir = path.join(nodeDir, 'upload');
    const downloadDir = path.join(nodeDir, 'download');
    fs.mkdirSync(downloadDir, { recursive: true });
    fs.mkdirSync(uploadDir, { recursive: true });
    if (!skipSkills) fs.mkdirSync(skillsRoot, { recursive: true });
    const store = new CollabStore({ file: path.join(nodeDir, 'collab.json') });
    const identity = loadIdentity({ file: path.join(nodeDir, 'identity.json'), username: name, host: '127.0.0.1', port: ports[idx] });
    return { store, identity, skillsRoot, uploadDir, downloadDir };
  }
  const A0 = await makeNode(0, 'alice');
  const B0 = await makeNode(1, 'bob');
  const engA = new CollabEngine({ store: A0.store, identity: A0.identity, skillsRoot: A0.skillsRoot, uploadDir: A0.uploadDir, downloadDir: A0.downloadDir });
  const engB = new CollabEngine({ store: B0.store, identity: B0.identity, skillsRoot: B0.skillsRoot, uploadDir: B0.uploadDir, downloadDir: B0.downloadDir });
  // 直连 transport：A 发的投给 B 的 handleIncoming，B 发的投给 A（忽略 host/port）
  const forward = async (eng, host, port, envelope) => {
    const r = await eng.handleIncoming(JSON.parse(JSON.stringify(envelope)));
    return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
  };
  engA.peer = { post: (host, port, envelope) => forward(engB, host, port, envelope) };
  engB.peer = { post: (host, port, envelope) => forward(engA, host, port, envelope) };
  engA.engine = engA;   // 供测试 B.engine.handleIncoming 这类写法
  engB.engine = engB;
  engA.skillsRoot = A0.skillsRoot;   // 兼容旧测试直接引用技能根
  engB.skillsRoot = B0.skillsRoot;
  return {
    nodes: [engA, engB],   // 直接返回引擎：A.requestFriend / A.store / A.skillsRoot 均可用
    async stop() {},
  };
}
