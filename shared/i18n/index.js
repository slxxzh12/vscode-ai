import { messages as zhCN } from './zh-CN.js';
import { messages as en } from './en.js';

export const LOCALES = Object.freeze(['zh-CN', 'en']);
// 只有明确的中文环境才用中文；其余（英文、其他语言、无法识别）一律英文。
export const DEFAULT_LOCALE = 'en';

const CATALOGS = { 'zh-CN': zhCN, en };

export function normalizeLocale(x) {
  if (typeof x !== 'string') return DEFAULT_LOCALE;
  const s = x.toLowerCase();
  if (s.startsWith('zh')) return 'zh-CN';
  if (s.startsWith('en')) return 'en';
  return DEFAULT_LOCALE;
}

// 探测当前机器语言：浏览器用 navigator.language(s)，Node 用 Intl 默认 locale。
// 中文 → zh-CN；其他或无法判断 → en。
export function detectLocale() {
  try {
    if (typeof navigator !== 'undefined') {
      const list = [navigator.language, ...(Array.isArray(navigator.languages) ? navigator.languages : [])].filter(Boolean);
      if (list.length) return list.some((x) => String(x).toLowerCase().startsWith('zh')) ? 'zh-CN' : 'en';
    }
  } catch { /* ignore */ }
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale;
    if (loc) return String(loc).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  } catch { /* ignore */ }
  return 'en';
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
