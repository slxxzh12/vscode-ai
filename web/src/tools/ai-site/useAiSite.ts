import { ref, type Ref } from 'vue';
import { requestPickFolder } from '../../pickFolder';

export interface AiSiteConfig {
  pluginRoot: string;
  pluginRootDefault?: boolean;
  pluginRootDefaultPath?: string;
  mode: 'port' | 'path';
  listenHost: string;
  listenPort: number;
  pathPrefix: string;
  enabled: boolean;
  requireAuth: boolean;
  sessionSecret: string;
}
export interface AiSiteStatus { status: 'running' | 'stopped' | 'error'; error: string | null; mode?: string; enabled?: boolean }
export interface AiSiteUser { id: string; username: string; jwt: string; jti: string; iat: number; exp: number; revoked: boolean; enabled: boolean; uses: number; lastLoginAt: number; lastRunAt: number }
export interface AiSitePluginField {
  key: string; label: string; type: string; required?: boolean;
  options?: string[]; default?: string; placeholder?: string;
  min?: number; max?: number; step?: number;
}
export interface AiSitePlugin { name: string; title: string; description: string; hasLogo: boolean; fields: AiSitePluginField[]; error: string | null }

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function jfetch(url: string, opt: RequestInit = {}): Promise<any> {
  const res = await fetch(url, opt);
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(j?.error || `HTTP ${res.status}`));
  return j;
}

export interface AiSiteApi {
  config: Ref<AiSiteConfig | null>;
  status: Ref<AiSiteStatus | null>;
  users: Ref<AiSiteUser[]>;
  plugins: Ref<AiSitePlugin[]>;
  load: () => Promise<void>;
  save: (patch: Partial<AiSiteConfig>) => Promise<AiSiteConfig>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  createUser: (username: string, expiresAt?: number) => Promise<AiSiteUser>;
  updateUser: (id: string, patch: { enabled?: boolean; username?: string; expiresAt?: number }) => Promise<AiSiteUser>;
  revokeUser: (username: string, revoked: boolean) => Promise<void>;
  removeUser: (id: string) => Promise<void>;
  pickFolder: () => Promise<{ path?: string; cancelled?: boolean; error?: string; message?: string }>;
}

export function useAiSite(): AiSiteApi {
  const config = ref<AiSiteConfig | null>(null);
  const status = ref<AiSiteStatus | null>(null);
  const users = ref<AiSiteUser[]>([]);
  const plugins = ref<AiSitePlugin[]>([]);

  async function loadPlugins() {
    const j = await jfetch('/api/ai-site/plugins');
    plugins.value = Array.isArray(j.items) ? j.items : [];
  }

  async function loadUserList() {
    const j = await jfetch('/api/ai-site/users');
    users.value = Array.isArray(j.items) ? j.items : [];
  }

  async function load(): Promise<void> {
    const j = await jfetch('/api/ai-site/config');
    config.value = j.config as AiSiteConfig;
    status.value = j.status as AiSiteStatus;
    await Promise.all([loadPlugins(), loadUserList()]);
  }

  async function save(patch: Partial<AiSiteConfig>): Promise<AiSiteConfig> {
    const j = await jfetch('/api/ai-site/config', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(patch) });
    config.value = j.config as AiSiteConfig;
    status.value = j.status as AiSiteStatus;
    await loadPlugins();
    return config.value;
  }

  async function start(): Promise<void> {
    const j = await jfetch('/api/ai-site/start', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    config.value = j.config as AiSiteConfig;
    status.value = j.status as AiSiteStatus;
  }

  async function stop(): Promise<void> {
    const j = await jfetch('/api/ai-site/stop', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    config.value = j.config as AiSiteConfig;
    status.value = j.status as AiSiteStatus;
  }

  async function createUser(username: string, expiresAt?: number): Promise<AiSiteUser> {
    const j = await jfetch('/api/ai-site/users', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ username, expiresAt }) });
    await loadUserList();
    return j.item as AiSiteUser;
  }

  async function updateUser(id: string, patch: { enabled?: boolean; username?: string; expiresAt?: number }): Promise<AiSiteUser> {
    const j = await jfetch('/api/ai-site/users', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ id, ...patch }) });
    await loadUserList();
    return j.item as AiSiteUser;
  }

  async function revokeUser(username: string, revoked: boolean): Promise<void> {
    await jfetch('/api/ai-site/revoke', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ username, revoked }) });
    await loadUserList();
  }

  async function removeUser(id: string): Promise<void> {
    await jfetch(`/api/ai-site/users?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadUserList();
  }

  function pickFolder(): Promise<{ path?: string; cancelled?: boolean; error?: string; message?: string }> {
    return requestPickFolder('/api/projects/pick');
  }

  return { config, status, users, plugins, load, save, start, stop, createUser, updateUser, revokeUser, removeUser, pickFolder };
}
