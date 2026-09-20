import { ref, type Ref } from 'vue';

export type NavicatType = 'mysql' | 'postgres' | 'sqlite' | 'redis';

export type NavicatProfile = {
  id?: string;
  name: string;
  type: NavicatType;
  host: string;
  port: string;
  user: string;
  database: string;
  options?: { ssl?: boolean };
  hasPassword?: boolean;
  password?: string;
  updatedAt?: string;
};

export type ExecResult = {
  columns: string[];
  rows: unknown[][];
  affected: number | null;
  truncated: boolean;
  durationMs: number;
  raw?: string;
};

export type ExecOutcome = { needConfirm: boolean; result?: ExecResult };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function jfetch(url: string, opt: RequestInit = {}): Promise<any> {
  const res = await fetch(url, opt);
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(j?.message || j?.error || `HTTP ${res.status}`));
  return j;
}

export function useNavicat(): {
  profiles: Ref<NavicatProfile[]>;
  load: () => Promise<void>;
  save: (p: NavicatProfile) => Promise<NavicatProfile>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  test: (p: { id?: string } | { profile: NavicatProfile }) => Promise<void>;
  exec: (id: string, sql: string, confirm?: boolean) => Promise<ExecOutcome>;
  reveal: (id: string) => Promise<string>;
  connstr: (id: string, withPassword: boolean) => Promise<string>;
  exportNcx: (ids: string[]) => Promise<string>;
} {
  const profiles = ref<NavicatProfile[]>([]);

  async function load(): Promise<void> {
    try {
      const j = await jfetch('/api/navicat/profiles');
      profiles.value = Array.isArray(j.items) ? j.items : [];
    } catch { /* 列表失败不阻塞 */ }
  }

  async function save(p: NavicatProfile): Promise<NavicatProfile> {
    const j = await jfetch('/api/navicat/profiles', {
      method: p.id ? 'PATCH' : 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(p),
    });
    await load();
    return j.item as NavicatProfile;
  }

  async function remove(id: string): Promise<void> {
    await jfetch(`/api/navicat/profiles?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  }

  async function rename(id: string, name: string): Promise<void> {
    await jfetch('/api/navicat/profiles', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ id, name }) });
    await load();
  }

  async function test(p: { id?: string } | { profile: NavicatProfile }): Promise<void> {
    await jfetch('/api/navicat/test', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(p) });
  }

  async function exec(id: string, sql: string, confirm = false): Promise<ExecOutcome> {
    const j = await jfetch('/api/navicat/exec', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id, sql, confirm }) });
    if (j.needConfirm) return { needConfirm: true };
    return { needConfirm: false, result: j.result as ExecResult };
  }

  async function reveal(id: string): Promise<string> {
    const j = await jfetch('/api/navicat/reveal', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id }) });
    return String(j.password || '');
  }

  async function connstr(id: string, withPassword: boolean): Promise<string> {
    const j = await jfetch('/api/navicat/connstr', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id, withPassword }) });
    return String(j.text || '');
  }

  async function exportNcx(ids: string[]): Promise<string> {
    const j = await jfetch('/api/navicat/ncx', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ids }) });
    return String(j.xml || '');
  }

  return { profiles, load, save, remove, rename, test, exec, reveal, connstr, exportNcx };
}
