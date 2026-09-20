import { ref, type Ref } from 'vue';
import type { FileTreeActionResult } from '../../fileTree';

export type ToolFile = { id: string; folder: string; name: string; updatedAt?: string };

// 拥有左侧文件树的小工具，各自一份独立目录（服务端 /api/files/<tool>/*）
export type FileTool = 'notepad' | 'yaml' | 'js' | 'translate';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function jfetch(url: string, opt: RequestInit = {}): Promise<any> {
  const res = await fetch(url, opt);
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(j?.error || `HTTP ${res.status}`));
  return j;
}

export function useToolFiles(tool: FileTool): {
  folders: Ref<string[]>;
  items: Ref<ToolFile[]>;
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
  const base = `/api/files/${tool}`;
  const folders = ref<string[]>([]);
  const items = ref<ToolFile[]>([]);

  async function load(): Promise<void> {
    try {
      const j = await jfetch(`${base}/tree`);
      items.value = Array.isArray(j.items) ? j.items : [];
      folders.value = Array.isArray(j.folders) ? j.folders : [];
    } catch { /* 列表失败不影响编辑 */ }
  }

  async function read(id: string): Promise<string> {
    const j = await jfetch(`${base}/file?id=${encodeURIComponent(id)}`);
    return typeof j.content === 'string' ? j.content : '';
  }

  async function save(id: string, content: string): Promise<void> {
    await jfetch(`${base}/file`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ id, content }) });
  }

  async function createFile(folder: string, name: string): Promise<string> {
    const j = await jfetch(`${base}/file`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ folder, name }) });
    await load();
    return String(j.id || '');
  }

  function wrap(fn: () => Promise<any>): Promise<FileTreeActionResult> {
    return fn()
      .then(async () => { await load(); return { ok: true }; })
      .catch((e) => ({ ok: false, error: (e as Error)?.message || 'failed' }));
  }

  const createFolder = (parent: string, name: string) => wrap(() => jfetch(`${base}/folder`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ path: parent ? `${parent}/${name}` : name }) }));
  const renameFolder = (path: string, name: string) => wrap(() => jfetch(`${base}/folder`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ path, name }) }));
  const removeFolder = (path: string) => wrap(() => jfetch(`${base}/folder?path=${encodeURIComponent(path)}`, { method: 'DELETE' }));
  const renameItem = (id: string, name: string) => wrap(() => jfetch(`${base}/file`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ id, name }) }));
  const removeItem = (id: string) => wrap(() => jfetch(`${base}/file?id=${encodeURIComponent(id)}`, { method: 'DELETE' }));
  const moveItem = (id: string, folder: string) => wrap(() => jfetch(`${base}/move`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id, folder }) }));

  return { folders, items, load, read, save, createFile, createFolder, renameFolder, removeFolder, renameItem, removeItem, moveItem };
}
