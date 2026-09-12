export interface LlmToken { id: string; employeeId: string; jwt: string; iat: number; exp: number; jti: string; revoked: boolean; }
export interface LlmProvider { id: string; name: string; baseURL: string; hasKey: boolean; models: string[]; }
export interface LlmPluginEntry { file: string; name: string; priority: number; error: string | null; }
export interface LlmStatus {
  vault: { initialized: boolean; unlocked: boolean };
  enabled: boolean;
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
    setEnabled: (enabled: boolean) => post<{ enabled: boolean }>('/api/llm-admin/enabled', { enabled }),
    tokens: () => json<{ tokens: LlmToken[] }>('/api/llm-admin/tokens'),
    issue: (employeeId: string, days: number) => post<{ token: LlmToken }>('/api/llm-admin/tokens', { employeeId, days }),
    revoke: (id: string) => json<{ ok: boolean }>(`/api/llm-admin/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    plugins: () => json<{ entries: LlmPluginEntry[]; dir: string | null }>('/api/llm-admin/plugins'),
    reloadPlugins: () => post<{ entries: LlmPluginEntry[] }>('/api/llm-admin/plugins/reload', {}),
    config: (provider: string, token: string) => json<{ config: string }>(`/api/llm-admin/opencode-config?provider=${encodeURIComponent(provider)}&token=${encodeURIComponent(token)}`),
  };
}
