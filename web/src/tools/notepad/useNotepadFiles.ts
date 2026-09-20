import { ref, type Ref } from 'vue';
import type { FileTreeActionResult } from '../../fileTree';

export type NotepadFile = { id: string; folder: string; name: string; updatedAt?: string };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function jfetch(url: string, opt: RequestInit = {}): Promise<any> {
  const res = await fetch(url, opt);
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(j?.error || `HTTP ${res.status}`));
  return j;
}

export function useNotepadFiles(): {
  folders: Ref<string[]>;
  items: Ref<NotepadFile[]>;
  load: () => Promise<void>;
  read: (id: string) => Promise<string>;
  save: (id: string, content: string) => Promise<void>;
  createFile: (folder: string, name: string) => Promise<string>;
  createFolder: (parent: string, name: string) => Promise<FileTreeActionResult>;
  renameFolder: (path: string, name: string) => Promise<FileTreeActionResult>;
  removeFolder: (path: string) => Promise<FileTreeActionResult>;
  renameItem: (id: string, name: string) => Promise<FileTreeActionResult>;
  removeItem: (id: string) => Promise<FileTreeActionResult>;
  moveItem: (id: string, folder: string) => Promise<FileTreeActionResult>;
} {
  const folders = ref<string[]>([]);
  const items = ref<NotepadFile[]>([]);

  async function load(): Promise<void> {
    try {
      const j = await jfetch('/api/notepad/tree');
      items.value = Array.isArray(j.items) ? j.items : [];
      folders.value = Array.isArray(j.folders) ? j.folders : [];
    } catch { /* 列表失败不影响编辑 */ }
  }

  async function read(id: string): Promise<string> {
    const j = await jfetch(`/api/notepad/file?id=${encodeURIComponent(id)}`);
    return typeof j.content === 'string' ? j.content : '';
  }

  async function save(id: string, content: string): Promise<void> {
    await jfetch('/api/notepad/file', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ id, content }) });
  }

  async function createFile(folder: string, name: string): Promise<string> {
    const j = await jfetch('/api/notepad/file', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ folder, name }) });
    await load();
    return String(j.id || '');
  }

  function wrap(fn: () => Promise<any>): Promise<FileTreeActionResult> {
    return fn()
      .then(async () => { await load(); return { ok: true }; })
      .catch((e) => ({ ok: false, error: (e as Error)?.message || 'failed' }));
  }

  const createFolder = (parent: string, name: string) => wrap(() => jfetch('/api/notepad/folder', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ path: parent ? `${parent}/${name}` : name }) }));
  const renameFolder = (path: string, name: string) => wrap(() => jfetch('/api/notepad/folder', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ path, name }) }));
  const removeFolder = (path: string) => wrap(() => jfetch(`/api/notepad/folder?path=${encodeURIComponent(path)}`, { method: 'DELETE' }));
  const renameItem = (id: string, name: string) => wrap(() => jfetch('/api/notepad/file', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ id, name }) }));
  const removeItem = (id: string) => wrap(() => jfetch(`/api/notepad/file?id=${encodeURIComponent(id)}`, { method: 'DELETE' }));
  const moveItem = (id: string, folder: string) => wrap(() => jfetch('/api/notepad/move', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id, folder }) }));

  return { folders, items, load, read, save, createFile, createFolder, renameFolder, removeFolder, renameItem, removeItem, moveItem };
}
