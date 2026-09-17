import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function opencodeConfigDir() {
  return process.env.DEVFLOW_OPENCODE_CONFIG || path.join(os.homedir(), '.config', 'opencode');
}

function stripJsonc(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// 常见 provider 的上游 baseURL 兜底：配置里未写 options.baseURL 时使用（显式配置优先）
export const DEFAULT_BASE_URLS = {
  deepseek: 'https://api.deepseek.com/v1',
};

function readConfigFile(dir) {
  for (const name of ['opencode.json', 'opencode.jsonc']) {
    const f = path.join(dir, name);
    try { return fs.readFileSync(f, 'utf8'); } catch { /* next */ }
  }
  return null;
}

export function loadOpencodeProviders({ dir = opencodeConfigDir() } = {}) {
  const raw = readConfigFile(dir);
  if (raw == null) return { providers: [], defaultProvider: null, model: '' };
  let json;
  try { json = JSON.parse(raw); } catch { try { json = JSON.parse(stripJsonc(raw)); } catch { return { providers: [], defaultProvider: null, model: '' }; } }
  const providers = [];
  for (const [id, p] of Object.entries(json.provider || {})) {
    const o = (p && p.options) || {};
    const apiKeysRaw = Array.isArray(o.apiKeys) ? o.apiKeys : (o.apiKey ? [o.apiKey] : []);
    providers.push({ id, name: (p && p.name) || id, baseURL: o.baseURL || DEFAULT_BASE_URLS[id] || '', apiKeysRaw, models: Object.keys((p && p.models) || {}) });
  }
  const model = typeof json.model === 'string' ? json.model : '';
  const defaultProvider = model.includes('/') ? model.split('/')[0] : (providers[0] ? providers[0].id : null);
  return { providers, defaultProvider, model };
}

function jwtSubject(token) {
  if (typeof token !== 'string') return '';
  const parts = token.split('.');
  if (parts.length !== 3) return '';
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof payload.sub === 'string' ? payload.sub.trim() : '';
  } catch { return ''; }
}

// 本机当前工号：优先环境变量，其次 opencode 配置里 DevFlow 代理 JWT 的 sub 声明。
export function detectEmployeeId({ dir = opencodeConfigDir(), env = process.env } = {}) {
  const override = env.DEVFLOW_EMPLOYEE_ID;
  if (typeof override === 'string' && override.trim()) return override.trim();
  const raw = readConfigFile(dir);
  if (raw == null) return '';
  let json;
  try { json = JSON.parse(raw); } catch { try { json = JSON.parse(stripJsonc(raw)); } catch { return ''; } }
  for (const p of Object.values(json.provider || {})) {
    const o = (p && p.options) || {};
    const keys = Array.isArray(o.apiKeys) ? o.apiKeys : (o.apiKey ? [o.apiKey] : []);
    for (const k of keys) {
      const sub = jwtSubject(resolveApiKey(k, env));
      if (sub) return sub;
    }
  }
  return '';
}

export function resolveApiKey(raw, env = process.env) {
  if (typeof raw !== 'string') return '';
  const m = raw.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/);
  return m ? (env[m[1]] || '') : raw;
}

export function resolveApiKeys(rawList, env = process.env) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  for (const raw of rawList) {
    const key = resolveApiKey(raw, env);
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

export function listProviders(opts) {
  const { providers, defaultProvider } = loadOpencodeProviders(opts);
  return {
    defaultProvider,
    providers: providers.map((p) => ({ id: p.id, name: p.name, baseURL: p.baseURL, hasKey: resolveApiKeys(p.apiKeysRaw).length > 0, models: p.models })),
  };
}

export function getProvider(id, opts) {
  const { providers } = loadOpencodeProviders(opts);
  const p = providers.find((x) => x.id === id);
  if (!p) return null;
  const apiKeys = resolveApiKeys(p.apiKeysRaw);
  return { id: p.id, baseURL: p.baseURL, apiKey: apiKeys[0] || '', apiKeys, models: p.models };
}

export function buildOpencodeConfig({ host, port, providerId, baseURL, token, models = [] }) {
  let basePath = '';
  try { basePath = new URL(baseURL).pathname.replace(/\/+$/, ''); } catch { basePath = ''; }
  const clientBase = `http://${host}:${port}/api/llm/${encodeURIComponent(providerId)}${basePath}`;
  const modelMap = {};
  for (const m of models) modelMap[m] = {};
  return {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      [`devflow-${providerId}`]: {
        npm: '@ai-sdk/openai-compatible',
        name: `DevFlow ${providerId}`,
        options: { baseURL: clientBase, apiKey: token },
        models: modelMap,
      },
    },
  };
}

export function buildOpencodeConfigMulti({ host, port, token, providers = [] }) {
  const provider = {};
  for (const p of providers) {
    if (!p || !p.id || !p.baseURL) continue;
    const one = buildOpencodeConfig({ host, port, providerId: p.id, baseURL: p.baseURL, token, models: p.models || [] });
    Object.assign(provider, one.provider);
  }
  return { $schema: 'https://opencode.ai/config.json', provider };
}
