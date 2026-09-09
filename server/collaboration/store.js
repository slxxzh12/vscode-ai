import fs from 'node:fs';
import path from 'node:path';

export function defaultData() {
  return {
    identity: null,      // { machineId, username, host, port, publicKey, privateKey }
    friends: [],         // 公开 profile
    pendingFriends: [],  // 待确认好友请求（对方 profile + requestedAt）
    groups: [],          // { id, name, ownerId, members:[profile+role], createdAt }
    pendingInvites: [],  // { id, groupId, groupName, inviter: profile, receivedAt }
    skillsInbox: [],     // { id, fromId, groupId|null, skillName, hash, size, zipPath, status, receivedAt }
    groupSkills: [],     // { groupId, skillName, hash, distributedBy, installed }
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
      try { return { ...defaultData(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch (e) { this.log?.warn?.('store corrupt, reset', e.message); }
    }
    return defaultData();
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  // friends
  listFriends() { return this.data.friends; }
  findFriend(machineId) { return this.data.friends.find((f) => f.machineId === machineId) || null; }
  addFriend(f) {
    if (this.findFriend(f.machineId)) return;
    this.data.friends.push({ ...f });
    this.data.pendingFriends = this.data.pendingFriends.filter((p) => p.machineId !== f.machineId);
    this.save();
  }
  upsertFriend(f) {
    const i = this.data.friends.findIndex((x) => x.machineId === f.machineId);
    if (i >= 0) this.data.friends[i] = { ...f };
    else this.data.friends.push({ ...f });
    this.save();
  }
  removeFriend(machineId) {
    this.data.friends = this.data.friends.filter((f) => f.machineId !== machineId);
    this.save();
  }

  // pending friends
  listPendingFriends() { return this.data.pendingFriends; }
  findPendingFriend(machineId) { return this.data.pendingFriends.find((p) => p.machineId === machineId) || null; }
  addPendingFriend(p) { if (!this.findPendingFriend(p.machineId)) this.data.pendingFriends.push({ ...p }); this.save(); }
  removePendingFriend(machineId) { this.data.pendingFriends = this.data.pendingFriends.filter((p) => p.machineId !== machineId); this.save(); }

  // groups
  listGroups() { return this.data.groups; }
  findGroup(id) { return this.data.groups.find((g) => g.id === id) || null; }
  addGroup(group) { this.data.groups.push(group); this.save(); return group; }
  removeGroup(id) { this.data.groups = this.data.groups.filter((g) => g.id !== id); this.save(); }
  upsertGroup(group) {
    const i = this.data.groups.findIndex((g) => g.id === group.id);
    if (i >= 0) this.data.groups[i] = group; else this.data.groups.push(group);
    this.save();
    return group;
  }
  saveGroup(group) { this.upsertGroup(group); }

  // pending invites
  listPendingInvites() { return this.data.pendingInvites; }
  findPendingInvite(id) { return this.data.pendingInvites.find((x) => x.id === id) || null; }
  addPendingInvite(inv) { this.data.pendingInvites.push(inv); this.save(); return inv; }
  removePendingInvite(id) { this.data.pendingInvites = this.data.pendingInvites.filter((x) => x.id !== id); this.save(); }

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
}
