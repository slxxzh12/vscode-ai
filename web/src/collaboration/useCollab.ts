import { ref, type Ref } from 'vue';
import type { CollabSnapshot } from './types';

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

  return {
    state, lastError, refresh,
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
