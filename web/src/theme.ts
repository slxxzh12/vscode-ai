import { ref, computed } from 'vue';

export type ThemeMode = 'dark' | 'light';
const STORE = 'devflow-theme';

function initial(): ThemeMode {
  try {
    const s = localStorage.getItem(STORE);
    if (s === 'light' || s === 'dark') return s;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  } catch { /* ignore */ }
  return 'dark';
}

const theme = ref<ThemeMode>(initial());

function apply() {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (root) root.dataset.theme = theme.value;
  try { localStorage.setItem(STORE, theme.value); } catch { /* ignore */ }
}
apply();

export function useTheme() {
  return {
    theme,
    isDark: computed(() => theme.value === 'dark'),
    toggle() {
      theme.value = theme.value === 'dark' ? 'light' : 'dark';
      apply();
    },
  };
}
