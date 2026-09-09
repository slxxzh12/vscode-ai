import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { CollabPeer } from '@devflow/shared/collab';
import { CollabStore } from './store.js';
import { loadIdentity, toPublicProfile } from './identity.js';
import { signEnvelope, verifyEnvelope } from './sign.js';
import { packSkill } from './skill-packer.js';
import { installZip } from './skill-installer.js';

// events 注入（便于 web 层广播到浏览器 /ws）；peer 注入（真实 HTTP 或测试直连）
export class CollabEngine {
  constructor({ store, identity, events = null, peer = null, skillsRoot = null, inboxDir = null, logger = console }) {
    this.store = store;
    this.identity = identity;      // { machineId, username, host, port, publicKey, privateKey }
    this.events = events;
    this.peer = peer;              // { post(host, port, envelope) -> Promise<{ok, data?, error?}> }
    this.skillsRoot = skillsRoot;  // 安装/本机技能根目录
    this.inboxDir = inboxDir;      // 收到的 zip 落盘目录
    this.log = logger;
  }
  get pub() { return toPublicProfile(this.identity); }

  _emit(type, payload) { if (this.events) this.events.emit(type, payload); }
  _sign(type, payload) {
    return signEnvelope(this.identity.privateKey, type, this.pub, payload);
  }
  async _post(host, port, env) {
    if (!this.peer) { this.log?.warn?.('peer transport not configured'); return { ok: false, error: 'no-transport' }; }
    try { return await this.peer.post(host, port, env); }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }
  // 返回 { ok, error?, data? }
  async handleIncoming(env) {
    // 先从 from 定位已知公钥；首次 friend-request 用 from.publicKey 自证
    const known = this._knownProfile(env && env.from && env.from.machineId);
    const pubKey = known ? known.publicKey : (env && env.from && env.from.publicKey);
    if (!pubKey || !verifyEnvelope(pubKey, env)) return { ok: false, error: 'bad-signature' };
    switch (env.type) {
      case CollabPeer.FRIEND_REQUEST: return this._inFriendRequest(env);
      case CollabPeer.FRIEND_ACCEPT: return this._inFriendAccept(env);
      case CollabPeer.GROUP_INVITE: return this._inGroupInvite(env);
      case CollabPeer.GROUP_ACCEPT: return this._inGroupAccept(env);
      case CollabPeer.MEMBER_SYNC: return this._inMemberSync(env);
      case CollabPeer.SKILL_PUSH: return this._inSkillPush(env);
      case CollabPeer.PULL_SYNC: return this._inPullSync(env);
      default: return { ok: false, error: 'unknown-type' };
    }
  }
  _knownProfile(machineId) {
    if (!machineId) return null;
    const f = this.store.findFriend(machineId);
    if (f) return f;
    for (const g of this.store.listGroups()) {
      const m = g.members.find((x) => x.machineId === machineId);
      if (m) return m;
    }
    return null;
  }

  // ---- 好友 ----
  async requestFriend({ host, port }) {
    const res = await this._post(host, port, this._sign(CollabPeer.FRIEND_REQUEST, {}));
    if (!res.ok) return { code: 'failed', error: res.error };
    return { code: 'requested' };
  }
  _inFriendRequest(env) {
    const p = env.from;
    if (this.store.findFriend(p.machineId)) return { ok: true };           // 已是好友
    this.store.addPendingFriend({ ...p, requestedAt: Date.now() });
    this._emit('friend-request', { from: p });
    return { ok: true };
  }
  async acceptFriend(machineId) {
    const p = this.store.findPendingFriend(machineId);
    if (!p) return { code: 'not-found' };
    this.store.removePendingFriend(machineId);
    this.store.addFriend(p);
    const res = await this._post(p.host, p.port, this._sign(CollabPeer.FRIEND_ACCEPT, {}));
    return res.ok ? { code: 'accepted' } : { code: 'accepted', localOnly: true, error: res.error };
  }
  _inFriendAccept(env) {
    const p = env.from;
    // 双向登记：若本机之前发过请求，清掉 pending；无论如何把对方落为好友
    if (this.store.findPendingFriend(p.machineId)) this.store.removePendingFriend(p.machineId);
    this.store.addFriend(p);
    this._emit('synced', {});
    return { ok: true };
  }

