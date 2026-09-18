export type JsonObject = Record<string, unknown>;
export type OpencodeModel = Record<string, unknown>;
export interface OpencodeProviderOptions {
  baseURL?: string;
  apiKey?: string;
  apiKeys?: string[];
  [k: string]: unknown;
}
export interface OpencodeProvider {
  name?: string;
  options?: OpencodeProviderOptions;
  models?: Record<string, OpencodeModel>;
  [k: string]: unknown;
}
export interface OpencodeConfigJson {
  $schema?: string;
  model?: string;
  provider?: Record<string, OpencodeProvider>;
  [k: string]: unknown;
}
export interface OpencodeConfigFile {
  path: string;
  exists: boolean;
  format: 'json' | 'jsonc' | null;
  raw: string;
  config: OpencodeConfigJson | null;
}

export interface ModelRow { id: string; name: string; extra: string }
export interface ProviderRow {
  id: string;
  name: string;
  baseURL: string;
  keys: string[];
  extraOptions: string;
  models: ModelRow[];
  rest: OpencodeProvider;
}

export function apiKeysOf(options: OpencodeProviderOptions | undefined): string[] {
  const o = options || {};
  const raw = Array.isArray(o.apiKeys) ? o.apiKeys : (typeof o.apiKey === 'string' && o.apiKey ? [o.apiKey] : []);
  const out: string[] = [];
  for (const k of raw) if (typeof k === 'string' && k && !out.includes(k)) out.push(k);
  return out;
}

export function optionsExtra(options: OpencodeProviderOptions | undefined): JsonObject {
  const o: JsonObject = { ...(options || {}) };
  delete o.baseURL;
  delete o.apiKey;
  delete o.apiKeys;
  return o;
}

export function modelExtra(model: OpencodeModel | undefined): JsonObject {
  const m: JsonObject = { ...(model || {}) };
  delete m.name;
  return m;
}

export function parseJsonObject(text: string): { ok: true; value: JsonObject } | { ok: false; error: string } {
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'not-object' };
    return { ok: true, value: v as JsonObject };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function composeOptions(baseURL: string, keys: string[], extra: JsonObject = {}): OpencodeProviderOptions {
  const o: OpencodeProviderOptions = { ...extra };
  delete o.baseURL;
  delete o.apiKey;
  delete o.apiKeys;
  if (baseURL) o.baseURL = baseURL;
  const clean = keys.filter((k) => k);
  if (clean.length === 1) o.apiKey = clean[0];
  else if (clean.length > 1) o.apiKeys = clean;
  return o;
}

export function composeModel(name: string, extra: JsonObject = {}): OpencodeModel {
  const m: OpencodeModel = { ...extra };
  if (name) m.name = name; else delete m.name;
  return m;
}

export function rowsFromProvider(provider: Record<string, OpencodeProvider> | undefined): ProviderRow[] {
  return Object.entries(provider || {}).map(([id, p]) => ({
    id,
    name: typeof p.name === 'string' ? p.name : '',
    baseURL: typeof p.options?.baseURL === 'string' ? p.options.baseURL : '',
    keys: apiKeysOf(p.options),
    extraOptions: JSON.stringify(optionsExtra(p.options), null, 2),
    models: Object.entries(p.models || {}).map(([mid, m]) => ({
      id: mid,
      name: typeof m.name === 'string' ? m.name : '',
      extra: JSON.stringify(modelExtra(m), null, 2),
    })),
    rest: p,
  }));
}

export function providerFromRows(rows: ProviderRow[]):
  { ok: true; value: Record<string, OpencodeProvider> } | { ok: false; error: string } {
  const out: Record<string, OpencodeProvider> = {};
  for (const r of rows) {
    const id = r.id.trim();
    if (!id) return { ok: false, error: 'need-id' };
    if (out[id]) return { ok: false, error: 'dup-id' };
    const ex = parseJsonObject(r.extraOptions);
    if (!ex.ok) return { ok: false, error: `options:${ex.error}` };
    const models: Record<string, OpencodeModel> = {};
    for (const m of r.models) {
      const mid = m.id.trim();
      if (!mid) return { ok: false, error: 'need-id' };
      if (models[mid]) return { ok: false, error: 'dup-id' };
      const me = parseJsonObject(m.extra);
      if (!me.ok) return { ok: false, error: `model:${mid}:${me.error}` };
      models[mid] = composeModel(m.name, me.value);
    }
    const p: OpencodeProvider = { ...r.rest };
    if (r.name) p.name = r.name; else delete p.name;
    p.options = composeOptions(r.baseURL, r.keys, ex.value);
    p.models = models;
    out[id] = p;
  }
  return { ok: true, value: out };
}

export function collectModelOptions(providers: ProviderRow[]): string[] {
  const out: string[] = [];
  for (const p of providers) {
    const pid = p.id.trim();
    if (!pid) continue;
    for (const m of p.models) {
      const mid = m.id.trim();
      if (mid) out.push(`${pid}/${mid}`);
    }
  }
  return out.sort();
}
