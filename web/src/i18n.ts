import { ref, type Ref } from 'vue';
import { translate, normalizeLocale, LOCALES } from '@devflow/shared/i18n';

const STORE = 'devflow-lang';

// 默认跟随系统语言：系统为中文 → 中文；其余一律 → 英文
function systemLocale(): string {
  try {
    const lang = (typeof navigator !== 'undefined' && navigator.language) || '';
    return lang.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  } catch { /* ignore */ }
  return 'en';
}

function initial(): string {
  try {
    const saved = localStorage.getItem(STORE);
    if (saved) return normalizeLocale(saved);
  } catch { /* ignore */ }
  return systemLocale();
}

export const locale: Ref<string> = ref(initial());

export function t(key: string, params?: Record<string, unknown>): string {
  return translate(locale.value, key, params);
}

export function setLocale(x: string) {
  const next = normalizeLocale(x);
  locale.value = next;
  try { localStorage.setItem(STORE, next); } catch { /* ignore */ }
  try {
    fetch('/api/settings/language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: next }),
    }).catch(() => { /* 同步失败不影响本地切换 */ });
  } catch { /* ignore */ }
}

export function useI18n() {
  return { locale, t, setLocale, LOCALES };
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $t: (key: string, params?: Record<string, unknown>) => string;
  }
}
