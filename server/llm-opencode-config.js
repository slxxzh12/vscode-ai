import fs from 'node:fs';
import path from 'node:path';
import { opencodeConfigDir, stripJsonc } from './llm-config.js';

const DEFAULT_SCHEMA = 'https://opencode.ai/config.json';

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function readFile(dir) {
  for (const name of ['opencode.json', 'opencode.jsonc']) {
    const file = path.join(dir, name);
    try { return { file, name, raw: fs.readFileSync(file, 'utf8') }; } catch { /* next */ }
  }
  return null;
}

export function readActiveConfig({ dir = opencodeConfigDir() } = {}) {
  const hit = readFile(dir);
  if (!hit) return { path: path.join(dir, 'opencode.json'), format: null, exists: false, raw: '', config: {} };
  const format = hit.name.endsWith('.jsonc') ? 'jsonc' : 'json';
  const text = hit.raw.replace(/^\uFEFF/, '');
  let config = null;
  try {
    config = JSON.parse(text);
  } catch {
    if (format === 'jsonc') {
      try { config = JSON.parse(stripJsonc(text)); } catch { config = null; }
    }
  }
  return { path: hit.file, format, exists: true, raw: hit.raw, config };
}

export function validateManaged({ provider, model } = {}) {
  if (model !== undefined && typeof model !== 'string') fail('bad-config', 'model must be a string');
  if (provider === undefined) return;
  if (!isPlainObject(provider)) fail('bad-config', 'provider must be an object');
  for (const [id, p] of Object.entries(provider)) {
    if (!isPlainObject(p)) fail('bad-config', `provider.${id} must be an object`);
    if (p.options !== undefined) {
      if (!isPlainObject(p.options)) fail('bad-config', `provider.${id}.options must be an object`);
      const o = p.options;
      if (o.baseURL !== undefined && typeof o.baseURL !== 'string') fail('bad-config', `provider.${id}.options.baseURL must be a string`);
      if (o.apiKey !== undefined && typeof o.apiKey !== 'string') fail('bad-config', `provider.${id}.options.apiKey must be a string`);
      if (o.apiKeys !== undefined && (!Array.isArray(o.apiKeys) || o.apiKeys.some((k) => typeof k !== 'string'))) {
        fail('bad-config', `provider.${id}.options.apiKeys must be a string array`);
      }
    }
    if (p.models !== undefined) {
      if (!isPlainObject(p.models)) fail('bad-config', `provider.${id}.models must be an object`);
      for (const [mid, m] of Object.entries(p.models)) {
        if (!isPlainObject(m)) fail('bad-config', `provider.${id}.models.${mid} must be an object`);
      }
    }
  }
}

export function normalizeProviderKeys(provider) {
  const out = { ...provider };
  const o = { ...(out.options || {}) };
  const hadKeys = o.apiKey !== undefined || o.apiKeys !== undefined;
  const raw = Array.isArray(o.apiKeys) ? o.apiKeys : (typeof o.apiKey === 'string' ? [o.apiKey] : []);
  const keys = [];
  for (const k of raw) if (typeof k === 'string' && k && !keys.includes(k)) keys.push(k);
  delete o.apiKey;
  delete o.apiKeys;
  if (keys.length === 1) o.apiKey = keys[0];
  else if (keys.length > 1) o.apiKeys = keys;
  if (out.options !== undefined || hadKeys) {
    if (Object.keys(o).length) out.options = o; else delete out.options;
  }
  return out;
}

function stamp(now) {
  const d = now instanceof Date ? now : new Date(now);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

export function mergeAndWrite({ dir = opencodeConfigDir(), provider, model, now = new Date() } = {}) {
  if (provider === undefined || model === undefined) fail('bad-config', 'provider and model are required');
  validateManaged({ provider, model });
  const current = readActiveConfig({ dir });
  if (current.exists && current.config === null) fail('bad-existing', 'existing config is not valid JSON');
  fs.mkdirSync(dir, { recursive: true });

  const s = stamp(now);
  const backups = [];
  const jsonc = path.join(dir, 'opencode.jsonc');
  if (fs.existsSync(jsonc)) {
    const bak = path.join(dir, `opencode.jsonc.${s}.bak`);
    fs.renameSync(jsonc, bak);
    backups.push(bak);
  }
  const target = path.join(dir, 'opencode.json');
  if (fs.existsSync(target)) {
    const bak = path.join(dir, `opencode.${s}.bak`);
    fs.copyFileSync(target, bak);
    backups.push(bak);
  }

  const config = { ...(current.config || {}) };
  if (!config.$schema) config.$schema = DEFAULT_SCHEMA;
  config.provider = {};
  for (const [id, p] of Object.entries(provider)) config.provider[id] = normalizeProviderKeys(p);
  if (model) config.model = model; else delete config.model;

  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
  try {
    fs.renameSync(tmp, target);
  } catch {
    try { fs.rmSync(target, { force: true }); } catch { /* ignore */ }
    fs.renameSync(tmp, target);
  }
  return { path: target, backups, config };
}
