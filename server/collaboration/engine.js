import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { CollabPeer } from '@devflow/shared/collab';
import { serializeWorkflowsFragment } from '@devflow/shared/workflow-xml';

// 成员从群主拉聊天时的单次上限（群主侧保留全量，按需分页拉取）
const CHAT_PULL_LIMIT = 20000;
// 群聊图片消息：白名单 + 大小上限（base64 内嵌 meta，故限制较小）
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
import { CollabStore } from './store.js';
import { loadIdentity, toPublicProfile, detectHost } from './identity.js';
import { signEnvelope, verifyEnvelope, signHash, verifyHash } from './sign.js';
import { packSkill } from './skill-packer.js';
import { installZip } from './skill-installer.js';
import { installBundleZip } from './bundle-installer.js';
import { buildManifest } from './asset-manifest.js';
import { stageImport as stageImportAsset, applyImport as applyImportAsset, discardImport as discardImportAsset, cleanupStagedImports as cleanupStagedImportsAsset } from './asset-import.js';
import { distKindsOf, distTypeOf, distUrl, shouldProcess, downloadAddrOf } from './dist-task.js';
import { buildZip } from './zip.js';
import { createOpenCodeRunner } from './remote-runner.js';
import { nextVersion } from './sync-seed.js';
import { createDownloadStore } from '../download-store.js';
import { createSyncStore } from '../sync-store.js';
import { t } from '../i18n.js';
import { agentSkillsDir, listAgentOptions, resolveSkillRoot } from './agent-skills.js';

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
// 监听地址是通配时（0.0.0.0/::），对外展示/上报用本机真实网卡 IP
function isWildcardHost(h) { return !h || h === '0.0.0.0' || h === '::' || h === '::0'; }
// 成员展示名：工号（无则系统用户名）@IP:端口
export function profileLabel(p) {
  if (!p) return '';
  const id = String(p.employeeId || p.username || '').trim();
  const host = p.host || '127.0.0.1';
  return id ? `${id}@${host}:${p.port || 0}` : `${host}:${p.port || 0}`;
}

// events 注入（便于 web 层广播到浏览器 /ws）；peer 注入（真实 HTTP 或测试直连）
export class CollabEngine {
  constructor({ store, identity, events = null, peer = null, peers = null, seedStore = null, collabDb = null, taskStore = null, downloadStore = null, syncStore = null, skillsRoot = null, inboxDir = null, uploadDir = null, downloadDir = null, downloadsDir = null, runner = null, logger = console, getWorkflows = null, mergeWorkflows = null, getAgents = null }) {
    this.store = store;
    this.identity = identity;      // { machineId, username, host, port, publicKey, privateKey }
    this.peers = peers;            // 用量上报库（master 侧），见 server/usage-peers.js
    this.seedStore = seedStore;    // 种子表（SQLite），见 server/seed-store.js
    this.collabDb = collabDb;      // 群成员/命令/消息表（SQLite），见 server/collab-db.js
    this.taskStore = taskStore;    // 本机任务表（SQLite），见 server/task-store.js
    this.events = events;
    this.peer = peer;              // { post(host, port, envelope) -> Promise<{ok, data?, error?}> }
    this.skillDefaultRoot = skillsRoot;   // opencode 技能根（env 覆盖优先）
    this.uploadDir = uploadDir;           // 发出的 zip 落盘目录
    this.downloadDir = downloadDir || inboxDir;   // 收到的 zip 落盘目录（下载页目录）
    this.downloadsDir = downloadsDir || path.join(os.tmpdir(), `devflow-downloads-${identity?.machineId || 'x'}`);
    this.downloadStore = downloadStore || createDownloadStore({ file: ':memory:', logger });   // 下载索引（SQLite）
    this.syncStore = syncStore || createSyncStore({ file: ':memory:', logger });               // 同步种子/记录（SQLite）
    this.runner = runner || createOpenCodeRunner();
    this.getWorkflows = typeof getWorkflows === 'function' ? getWorkflows : null;
    this.mergeWorkflows = typeof mergeWorkflows === 'function' ? mergeWorkflows : null;
    this.getAgents = typeof getAgents === 'function' ? getAgents : null;   // 返回 { default, list }
    this.log = logger;
    _extendChat(this);
  }
  get pub() { return toPublicProfile(this.identity); }

