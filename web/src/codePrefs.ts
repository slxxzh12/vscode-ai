import { ref, watch } from 'vue';
import { DEFAULT_CODE_EXTS, DEFAULT_EXCLUDE_DIRS, DEFAULT_HUGE_COMMIT_ADDED_LIMIT } from '@devflow/shared/git-filter';

export interface CodePrefs {
  exts: string;
  excludeDirs: string;
  excludeTestFiles: boolean;
  codeOnly: boolean;
  hugeCommitLimit: string;
}

export function defaultPrefs(): CodePrefs {
  return {
    exts: DEFAULT_CODE_EXTS.join(', '),
    excludeDirs: DEFAULT_EXCLUDE_DIRS.join(', '),
    excludeTestFiles: true,
    codeOnly: true,
    hugeCommitLimit: String(DEFAULT_HUGE_COMMIT_ADDED_LIMIT),
  };
}

// 服务端只存用户改过的键；缺键/类型不符一律回退默认值
export function mergePrefs(saved: unknown, base: CodePrefs): CodePrefs {
  const s = saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {};
  const str = (k: keyof CodePrefs, d: string) => (typeof s[k] === 'string' ? (s[k] as string) : d);
  const bool = (k: keyof CodePrefs, d: boolean) => (typeof s[k] === 'boolean' ? (s[k] as boolean) : d);
  return {
    exts: str('exts', base.exts),
    excludeDirs: str('excludeDirs', base.excludeDirs),
    hugeCommitLimit: str('hugeCommitLimit', base.hugeCommitLimit),
    excludeTestFiles: bool('excludeTestFiles', base.excludeTestFiles),
    codeOnly: bool('codeOnly', base.codeOnly),
  };
}

const prefs = ref<CodePrefs>(defaultPrefs());
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

async function fetchPrefs(): Promise<Partial<CodePrefs>> {
  const res = await fetch('/api/code/prefs');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Partial<CodePrefs>>;
}

async function putPrefs(data: CodePrefs): Promise<Partial<CodePrefs>> {
  const res = await fetch('/api/code/prefs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Partial<CodePrefs>>;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void putPrefs(prefs.value).catch(() => { /* ignore */ }); }, 500);
}

// 任何字段被改动 → 去抖上报服务端（同端口所有浏览器共享）
watch(prefs, scheduleSave, { deep: true });

export function useCodePrefs() {
  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const saved = await fetchPrefs();
      prefs.value = mergePrefs(saved, defaultPrefs());
    } catch { /* 用默认值 */ }
  }
  return { prefs, load, saveNow: () => putPrefs(prefs.value) };
}
