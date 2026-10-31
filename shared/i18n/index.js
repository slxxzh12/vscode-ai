import { messages as zhCN } from './zh-CN.js';
import { messages as en } from './en.js';

export const LOCALES = Object.freeze(['zh-CN', 'en']);
export const DEFAULT_LOCALE = 'zh-CN';

const CATALOGS = { 'zh-CN': zhCN, en };

export function normalizeLocale(x) {
  if (typeof x !== 'string') return DEFAULT_LOCALE;
  const s = x.toLowerCase();
  if (s.startsWith('zh')) return 'zh-CN';
  if (s.startsWith('en')) return 'en';
  return DEFAULT_LOCALE;
}

function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] == null ? m : String(params[k])));
}

export function translate(locale, key, params) {
  const loc = normalizeLocale(locale);
  const current = CATALOGS[loc] || {};
  const raw = (key in current) ? current[key] : (key in en ? en[key] : key);
  return interpolate(raw, params);
}
