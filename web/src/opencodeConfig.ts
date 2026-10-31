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

export function apiKeysOf(options: OpencodeProviderOptions | undefined): string[] {
  const o = options || {};
  const raw = Array.isArray(o.apiKeys) ? o.apiKeys : (typeof o.apiKey === 'string' && o.apiKey ? [o.apiKey] : []);
  const out: string[] = [];
  for (const k of raw) if (typeof k === 'string' && k && !out.includes(k)) out.push(k);
  return out;
}
