import { LLM_PROVIDER_PRESETS, presetById, isVisionModel } from '@devflow/shared/llm-presets';

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

export function validateSelections(value) {
  if (!Array.isArray(value)) fail('bad-config', 'providers must be an array');
  for (const sel of value) {
    if (!sel || typeof sel !== 'object' || Array.isArray(sel)) fail('bad-config', 'selection must be an object');
    if (typeof sel.id !== 'string' || !sel.id) fail('bad-config', 'selection.id required');
    if (!presetById(sel.id)) fail('bad-config', `unknown provider: ${sel.id}`);
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

export function mergePresetProviders({ current = {}, selections = [], presets = LLM_PROVIDER_PRESETS } = {}) {
  const out = { ...current };
  const skipped = [];
  const presetMap = new Map(presets.map((p) => [p.id, p]));
  for (const sel of selections) {
    const preset = presetMap.get(sel.id);
    if (!preset) continue;
    const existing = current[sel.id] && typeof current[sel.id] === 'object' && !Array.isArray(current[sel.id])
      ? current[sel.id]
      : {};
    const incoming = typeof sel.apiKey === 'string' ? sel.apiKey.trim() : '';
    const keys = incoming ? [incoming] : existingKeys(existing.options);
    if (!keys.length) { skipped.push(sel.id); continue; }

    const opts = { ...(existing.options || {}), baseURL: preset.baseURL };
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

    out[sel.id] = { ...existing, name: preset.name, options: opts, models };
  }
  return { provider: out, skipped };
}