  // ---- 群 ----
  async createGroup(name) {
    const g = {
      id: crypto.randomUUID(), name, ownerId: this.pub.machineId, createdAt: Date.now(),
      members: [{ ...this.pub, role: 'owner' }],
    };
    this.store.addGroup(g);
    this._emit('synced', {});
    return g;
  }
  async inviteMember({ groupId, targetMachineId }) {
    const g = this.store.findGroup(groupId);
    const me = g && g.members.find((m) => m.machineId === this.pub.machineId);
    if (!g || !me) return { code: 'not-member' };
    if (g.members.find((m) => m.machineId === targetMachineId)) return { code: 'already-member' };
    const t = this._knownProfile(targetMachineId) || this.store.findPendingFriend(targetMachineId);
    if (!t) return { code: 'no-target-profile' };
    const res = await this._post(t.host, t.port, this._sign(CollabPeer.GROUP_INVITE, { group: { id: g.id, name: g.name } }));
    return res.ok ? { code: 'invited' } : { code: 'failed', error: res.error };
  }
  _inGroupInvite(env) {
    const p = env.from;
    const { group } = env.payload;
    const existing = this.store.findGroup(group.id);
    if (existing && existing.members.find((m) => m.machineId === this.pub.machineId)) return { ok: true };
    if (this.store.findPendingInvite(group.id)) return { ok: true };
    const inv = { id: crypto.randomUUID(), groupId: group.id, groupName: group.name, inviter: p, receivedAt: Date.now() };
    this.store.addPendingInvite(inv);
    this._emit('group-invite', { invite: inv });
    return { ok: true };
  }
  async acceptInvite(inviteId) {
    const inv = this.store.findPendingInvite(inviteId);
    if (!inv) return { code: 'not-found' };
    this.store.removePendingInvite(inviteId);
    // 发回 accept，并带上本机 profile
    const res = await this._post(inv.inviter.host, inv.inviter.port, this._sign(CollabPeer.GROUP_ACCEPT, { groupId: inv.groupId }));
    if (!res.ok) { this.store.addPendingInvite(inv); return { code: 'failed', error: res.error }; }
    // 本机建（或并入）群，等待 MEMBER_SYNC 拿全量成员表
    if (!this.store.findGroup(inv.groupId)) {
      this.store.addGroup({ id: inv.groupId, name: inv.groupName, ownerId: null, createdAt: Date.now(), members: [{ ...this.pub, role: 'member' }] });
    }
    this._emit('synced', {});
    return { code: 'accepted' };
  }
  // 入群者自动角色：管理位共 5 个（owner 占 1），owner 之后按入群先后自动把前 4 位置为 admin，其余为 member
  _assignRole(g) {
    const adminCount = g.members.filter((m) => m.role === 'owner' || m.role === 'admin').length;
    return adminCount < 5 ? 'admin' : 'member';
  }
  async _inGroupAccept(env) {
    const p = env.from;
    const groupId = env.payload.groupId;
    const g = this.store.findGroup(groupId);
    if (!g) return { ok: true };
    if (!g.members.find((m) => m.machineId === p.machineId)) {
      g.members.push({ ...p, role: this._assignRole(g) });
      this.store.saveGroup(g);
    }
    // 广播全量成员表给所有成员（await，保证发起方应答前对方已收到同步）
    await this._broadcastMemberSync(g);
    this._emit('synced', {});
    return { ok: true };
  }
  async _broadcastMemberSync(g) {
    const env = this._sign(CollabPeer.MEMBER_SYNC, { group: g });
    for (const m of g.members) {
      if (m.machineId === this.pub.machineId) continue;
      await this._post(m.host, m.port, env);
    }
  }
  _inMemberSync(env) {
    const group = env.payload.group;
    if (!group || !group.id) return { ok: false, error: 'bad-group' };
    // 我已不在成员表 → 被移出/解散，本地删除群
    if (!(group.members || []).find((m) => m.machineId === this.pub.machineId)) {
      this.store.removeGroup(group.id);
      this._emit('synced', {});
      return { ok: true };
    }
    this.store.upsertGroup(group);
    this._emit('synced', {});
    return { ok: true };
  }
  // 踢人：owner 可踢任何人（含 admin）；admin 只能踢 member；member 无权
  async kickMember({ groupId, targetMachineId }) {
    const g = this.store.findGroup(groupId);
    const me = g && g.members.find((m) => m.machineId === this.pub.machineId);
    const target = g && g.members.find((m) => m.machineId === targetMachineId);
    if (!g || !me) return { code: 'not-member' };
    if (!target) return { code: 'no-target' };
    if (me.role !== 'owner' && me.role !== 'admin') return { code: 'forbidden' };
    if (me.role === 'admin' && target.role !== 'member') return { code: 'forbidden' };
    g.members = g.members.filter((m) => m.machineId !== targetMachineId);
    this.store.saveGroup(g);
    // 通知被踢者（其收到后因不在成员表会删本地群）
    await this._post(target.host, target.port, this._sign(CollabPeer.MEMBER_SYNC, { group: g }));
    // 同步其余成员
    await this._broadcastMemberSync(g);
    this._emit('synced', {});
    return { code: 'kicked' };
  }

