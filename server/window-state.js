import { createJsonStore } from './json-store.js';

// 窗口状态：上次打开的文件页签、激活页签、左侧栏位、「历史」子页、消息筛选开关。
// rail 白名单**不含 mobile**——手机视图由前端 mobileLanding 的自动逻辑管理，不参与窗口恢复。
export const RAILS = ['explorer', 'history', 'contacts', 'stat', 'scheduler', 'proxy'];
export const HISTORY_TABS = ['files', 'messages'];
export const MAX_TABS = 50;

export function emptyWindowState() { return {}; }

function fileNameOf(p) {
  const q = p.replace(/\\/g, '/');
  return q.split('/').filter(Boolean).pop() || q;
}

export function normalizeWindowState(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  const rail = src.rail === 'jobs' ? 'scheduler' : src.rail;
  if (typeof rail === 'string' && RAILS.includes(rail)) out.rail = rail;
  if (typeof src.historyTab === 'string' && HISTORY_TABS.includes(src.historyTab)) out.historyTab = src.historyTab;
  if (typeof src.msgFilter === 'boolean') out.msgFilter = src.msgFilter;
  if (Array.isArray(src.tabs)) {
    const tabs = [];
    for (const t of src.tabs) {
      if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
      if (typeof t.projectId !== 'string' || !t.projectId) continue;
      if (typeof t.path !== 'string' || !t.path) continue;
      const label = typeof t.label === 'string' && t.label ? t.label : fileNameOf(t.path);
      tabs.push({ projectId: t.projectId, path: t.path, label });
      if (tabs.length >= MAX_TABS) break;
    }
    out.tabs = tabs;
  }
  if (typeof src.activeTab === 'string' && src.activeTab) out.activeTab = src.activeTab;
  else if (src.activeTab === null) out.activeTab = null;
  return out;
}

export function createWindowState({ file = null, logger = console } = {}) {
  return createJsonStore({ file, logger, normalize: normalizeWindowState, defaults: emptyWindowState });
}
