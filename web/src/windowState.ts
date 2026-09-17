import type { CenterTab } from './useCenter';

// 窗口状态（服务端 <端口数据目录>/window-state.json，一个端口一份，多端共享一份）。
export type Rail = 'explorer' | 'history' | 'contacts' | 'stat' | 'scheduler' | 'proxy' | 'mobile';
export type HistoryTab = 'files' | 'messages';

export interface SavedTab { projectId: string; path: string; label: string }
export interface WindowState {
  rail?: Rail;
  historyTab?: HistoryTab;
  msgFilter?: boolean;
  tabs?: SavedTab[];
  activeTab?: string | null;
}

export interface RestorePlan {
  tabs: SavedTab[];            // 已过滤掉 projects 里不存在的 projectId
  rail?: Rail;                 // 仅当 URL hash 未指定栏位
  historyTab?: HistoryTab;     // 仅当 URL hash 未指定子页
  msgFilter?: boolean;
  activeFileTab?: string;      // `f:<projectId>|<path>`；深链优先或指不到时 undefined
}

const SAVE_DEBOUNCE_MS = 600;
const fileTabId = (projectId: string, path: string) => `f:${projectId}|${path}`;

// 中心页签 → 存档（只存文件页签：会话页签由服务端 SESSION_LIST 自动恢复）
export function toSavedTabs(tabs: CenterTab[]): SavedTab[] {
  const out: SavedTab[] = [];
  for (const t of tabs) {
    if (t.kind !== 'file') continue;
    if (!t.projectId || !t.path) continue;
    out.push({ projectId: t.projectId, path: t.path, label: t.label || t.path });
  }
  return out;
}

// 存档 → 文件页签列表（容错：非法项直接丢）
export function fileTabsOf(state: WindowState | null): SavedTab[] {
  if (!state || !Array.isArray(state.tabs)) return [];
  const out: SavedTab[] = [];
  for (const t of state.tabs) {
    if (!t || typeof t.projectId !== 'string' || !t.projectId) continue;
    if (typeof t.path !== 'string' || !t.path) continue;
    out.push({ projectId: t.projectId, path: t.path, label: typeof t.label === 'string' && t.label ? t.label : t.path });
  }
  return out;
}

// 恢复决策（纯函数，便于单测）：hash 优先级、失效页签过滤、激活页签兜底都在这里定。
export function planRestore(state: WindowState | null, opts: {
  projectIds: string[];
  hashRail: string | null;
  hashHistoryTab: HistoryTab | null;
  deepLinkOpened: boolean;
}): RestorePlan {
  const known = new Set(opts.projectIds);
  const tabs = fileTabsOf(state).filter((t) => known.has(t.projectId));
  const plan: RestorePlan = { tabs };
  if (!state) return plan;                                   // 无存档：不覆盖任何默认值
  if (!opts.hashRail && state.rail) plan.rail = state.rail;
  if (!opts.hashHistoryTab && state.historyTab) plan.historyTab = state.historyTab;
  if (typeof state.msgFilter === 'boolean') plan.msgFilter = state.msgFilter;
  if (opts.deepLinkOpened) return plan;                       // ?open= 深链优先于存档的激活项
  const active = state.activeTab;
  if (typeof active === 'string' && tabs.some((t) => fileTabId(t.projectId, t.path) === active)) {
    plan.activeFileTab = active;
  }
  return plan;
}

export async function fetchWindowState(): Promise<WindowState | null> {
  try {
    const res = await fetch('/api/window-state');
    if (!res.ok) return null;
    const j = await res.json();
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as WindowState) : null;
  } catch { return null; }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

async function putWindowState(state: WindowState): Promise<void> {
  try {
    await fetch('/api/window-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
      keepalive: true,
    });
  } catch { /* 窗口状态丢了不影响使用 */ }
}

// 去抖合并写（页签开关会连续触发）
export function saveWindowState(state: WindowState): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void putWindowState(state); }, SAVE_DEBOUNCE_MS);
}

// 立即写（beforeunload 用）
export async function flushWindowState(state: WindowState): Promise<void> {
  clearTimeout(saveTimer);
  await putWindowState(state);
}
