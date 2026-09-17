import { createJsonStore } from './json-store.js';

const MAX_TEXT_LEN = 4000;
const TEXT_KEYS = ['exts', 'excludeDirs', 'hugeCommitLimit'];
const BOOL_KEYS = ['excludeTestFiles', 'codeOnly'];

export function emptyPrefs() { return {}; }

// 只保留已知键：文本键截断、布尔键仅接受布尔值；缺键 = 用前端默认值
export function normalizeCodePrefs(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  for (const key of TEXT_KEYS) {
    if (typeof src[key] === 'string') out[key] = src[key].slice(0, MAX_TEXT_LEN);
  }
  for (const key of BOOL_KEYS) {
    if (typeof src[key] === 'boolean') out[key] = src[key];
  }
  return out;
}

export function createCodePrefs({ file = null, logger = console } = {}) {
  return createJsonStore({ file, logger, normalize: normalizeCodePrefs, defaults: emptyPrefs });
}
