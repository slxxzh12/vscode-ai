import type { ProjectInfo, TreeItem } from '@devflow/shared';

export interface FileText { name: string; path: string; size: number; content: string; }

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
    rawUrl(project: string, rel: string): string {
      return `/api/raw?project=${encodeURIComponent(project)}&path=${encodeURIComponent(rel)}`;
    },
  };
}
