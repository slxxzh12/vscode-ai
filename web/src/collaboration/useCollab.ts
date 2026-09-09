import { ref, type Ref } from 'vue';
import type { CollabSnapshot, CollabChatMessage, CollabPendingCmd } from './types';

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || j.message || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function useCollab() {
  const state: Ref<CollabSnapshot | null> = ref(null);
  const lastError = ref('');
  const chatState = ref<Record<string, { messages: CollabChatMessage[] }>>({});
  const pendingCmdState = ref<CollabPendingCmd[]>([]);
  const allowlistState = ref<string[]>([]);

  async function refresh(): Promise<CollabSnapshot> {
    try {
      const s = await http<CollabSnapshot>('/api/collab/snapshot');
      state.value = s; lastError.value = '';
      return s;
    } catch (e) { lastError.value = String((e as Error).message || e); throw e; }
  }
  async function post<T = Record<string, unknown>>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    return http<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  function ensureChat(groupId: string) {
    if (!chatState.value[groupId]) chatState.value[groupId] = { messages: [] };
    return chatState.value[groupId];
  }
  async function chat(groupId: string): Promise<CollabChatMessage[]> {
    const r = await http<{ messages: CollabChatMessage[] }>(`/api/collab/groups/${groupId}/chat`);
    ensureChat(groupId).messages = r.messages;
    return r.messages;
  }
  async function sendChat(groupId: string, text: string, toId: string | null) {
    const r = await post(`/api/collab/groups/${groupId}/chat`, { text, toId });
    await chat(groupId);
    return r;
  }
  async function sendCmd(groupId: string, text: string, toId: string) {
    return post(`/api/collab/groups/${groupId}/cmd`, { text, toId });
  }
  async function pullChat(groupId: string, machineId: string) {
    const r = await post<{ code: string; messages?: CollabChatMessage[] }>(`/api/collab/groups/${groupId}/chat-pull`, { machineId });
    if (r.code === 'ok' && r.messages) {
      const g = ensureChat(groupId);
      for (const m of r.messages) if (!g.messages.some((x) => x.id === m.id)) g.messages.push(m);
      g.messages.sort((a, b) => a.seq - b.seq);
    }
    return r;
  }
  async function loadPendingCmds() {
    const r = await http<{ pending: CollabPendingCmd[] }>('/api/collab/cmds');
    pendingCmdState.value = r.pending;
    return r.pending;
  }
  async function approveCmd(reqId: string, approve: boolean) { return post(`/api/collab/cmds/${reqId}/approve`, { approve }); }
  async function loadAllowlist() {
    const r = await http<{ allowlist: string[] }>('/api/collab/allowlist');
    allowlistState.value = r.allowlist;
    return r.allowlist;
  }
  async function addAllow(prefix: string) { await post('/api/collab/allowlist', { prefix }); return loadAllowlist(); }
  async function removeAllow(prefix: string) { await http(`/api/collab/allowlist/${encodeURIComponent(prefix)}`, { method: 'DELETE' }); return loadAllowlist(); }

  async function handleS2C(type: string, payload: Record<string, unknown>) {
    if (type === 'collab-chat') {
      const gid = payload.groupId as string | undefined;
      if (gid) await chat(gid).catch(() => {});
    } else if (type === 'collab-cmd-pending') {
      await loadPendingCmds().catch(() => {});
    }
  }

  return {
    state, lastError, refresh,
    chatState, pendingCmdState, allowlistState,
    chat, sendChat, sendCmd, pullChat, loadPendingCmds, approveCmd,
    loadAllowlist, addAllow, removeAllow, handleS2C,
    async updateIdentity(host: string, port: number) { await post('/api/collab/identity', { host, port }); return refresh(); },
    requestFriend: (host: string, port: number) => post('/api/collab/friends', { host, port }),
    async acceptFriend(machineId: string) { return post(`/api/collab/friends/${machineId}/accept`); },
    async removeFriend(machineId: string) { await http(`/api/collab/friends/${machineId}`, { method: 'DELETE' }); return refresh(); },
    createGroup: (name: string) => post('/api/collab/groups', { name }),
    inviteMember: (groupId: string, machineId: string) => post(`/api/collab/groups/${groupId}/invite`, { machineId }),
    kickMember: (groupId: string, machineId: string) => post(`/api/collab/groups/${groupId}/members/${machineId}/kick`),
    async deleteGroup(groupId: string) { await http(`/api/collab/groups/${groupId}`, { method: 'DELETE' }); return refresh(); },
    acceptInvite: (inviteId: string) => post(`/api/collab/invites/${inviteId}/accept`),
    rejectInvite: (inviteId: string) => post(`/api/collab/invites/${inviteId}/reject`),
    listSkills: () => http<{ skills: { name: string }[] }>('/api/collab/skills'),
    distributeToGroup: (groupId: string, skillNames: string[]) => post(`/api/collab/groups/${groupId}/distribute`, { skillNames }),
    installInbox: (id: string) => post(`/api/collab/inbox/${id}/install`),
    ignoreInbox: (id: string) => post(`/api/collab/inbox/${id}/ignore`),
    async removeInbox(id: string) { await http(`/api/collab/inbox/${id}`, { method: 'DELETE' }); return refresh(); },
  };
}

export type CollabApi = ReturnType<typeof useCollab>;
