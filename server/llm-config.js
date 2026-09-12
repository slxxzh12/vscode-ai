import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function opencodeConfigDir() {
  return process.env.DEVFLOW_OPENCODE_CONFIG || path.join(os.homedir(), '.config', 'opencode');
}

function stripJsonc(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readConfigFile(dir) {
  for (const name of ['opencode.json', 'opencode.jsonc']) {
    const f = path.join(dir, name);
    try { return fs.readFileSync(f, 'utf8'); } catch { /* next */ }
  }
  return null;
}

export function loadOpencodeProviders({ dir = opencodeConfigDir() } = {}) {
  const raw = readConfigFile(dir);
  if (raw == null) return { providers: [], defaultProvider: null };
  let json;
  try { json = JSON.parse(raw); } catch { try { json = JSON.parse(stripJsonc(raw)); } catch { return { providers: [], defaultProvider: null }; } }
  const providers = [];
  for (const [id, p] of Object.entries(json.provider || {})) {
    const o = (p && p.options) || {};
    providers.push({ id, name: (p && p.name) || id, baseURL: o.baseURL || '', apiKeyRaw: o.apiKey || '', models: Object.keys((p && p.models) || {}) });
  }
  const model = typeof json.model === 'string' ? json.model : '';
  const defaultProvider = model.includes('/') ? model.split('/')[0] : (providers[0] ? providers[0].id : null);
  return { providers, defaultProvider };
}

export function resolveApiKey(raw, env = process.env) {
  if (typeof raw !== 'string') return '';
  const m = raw.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/);
  return m ? (env[m[1]] || '') : raw;
}

export function listProviders(opts) {
  const { providers, defaultProvider } = loadOpencodeProviders(opts);
  return {
    defaultProvider,
    providers: providers.map((p) => ({ id: p.id, name: p.name, baseURL: p.baseURL, hasKey: !!resolveApiKey(p.apiKeyRaw), models: p.models })),
  };
}

export function getProvider(id, opts) {
  const { providers } = loadOpencodeProviders(opts);
  const p = providers.find((x) => x.id === id);
  if (!p) return null;
  return { id: p.id, baseURL: p.baseURL, apiKey: resolveApiKey(p.apiKeyRaw), models: p.models };
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
