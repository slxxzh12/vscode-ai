import { ref, type Ref } from 'vue';

export type PostmanRecord = {
  id: string;
  command: string;
  title?: string;
  result?: unknown;
  updatedAt?: string;
  folder?: string;
  name?: string;
};

export type ActionResult = { ok: boolean; error?: string; path?: string };

export type PostmanActions = {
  createFolder: (parent: string, name: string) => Promise<ActionResult>;
  renameFolder: (path: string, name: string) => Promise<ActionResult>;
  renameRecord: (id: string, title: string) => Promise<ActionResult>;
  removeFolder: (path: string) => Promise<ActionResult>;
  removeRecord: (id: string) => Promise<ActionResult>;
  moveRecord: (id: string, folder: string) => Promise<ActionResult>;
};

export type CurlResult = {
  ok: boolean;
  code: number;
  status: number;
  headers: string;
  body: string;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function usePostmanHistory(): {
  history: Ref<PostmanRecord[]>;
  folders: Ref<string[]>;
  load: () => Promise<void>;
  createFolder: (parent: string, name: string) => Promise<ActionResult>;
  renameFolder: (path: string, name: string) => Promise<ActionResult>;
  renameRecord: (id: string, title: string) => Promise<ActionResult>;
  removeFolder: (path: string) => Promise<ActionResult>;
  removeRecord: (id: string) => Promise<ActionResult>;
  moveRecord: (id: string, folder: string) => Promise<ActionResult>;
  runCurl: (command: string, folder: string) => Promise<CurlResult>;
} {
  const history = ref<PostmanRecord[]>([]);
  const folders = ref<string[]>([]);

  async function load(): Promise<void> {
    try {
      const res = await fetch('/api/postman/history');
      const j: any = await res.json().catch(() => ({}));
      history.value = Array.isArray(j.items) ? j.items : [];
      folders.value = Array.isArray(j.folders) ? j.folders : [];
    } catch { /* 列表拉取失败不影响执行 */ }
  }

  async function createFolder(parent: string, name: string): Promise<ActionResult> {
    const path = parent ? `${parent}/${name}` : name;
    try {
      const res = await fetch('/api/postman/folder', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ path }) });
      if (!res.ok) {
        const j: any = await res.json().catch(() => ({}));
        return { ok: false, error: String(j?.error || 'bad-path') };
      }
      await load();
      return { ok: true, path };
    } catch { return { ok: false, error: 'failed' }; }
  }

  async function renameFolder(path: string, name: string): Promise<ActionResult> {
    try {
      const res = await fetch('/api/postman/folder', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ path, name }) });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: String(j?.error || 'rename-failed') };
      await load();
      return { ok: true, path: String(j?.path || path) };
    } catch { return { ok: false, error: 'failed' }; }
  }

  async function renameRecord(id: string, title: string): Promise<ActionResult> {
    try {
      const res = await fetch('/api/postman/history', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ id, title }) });
      if (!res.ok) return { ok: false, error: 'rename-failed' };
      await load();
      return { ok: true };
    } catch { return { ok: false, error: 'failed' }; }
  }

  async function removeFolder(path: string): Promise<ActionResult> {
    try {
      const res = await fetch(`/api/postman/folder?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
      await load();
      return res.ok ? { ok: true } : { ok: false, error: 'not-found' };
    } catch { await load(); return { ok: false, error: 'failed' }; }
  }

  async function removeRecord(id: string): Promise<ActionResult> {
    try {
      const res = await fetch(`/api/postman/history?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
      return res.ok ? { ok: true } : { ok: false, error: 'not-found' };
    } catch { await load(); return { ok: false, error: 'failed' }; }
  }

  async function moveRecord(id: string, folder: string): Promise<ActionResult> {
    try {
      const res = await fetch('/api/postman/move', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id, folder }) });
      if (res.ok) await load();
      return res.ok ? { ok: true } : { ok: false, error: 'not-found' };
    } catch { return { ok: false, error: 'failed' }; }
  }

  async function runCurl(command: string, folder: string): Promise<CurlResult> {
    const res = await fetch('/api/curl', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ command, folder }) });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(j?.message || j?.error || `HTTP ${res.status}`));
    await load();
    return j as CurlResult;
  }

  return { history, folders, load, createFolder, renameFolder, renameRecord, removeFolder, removeRecord, moveRecord, runCurl };
}
