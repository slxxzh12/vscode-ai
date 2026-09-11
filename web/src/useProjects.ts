import type { ProjectInfo, TreeItem } from '@devflow/shared';

export interface FileText { name: string; path: string; size: number; content: string; mtime?: number; abs?: string; binary?: boolean; }
export interface FileMeta { name: string; path: string; abs: string; size: number; mtime: number; isDir: boolean; }
export interface FileHashes { md5: string; sha256: string; }

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export function useProjects() {
  return {
    async list(): Promise<ProjectInfo[]> {
      const r = await get<{ projects: ProjectInfo[] }>('/api/projects');
      return r.projects;
    },
    async add(path: string, name?: string): Promise<ProjectInfo> {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, name }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.error || msg; } catch { /* keep */ }
        throw new Error(msg);
      }
      const r = await res.json() as { project: ProjectInfo };
      return r.project;
    },
    async pickFolder(): Promise<{ path?: string; cancelled?: boolean; error?: string; message?: string }> {
      const res = await fetch('/api/projects/pick', { method: 'POST' });
      return res.json();
    },
    async tree(project: string, rel: string): Promise<TreeItem[]> {
      const r = await get<{ items: TreeItem[] }>(`/api/tree?project=${encodeURIComponent(project)}&path=${encodeURIComponent(rel)}`);
      return r.items;
    },
    async text(project: string, rel: string): Promise<FileText> {
      const r = await get<FileText>(`/api/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(rel)}`);
      return r;
    },
    async write(project: string, rel: string, content: string): Promise<{ size: number }> {
      const res = await fetch(`/api/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(rel)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.error || msg; } catch { /* keep status */ }
        throw new Error(msg);
      }
      return res.json();
    },
    async createFile(project: string, rel: string, content = ''): Promise<{ name: string; path: string }> {
      const res = await fetch(`/api/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(rel)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ create: true, content }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.error || msg; } catch { /* keep status */ }
        throw new Error(msg);
      }
      return res.json();
    },
    async createDir(project: string, rel: string): Promise<{ name: string; path: string }> {
      const res = await fetch(`/api/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(rel)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ create: true, dir: true }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.error || msg; } catch { /* keep status */ }
        throw new Error(msg);
      }
      return res.json();
    },
    async reveal(project: string, rel: string): Promise<{ ok: boolean; platform: string }> {
      const res = await fetch(`/api/explorer/reveal?project=${encodeURIComponent(project)}&path=${encodeURIComponent(rel)}`, { method: 'POST' });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.error || msg; } catch { /* keep status */ }
        throw new Error(msg);
      }
      return res.json();
    },
    async runScript(project: string, rel: string): Promise<{ ok: boolean; platform: string }> {
      const res = await fetch(`/api/run-script?project=${encodeURIComponent(project)}&path=${encodeURIComponent(rel)}`, { method: 'POST' });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.error || msg; } catch { /* keep status */ }
        throw new Error(msg);
      }
      return res.json();
    },
    async format(name: string, content: string): Promise<{ content: string; size: number }> {
      const res = await fetch('/api/format', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = (j.error || '') + (j.message ? '：' + j.message : ''); } catch { /* keep status */ }
        throw new Error(msg || 'format failed');
      }
      return res.json();
    },
    rawUrl(project: string, rel: string): string {
      return `/api/raw?project=${encodeURIComponent(project)}&path=${encodeURIComponent(rel)}`;
    },
    async fileMeta(project: string, rel: string): Promise<FileMeta> {
      return get<FileMeta>(`/api/file/meta?project=${encodeURIComponent(project)}&path=${encodeURIComponent(rel)}`);
    },
    async fileHash(project: string, rel: string): Promise<FileHashes> {
      return get<FileHashes>(`/api/file/hash?project=${encodeURIComponent(project)}&path=${encodeURIComponent(rel)}`);
    },
  };
}
