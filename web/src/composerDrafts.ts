// 提示词输入框草稿：按会话保存在 localStorage，切换页签/会话或组件重建后仍能恢复。
const KEY = 'devflow-composer-drafts';
const MAX_PER_DRAFT = 100_000;

type Store = Record<string, string>;
let store: Store | null = null;

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Store = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && k) out[k] = v;
    }
    return out;
  } catch { return {}; }
}

function getStore(): Store {
  if (!store) store = load();
  return store;
}

function persist(): void {
  try { localStorage.setItem(KEY, JSON.stringify(getStore())); } catch { /* 配额/隐私模式：仅内存 */ }
}

export function draftKey(sessionId: string | null | undefined): string {
  return sessionId || '__none__';
}

export function getComposerDraft(sessionId: string | null | undefined): string {
  return getStore()[draftKey(sessionId)] || '';
}

export function setComposerDraft(sessionId: string | null | undefined, text: string): void {
  const key = draftKey(sessionId);
  const s = getStore();
  if (!text) {
    if (key in s) { delete s[key]; persist(); }
    return;
  }
  const next = text.length > MAX_PER_DRAFT ? text.slice(-MAX_PER_DRAFT) : text;
  if (s[key] === next) return;
  s[key] = next;
  persist();
}

export function clearComposerDrafts(): void {
  store = {};
  persist();
}
