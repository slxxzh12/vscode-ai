import type { OpencodeConfigFile } from './opencodeConfig';

export interface ProviderSelection { id: string; apiKey: string; models: string[] }

export interface LlmToken { id: string; employeeId: string; jwt: string; iat: number; exp: number; jti: string; revoked: boolean; }
export interface LlmProvider { id: string; name: string; baseURL: string; hasKey: boolean; models: string[]; }
export interface LlmPluginEntry { file: string; name: string; priority: number; error: string | null; }
export interface LlmStatus {
  vault: { initialized: boolean; unlocked: boolean };
  enabled: boolean;
  hasSecret: boolean;
  host: string;
  port: number;
  defaultProvider: string | null;
  providers: LlmProvider[];
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).message || (body as any).error || `HTTP ${res.status}`);
  return body as T;
}
const post = <T>(url: string, obj: unknown) =>
  json<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

export function useLlm() {
  return {
    status: () => json<LlmStatus>('/api/llm-admin/status'),
    vaultInit: (passphrase: string) => post('/api/llm-admin/vault/init', { passphrase }),
    vaultUnlock: (passphrase: string) => post('/api/llm-admin/vault/unlock', { passphrase }),
    vaultLock: () => post('/api/llm-admin/vault/lock', {}),
    vaultPassphrase: (oldP: string, newP: string) => post('/api/llm-admin/vault/passphrase', { old: oldP, new: newP }),
    vaultReset: () => post<{ ok: boolean; vault: { initialized: boolean; unlocked: boolean } }>('/api/llm-admin/vault/reset', {}),
    setSecret: (secret: string) => post<{ secret: string }>('/api/llm-admin/secret', { secret }),
    regenerateSecret: () => post('/api/llm-admin/secret/regenerate', {}),
    setEnabled: (enabled: boolean) => post<{ enabled: boolean }>('/api/llm-admin/enabled', { enabled }),
    tokens: () => json<{ tokens: LlmToken[] }>('/api/llm-admin/tokens'),
    issue: (employeeId: string, days: number) => post<{ token: LlmToken }>('/api/llm-admin/tokens', { employeeId, days }),
    revoke: (id: string) => json<{ ok: boolean }>(`/api/llm-admin/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    plugins: () => json<{ entries: LlmPluginEntry[]; dir: string | null; template: string }>('/api/llm-admin/plugins'),
    createPluginExample: () => post<{ entries: LlmPluginEntry[]; file: string }>('/api/llm-admin/plugins/example', {}),
    revealPlugins: () => post<{ ok: boolean }>('/api/llm-admin/plugins/reveal', {}),
    reloadPlugins: () => post<{ entries: LlmPluginEntry[] }>('/api/llm-admin/plugins/reload', {}),
    config: (token: string, selections: { id: string; models: string[] }[]) => {
      const q = new URLSearchParams({ token });
      for (const sel of selections) for (const m of sel.models) { q.append('pid', sel.id); q.append('model', m); }
      return json<{ config: string }>(`/api/llm-admin/opencode-config?${q.toString()}`);
    },
    opencodeConfig: () => json<OpencodeConfigFile>('/api/llm-admin/opencode'),
    saveOpencodeConfig: (payload: { providers: ProviderSelection[]; model: string }) =>
      post<{ ok: boolean; path: string; backups: string[]; config: unknown; skipped: string[] }>('/api/llm-admin/opencode', payload),
  };
}