  // 当前生效的工具选择（未选择时兜底 devflow 默认 agent）
  effectiveTool() {
    const tool = this.store.getTool() || {};
    const cfg = this.getAgents ? this.getAgents() : null;
    return { agentId: tool.agentId || cfg?.default || 'opencode', customRoot: tool.customRoot || null };
  }
  // 本机选定的 agent → 技能根目录（分发打包源 & 安装目标）
  skillRoot() {
    const cfg = this.getAgents ? this.getAgents() : null;
    const tool = this.effectiveTool();
    return resolveSkillRoot({
      selected: tool.agentId,
      customRoot: tool.customRoot,
      agents: cfg?.list || [],
      defaultSkillsRoot: this.skillDefaultRoot,
    });
  }
  getToolInfo() {
    const cfg = this.getAgents ? this.getAgents() : null;
    const tool = this.effectiveTool();
    return {
      tool,
      root: this.skillRoot(),
      selected: tool.agentId,
      agents: listAgentOptions({ agents: cfg?.list || [], selected: tool.agentId }),
    };
  }
  setTool({ agentId, customRoot } = {}) {
    const cfg = this.getAgents ? this.getAgents() : null;
    const list = cfg?.list || [];
    if (agentId === 'custom') {
      const root = customRoot && String(customRoot).trim();
      if (!root) return { code: 'need-custom-root' };
      this.store.setTool({ agentId: 'custom', customRoot: root });
      this._emit('synced', {});
      return { code: 'ok', ...this.getToolInfo() };
    }
    const agent = list.find((a) => a.id === agentId);
    if (!agent) return { code: 'unknown-agent' };
    if (!agentSkillsDir(agent)) return { code: 'agent-unavailable' };
    this.store.setTool({ agentId, customRoot: null });
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
    out.workflow = (this.getWorkflows ? this.getWorkflows() : []).map((w) => ({ id: w.id, name: w.label }));
    return out;
  }
  // 第一步：打包（只生成本地 zip + outbox 未发送记录，不推送）
  async buildPackage({ skills = [], command = [], agent = [], workflow = [] }) {
    const sSel = [...new Set(skills || [])];
    const cSel = [...new Set(command || [])];
    const aSel = [...new Set(agent || [])];
    const wSel = [...new Set(workflow || [])];
    const pickedWorkflows = [];
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
    for (const id of wSel) {
      assertSafeRel(id);
      const w = (this.getWorkflows ? this.getWorkflows() : []).find((x) => x.id === id);
      if (w) pickedWorkflows.push(w);
    }
    // 工作流勾选后打成一份 XML（与 devflow.xml 的 <workflow> 片段同构）
    if (pickedWorkflows.length) {
      files.push({ rel: 'workflow/workflows.xml', data: Buffer.from(serializeWorkflowsFragment(pickedWorkflows), 'utf8') });
    }
    if (!files.length) throw new Error(t('collab.err.no_content'));
    // 种子明细：skill 有哪些文件 / workflow 有哪些阶段，以及各自最后更新时间
    const skillStat = (n) => { try { return fs.statSync(path.join(this.skillRoot(), n)).mtimeMs; } catch { return 0; } };
    const skillsUpdatedAt = (() => {
      let max = 0;
      for (const n of sSel) max = Math.max(max, skillStat(n));
      return max || Date.now();
    })();
    let workflowUpdatedAt = Date.now();
    try { const v = Number(this.getWorkflowsUpdatedAt?.()); if (v > 0) workflowUpdatedAt = v; } catch { /* 取不到就用打包时间 */ }
    const skillDetails = [];
    for (const n of sSel) {
      let size = null; let hash = null;
      try { const p = await packSkill(path.join(this.skillRoot(), n)); size = p.zip.length; hash = p.hash; } catch { /* 目录异常时留空 */ }
      skillDetails.push({
        name: n,
        files: files.filter((f) => f.rel.startsWith(`skills/${n}/`)).length,
        updatedAt: skillStat(n) || null,
        size,
        hash,
      });
    }
    const detail = {
      skills: skillDetails,
      workflow: pickedWorkflows.map((w) => ({ id: w.id, label: w.label, stages: (w.stages || []).length })),
    };
    files.push({
      rel: 'Manifest.json',
      data: Buffer.from(JSON.stringify(buildManifest({
        selection: { skills: sSel, command: cSel, agent: aSel, workflow: wSel },
        details: {
          skills: skillDetails,
          command: cSel.map((name) => ({ name })),
          agent: aSel.map((name) => ({ name })),
          workflow: pickedWorkflows.map((w) => ({ id: w.id, label: w.label, stages: (w.stages || []).length })),
        },
        source: { machineId: this.pub.machineId, host: this.pub.host, port: this.pub.port, employeeId: this.pub.employeeId || '' },
      })), 'utf8'),
    });
    const zip = buildZip(files.map((f) => ({ name: f.rel, data: f.data })));
    const hash = crypto.createHash('sha256').update(zip).digest('hex');
    const total = sSel.length + cSel.length + aSel.length + wSel.length;
    const label = `assets-${total}-${hash.slice(0, 6)}.zip`;
    if (!this.uploadDir) throw new Error(t('collab.err.no_upload_dir'));
    fs.mkdirSync(this.uploadDir, { recursive: true });
    fs.writeFileSync(path.join(this.uploadDir, label), zip);
    // 同时落一份到本机 download 目录（用户在「download」里能直接拿到 zip）
    if (this.downloadDir) {
      try {
        fs.mkdirSync(this.downloadDir, { recursive: true });
        fs.writeFileSync(path.join(this.downloadDir, label), zip);
      } catch { /* download 目录不可写时忽略 */ }
    }
    // 再落一份到共享 downloads 目录并登记索引（打包产物在应用市场可见）
    try {
      this.writeDownload(label, zip, 'skill');
    } catch { /* downloads 目录不可写时忽略 */ }
    const rec = this.store.addOutbox({
      id: crypto.randomUUID(), kind: 'file', groupId: null, skillName: null, fileName: label,
      storedFile: label, size: zip.length, hash, createdAt: Date.now(),
      package: { sent: false, skills: sSel, command: cSel, agent: aSel, workflow: wSel },
    });
    // 打包即入「种子表」（SQLite）：记录 zip 与其内容，供查询/发布追踪
    try {
      this.seedStore?.add?.({
        id: rec.id, fileName: label, hash, size: zip.length, count: total,
        skills: sSel, command: cSel, agent: aSel, workflow: wSel, createdAt: rec.createdAt,
        skillsUpdatedAt, workflowUpdatedAt, detail,
      });
    } catch { /* 种子表不可用时不影响打包 */ }
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
      skills: pkg.skills || [], command: pkg.command || [], agent: pkg.agent || [], workflow: pkg.workflow || [],
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
    if ((pkg.workflow || []).length) {
      const wf = this.getWorkflows ? this.getWorkflows() : [];
      const labels = (pkg.workflow || []).map((id) => (wf.find((w) => w.id === id) || {}).label || id);
      parts.push(t('collab.sys.part.workflow', { names: labels.join('、') }));
    }
    this._addSystemMessage(groupId, t('collab.sys.pkg_distributed', { parts: parts.join(t('collab.sys.part_sep')) }));
    this._emit('synced', {});
    return { code: 'ok', pushed, failures };
  }

  _emit(type, payload) { if (this.events) this.events.emit(type, payload); }
  // 分发通知：发布成功后广播一条 kind:'dist' 群消息（正文含类型与下载地址，meta 带结构化字段）
  _broadcastDist(groupId, info) {
    const g = this.store.findGroup(groupId);
    if (!g) return null;
    const meta = { target: 'all', type: distTypeOf(info), url: distUrl(this.pub.host, this.pub.port, info.name), ...info };
    const text = t(`collab.dist.msg.${meta.type}`, { name: info.name, count: info.count || 0, url: meta.url });
    const msg = {
      id: crypto.randomUUID(), groupId, kind: 'dist', fromId: this.pub.machineId, text,
      toId: null, ts: Date.now(), seq: this.store.nextChatSeq(), meta,
    };
    this.store.addChatMessage(msg);
    this._logMessage({ groupId, id: msg.id, src: msg.fromId, target: 'all', message: text, ts: msg.ts });
    this._broadcastChat(groupId, msg);
    this._emit('chat', { groupId, msg });
    return msg;
  }

