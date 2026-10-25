import { ref, type Ref } from 'vue';
import { NGINX_DEFAULT_PORT, NGINX_SAMPLE_REWRITES } from '@devflow/shared';

export type NginxMode = 'port' | 'path';
export interface NginxHeader { name: string; value: string }
export interface NginxRewrite {
  from: string;
  to: string;
  directResponse?: boolean;
  directStatus?: number;
  directContentType?: string;
  directBody?: string;
  directHeaders?: NginxHeader[];
}
export interface NginxReplace { from: string; to: string }
export interface NginxRule {
  id?: string;
  name: string;
  mode: NginxMode;
  enabled: boolean;
  listenHost: '127.0.0.1' | '0.0.0.0';
  listenPort: number;
  pathPrefix: string;
  stripPrefix: boolean;
  staticDir: string;
  target: { protocol: 'http' | 'https'; host: string; port: number };
  tlsInsecure: boolean;
  preserveHost: boolean;
  headers: NginxHeader[];
  responseHeaders: NginxHeader[];
  rewrites: NginxRewrite[];
  responseReplace: NginxReplace[];
  locationReplace: NginxReplace[];
  directResponse: boolean;
  directStatus: number;
  directContentType: string;
  directBody: string;
  corsPreflight: boolean;
  logRequests: boolean;
  capture: boolean;
}
export interface NginxStatus { status: 'running' | 'stopped' | 'error'; error: string | null }
export interface NginxLogEntry { ts: number; method: string; url: string; status: number; durationMs: number; kind: string }
export interface CaptureSummary {
  id: string; ts: string; method: string; url: string; status: number; durationMs: number;
  kind: string; state: string; reqBodySize: number; resBodySize: number; frameCount: number; truncated: boolean;
}
export interface CaptureDetail {
  record: CaptureSummary & {
    reqHeaders: Record<string, string>;
    forwardUrl?: string;
    forwardHeaders?: Record<string, string> | null;
    resHeaders: Record<string, string> | null;
  };
  reqBody: string; resBody: string;
  frames: Array<{ dir: string; opcode: number; ts: number; data: string }>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function jfetch(url: string, opt: RequestInit = {}): Promise<any> {
  const res = await fetch(url, opt);
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(j?.error || `HTTP ${res.status}`));
  return j;
}

export function emptyRule(): NginxRule {
  return {
    name: '', mode: 'port', enabled: true, listenHost: '0.0.0.0', listenPort: NGINX_DEFAULT_PORT,
    pathPrefix: '', stripPrefix: true, staticDir: '', target: { protocol: 'http', host: '127.0.0.1', port: 5173 },
    tlsInsecure: true, preserveHost: true, headers: [], responseHeaders: [], rewrites: [], responseReplace: [], directResponse: false, directStatus: 200, directContentType: 'application/json; charset=utf-8', directBody: '', locationReplace: [], corsPreflight: false, logRequests: false, capture: false,
  };
}

// DeepSeek 官方 API 代理样例：客户端用 deepseek-flash 模型调用，Authorization 用 ak-123456 占位
export function deepseekFlashRule(): NginxRule {
  return {
    name: 'deepseek-flash', mode: 'port', enabled: true, listenHost: '0.0.0.0', listenPort: NGINX_DEFAULT_PORT,
    pathPrefix: '', stripPrefix: true,
    staticDir: '',
    target: { protocol: 'https', host: 'api.deepseek.com', port: 443 },
    tlsInsecure: true, preserveHost: true,
    headers: [{ name: 'Authorization', value: 'Bearer ak-123456' }], responseHeaders: [],
    rewrites: NGINX_SAMPLE_REWRITES.map((r) => ({ ...r })), responseReplace: [], directResponse: false, directStatus: 200, directContentType: 'application/json; charset=utf-8', directBody: '', locationReplace: [], corsPreflight: false, logRequests: false, capture: false,
  };
}

export interface NginxApi {
  rules: Ref<NginxRule[]>;
  status: Ref<Record<string, NginxStatus>>;
  load: () => Promise<void>;
  save: (r: NginxRule) => Promise<NginxRule>;
  remove: (id: string) => Promise<void>;
  start: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  log: (id: string) => Promise<NginxLogEntry[]>;
  captures: (id: string) => Promise<CaptureSummary[]>;
  capture: (ruleId: string, id: string) => Promise<CaptureDetail>;
  clearCaptures: (id: string) => Promise<void>;
  pickFolder: () => Promise<{ path?: string; cancelled?: boolean; error?: string; message?: string }>;
}

export function useNginx(): NginxApi {
  const rules = ref<NginxRule[]>([]);
  const status = ref<Record<string, NginxStatus>>({});

  async function load(): Promise<void> {
    try {
      const j = await jfetch('/api/nginx/rules');
      rules.value = Array.isArray(j.items) ? j.items : [];
      status.value = j.status || {};
    } catch { /* ignore */ }
  }

  async function save(r: NginxRule): Promise<NginxRule> {
    const j = await jfetch('/api/nginx/rules', { method: r.id ? 'PATCH' : 'POST', headers: JSON_HEADERS, body: JSON.stringify(r) });
    await load();
    return j.item as NginxRule;
  }

  async function remove(id: string): Promise<void> {
    await jfetch(`/api/nginx/rules?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  }

  async function start(id: string): Promise<void> {
    await jfetch(`/api/nginx/rules/start?id=${encodeURIComponent(id)}`, { method: 'POST' });
    await load();
  }

  async function stop(id: string): Promise<void> {
    await jfetch(`/api/nginx/rules/stop?id=${encodeURIComponent(id)}`, { method: 'POST' });
    await load();
  }

  async function log(id: string): Promise<NginxLogEntry[]> {
    const j = await jfetch(`/api/nginx/log?rule=${encodeURIComponent(id)}`);
    return Array.isArray(j.items) ? j.items : [];
  }

  async function captures(id: string): Promise<CaptureSummary[]> {
    const j = await jfetch(`/api/nginx/captures?rule=${encodeURIComponent(id)}`);
    return Array.isArray(j.items) ? j.items : [];
  }

  async function capture(ruleId: string, id: string): Promise<CaptureDetail> {
    const j = await jfetch(`/api/nginx/captures/${encodeURIComponent(ruleId)}/${encodeURIComponent(id)}`);
    return j.item as CaptureDetail;
  }

  async function clearCaptures(id: string): Promise<void> {
    await jfetch(`/api/nginx/captures?rule=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  function pickFolder(): Promise<{ path?: string; cancelled?: boolean; error?: string; message?: string }> {
    return jfetch('/api/projects/pick', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
  }

  return { rules, status, load, save, remove, start, stop, log, captures, capture, clearCaptures, pickFolder };
}
