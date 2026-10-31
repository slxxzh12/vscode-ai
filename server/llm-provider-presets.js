import { LLM_PROVIDER_PRESETS, presetById, isVisionModel } from '@devflow/shared/llm-presets';

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

const CUSTOM_ID_RE = /^[A-Za-z0-9._-]+$/;

function isHttpUrl(v) {
  if (typeof v !== 'string' || !v) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

export function validateSelections(value) {
  if (!Array.isArray(value)) fail('bad-config', 'providers must be an array');
  for (const sel of value) {
    if (!sel || typeof sel !== 'object' || Array.isArray(sel)) fail('bad-config', 'selection must be an object');
    if (typeof sel.id !== 'string' || !sel.id) fail('bad-config', 'selection.id required');
    if (!presetById(sel.id)) {
      if (!CUSTOM_ID_RE.test(sel.id)) fail('bad-config', `invalid provider id: ${sel.id}`);
      if (!isHttpUrl(sel.baseURL)) fail('bad-config', `provider ${sel.id} requires baseURL`);
    }
    if (sel.name !== undefined && typeof sel.name !== 'string') fail('bad-config', 'name must be a string');
    if (sel.baseURL !== undefined && typeof sel.baseURL !== 'string') fail('bad-config', 'baseURL must be a string');
    if (sel.apiKey !== undefined && typeof sel.apiKey !== 'string') fail('bad-config', 'apiKey must be a string');
    if (!Array.isArray(sel.models) || sel.models.some((m) => typeof m !== 'string')) {
      fail('bad-config', 'models must be a string array');
    }
  }
}

function existingKeys(options) {
  const o = options || {};
  const raw = Array.isArray(o.apiKeys) ? o.apiKeys : (typeof o.apiKey === 'string' && o.apiKey ? [o.apiKey] : []);
  const out = [];
  for (const k of raw) if (typeof k === 'string' && k && !out.includes(k)) out.push(k);
  return out;
}

export function mergeConfiguredProviders({ current = {}, selections = [], remove = [], presets = LLM_PROVIDER_PRESETS } = {}) {
  const out = { ...current };
  for (const id of remove) if (typeof id === 'string' && id) delete out[id];
  const skipped = [];
  const presetMap = new Map(presets.map((p) => [p.id, p]));
  for (const sel of selections) {
    const preset = presetMap.get(sel.id);
    const existing = current[sel.id] && typeof current[sel.id] === 'object' && !Array.isArray(current[sel.id])
      ? current[sel.id]
      : {};
    const incoming = typeof sel.apiKey === 'string' ? sel.apiKey.trim() : '';
    const keys = incoming ? [incoming] : existingKeys(existing.options);
    if (!keys.length) { skipped.push(sel.id); continue; }

    const baseURL = preset ? preset.baseURL : sel.baseURL;
    const name = preset ? preset.name : (sel.name || sel.id);
    const opts = { ...(existing.options || {}), baseURL };
    delete opts.apiKey;
    delete opts.apiKeys;
    if (keys.length === 1) opts.apiKey = keys[0]; else opts.apiKeys = keys;

    const models = {};
    const seen = new Set();
    for (const raw of sel.models) {
      const id = String(raw).trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const base = existing.models && existing.models[id] && typeof existing.models[id] === 'object'
        ? existing.models[id]
        : {};
      const entry = { ...base };
      if (isVisionModel(sel.id, id)) entry.attachment = true;
      models[id] = entry;
    }

    out[sel.id] = { ...existing, name, options: opts, models };
  }
  return { provider: out, skipped };
}
