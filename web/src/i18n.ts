import { ref, type Ref } from 'vue';
import { translate, normalizeLocale, detectLocale, LOCALES } from '@devflow/shared/i18n';

const STORE = 'devflow-lang';

// 默认跟随当前机器语言：中文 → 中文；其余（含无法识别）→ 英文。
function initial(): string {
  try {
    const saved = localStorage.getItem(STORE);
    if (saved) return normalizeLocale(saved);
  } catch { /* ignore */ }
  return detectLocale();
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
