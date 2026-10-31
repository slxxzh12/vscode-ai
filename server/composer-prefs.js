import { createJsonStore } from './json-store.js';

const BOOL_KEYS = ['autoSend'];

export function emptyPrefs() { return {}; }

// 只保留已知键；布尔键仅接受布尔值；缺键 = 用前端默认值
export function normalizeComposerPrefs(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  for (const key of BOOL_KEYS) {
    if (typeof src[key] === 'boolean') out[key] = src[key];
  }
  return out;
}

export function createComposerPrefs({ file = null, logger = console } = {}) {
  return createJsonStore({ file, logger, normalize: normalizeComposerPrefs, defaults: emptyPrefs });
}
