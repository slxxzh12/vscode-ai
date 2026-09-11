export interface WorkspaceProfile { id: string; name: string; port: number; lastUsedAt: number; projectCount?: number; }
export interface WorkspaceState { ready: boolean; needSelect: boolean; listenPort: number; current: string | null; profiles: WorkspaceProfile[]; }

async function jsonPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { message?: string; error?: string }).message || (j as { error?: string }).error || `HTTP ${res.status}`);
  return j as T;
}

export function useWorkspace() {
  return {
    async state(): Promise<WorkspaceState> {
      return fetch('/api/workspace/state').then((r) => r.json());
    },
    select(id: string) { return jsonPost<{ ok: boolean }>('/api/workspace/select', { id }); },
    create(name?: string) { return jsonPost<{ ok: boolean; profile: WorkspaceProfile }>('/api/workspace/create', { name }); },
  };
}
