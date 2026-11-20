import { ref } from 'vue';

// 刷新后恢复的页签数（默认 5）与「最近点击」页签顺序，均存本机 localStorage。
// 页签 id 与会话/文件页签一致：`s:<sessionId>` 或 `f:<projectId>|<path>`。
export const DEFAULT_RESTORE_TABS = 5;
export const MAX_RESTORE_TABS = 50;
export const MAX_RECENT_TABS = 50;
const RESTORE_KEY = 'devflow-restore-tabs';
const RECENT_KEY = 'devflow-recent-tabs';

export function clampRestoreTabs(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return DEFAULT_RESTORE_TABS;
  return Math.min(v, MAX_RESTORE_TABS);
}

// 把一个页签 id 移到最前（去重），最多保留 MAX_RECENT_TABS 条
export function pushRecentTab(list: string[], id: string): string[] {
  if (!id) return list;
  return [id, ...list.filter((x) => x !== id)].slice(0, MAX_RECENT_TABS);
}

// 取最近 N 个页签 id；无历史时返回 null（= 不限制，保持旧行为）
export function allowedRestoreIds(recent: string[], n: unknown): Set<string> | null {
  if (!recent.length) return null;
  return new Set(recent.slice(0, clampRestoreTabs(n)));
}

export function loadRestoreTabs(): number {
  try { return clampRestoreTabs(localStorage.getItem(RESTORE_KEY)); } catch { return DEFAULT_RESTORE_TABS; }
}

export function loadRecentTabs(): string[] {
  try {
    const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : [];
  } catch { return []; }
}

export function saveRecentTabs(list: string[]): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT_TABS))); } catch { /* ignore */ }
}

// 设置面板共享的响应式值：改完即时落盘，下次刷新生效
export const restoreTabs = ref(loadRestoreTabs());
export function setRestoreTabs(n: unknown): number {
  const v = clampRestoreTabs(n);
  restoreTabs.value = v;
  try { localStorage.setItem(RESTORE_KEY, String(v)); } catch { /* ignore */ }
  return v;
}