  // ---- 本机任务表：分发通知落任务 ----
  listTasks(filter = {}) { return this.taskStore?.list?.(filter) || []; }
  _advanceCursor(groupId, msg) {
    if (!groupId || !msg) return;
    try { this.taskStore?.advanceCursor?.(groupId, Number(msg.ts) || 0, msg.id); } catch { /* ignore */ }
  }
  // 一条 kind:'dist' 群消息 → 本机任务（按类型各一条；同 hash 幂等）
  ingestDist(msg) {
    if (!msg || msg.kind !== 'dist' || !msg.groupId || !msg.meta) return { code: 'skip' };
    const g = this.store.findGroup(msg.groupId);
    if (!g) return { code: 'no-group' };
    if (msg.fromId === this.pub.machineId) return { code: 'self' };                 // 群主本机不建任务
    if (msg.fromId !== g.hubId) return { code: 'not-hub' };                         // 只认群主的通知
    if (!g.members.find((m) => m.machineId === this.pub.machineId)) return { code: 'not-member' };
    const meta = msg.meta;
    if (!meta.hash || !meta.name) return { code: 'bad-meta' };
    if (meta.type && !['skills', 'workflow', 'mixed'].includes(String(meta.type))) return { code: 'bad-meta' };
    const kinds = distKindsOf(meta);
    if (!kinds.length) return { code: 'bad-meta' };
    const payload = {
      skills: meta.skills || [], command: meta.command || [], agent: meta.agent || [], workflow: meta.workflow || [],
      count: Number(meta.count) || 0, size: Number(meta.size) || 0,
      skillsUpdatedAt: Number(meta.skillsUpdatedAt) || 0, workflowUpdatedAt: Number(meta.workflowUpdatedAt) || 0,
    };
    const created = [];
    for (const kind of kinds) {
      const r = this.taskStore?.upsert?.({
        id: crypto.randomUUID(), groupId: msg.groupId, hubId: g.hubId, kind, hash: String(meta.hash),
        name: String(meta.name), url: String(meta.url || ''), payload, status: 'pending',
        messageId: msg.id, createdAt: Date.now(), updatedAt: Date.now(),
      });
      if (r?.created) created.push(kind);
    }
    this._emit('tasks', { groupId: msg.groupId, created, msgId: msg.id });
    return { code: 'ok', created };
  }
  // 启动补扫：拉各群历史聊天，把错过的分发通知补成任务（失败只记日志，等下次心跳/拉取）
  async backfillDistTasks() {
    const groups = this.store.listGroups()
      .filter((g) => g.hubId !== this.pub.machineId && g.members.find((m) => m.machineId === this.pub.machineId));
    let scanned = 0;
    let pending = 0;
    for (const g of groups) {
      try {
        const r = await this.pullChatFrom(g.hubId, { groupId: g.id });
        if (r.code !== 'ok' || !Array.isArray(r.messages) || !r.messages.length) continue;
        scanned += r.messages.filter((m) => m.kind === 'dist').length;
        this.applyChatPull({ groupId: g.id, messages: r.messages });
        pending += this.listTasks({ groupId: g.id, status: 'pending' }).length;
      } catch (e) { this.log?.warn?.('dist backfill failed', (e && e.message) || e); }
    }
    return { code: 'ok', groups: groups.length, distMessages: scanned, pending };
  }
  // 定时轮询：补分发任务 + 取各 master 最新升级 version（失败忽略，不阻塞）
  async pollDistTasks() {
    const groups = this.store.listGroups()
      .filter((g) => g.hubId !== this.pub.machineId && g.members.find((m) => m.machineId === this.pub.machineId));
    try { await this.backfillDistTasks(); } catch (e) { this.log?.warn?.('poll backfill failed', (e && e.message) || e); }
    const updates = [];
    for (const g of groups) {
      try {
        const c = await this.checkUpdate(g.hubId);
        if (c.code === 'ok' && c.newer && c.update) updates.push({ groupId: g.id, masterId: c.masterId, version: c.update.version });
      } catch { /* 单个 master 失败忽略 */ }
    }
    return { code: 'ok', groups: groups.length, tasks: this.listTasks({ status: 'pending' }).length, updates };
  }
  _sign(type, payload) {
    return signEnvelope(this.identity.privateKey, type, this.pub, payload);
  }
  async _post(host, port, env, headers = null, path = '/api/collab/peer') {
    if (!this.peer) { this.log?.warn?.('peer transport not configured'); return { ok: false, error: 'no-transport' }; }
    try { return await this.peer.post(host, port, env, headers, path); }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }
  // 按公钥反查已知身份（单例群成员），供接收方头部公钥鉴权
  profileByPublicKey(pem) {
    if (!pem) return null;
    for (const g of this.store.listGroups()) {
      const m = g.members.find((x) => x.publicKey === pem);
      if (m) return m;
    }
    return null;
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
      case CollabPeer.MEMBER_INFO: return this._inMemberInfo(env);
      case CollabPeer.SKILL_PUSH: return this._inSkillPush(env);
      case CollabPeer.FILE_PUSH: return this._inFilePush(env);
      case CollabPeer.PULL_SYNC: return this._inPullSync(env);
      case CollabPeer.CHAT_SEND: return this._inChatSend(env);
      case CollabPeer.CMD_REQ: return this._inCmdReq(env);
      case CollabPeer.CMD_CONFIRM: return this._inCmdConfirm(env);
      case CollabPeer.CMD_RESULT: return this._inCmdResult(env);
      case CollabPeer.CHAT_PULL: return this._inChatPull(env);
      case CollabPeer.PULL_DOWNLOADS: return this._inPullDownloads(env);
      case CollabPeer.UPDATE_CHECK: return this._inUpdateCheck(env);
      case CollabPeer.LIST_DOWNLOADS: return this._inListDownloads(env);
      case CollabPeer.PKG_UPLOAD: return this._inPkgUpload(env);
      case CollabPeer.USAGE_PULL: return this._inUsagePull(env);
      default: return { ok: false, error: 'unknown-type' };
    }
  }
  _knownProfile(machineId) {
    if (!machineId) return null;
    for (const g of this.store.listGroups()) {
      const m = g.members.find((x) => x.machineId === machineId);
      if (m) return m;
    }
    return null;
  }

  // ---- 群组（hub = 开启远程访问并分享链接者）----
  ensureGroup() {
    const name = profileLabel(this.pub);
    let g = this.store.ownedGroup(this.pub.machineId);
    if (!g) g = this.store.ensureGroup({ name, hubId: this.pub.machineId, self: this.pub });
    else if (g.name !== name) { g.name = name; this.store.upsertGroup(g); }
    this._emit('synced', {});
    return g;
  }
  joinByLink({ host, port, token }) {
    const env = this._sign(CollabPeer.GROUP_JOIN, { token });
    return this._post(host, port, env).then((res) => {
      if (!res.ok) return { code: res.error === 'bad-token' ? 'bad-token' : 'unreachable', error: res.error };
      const group = res.data && res.data.group;
      if (!group) return { code: 'unreachable' };
      this.store.upsertGroup(group);
      this._emit('synced', {});
      // 入群即知道 master 的地址与邀请令牌：交给上层作为「默认用量上报目标」
      try { this.onJoined?.({ host, port: Number(port), token, group }); } catch { /* ignore */ }
      return { code: 'joined', group };
    });
  }
  async _inJoin(env) {
    if (typeof this.verifyAccessToken !== 'function' || !this.verifyAccessToken(env.payload && env.payload.token)) {
      return { ok: false, error: 'bad-token' };
    }
    const g = this.store.ownedGroup(this.pub.machineId) || this.ensureGroup();
    g.hubId = this.pub.machineId;
    this.store.addGroupMember(g.id, env.from);
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
  // 群公告：仅群主（hub）可改，改完随 member-sync 下发给成员
  async setAnnouncement(text) {
    const g = this.store.ownedGroup(this.pub.machineId);
    if (!g) return { ok: false, error: 'not-hub' };
    g.announcement = String(text == null ? '' : text).slice(0, 2000);
    this.store.upsertGroup(g);
    await this._broadcastMemberSync(g);
    this._emit('synced', {});
    return { ok: true, group: g };
  }
  // 群主（hub）更换地址/名称后，用私钥签名广播给所有成员；成员据此把群主指到新的
  async renameGroup(name) {
    const g = this.store.ownedGroup(this.pub.machineId);
    if (!g) return { ok: false, error: 'not-hub' };
    g.name = String(name == null ? '' : name).trim() || profileLabel(this.pub);
    g.hubId = this.pub.machineId;
    const self = g.members.find((m) => m.machineId === this.pub.machineId);
    const me = { host: this.pub.host, port: this.pub.port, username: this.pub.username, employeeId: this.pub.employeeId || '' };
    if (self) Object.assign(self, me); else g.members.push({ ...this.pub });
    this.store.upsertGroup(g);
    await this._broadcastMemberSync(g);
    this._emit('synced', {});
    return { ok: true, group: g };
  }
  // 启动时：我是群主且对外地址（host/port）变了 → 自动签名广播一次（无需手动按钮）
  async announceIfMoved() {
    const g = this.store.ownedGroup(this.pub.machineId);
    if (!g) return { ok: false, error: 'not-hub' };
    const expect = profileLabel(this.pub);
    const hub = (g.members || []).find((m) => m.machineId === this.pub.machineId);
    const moved = !hub || hub.host !== this.pub.host || Number(hub.port) !== Number(this.pub.port);
    if (g.name === expect && !moved) return { ok: true, unchanged: true };
    return this.renameGroup(expect);
  }
  // 我拥有的 command 名单（供入群注册）
  myCommands() {
    const root = this.assetDir('command');
    if (!root || !fs.existsSync(root)) return [];
    const files = [];
    collectTree(root, '', files);
    return files.map((f) => f.rel).sort();
  }
  // 启动/入群：把自己的成员资料 + command 注册到群里（hub 落 SQLite，成员报给 hub）
  async registerSelfAssets() {
    this.myCmdCache = this.myCommands();
    const groups = this.store.listGroups().filter((g) => g.members.find((m) => m.machineId === this.pub.machineId));
    for (const g of groups) {
      const me = g.members.find((m) => m.machineId === this.pub.machineId);
      Object.assign(me, {
        host: this.pub.host, port: this.pub.port, username: this.pub.username,
        employeeId: this.pub.employeeId || '', commands: this.myCmdCache,
      });
      this.store.upsertGroup(g);
      this._registerToDb(g, me);
      if (g.hubId === this.pub.machineId) await this._broadcastMemberSync(g);
      else {
        const hub = g.members.find((m) => m.machineId === g.hubId);
        if (hub) {
          await this._post(hub.host, hub.port, this._sign(CollabPeer.MEMBER_INFO, { groupId: g.id, profile: me, commands: this.myCmdCache }))
            .catch(() => { /* hub 离线时下次启动再报 */ });
        }
      }
    }
    this._emit('synced', {});
    return { ok: true, groups: groups.length, commands: this.myCmdCache.length };
  }
  _registerToDb(g, member) {
    if (!this.collabDb || !g || !member) return;
    try {
      this.collabDb.registerMember({
        groupId: g.id, machineId: member.machineId, username: member.username, employeeId: member.employeeId,
        host: member.host, port: member.port, publicKey: member.publicKey,
      });
      if (Array.isArray(member.commands)) this.collabDb.setCommands({ groupId: g.id, machineId: member.machineId, commands: member.commands });
    } catch { /* 表不可用不影响协作 */ }
  }
  _logMessage({ groupId, id, src, target = null, message = '', command = null, ts = Date.now() }) {
    if (!this.collabDb) return;
    try { this.collabDb.addMessage({ id, groupId, src, target, message, command, updateTime: ts }); } catch { /* ignore */ }
  }
  _isHub(groupId) {
    const g = this.store.findGroup(groupId);
    return !!g && g.hubId === this.pub.machineId;
  }
  _inMemberInfo(env) {
    const p = env.from;
    const g = this.store.findGroup(env.payload && env.payload.groupId) || this.store.getGroup();
    if (!g || g.hubId !== this.pub.machineId) return { ok: false, error: 'not-hub' };
    const m = g.members.find((x) => x.machineId === p.machineId);
    if (!m) return { ok: false, error: 'not-member' };
    const prof = (env.payload && env.payload.profile) || {};
    Object.assign(m, {
      host: prof.host || m.host, port: prof.port || m.port,
      username: prof.username || m.username, employeeId: prof.employeeId || m.employeeId || '',
      commands: Array.isArray(env.payload && env.payload.commands) ? env.payload.commands : (m.commands || []),
    });
    this.store.upsertGroup(g);
    this._registerToDb(g, m);
    this._broadcastMemberSync(g);
    this._emit('synced', {});
    return { ok: true };
  }
  _inMemberSync(env) {
    const g = env.payload.group;
    if (!g || !Array.isArray(g.members)) return { ok: false, error: 'bad-payload' };
    const local = this.store.findGroup(g.id);
    if (!local) this.store.upsertGroup({ ...g });
    else {
      for (const m of g.members) if (!local.members.find((x) => x.machineId === m.machineId)) local.members.push(m);
      // 只认「当前群主」发来的群资料变更（口令：换地址 / 换新群主都由旧群主签名告知）
      if (local.hubId === env.from.machineId) {
        if (typeof g.name === 'string' && g.name) local.name = g.name;
        if (typeof g.announcement === 'string') local.announcement = g.announcement;
        if (typeof g.hubId === 'string' && g.hubId) local.hubId = g.hubId;
        const hub = (g.members || []).find((m) => m.machineId === local.hubId);
        if (hub) {
          const stale = local.members.find((m) => m.machineId === hub.machineId);
          if (stale) Object.assign(stale, { host: hub.host, port: hub.port, username: hub.username, employeeId: hub.employeeId });
          else local.members.push({ ...hub });
        }
      }
      this.store.upsertGroup(local);
      for (const m of local.members) this._registerToDb(local, m);   // 成员维护表 + 各成员的 command
    }
    this._emit('synced', {});
    return { ok: true };
  }
  // ---- downloads（master 共享目录）与心跳：索引进 SQLite，文件只留打包产物 ----
  readManifest() { return this.downloadStore.readManifest(); }
  _writeManifest(m) { this.downloadStore.replaceAll(m && m.files); }
  writeDownload(name, buf, kind) {
    if (typeof name !== 'string' || name.includes('..') || name.includes('\\')) throw new Error('unsafe name');
    const abs = path.join(this.downloadsDir, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const updatedAt = Date.now();
    this.downloadStore.upsert({ name, kind, size: buf.length, sha256, updatedAt });
    return { name, sha256, size: buf.length };
  }
  // ---- 同步种子（update.json）----
  _hubFor(masterId) {
    const groups = this.store.listGroups()
      .filter((g) => g.hubId !== this.pub.machineId && g.members.find((m) => m.machineId === this.pub.machineId));
    if (!groups.length) return null;
    const g = masterId ? groups.find((x) => x.hubId === masterId) : groups[0];
    if (!g) return null;
    const hub = g.members.find((m) => m.machineId === g.hubId);
    return hub ? { group: g, hub } : null;
  }
  publishUpdate(names) {
    const g = this.store.ownedGroup(this.pub.machineId);
    if (!g || g.hubId !== this.pub.machineId) return { code: 'not-master' };
    const wanted = new Set([...new Set(Array.isArray(names) ? names : [])]);
    const manifest = this.readManifest();
    const files = (manifest.files || [])
      .filter((f) => wanted.has(f.name))
      .map((f) => ({ name: f.name, kind: f.kind, size: f.size, sha256: f.sha256 }));
    const prev = this.readUpdate();
    const update = { version: nextVersion(prev.version, new Date()), updatedAt: Date.now(), files };
    this.syncStore.writeUpdate(update);
    this._emit('synced', {});
    return { code: 'ok', update };
  }
  readUpdate() { return this.syncStore.readUpdate(); }
  async checkUpdate(masterId) {
    const hit = this._hubFor(masterId);
    if (!hit) return { code: 'no-master' };
    const res = await this._post(hit.hub.host, hit.hub.port, this._sign(CollabPeer.UPDATE_CHECK, {}));
    if (!res.ok) return { code: 'unreachable', error: res.error };
    const update = (res.data && res.data.update) || null;
    const local = this.syncStore.readRecord(hit.hub.machineId);
    const newer = !!(update && update.version && update.version > ((local && local.version) || ''));
    return { code: 'ok', masterId: hit.hub.machineId, masterLabel: profileLabel(hit.hub), update, local, newer };
  }
  async listRemoteFiles(masterId) {
    const hit = this._hubFor(masterId);
    if (!hit) return { code: 'no-master' };
    const res = await this._post(hit.hub.host, hit.hub.port, this._sign(CollabPeer.LIST_DOWNLOADS, {}));
    if (!res.ok) return { code: 'unreachable', error: res.error };
    return {
      code: 'ok', masterId: hit.hub.machineId, masterLabel: profileLabel(hit.hub),
      manifest: (res.data && res.data.manifest) || { files: [] },
      update: (res.data && res.data.update) || null,
    };
  }
  async applyUpdate({ masterId, action } = {}) {
    const check = await this.checkUpdate(masterId);
    if (check.code !== 'ok') return { code: check.code, error: check.error };
    if (!check.update) return { code: 'no-update' };
    const reject = action === 'reject';
    let files = [];
    if (!reject) {
      const r = await this.pullDownloads((check.update.files || []).map((f) => f.name), check.masterId);
      if (r.code !== 'ok') return { code: r.code, error: r.error };
      files = r.files || [];
    }
    this.syncStore.writeRecord(check.masterId, {
      masterId: check.masterId, version: check.update.version,
      action: reject ? 'reject' : 'accept', checkedAt: Date.now(), update: check.update,
    });
    this._emit('synced', {});
    return { code: 'ok', action: reject ? 'reject' : 'accept', version: check.update.version, files };
  }
  _inUpdateCheck(env) {
    const g = this.store.ownedGroup(this.pub.machineId) || this.store.getGroup();
    if (!g || !g.members.find((m) => m.machineId === env.from.machineId)) return { ok: false, error: 'not-member' };
    return { ok: true, data: { update: this.readUpdate() } };
  }
  _inListDownloads(env) {
    const g = this.store.ownedGroup(this.pub.machineId) || this.store.getGroup();
    if (!g || !g.members.find((m) => m.machineId === env.from.machineId)) return { ok: false, error: 'not-member' };
    return { ok: true, data: { manifest: this.readManifest(), update: this.readUpdate() } };
  }
  pullDownloads(names = null, masterId = null, addr = null) {
    const hit = this._hubFor(masterId);
    const host = addr && addr.host ? addr.host : (hit && hit.hub.host);
    const port = addr && addr.port ? addr.port : (hit && hit.hub.port);
    if (!host || !port) return Promise.resolve({ code: 'no-master' });
    const payload = Array.isArray(names) && names.length ? { names } : {};
    return this._post(host, port, this._sign(CollabPeer.PULL_DOWNLOADS, payload)).then((res) => {
      if (!res.ok) return { code: 'unreachable', error: res.error };
      const data = res.data || {};
      for (const f of data.files || []) {
        const abs = path.join(this.downloadsDir, f.name);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, Buffer.from(f.b64, 'base64'));
      }
      if (data.manifest) this._writeManifest(data.manifest);
      if (data.group) this.store.upsertGroup(data.group);
      this._emit('synced', {});
      this._emit('heartbeat', {});
      return { code: 'ok', files: (data.files || []).map((f) => f.name) };
    });
  }
  pullUsageFrom(masterId = null) {
    const hit = this._hubFor(masterId);
    if (!hit) return Promise.resolve({ code: 'no-master' });
    return this._post(hit.hub.host, hit.hub.port, this._sign(CollabPeer.USAGE_PULL, {})).then((res) => {
      if (!res.ok) return { code: 'unreachable', error: res.error };
      const data = res.data || {};
      return { code: 'ok', updatedAt: data.updatedAt || 0, members: data.members || {} };
    });
  }
  _inUsagePull(env) {
    const g = this.store.ownedGroup(this.pub.machineId) || this.store.getGroup();
    if (!g || !g.members.find((m) => m.machineId === env.from.machineId)) return { ok: false, error: 'not-member' };
    return { ok: true, data: { updatedAt: Date.now(), members: (this.peers && this.peers.list) ? this.peers.list() : {} } };
  }
  _inPullDownloads(env) {
    const g = this.store.ownedGroup(this.pub.machineId) || this.store.getGroup();
    if (!g || !g.members.find((m) => m.machineId === env.from.machineId)) return { ok: false, error: 'not-member' };
    const manifest = this.readManifest();
    const wanted = Array.isArray(env.payload && env.payload.names) && env.payload.names.length
      ? new Set(env.payload.names) : null;
    const files = [];
    for (const f of manifest.files) {
      if (wanted && !wanted.has(f.name)) continue;
      const abs = path.join(this.downloadsDir, f.name);
      if (!fs.existsSync(abs)) continue;
      files.push({ name: f.name, b64: fs.readFileSync(abs).toString('base64') });
    }
      return { ok: true, data: { manifest, files, group: g } };
  }
  // master 发布捆绑包到 downloads/skills（不再 push 成员）
  publishPackage(packageId) {
    const g = this.store.ownedGroup(this.pub.machineId);
    if (!g || g.hubId !== this.pub.machineId) return { code: 'not-master' };
    const rec = this.store.listOutbox().find((r) => r.id === packageId);
    if (!rec || !rec.storedFile || !this.uploadDir) return { code: 'not-found' };
    const abs = path.join(this.uploadDir, path.basename(rec.storedFile));
    if (!fs.existsSync(abs)) return { code: 'file-missing' };
    const buf = fs.readFileSync(abs);
    // 上传的包在上传时已落共享下载目录（rec.downloadName）：复用同一 name，避免重复写一份
    const name = rec.downloadName || `skills/${crypto.randomUUID()}-${path.basename(rec.fileName || 'assets.zip')}`;
    if (!rec.downloadName || !fs.existsSync(path.join(this.downloadsDir, name))) this.writeDownload(name, buf, 'skill');
    const up = this.publishUpdate([name]);
    const version = up.code === 'ok' ? up.update.version : '';
    const pkg = rec.package || {};
    for (const skillName of (pkg.skills || [])) {
      this.store.upsertGroupSkill({ groupId: g.id, skillName, hash: rec.hash, distributedBy: this.pub.machineId, installed: true });
    }
    // 广播分发通知：成员据此在本机建任务
    const skillList = pkg.skills || [];
    const cmdList = pkg.command || [];
    const agentList = pkg.agent || [];
    const wfIds = pkg.workflow || [];
    const wfAll = this.getWorkflows ? this.getWorkflows() : [];
    const seedRec = this.seedStore?.get?.(rec.id) || null;
    const count = skillList.length + cmdList.length + agentList.length + wfIds.length;
    this._broadcastDist(g.id, {
      name, packageId: rec.id, hash: rec.hash || '', size: buf.length, count, version,
      skills: skillList, command: cmdList, agent: agentList,
      workflow: wfIds.map((id) => ({ id, label: ((wfAll.find((w) => w.id === id) || {}).label) || id })),
      skillsUpdatedAt: seedRec?.skillsUpdatedAt || 0,
      workflowUpdatedAt: seedRec?.workflowUpdatedAt || 0,
    });
    this._emit('synced', {});
    return { code: 'ok', name, size: buf.length, version };
  }
  // 成员把已打包的 zip 上传给群主，并在群里发一条审核通知
  async uploadPackageToMaster(packageId, groupId) {
    const g = this.store.findGroup(groupId);
    if (!g) return { code: 'no-group' };
    if (g.hubId === this.pub.machineId) return { code: 'is-master' };
    if (!g.members.find((m) => m.machineId === this.pub.machineId)) return { code: 'not-member' };
    const rec = this.store.listOutbox().find((r) => r.id === packageId);
    if (!rec || !rec.storedFile || !this.uploadDir) return { code: 'not-found' };
    const abs = path.join(this.uploadDir, path.basename(rec.storedFile));
    if (!fs.existsSync(abs)) return { code: 'file-missing' };
    const buf = fs.readFileSync(abs);
    const hub = g.members.find((m) => m.machineId === g.hubId);
    if (!hub) return { code: 'no-master' };
    const pkg = rec.package || {};
    const env = this._sign(CollabPeer.PKG_UPLOAD, {
      groupId, name: rec.fileName, hash: rec.hash, size: buf.length,
      b64: buf.toString('base64'), package: pkg,
    });
    const res = await this._post(hub.host, hub.port, env);
    if (!res.ok) return { code: 'unreachable', error: res.error };
    const masterPackageId = (res.data && res.data.packageId) || '';
    const masterName = (res.data && res.data.name) || '';
    const masterUrl = (res.data && res.data.url) || '';
    this._sendPkgUploadNotice(g, rec, pkg, masterPackageId, masterUrl);
    return { code: 'ok', packageId: masterPackageId, name: masterName, url: masterUrl };
  }
  // 群内通知群主：我上传了一个待审核的包（kind:'pkg-upload'）
  _sendPkgUploadNotice(g, rec, pkg, masterPackageId, masterUrl = '') {
    const count = (pkg.skills || []).length + (pkg.command || []).length + (pkg.agent || []).length + (pkg.workflow || []).length;
    const master = g.members.find((m) => m.machineId === g.hubId);
    const text = t('collab.dist.upload_notice', { name: rec.fileName || '', count, master: master ? profileLabel(master) : '' });
    const msg = {
      id: crypto.randomUUID(), groupId: g.id, kind: 'pkg-upload', fromId: this.pub.machineId,
      text, toId: g.hubId, ts: Date.now(), seq: this.store.nextChatSeq(),
      meta: { type: distTypeOf(pkg), name: rec.fileName || '', hash: rec.hash || '', size: Number(rec.size) || 0, count, packageId: masterPackageId, url: masterUrl, ...pkg },
    };
    this.store.addChatMessage(msg);
    this._broadcastChat(g.id, msg);
    this._emit('chat', { groupId: g.id, msg });
    return msg;
  }
  // 群主收到上传通知消息：给自己建审核任务（对称于 ingestDist）
  ingestUploadRequest(msg) {
    if (!msg || msg.kind !== 'pkg-upload' || !msg.groupId || !msg.meta) return { code: 'skip' };
    const g = this.store.findGroup(msg.groupId);
    if (!g) return { code: 'no-group' };
    if (g.hubId !== this.pub.machineId) return { code: 'not-master' };
    if (msg.fromId === this.pub.machineId) return { code: 'self' };
    if (!g.members.find((m) => m.machineId === msg.fromId)) return { code: 'not-member' };
    const meta = msg.meta;
    if (!meta.hash || !meta.packageId) return { code: 'bad-meta' };
    const payload = {
      skills: meta.skills || [], command: meta.command || [], agent: meta.agent || [], workflow: meta.workflow || [],
      count: Number(meta.count) || 0, size: Number(meta.size) || 0,
      packageId: String(meta.packageId), submittedBy: msg.fromId,
    };
    const r = this.taskStore?.upsert?.({
      id: crypto.randomUUID(), groupId: msg.groupId, hubId: g.hubId, kind: 'upload',
      hash: String(meta.hash), name: String(meta.name || ''), url: String(meta.url || ''),
      payload, status: 'pending', messageId: msg.id, createdAt: Date.now(), updatedAt: Date.now(),
    });
    this._emit('tasks', { groupId: msg.groupId, created: r?.created ? ['upload'] : [], msgId: msg.id });
    return { code: 'ok' };
  }
  // 群主接收成员上传的包：落 upload/ 目录 + outbox 记录（供接受时 publishPackage）
  async _inPkgUpload(env) {
    const p = env.from;
    const { groupId, name, hash, size, b64, package: pkg = {} } = env.payload || {};
    if (!groupId || !name || !hash || typeof b64 !== 'string') return { ok: false, error: 'bad-payload' };
    const g = this.store.findGroup(groupId);
    if (!g || !g.members.find((m) => m.machineId === p.machineId)) return { ok: false, error: 'not-member' };
    if (g.hubId !== this.pub.machineId) return { ok: false, error: 'not-hub' };
    const data = Buffer.from(b64, 'base64');
    if (data.length === 0 || (size != null && size !== data.length)) return { ok: false, error: 'size-mismatch' };
    if (crypto.createHash('sha256').update(data).digest('hex') !== hash) return { ok: false, error: 'hash-mismatch' };
    if (!this.uploadDir) return { ok: false, error: 'no-upload-dir' };
    fs.mkdirSync(this.uploadDir, { recursive: true });
    const label = `assets-${String(p.machineId).slice(0, 8)}-${Date.now().toString(36)}.zip`;
    fs.writeFileSync(path.join(this.uploadDir, label), data);
    // 上传即写入共享下载目录并生成下载地址，供群主审阅/应用（尚未发布：不进升级种子、不广播）
    const downloadName = `skills/${crypto.randomUUID()}-${path.basename(name || 'assets.zip')}`;
    let downloadUrl = '';
    try { this.writeDownload(downloadName, data, 'skill'); downloadUrl = distUrl(this.pub.host, this.pub.port, downloadName); } catch { /* downloads 不可写时忽略 */ }
    const rec = this.store.addOutbox({
      id: crypto.randomUUID(), kind: 'file', groupId, skillName: null, fileName: name,
      storedFile: label, size: data.length, hash, createdAt: Date.now(),
      downloadName, downloadUrl,
      package: { sent: false, skills: pkg.skills || [], command: pkg.command || [], agent: pkg.agent || [], workflow: pkg.workflow || [] },
    });
    this._emit('synced', {});
    return { ok: true, data: { packageId: rec.id, name: downloadName, url: downloadUrl } };
  }
  // slave 从本地 downloads 缓存安装捆绑包
  installDownload(name) {
    if (!name || name.includes('..') || name.includes('\\')) return { code: 'bad-name' };
    const abs = path.join(this.downloadsDir, name);
    if (!fs.existsSync(abs)) return { code: 'not-found' };
    try {
      const r = installBundleZip({ zip: fs.readFileSync(abs), skillRoot: this.skillRoot(), configRoot: this.configRoot(), installWorkflows: (list) => (this.mergeWorkflows ? this.mergeWorkflows(list) : null) });
      this._emit('synced', {});
      return { code: 'ok', ...r };
    } catch (e) { return { code: 'invalid', error: String((e && e.message) || e) }; }
  }
  // ---- 本地导出包导入（独立于群）----
  importAssetDir() {
    return this.downloadDir || path.join(os.tmpdir(), `devflow-import-${this.identity?.machineId || 'x'}`);
  }
  stageImport(zip) {
    try {
      const r = stageImportAsset({ zip, dir: this.importAssetDir() });
      if (!this.importStaging) this.importStaging = new Map();
      this.importStaging.set(r.id, { file: r.file, manifest: r.manifest });
      return { code: 'ok', id: r.id, manifest: r.manifest, summary: r.summary };
    } catch (e) {
      return { code: (e && e.code) || 'invalid-zip', error: String((e && e.message) || e) };
    }
  }
  applyImport(id) {
    const it = this.importStaging && this.importStaging.get(id);
    if (!it) return { code: 'not-found' };
    const r = applyImportAsset({
      id, file: it.file, manifest: it.manifest,
      skillRoot: this.skillRoot(), configRoot: this.configRoot(),
      installWorkflows: (list) => (this.mergeWorkflows ? this.mergeWorkflows(list) : null),
    });
    if (r.code === 'ok') {
      discardImportAsset(it.file);
      this.importStaging.delete(id);
      this._emit('synced', {});
    }
    return r;
  }
  discardImport(id) {
    const it = this.importStaging && this.importStaging.get(id);
    if (!it) return { code: 'not-found' };
    discardImportAsset(it.file);
    this.importStaging.delete(id);
    return { code: 'ok' };
  }
  cleanupStagedImports() { return cleanupStagedImportsAsset(this.importAssetDir()); }
  // 接受分发任务：确保包在本机 → 解包安装（skills/command/agent 落位 + workflow 融合）→ done
  async acceptTask(id) {
    const task = this.taskStore?.get?.(id);
    if (!task) return { code: 'not-found' };
    if (task.kind === 'upload') return this._acceptUploadTask(task);
    if (task.status !== 'pending' && task.status !== 'failed') return { code: 'not-pending' };
    if (!task.name || task.name.includes('..') || task.name.includes('\\')) {
      this.taskStore.setStatus(id, 'failed', { payload: { ...task.payload, lastError: 'bad-name' } });
      return { code: 'bad-name' };
    }
    const abs = path.join(this.downloadsDir, task.name);
    if (!fs.existsSync(abs)) {
      try { await this.pullDownloads([task.name], task.hubId); } catch (e) { this.log?.warn?.('task pull failed', (e && e.message) || e); }
    }
    // 群记录里的 hub 地址可能过期（群主换网/IP）：用分发通知里的下载地址主机再试一次
    if (!fs.existsSync(abs)) {
      const addr = downloadAddrOf(task.url);
      if (addr) {
        try { await this.pullDownloads([task.name], task.hubId, addr); } catch (e) { this.log?.warn?.('task pull by url failed', (e && e.message) || e); }
      }
    }
    if (!fs.existsSync(abs)) {
      this.taskStore.setStatus(id, 'failed', { payload: { ...task.payload, lastError: 'file-missing' } });
      return { code: 'file-missing' };
    }
    const r = this.installDownload(task.name);
    if (r.code !== 'ok') {
      this.taskStore.setStatus(id, 'failed', { payload: { ...task.payload, lastError: r.code || 'install-failed' } });
      return { code: r.code || 'install-failed', error: r.error };
    }
    this.taskStore.setStatus(id, 'done');
    this._emit('synced', {});
    this._emit('tasks', { groupId: task.groupId, created: [], accepted: id });
    return { code: 'ok', counts: r.counts };
  }
  // 群主接受成员上传：先在本机「应用」这份包（解包装 skills/command/agent + 融合 workflow），
  // 再发布到群（写共享下载 + 生成升级种子 + 广播）；先应用可让广播正文解析出正确的 workflow label
  _acceptUploadTask(task) {
    if (task.status !== 'pending' && task.status !== 'failed') return { code: 'not-pending' };
    this._applyUploadToSelf(task.payload && task.payload.packageId);
    const r = this.publishPackage(task.payload && task.payload.packageId);
    if (r.code !== 'ok') {
      this.taskStore.setStatus(task.id, 'failed', { payload: { ...task.payload, lastError: r.code } });
      return { code: r.code };
    }
    this.taskStore.setStatus(task.id, 'done');
    this._addSystemMessage(task.groupId, t('collab.sys.upload_accepted', { name: task.name || '' }));
    this._emit('tasks', { groupId: task.groupId, created: [], accepted: task.id });
    return { code: 'ok', version: r.version };
  }
  // 把成员上传的包解包应用到群主本机（等同成员侧 installDownload），失败只告警不阻断发布
  _applyUploadToSelf(packageId) {
    const rec = this.store.listOutbox().find((r) => r.id === packageId);
    if (!rec || !rec.storedFile || !this.uploadDir) return;
    const abs = path.join(this.uploadDir, path.basename(rec.storedFile));
    if (!fs.existsSync(abs)) return;
    try {
      installBundleZip({
        zip: fs.readFileSync(abs),
        skillRoot: this.skillRoot(),
        configRoot: this.configRoot(),
        installWorkflows: (list) => (this.mergeWorkflows ? this.mergeWorkflows(list) : null),
      });
    } catch (e) { this.log?.warn?.('apply upload to master failed', (e && e.message) || e); }
  }
  ignoreTask(id) {
    const task = this.taskStore?.get?.(id);
    if (!task) return { code: 'not-found' };
    if (task.kind === 'upload') {
      const packageId = task.payload && task.payload.packageId;
      if (packageId) this.removeOutbox(packageId);
      this.taskStore.setStatus(id, 'ignored');
      this._addSystemMessage(task.groupId, t('collab.sys.upload_rejected', { name: task.name || '' }));
      this._emit('tasks', { groupId: task.groupId, created: [], ignored: id });
      return { code: 'ignored' };
    }
    this.taskStore.setStatus(id, 'ignored');
    this._emit('tasks', { groupId: task.groupId, created: [], ignored: id });
    return { code: 'ignored' };
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
  setAdvertised({ host, port, employeeId } = {}) {
    if (host) this.identity.host = isWildcardHost(host) ? (detectHost() || host) : host;
    if (port) this.identity.port = port;
    if (employeeId !== undefined) this.identity.employeeId = String(employeeId || '').trim();
    this.store.data.identity = { ...this.identity };
    this.store.save();
    const g = this.store.ownedGroup(this.pub.machineId);
    if (g) {
      g.name = profileLabel(this.pub);
      const me = g.members.find((m) => m.machineId === this.pub.machineId);
      if (me) {
        me.employeeId = this.pub.employeeId; me.username = this.pub.username;
        me.host = this.pub.host; me.port = this.pub.port;
      }
      this.store.upsertGroup(g);
    }
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
  // 不做广播：群主是唯一权威存储。
  // - 本机是群主：消息已在本地落库，无需外发；
  // - 本机是成员：只把消息发给群主；其它成员进群聊时从群主拉取。
  engine._broadcastChat = async function _broadcastChat(groupId, msg) {
    if (this._isHub(groupId)) return;
    const g = this.store.findGroup(groupId);
    if (!g) return;
    const hub = g.members.find((m) => m.machineId === g.hubId) || this._knownProfile(g.hubId);
    if (!hub) { this.log?.warn?.(`chat hub profile not found: ${g.hubId}`); return; }
    const res = await this._post(hub.host, hub.port, this._sign(CollabPeer.CHAT_SEND, { msg }));
    if (!res.ok) this.log?.warn?.(`chat to hub ${g.hubId} failed: ${res.error || ''}`);
  };
  engine.sendChat = async function sendChat({ groupId, text, toId = null }) {
    const r = this._requireMember(groupId);
    if (r.code !== 'ok') return { code: r.code };
    if (toId && !r.group.members.find((m) => m.machineId === toId)) return { code: 'no-target' };
    const msg = { id: crypto.randomUUID(), groupId, kind: 'text', fromId: this.pub.machineId, text, toId, ts: Date.now(), seq: this.store.nextChatSeq() };
    this.store.addChatMessage(msg);   // 本地先落地（成员侧作为缓存，群主侧即权威）
    if (this._isHub(groupId)) this._logMessage({ groupId, id: msg.id, src: msg.fromId, target: msg.toId, message: msg.text, ts: msg.ts });
    this._emit('chat', { groupId, msg });
    // 不做广播：成员只把消息发给群主；群主本机即权威存储
    if (!this._isHub(groupId)) {
      const hub = r.group.members.find((m) => m.machineId === r.group.hubId) || this._knownProfile(r.group.hubId);
      if (hub) {
        const res = await this._post(hub.host, hub.port, this._sign(CollabPeer.CHAT_SEND, { msg }));
        if (!res.ok) this.log?.warn?.(`chat send to hub ${r.group.hubId} failed: ${res.error || ''}`);
      } else {
        this.log?.warn?.(`chat hub profile not found: ${r.group.hubId}`);
      }
    }
    return { code: 'ok', msg };
  };
  engine.sendImage = async function sendImage({ groupId, name, mime, data }) {
    const r = this._requireMember(groupId);
    if (r.code !== 'ok') return { code: r.code };
    if (!Buffer.isBuffer(data) || data.length === 0) return { code: 'empty-image' };
    if (data.length > MAX_IMAGE_BYTES) return { code: 'too-large' };
    const mimeType = String(mime || '').toLowerCase();
    if (!IMAGE_MIME.has(mimeType)) return { code: 'bad-image' };
    const safeName = path.basename(String(name || '')).trim() || 'image.png';
    const msg = {
      id: crypto.randomUUID(), groupId, kind: 'image', fromId: this.pub.machineId,
      text: safeName, toId: null, ts: Date.now(), seq: this.store.nextChatSeq(),
      meta: { name: safeName, mime: mimeType, size: data.length, b64: data.toString('base64') },
    };
    this.store.addChatMessage(msg);
    if (this._isHub(groupId)) this._logMessage({ groupId, id: msg.id, src: msg.fromId, target: null, message: safeName, ts: msg.ts });
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
    if (msg.kind === 'dist') this.ingestDist(msg);
    else if (msg.kind === 'pkg-upload') this.ingestUploadRequest(msg);
    this._advanceCursor(msg.groupId, msg);
    if (this._isHub(msg.groupId)) this._logMessage({ groupId: msg.groupId, id: msg.id, src: p.machineId, target: msg.toId, message: msg.text, ts: msg.ts });
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
    if (this._isHub(groupId)) this._logMessage({ groupId, id: msg.id, src: msg.fromId, target: fromId, message: msg.text, command: text, ts: msg.ts });
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
      if (m.kind === 'dist' && shouldProcess(this.taskStore?.getCursor?.(groupId), m)) this.ingestDist(m);
      if (m.kind === 'pkg-upload') this.ingestUploadRequest(m);
      this._advanceCursor(groupId, m);
    }
    this._emit('chat', { groupId, msg: null });
  };
  engine._inChatPull = function _inChatPull(env) {
    const p = env.from;
    const { groupId, afterSeq = 0 } = env.payload;
    const r = this._requireMember(groupId, p.machineId);
    if (r.code !== 'ok') return { ok: false, error: 'not-member' };
    // 群主是聊天数据的权威存储：拉取时给全量（成员端自行裁剪本地缓存）
    const messages = this.store.listChatMessages(groupId, { afterSeq, limit: CHAT_PULL_LIMIT });
    return { ok: true, data: { messages } };
  };
  engine.listPendingCmds = function listPendingCmds() { return this.store.listPendingCmds(); };
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
    const downloadsDir = path.join(nodeDir, 'downloads');
    fs.mkdirSync(downloadDir, { recursive: true });
    fs.mkdirSync(uploadDir, { recursive: true });
    if (!skipSkills) fs.mkdirSync(skillsRoot, { recursive: true });
    const store = new CollabStore({ file: path.join(nodeDir, 'collab.json') });
    const identity = loadIdentity({ file: path.join(nodeDir, 'identity.json'), username: name, host: '127.0.0.1', port: ports[idx] });
    return { store, identity, skillsRoot, uploadDir, downloadDir, downloadsDir };
  }
  const A0 = await makeNode(0, 'alice');
  const B0 = await makeNode(1, 'bob');
  const engA = new CollabEngine({ store: A0.store, identity: A0.identity, skillsRoot: A0.skillsRoot, uploadDir: A0.uploadDir, downloadDir: A0.downloadDir, downloadsDir: A0.downloadsDir });
  const engB = new CollabEngine({ store: B0.store, identity: B0.identity, skillsRoot: B0.skillsRoot, uploadDir: B0.uploadDir, downloadDir: B0.downloadDir, downloadsDir: B0.downloadsDir });
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
