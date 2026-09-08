import type { ProjectInfo, TreeItem } from '@devflow/shared';

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
  };
}