  // ---- skill 分发 ----
  async distributeToGroup(groupId, skillNames) {
    const g = this.store.findGroup(groupId);
    if (!g) return { code: 'no-group', failures: [], pushed: 0 };
    const me = g.members.find((m) => m.machineId === this.pub.machineId);
    if (!me) return { code: 'not-member', failures: [], pushed: 0 };
    const failures = [];
    let pushed = 0;
    for (const skillName of skillNames) {
      const skillDir = path.join(this.skillsRoot, skillName);
      let pkg;
      try { pkg = await packSkill(skillDir); } catch (e) { failures.push({ skillName, error: 'pack:' + (e && e.message) }); continue; }
      if (pkg.skillName !== skillName) { failures.push({ skillName, error: 'name-mismatch' }); continue; }
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
    this._emit('synced', {});
    return { code: 'ok', pushed, failures };
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
    fs.mkdirSync(this.inboxDir, { recursive: true });
    const zipPath = path.join(this.inboxDir, `${itemId}.zip`);
    fs.writeFileSync(zipPath, zip);
    const item = { id: itemId, fromId: p.machineId, groupId, skillName, hash, size: zip.length, zipPath, status: 'received', receivedAt: Date.now() };
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
      installZip({ zip: fs.readFileSync(it.zipPath), skillName: it.skillName, destRoot: this.skillsRoot });
    } catch (e) { this.store.setInboxStatus(itemId, 'invalid'); return { code: 'invalid', error: String(e && e.message || e) }; }
    this.store.setInboxStatus(itemId, 'installed');
    if (it.groupId) {
      const gs = this.store.findGroupSkill(it.groupId, it.skillName);
      if (gs) { gs.installed = true; gs.hash = it.hash; this.store.save(); }
    }
    this._emit('synced', {});
    return { code: 'installed' };
  }
  async ignoreInbox(itemId) {
    const it = this.store.findInbox(itemId);
    if (!it) return { code: 'not-found' };
    this.store.setInboxStatus(itemId, 'ignored');
    this._emit('synced', {});
    return { code: 'ignored' };
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
      if (!local) this.store.addGroup({ ...g });
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

// ---- 测试双节点 harness（直连 transport，不走 http）----
export async function createPairHarness({ skipSkills = false, dir = null } = {}) {
  const base = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'collab-pair-'));
  const ports = [39991, 39992];
  async function makeNode(idx, name) {
    const nodeDir = path.join(base, name);
    const skillsRoot = path.join(nodeDir, 'skills');
    const inboxDir = path.join(nodeDir, 'inbox');
    fs.mkdirSync(inboxDir, { recursive: true });
    if (!skipSkills) fs.mkdirSync(skillsRoot, { recursive: true });
    const store = new CollabStore({ file: path.join(nodeDir, 'collab.json') });
    const identity = loadIdentity({ file: path.join(nodeDir, 'identity.json'), username: name, host: '127.0.0.1', port: ports[idx] });
    return { store, identity, skillsRoot, inboxDir };
  }
  const A0 = await makeNode(0, 'alice');
  const B0 = await makeNode(1, 'bob');
  const engA = new CollabEngine({ store: A0.store, identity: A0.identity, skillsRoot: A0.skillsRoot, inboxDir: A0.inboxDir });
  const engB = new CollabEngine({ store: B0.store, identity: B0.identity, skillsRoot: B0.skillsRoot, inboxDir: B0.inboxDir });
  // 直连 transport：A 发的投给 B 的 handleIncoming，B 发的投给 A（忽略 host/port）
  const forward = async (eng, host, port, envelope) => {
    const r = await eng.handleIncoming(JSON.parse(JSON.stringify(envelope)));
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  };
  engA.peer = { post: (host, port, envelope) => forward(engB, host, port, envelope) };
  engB.peer = { post: (host, port, envelope) => forward(engA, host, port, envelope) };
  engA.engine = engA;   // 供测试 B.engine.handleIncoming 这类写法
  engB.engine = engB;
  return {
    nodes: [engA, engB],   // 直接返回引擎：A.requestFriend / A.store / A.skillsRoot 均可用
    async stop() {},
  };
}
