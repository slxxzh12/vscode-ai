import fs from 'node:fs';
import path from 'node:path';

export function defaultData() {
  return {
    identity: null,      // { machineId, username, host, port, publicKey, privateKey }
    groups: [],          // 多个群组 { id, name, createdAt, hubId, members:[profile] }
    heartbeats: {},      // { [machineId]: { agent, days, ...usage, receivedAt } }
    skillsInbox: [],     // { id, kind:'skill'|'file', fromId, groupId|null, skillName|null, fileName|null, hash, size, zipPath, status, receivedAt }
    groupSkills: [],     // { groupId, skillName, hash, distributedBy, installed }
    outbox: [],          // 我发出的传输记录 { id, kind, groupId, skillName|null, fileName|null, size, hash, createdAt }
    tool: { kind: 'opencode', customRoot: null },  // 我的开发工具：opencode | claudecode | custom(customRoot)
    chatSeq: 0,          // 本机全局单调消息序号
    chatMessages: [],    // { id, groupId, kind, fromId, text, toId, meta, ts, seq }
    pendingCmds: [],     // { id(reqId), groupId, fromId, text, receivedAt }
  };
}

export class CollabStore {
  constructor({ file, logger = console }) {
    this.file = file;
    this.log = logger;
    this.data = this._load();
  }
  _load() {
    if (fs.existsSync(this.file)) {
      try {
        const data = { ...defaultData(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
        if (!Array.isArray(data.groups)) data.groups = [];
        if (!data.groups.length && data.group) {
          const g = data.group;
          if (g.id === 'shared' && g.hubId) g.id = g.hubId;
          data.groups = [g];
        }
        delete data.group;
        return data;
      } catch (e) { this.log?.warn?.('store corrupt, reset', e.message); }
    }
    return defaultData();
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  // ---- 群组（多个并存）----
  listGroups() { return this.data.groups; }
  getGroup(id) { return id ? this.findGroup(id) : (this.data.groups[0] || null); }
  findGroup(id) { return this.data.groups.find((g) => g.id === id) || null; }
  ownedGroup(machineId) { return this.data.groups.find((g) => g.hubId === machineId) || null; }
  ensureGroup({ name, hubId, self }) {
    const existing = this.ownedGroup(hubId);
    if (existing) return existing;
    const g = { id: hubId, name, createdAt: Date.now(), hubId, members: [{ ...self }] };
    this.data.groups.push(g);
    this.save();
    return g;
  }
  upsertGroup(group) {
    const i = this.data.groups.findIndex((g) => g.id === group.id);
    if (i >= 0) this.data.groups[i] = group; else this.data.groups.push(group);
    this.save();
    return group;
  }
  setGroup(group) { return this.upsertGroup(group); }
  saveGroup(group) { return this.upsertGroup(group); }
  addGroupMember(groupId, profile) {
    const g = this.findGroup(groupId);
    if (!g) return null;
    if (!g.members.find((m) => m.machineId === profile.machineId)) g.members.push({ ...profile });
    this.save();
    return g;
  }

  // ---- 心跳（最新用量）----
  listHeartbeats() { return this.data.heartbeats; }
  getHeartbeat(machineId) { return this.data.heartbeats[machineId] || null; }
  setHeartbeat(machineId, usage) {
    this.data.heartbeats[machineId] = { ...usage };
    this.save();
    return this.data.heartbeats[machineId];
  }

  // inbox
  listInbox() { return this.data.skillsInbox; }
  findInbox(id) { return this.data.skillsInbox.find((x) => x.id === id) || null; }
  addInbox(item) { this.data.skillsInbox.push(item); this.save(); return item; }
  setInboxStatus(id, status) {
    const it = this.findInbox(id);
    if (it) { it.status = status; this.save(); }
    return it;
  }
  removeInbox(id) { this.data.skillsInbox = this.data.skillsInbox.filter((x) => x.id !== id); this.save(); }

  // outbox（我发出的传输记录）
  listOutbox() { return this.data.outbox; }
  addOutbox(rec) {
    this.data.outbox.unshift(rec);
    const cap = 200;
    if (this.data.outbox.length > cap) this.data.outbox.length = cap;
    this.save();
    return rec;
  }
  removeOutbox(id) { this.data.outbox = this.data.outbox.filter((x) => x.id !== id); this.save(); }

  // 我的开发工具
  getTool() { return this.data.tool || { kind: 'opencode', customRoot: null }; }
  setTool(tool) { this.data.tool = { kind: 'opencode', customRoot: null, ...tool }; this.save(); return this.data.tool; }

  // group skills
  listGroupSkills(groupId = null) {
    if (groupId == null) return this.data.groupSkills;
    return this.data.groupSkills.filter((g) => g.groupId === groupId);
  }
  findGroupSkill(groupId, skillName) {
    return this.data.groupSkills.find((g) => g.groupId === groupId && g.skillName === skillName) || null;
  }
  upsertGroupSkill(gs) {
    const i = this.data.groupSkills.findIndex((g) => g.groupId === gs.groupId && g.skillName === gs.skillName);
    if (i >= 0) this.data.groupSkills[i] = gs; else this.data.groupSkills.push(gs);
    this.save();
    return gs;
  }

  // ---- chat ----
  nextChatSeq() { this.data.chatSeq += 1; this.save(); return this.data.chatSeq; }
  addChatMessage(msg) {
    const seq = msg.seq ?? this.data.chatSeq + 1;
    if (msg.seq == null) { this.data.chatSeq = seq; }
    const m = { id: msg.id, groupId: msg.groupId, kind: msg.kind, fromId: msg.fromId,
      text: msg.text, toId: msg.toId ?? null, meta: msg.meta ?? null, ts: msg.ts, seq };
    this.data.chatMessages.push(m);
    const cap = 500;
    const same = this.data.chatMessages.filter((x) => x.groupId === m.groupId);
    while (same.length > cap) {
      const first = same.shift();
      this.data.chatMessages = this.data.chatMessages.filter((x) => x !== first);
    }
    this.save();
    return m;
  }
  listChatMessages(groupId, { afterSeq = 0, limit = 500 } = {}) {
    return this.data.chatMessages
      .filter((m) => m.groupId === groupId && m.seq > afterSeq)
      .sort((a, b) => a.seq - b.seq)
      .slice(-limit);
  }
  lastSeqOf(groupId) {
    const arr = this.data.chatMessages.filter((m) => m.groupId === groupId);
    if (!arr.length) return 0;
    return Math.max(...arr.map((m) => m.seq));
  }

  // ---- pending cmds ----
  listPendingCmds() { return this.data.pendingCmds; }
  findPendingCmd(id) { return this.data.pendingCmds.find((c) => c.id === id) || null; }
  addPendingCmd(cmd) { if (!this.findPendingCmd(cmd.id)) this.data.pendingCmds.push(cmd); this.save(); return cmd; }
  removePendingCmd(id) { this.data.pendingCmds = this.data.pendingCmds.filter((c) => c.id !== id); this.save(); }
}
