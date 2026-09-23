import fs from 'node:fs';
import path from 'node:path';

// 聊天留存上限：群主存全量（权威），成员只留本地缓存
const CHAT_HUB_CAP = 20000;
const CHAT_MEMBER_CAP = 500;

export function defaultData() {
  return {
    identity: null,      // { machineId, username, host, port, publicKey, privateKey }
    groups: [],          // 多个群组 { id, name, createdAt, hubId, members:[profile] }
    skillsInbox: [],     // { id, kind:'skill'|'file', fromId, groupId|null, skillName|null, fileName|null, hash, size, zipPath, status, receivedAt }
    groupSkills: [],     // { groupId, skillName, hash, distributedBy, installed }
    outbox: [],          // 我发出的传输记录 { id, kind, groupId, skillName|null, fileName|null, size, hash, createdAt }
    tool: null,          // 我的开发工具：{ agentId: '<agent id>' | 'custom', customRoot }
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
        // 旧结构群组（ownerId/role，无 hubId）迁移：补 hubId，去掉废弃字段
        for (const g of data.groups) {
          if (!g || typeof g !== 'object') continue;
          if (!g.hubId && g.ownerId) g.hubId = g.ownerId;
          delete g.ownerId;
          for (const m of g.members || []) if (m && typeof m === 'object') delete m.role;
        }
        // 旧结构 tool.kind → tool.agentId（幂等）
        if (data.tool && typeof data.tool === 'object' && data.tool.agentId === undefined && data.tool.kind !== undefined) {
          data.tool = { agentId: data.tool.kind, customRoot: data.tool.customRoot || null };
        }
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
    const g = { id: hubId, name, createdAt: Date.now(), hubId, announcement: '', members: [{ ...self }] };
    this.data.groups.push(g);
    this.save();
    return g;
  }
  upsertGroup(group) {
    const i = this.data.groups.findIndex((g) => g.id === group.id);
    const next = { announcement: '', ...group };
    if (i >= 0) this.data.groups[i] = next; else this.data.groups.push(next);
    this.save();
    return next;
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

  // 我的开发工具（未选择返回 null，由 engine 兜底默认 agent）
  getTool() { return this.data.tool || null; }
  setTool(tool) { this.data.tool = { agentId: 'opencode', customRoot: null, ...tool }; this.save(); return this.data.tool; }

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
    // 幂等：同一条消息（同 id）重复送达时不再入库，避免重复显示
    if (msg && msg.id) {
      const dup = this.data.chatMessages.find((x) => x.id === msg.id);
      if (dup) return dup;
    }
    const seq = msg.seq ?? this.data.chatSeq + 1;
    if (msg.seq == null) { this.data.chatSeq = seq; }
    const m = { id: msg.id, groupId: msg.groupId, kind: msg.kind, fromId: msg.fromId,
      text: msg.text, toId: msg.toId ?? null, meta: msg.meta ?? null, ts: msg.ts, seq };
    this.data.chatMessages.push(m);
    const cap = this._chatCap(m.groupId);
    const same = this.data.chatMessages.filter((x) => x.groupId === m.groupId);
    while (same.length > cap) {
      const first = same.shift();
      this.data.chatMessages = this.data.chatMessages.filter((x) => x !== first);
    }
    this.save();
    return m;
  }
  // 群主（hub）是聊天数据的唯一权威存储：本机为群主时保留全量；其它成员只留本地缓存
  _chatCap(groupId) {
    const g = this.findGroup(groupId);
    const self = this.data.identity && this.data.identity.machineId;
    return (g && self && g.hubId === self) ? CHAT_HUB_CAP : CHAT_MEMBER_CAP;
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
