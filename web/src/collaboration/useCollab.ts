import { ref, type Ref } from 'vue';
import type { CollabSnapshot, CollabChatMessage, CollabPendingCmd, CollabGroup } from './types';
import type { AssetManifest, AssetManifestSummary } from './types';
import { t } from '../i18n';

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
    // 先在界面展示用户消息（乐观），再把消息发给群主/master；master 落库后 refetch 校正
    const meId = state.value?.identity?.machineId || '';
    const temp: CollabChatMessage = {
      id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      groupId, kind: 'text', fromId: meId, text, toId, meta: null, ts: Date.now(), seq: Number.MAX_SAFE_INTEGER,
    };
    const g = ensureChat(groupId);
    g.messages.push(temp);
    try {
      const r = await post(`/api/collab/groups/${groupId}/chat`, { text, toId });
      await chat(groupId);   // 拉回服务端记录（含本条），临时消息被替换
      return r;
    } catch (e) {
      const i = g.messages.findIndex((m) => m.id === temp.id);
      if (i >= 0) g.messages.splice(i, 1);
      throw e;
    }
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
    chatState, pendingCmdState,
    chat, sendChat, sendCmd, pullChat, loadPendingCmds, approveCmd,
    handleS2C,
    async updateIdentity(host: string, port: number, employeeId?: string) { await post('/api/collab/identity', { host, port, employeeId }); return refresh(); },
    async setAnnouncement(text: string) { await post('/api/collab/announcement', { text }); return refresh(); },
    async join(host: string, port: number, token: string) {
      const r = await post<{ code: string; group?: CollabGroup }>('/api/collab/join', { host, port, token });
      await refresh();
      return r;
    },
    async syncDownloads() {
      const r = await post<{ code: string; files?: string[] }>('/api/collab/downloads/sync');
      await refresh();
      return r;
    },
    listDownloads: () => http<{ manifest: { files: { name: string; kind: string; size: number; updatedAt: number }[] }; usage: unknown; group: unknown }>('/api/collab/downloads'),
    getUpdate: () => http<{ update: { version: string; updatedAt: number; files: { name: string; kind: string; size: number; sha256: string }[] } }>('/api/collab/update'),
    publishUpdate: (names: string[]) => post<{ code: string; update: { version: string; files: { name: string }[] } }>('/api/collab/update/publish', { names }),
    checkUpdate: (masterId?: string) => post<{
      code: string; masterId?: string; masterLabel?: string;
      update: { version: string; files: { name: string; kind?: string; size?: number }[] } | null;
      newer?: boolean;
    }>('/api/collab/update/check', { masterId: masterId ?? null }),
    listRemoteFiles: (masterId?: string) => http<{
      code: string; masterId?: string; masterLabel?: string;
      manifest: { files: { name: string; kind: string; size: number; updatedAt: number }[] };
      update: { version: string; files: { name: string }[] } | null;
    }>(`/api/collab/downloads/remote${masterId ? `?masterId=${encodeURIComponent(masterId)}` : ''}`),
    pullDownloads: (names: string[], masterId?: string) => post<{ code: string; files?: string[] }>('/api/collab/downloads/pull', { names, masterId: masterId ?? null }),
    applyUpdate: (masterId: string, action: 'accept' | 'reject') => post<{ code: string; action?: string; version?: string; files?: string[] }>('/api/collab/update/apply', { masterId, action }),
    listSkills: () => http<{ skills: { name: string }[] }>('/api/collab/skills'),
    async sendGroupFile(groupId: string, fileName: string, blob: Blob) {
      if (blob.size > 40 * 1024 * 1024) throw new Error(t('collab.file.too_large'));
      const res = await fetch(`/api/collab/groups/${groupId}/files?name=${encodeURIComponent(fileName)}`, { method: 'POST', body: blob });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.error || msg; } catch { /* keep */ }
        throw new Error(msg);
      }
      return res.json();
    },
    async sendImage(groupId: string, fileName: string, mime: string, blob: Blob) {
      if (blob.size > 8 * 1024 * 1024) throw new Error(t('collab.image.too_large'));
      const res = await fetch(`/api/collab/groups/${groupId}/image?name=${encodeURIComponent(fileName)}&mime=${encodeURIComponent(mime)}`, { method: 'POST', body: blob });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.error || msg; } catch { /* keep */ }
        throw new Error(msg);
      }
      await chat(groupId);
      return res.json();
    },
    getTool: () => http<{
      tool: { agentId: string; customRoot: string | null };
      root: string;
      selected: string;
      agents: { id: string; name: string; cmd: string; skillsDir: string | null; exists: boolean; selectable: boolean; selected: boolean }[];
    }>('/api/collab/tool'),
    setTool: (agentId: string, customRoot?: string | null) => post<{
      code: string;
      root: string;
      selected: string;
      tool: { agentId: string; customRoot: string | null };
      agents: { id: string; name: string; cmd: string; skillsDir: string | null; exists: boolean; selectable: boolean; selected: boolean }[];
    }>('/api/collab/tool', { agentId, customRoot: customRoot ?? null }),
    getAssets: () => http<{ skills: { name: string }[]; command: { name: string }[]; agent: { name: string }[]; workflow: { id: string; name: string }[] }>('/api/collab/assets'),
    buildPackage: (sel: { skills?: string[]; command?: string[]; agent?: string[]; workflow?: string[] }) =>
      post<{ package: { id: string; fileName: string; size: number } }>('/api/collab/packages', { skills: sel.skills || [], command: sel.command || [], agent: sel.agent || [], workflow: sel.workflow || [] }),
    importAsset: (file: File) => http<{ id: string; manifest: AssetManifest; summary: AssetManifestSummary }>('/api/collab/import', { method: 'POST', body: file }),
    applyImport: (id: string) => post<{ code: string; counts?: Record<string, number> }>(`/api/collab/import/${id}/apply`),
    discardImport: (id: string) => http<{ code: string }>(`/api/collab/import/${id}`, { method: 'DELETE' }),
    getWorkflowSeed: () => http<{ version: number; workflows: { id: string; label: string; hash: string }[] }>('/api/workflows-seed'),
    sendPackage: (id: string, groupId: string) => post<{ code: string; pushed: number; failures: unknown[] }>(`/api/collab/packages/${id}/send`, { groupId }),
    publishPackage: (id: string) => post<{ code: string; name?: string; version?: string }>(`/api/collab/packages/${id}/publish`),
    uploadPackage: (id: string, groupId: string) => post<{ code: string; packageId?: string }>(`/api/collab/packages/${id}/upload`, { groupId }),
    installDownload: (name: string) => post<{ code: string }>('/api/collab/downloads/install', { name }),
    pollTasks: () => post<{ code: string; tasks?: number; updates?: { groupId: string; masterId?: string; version: string }[] }>('/api/collab/tasks/poll'),
    listTasks: (status?: string) => http<{ tasks: import('./distTasks').DistTask[] }>(`/api/collab/tasks${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    acceptTask: (id: string) => post<{ code: string; counts?: Record<string, number> }>(`/api/collab/tasks/${id}/accept`),
    ignoreTask: (id: string) => post<{ code: string }>(`/api/collab/tasks/${id}/ignore`),
    getDirs: () => http<{ upload: string | null; download: string | null }>('/api/collab/dirs'),
    distributeToGroup: (groupId: string, skillNames: string[]) => post(`/api/collab/groups/${groupId}/distribute`, { skillNames }),
    installInbox: (id: string) => post(`/api/collab/inbox/${id}/install`),
    ignoreInbox: (id: string) => post(`/api/collab/inbox/${id}/ignore`),
    async removeInbox(id: string) { await http(`/api/collab/inbox/${id}`, { method: 'DELETE' }); return refresh(); },
    async removeOutTask(id: string) { await http(`/api/collab/outbox/${id}`, { method: 'DELETE' }); return refresh(); },
  };
}

export type CollabApi = ReturnType<typeof useCollab>;
