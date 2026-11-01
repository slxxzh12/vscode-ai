<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue';
import { useTerminal } from './useTerminal';
import { useProjects } from './useProjects';
import { useCenter } from './useCenter';
import { useMessageHistory } from './useMessageHistory';
import SchedulerView from './scheduler/SchedulerView.vue';
import TerminalView from './components/TerminalView.vue';
import HistoryList from './components/HistoryList.vue';
import ToolSidebar from './components/ToolSidebar.vue';
import { MINI_TOOLS, type ToolId } from './tools/catalog';
import CodeStats from './components/CodeStats.vue';
import type { ProjectInfo } from '@devflow/shared';
import { useTheme } from './theme';
import { useI18n } from './i18n';
import { elementLocale } from './element-locale';
import { ElConfigProvider } from 'element-plus';
import { parseOpenParam, parseVoidProject } from './deeplink';
import ProxyHubView from './components/ProxyHubView.vue';
import AppMarketView from './components/AppMarketView.vue';
import { useLocalSources } from './local/useLocalSources';
import { useLocalDrop, type LocalDropPayload } from './local/useLocalDrop';
import { MAX_DROP_FILES } from './local/localHandles';
import LocalDropOverlay from './local/LocalDropOverlay.vue';
import LocalSidebar from './local/LocalSidebar.vue';
import { startDesktopRemoteCoder } from './remote-coder/useDesktopRemoteCoder';
import { useVersion } from './useVersion';
import { useUpgrade, shouldPopup } from './useUpgrade';
import UpgradeDialog from './components/UpgradeDialog.vue';
import SkillsInstallDialog from './components/SkillsInstallDialog.vue';
import { useSkillsInstall } from './useSkillsInstall';
import { readMobileLanding, writeMobileLanding } from './mobileLanding';
import { useSessionProjects } from './sessionProjects';
import { fetchWindowState, planRestore, saveWindowState, flushWindowState, toSavedTabs, type HistoryTab, type Rail, type AllStyle } from './windowState';
import { filterMessages, filterSessionsByProject, sessionOfActiveTab } from './msgFilter';
import { openRestoredSession } from './sessionRestore';
import { useLedgerSessions } from './ledgerSessions';
import type { SessionExtra } from './sessionTree';
import { allowedRestoreIds, loadRecentTabs, loadRestoreTabs, pushRecentTab, saveRecentTabs } from './restorePrefs';
import { pendingToolTab, clearPendingToolTab, pendingProxyTab, requestProxyTab, requestStartAgent } from './uiIntents';
import { parseSchedulerPromptFromSearch, requestSchedulerPrompt, SCHEDULER_PROMPT_PARAMS, parseSchedulerEditFromSearch, requestSchedulerEdit, SCHEDULER_EDIT_PARAMS } from './scheduler/schedulerIntent';
import { useNavicatWorkbench } from './tools/navicat/useNavicatWorkbench';
import { shouldOpenInNavicat } from './tools/navicat/sqliteFile';

const appRef = ref<HTMLDivElement | null>(null);
const termViewRef = ref<InstanceType<typeof TerminalView> | null>(null);

// 顶栏手机按钮：新标签页打开手机页（带上当前 access 参数，远端/手机可直接访问）
let stopRemoteCoder: (() => void) | null = null;

const terminal = useTerminal({});
const center = useCenter();

// —— 拖入本地文件/文件夹：挂载本地来源并开页签 ——
const local = useLocalSources();
function onLocalDrop(p: LocalDropPayload) {
  rail.value = 'explorer';
  if (p.dirHandles.length) {
    const folder = p.dirHandles[0];
    local.mountFolder(folder);
    center.openLocalRoot(folder.name);
    if (p.dirHandles.length > 1) alert(t('local.extra_folders'));
  }
  if (p.fileHandles.length) {
    const { keys, truncated } = local.addFiles(p.fileHandles.map((h) => ({ name: h.name, handle: h, file: null })));
    keys.forEach((key, i) => center.openLocalFile(key, p.fileHandles[i].name));
    if (truncated > 0) alert(t('local.too_many_files', { max: MAX_DROP_FILES }));
  } else if (!p.dirHandles.length && p.files.length) {
    // 非 Chromium 降级：只读打开文件
    const { keys, truncated } = local.addFiles(p.files.map((f) => ({ name: f.name, handle: null, file: f })));
    keys.forEach((key, i) => center.openLocalFile(key, p.files[i].name));
    if (truncated > 0) alert(t('local.too_many_files', { max: MAX_DROP_FILES }));
  }
}
const { dragging: localDragging } = useLocalDrop(onLocalDrop);
const activeLocalRoot = computed(() => center.active.value?.kind === 'local' && center.active.value.id === 'l:root' && !!local.root.value);
// 活动页签是工具时：左侧面板显示该工具的固定树（否则显示历史列表）
const activeToolTab = computed(() => (center.active.value?.kind === 'tool' ? center.active.value : null));
const activeTool = computed(() => activeToolTab.value?.tool as ToolId | undefined);
const projectsApi = useProjects();
const { version: appVersion, loadVersion } = useVersion();
const { upgrade: upgradeInfo, loadUpgrade } = useUpgrade();
const showUpgrade = ref(false);
const { status: skillsStatus, installing: skillsInstalling, loadSkillsStatus, installMissingSkills } = useSkillsInstall();
const showSkillsInstall = ref(false);
const skillsDialogTargets = computed(() => (skillsStatus.value?.targets || []).filter((t) => t.missing.length > 0));
async function maybeSkillsPopup() {
  const s = await loadSkillsStatus('', true);
  if (s && s.startupPrompt && s.missing > 0) showSkillsInstall.value = true;
}
async function installSkillsNow() {
  const r = await installMissingSkills();
  if (r) showSkillsInstall.value = false;
}
const UPGRADE_POPUP_KEY = 'devflow-upgrade-popup-at';
const UPGRADE_SKIP_KEY = 'devflow-upgrade-skip';
function openUpgrade() { const u = upgradeInfo.value?.downloadUrl || upgradeInfo.value?.url; if (u) window.open(u, '_blank', 'noopener'); }
function markUpgradePopup() { try { localStorage.setItem(UPGRADE_POPUP_KEY, String(Date.now())); } catch { /* ignore */ } }
function upgradeGo() { openUpgrade(); markUpgradePopup(); showUpgrade.value = false; }
function upgradeClose() { markUpgradePopup(); showUpgrade.value = false; }
function upgradeSkip() { try { localStorage.setItem(UPGRADE_SKIP_KEY, upgradeInfo.value?.latest || ''); } catch { /* ignore */ } showUpgrade.value = false; }
function maybeUpgradePopup() {
  let skip = ''; let popupAt = 0;
  try { skip = localStorage.getItem(UPGRADE_SKIP_KEY) || ''; popupAt = Number(localStorage.getItem(UPGRADE_POPUP_KEY) || 0); } catch { /* ignore */ }
  showUpgrade.value = shouldPopup(upgradeInfo.value, Date.now(), { skip, popupAt });
}
const { theme, toggle } = useTheme();
const { locale, setLocale, t } = useI18n();
function toggleLang() { setLocale(locale.value === 'en' ? 'zh-CN' : 'en'); }
// 目录颜色：按项目根目录自动分配并持久化；不同目录优先用不同颜色，用户可改
const DIR_COLORS_STORE = 'devflow-dir-colors';
const COLOR_VALUE: Record<string, string> = {
  red: '#7f1d1d', yellow: '#6b4e0f', blue: '#1e3a8a', green: '#14532d', purple: '#4c1d95',
  teal: '#134e4a', orange: '#7c2d12', pink: '#831843', cyan: '#164e63', lime: '#365314', brown: '#451a03', slate: '#334155',
};
const COLOR_IDS = Object.keys(COLOR_VALUE);
const colorOptions = COLOR_IDS.map((id) => ({ id, key: `top.color.${id}` }));
function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// 加权 RGB 色差（redmean），用于挑与已有目录颜色差异最大的颜色
function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexRgb(a);
  const [r2, g2, b2] = hexRgb(b);
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
function dirColorKey(root: string): string {
  const s = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-zA-Z]:/.test(s) ? s.toLowerCase() : s;
}
function loadDirColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DIR_COLORS_STORE);
    const o: unknown = raw ? JSON.parse(raw) : {};
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'string' && v in COLOR_VALUE) out[k] = v;
    }
    return out;
  } catch { return {}; }
}
const dirColors = ref<Record<string, string>>(loadDirColors());
function saveDirColors() {
  try { localStorage.setItem(DIR_COLORS_STORE, JSON.stringify(dirColors.value)); } catch { /* ignore */ }
}
function assignDirColor(root: string): string {
  const key = dirColorKey(root);
  if (!key) return '';
  const existing = dirColors.value[key];
  if (existing && existing in COLOR_VALUE) return existing;
  const used = new Set(Object.values(dirColors.value));
  // 前三个目录固定先用红、黄、绿，之后在空闲颜色里挑与已用颜色差异最大的
  const firstFree = ['red', 'yellow', 'green'].find((id) => !used.has(id));
  let id = firstFree || '';
  if (!id) {
    const free = COLOR_IDS.filter((c) => !used.has(c));
    const pool = free.length ? free : COLOR_IDS;
    let best = -1;
    for (const cand of pool) {
      const minDist = used.size
        ? Math.min(...[...used].map((u) => colorDistance(COLOR_VALUE[cand], COLOR_VALUE[u])))
        : 0;
      if (minDist > best) { best = minDist; id = cand; }
    }
  }
  dirColors.value = { ...dirColors.value, [key]: id };
  saveDirColors();
  return id;
}
const currentDirColorId = ref('');
const currentDirColor = computed(() => COLOR_VALUE[currentDirColorId.value] || '');
function onDirColorChange(e: Event) {
  const id = (e.target as HTMLSelectElement).value;
  const root = currentProjectInfo.value?.root || '';
  if (!root || !(id in COLOR_VALUE)) return;
  dirColors.value = { ...dirColors.value, [dirColorKey(root)]: id };
  saveDirColors();
  currentDirColorId.value = id;
}
const projects = ref<ProjectInfo[]>([]);
const currentProject = ref<string | null>(null);
const rail = ref<'explorer' | 'stat' | 'scheduler' | 'proxy' | 'mobile'>('explorer');
// 工具页签意图：切到 explorer 并打开对应工具页签（磁贴 / 活动栏图标触发）
watch(pendingToolTab, (id) => {
  if (!id) return;
  rail.value = 'explorer';
  center.openTool(id);
  clearPendingToolTab();
}, { immediate: true });
// 合并后的代理页：由 ProxyHubView 消费 pendingProxyTab 并选中子页签，这里只负责切 rail
watch(pendingProxyTab, (tab) => {
  if (!tab) return;
  rail.value = 'proxy';
}, { immediate: true });
// 新窗口（新标签/新浏览器窗口）与刷新的区分：sessionStorage 每标签独立，刷新保留、新开为空 → 左侧默认「消息」子页
const NEW_WINDOW = (() => {
  try {
    const k = 'devflow-window-booted';
    if (sessionStorage.getItem(k)) return false;
    sessionStorage.setItem(k, '1');
    return true;
  } catch { return false; }
})();
const historyTab = ref<HistoryTab>(NEW_WINDOW ? 'messages' : 'tree');
type StatTab = 'code' | 'group' | 'token';
const statTab = ref<StatTab>('code');

// —— URL hash 锚点：页签可刷新直达（#rail 或 #rail/sub）——
const RAILS = ['explorer', 'stat', 'scheduler', 'proxy', 'mobile'];
const TOOL_IDS = MINI_TOOLS.map((m) => m.id);
const SIDE_TABS = ['messages', 'files', 'tree'];
function parseHashSegs(): string[] {
  try { return decodeURIComponent(window.location.hash.replace(/^#/, '')).split('/').filter(Boolean); }
  catch { return []; }
}
function hashRailOf(): string | null {
  const r = (window.location.hash || '').replace(/^#\/?/, '').split('/')[0];
  if (r === 'jobs') return 'scheduler';
  return r && RAILS.includes(r) ? r : null;
}
function isSideTab(v: string | undefined): v is HistoryTab {
  return !!v && (SIDE_TABS as string[]).includes(v);
}
function hashHistoryTabOf(): HistoryTab | null {
  const [r, sub] = parseHashSegs();
  return (r === 'explorer' || r === 'history') && isSideTab(sub) ? sub : null;
}
function hashToolOf(): ToolId | null {
  const [r, sub] = parseHashSegs();
  return r === 'tools' && sub && (TOOL_IDS as string[]).includes(sub) ? (sub as ToolId) : null;
}
function applyHash() {
  const [r, sub] = parseHashSegs();
  const historyAlias = r === 'history';
  if (r === 'tools') {
    const tool = hashToolOf();
    if (tool === 'nginx') { rail.value = 'proxy'; requestProxyTab('nginx'); return; }
    rail.value = 'explorer';
    if (tool) center.openTool(tool);
    return;
  }
  if (r === 'proxy') {
    rail.value = 'proxy';
    if (sub === 'nginx' || sub === 'static' || sub === 'llm') requestProxyTab(sub);
    return;
  }
  // 兼容旧协作深链：#contacts/group → #stat/group，#contacts/master → #stat/token
  if (r === 'contacts') {
    rail.value = 'stat';
    statTab.value = sub === 'master' ? 'token' : 'group';
    return;
  }
  if (!r || (!RAILS.includes(r) && !historyAlias)) return;
  rail.value = (historyAlias ? 'explorer' : r) as typeof rail.value;
  if ((r === 'explorer' || historyAlias) && isSideTab(sub)) historyTab.value = sub;
  // 代码统计内部子页（git/real/usage）统一落到顶层「代码统计」；群组/Token 是平级页签
  if (r === 'stat') statTab.value = sub === 'group' || sub === 'token' ? sub : 'code';
}
function currentHash() {
  if (rail.value === 'explorer') {
    const a = center.active.value;
    if (a?.kind === 'tool' && a.tool) return `#tools/${a.tool}`;
    return `#explorer/${historyTab.value}`;
  }
  if (rail.value === 'stat') return `#stat/${statTab.value}`;
  return `#${rail.value}`;
}
function syncHash() {
  const next = currentHash();
  if (window.location.hash !== next) {
    window.history.replaceState({}, '', window.location.pathname + window.location.search + next);
  }
}
watch([rail, historyTab, statTab, () => center.activeId.value], syncHash);
const msgHistory = useMessageHistory();

// —— 窗口状态：上次页签/激活页签/左侧栏位/消息筛选 ——
const msgFilter = ref(true);
const msgAllStyle = ref<AllStyle>('flat');   // 「全部会话」的展示样式：flat=平铺（默认），tree=会话树
const { map: sessionProjectMap, load: loadSessionProjects } = useSessionProjects();
const { sessions: ledgerSessions, load: loadLedgerSessions } = useLedgerSessions();
// 历史面板「全部会话」的会话来源：账本（含已关闭）∪ 运行中；历史消息里的会话由 sessionTree 合并
const sessionExtras = computed<SessionExtra[]>(() => {
  const byId = new Map<string, SessionExtra>();
  for (const s of ledgerSessions.value) byId.set(s.id, { id: s.id, name: s.name, updatedAt: s.updatedAt });
  for (const s of terminal.state.sessions) if (!byId.has(s.id)) byId.set(s.id, { id: s.id, name: s.name });
  return [...byId.values()];
});
// 会话自定义页签名（由 TerminalView 改名时写入）：覆盖「全部会话」树的节点标签
const sessionNames = computed(() => msgHistory.names.value);
let windowRestored = false;             // 闸门：恢复完成前不写盘（避免空状态覆盖存档）
let deepLinkOpened = false;             // ?open= 深链已打开文件：优先于存档的 activeTab
// —— 刷新后只恢复最近点击的 N 个页签（会话+文件合计，默认 5，可在设置面板改）——
// 同步读 localStorage，保证会话页签的可见集合在 TerminalView 首次收到 SESSION_LIST 前就定好。
let recentTabs = loadRecentTabs();
const bootAllowed = allowedRestoreIds(recentTabs, loadRestoreTabs());
const visibleSessionIds = bootAllowed
  ? [...bootAllowed].filter((id) => id.startsWith('s:')).map((id) => id.slice(2))
  : null;                                // null = 无历史，不限制（保持旧行为）
const liveProjectBySession = computed(() => {
  const out: Record<string, string | null> = {};
  for (const s of terminal.state.sessions) out[s.id] = s.projectId ?? null;
  return out;
});
const liveSessionIds = computed(() => terminal.state.sessions.filter((s) => s.state === 'running').map((s) => s.id));
// 左侧「全部会话」树只展示当前目录的会话（含已关闭的账本会话）
const scopedSessionExtras = computed(() => filterSessionsByProject(
  sessionExtras.value, currentProject.value, liveProjectBySession.value, sessionProjectMap.value,
));
async function openHistorySession(sid: string, name?: string): Promise<{ id: string } | null> {
  // 会话已作为中心页签打开：只选中该页签，不再向服务端 RESTORE（避免重复重建/回放终端）。
  if (center.hasSession(sid)) {
    center.activateSession(sid);
    terminal.switchTo(sid);   // 同步终端输出到该会话，否则只高亮页签、终端仍停在旧会话
    return { id: sid };
  }
  return openRestoredSession(sid, {
    restore: (id) => terminal.restoreSession(id, { name }),
    activate: (id) => center.activateSession(id),
    error: () => terminal.state.error,
    onFailed: (reason) => alert(t('hist.tree.restore_failed', { reason })),
    onFreshAgent: () => alert(t('hist.tree.fresh_agent')),
    onRecreated: () => alert(t('hist.tree.recreated')),
  });
}
// 左侧「全部会话」编辑：先恢复/打开该会话，成功后再复用 TerminalView 的页签改名弹框，
// 这样页签名与 Agent 内对话名能一起改（未打开的会话无法向 Agent 同步 /rename）。
async function editHistorySession(sid: string) {
  const opened = await openHistorySession(sid);
  if (!opened) return;                                  // 恢复失败已提示，不再打开编辑
  termViewRef.value?.editSession(opened.id);
}
// 定时任务「打开运行会话」：把运行中的 agent 会话作为主区内容打开
function openLiveSession(sid: string) {
  center.activateSession(sid);
  terminal.switchTo(sid);
}
// 会话集合变化（新建/退出/关闭）后刷新账本，保证「全部会话」能列出已关闭会话
watch(() => terminal.state.sessions.map((s) => s.id).join(','), () => { void loadLedgerSessions(true); });
const activeSessionTab = computed(() => sessionOfActiveTab(center.active.value));
const visibleMessages = computed(() => filterMessages({
  messages: msgHistory.messages.value,
  filterOn: msgFilter.value,
  sessionId: activeSessionTab.value?.sessionId ?? null,
  tabName: activeSessionTab.value?.tabName ?? null,
  projectId: currentProject.value,
  liveProjectBySession: liveProjectBySession.value,
  map: sessionProjectMap.value,
}));
function currentWindowState() {
  return {
    rail: rail.value === 'mobile' ? undefined : (rail.value as Rail),
    historyTab: historyTab.value as HistoryTab,
    msgFilter: msgFilter.value,
    msgAllStyle: msgAllStyle.value,
    tabs: toSavedTabs(center.tabs.value),
    activeTab: center.activeId.value,
  };
}
async function restoreWindowState(projectsReady: Promise<void>) {
  await projectsReady;
  const ws = await fetchWindowState();
  const plan = planRestore(ws, {
    projectIds: projects.value.map((p) => p.id),
    hashRail: hashRailOf(),
    hashHistoryTab: hashHistoryTabOf(),
    deepLinkOpened,
    newWindow: NEW_WINDOW,
  });
  if (plan.rail && RAILS.includes(plan.rail)) rail.value = plan.rail;
  if (plan.historyTab) historyTab.value = plan.historyTab;
  if (typeof plan.msgFilter === 'boolean') msgFilter.value = plan.msgFilter;
  if (plan.msgAllStyle) msgAllStyle.value = plan.msgAllStyle;
  const tabs = bootAllowed ? plan.tabs.filter((t) => bootAllowed.has(`f:${t.projectId}|${t.path}`)) : plan.tabs;
  const opened = tabs.map((t) => `f:${t.projectId}|${t.path}`);
  // 恢复出来的文件页签只挂到页签栏，不抢占激活（否则会把深链/用户已打开的文件顶掉）
  for (const t of tabs) center.openFile(t.projectId, t.path, t.label, false);
  if (center.activeId.value) {
    // 深链或用户在恢复期间已经打开了页面：保留当前激活项
  } else if (plan.activeFileTab && opened.includes(plan.activeFileTab)) {
    center.setActive(plan.activeFileTab);
  } else {
    // 没有更优先的激活项：回到当前会话页签；会话列表未到时置空，交给会话激活逻辑
    const sid = terminal.state.activeSessionId;
    const tab = sid
      ? center.tabs.value.find((t) => t.id === `s:${sid}`)
      : center.tabs.value.find((t) => t.kind === 'session');
    center.setActive(tab?.id ?? null);
  }
  windowRestored = true;
  // 深链 #tools/<id> 优先于存档的激活页签
  const tool = hashToolOf();
  if (tool === 'nginx') { rail.value = 'proxy'; requestProxyTab('nginx'); }
  else if (tool) { rail.value = 'explorer'; center.openTool(tool); }
}
watch(
  [() => center.tabs.value.map((t) => `${t.id}|${t.label}`).join(','), center.activeId, rail, historyTab, msgFilter, msgAllStyle],
  () => { if (windowRestored) saveWindowState(currentWindowState()); },
);
// 记录最近点击的页签顺序（会话+文件合并），刷新时据此只恢复最近 N 个
watch(center.activeId, (id) => {
  if (!windowRestored || !id) return;
  recentTabs = pushRecentTab(recentTabs, id);
  saveRecentTabs(recentTabs);
});
function persistWindowState() { if (windowRestored) void flushWindowState(currentWindowState()); }
// 当天输入超过 3 条消息时，主动展示一次历史消息；当天已展示过则不再主动，仅用户点击才展示
const AUTO_SHOWN_KEY = 'devflow-history-auto-shown';
const SETTINGS_AUTO_KEY = 'devflow-settings-autoshown';   // 首启设置框只自动弹一次
function ymd(ts: number) {
  const d = new Date(ts); const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const todayMsgCount = computed(() => {
  const k = ymd(Date.now());
  return msgHistory.messages.value.filter((m) => m.ts && ymd(m.ts) === k).length;
});
watch(todayMsgCount, (n) => {
  try {
    const k = ymd(Date.now());
    if (localStorage.getItem(AUTO_SHOWN_KEY) === k) return;
    if (n > 3) {
      localStorage.setItem(AUTO_SHOWN_KEY, k);
      rail.value = 'explorer';
      historyTab.value = 'messages';
    }
  } catch { /* ignore */ }
});
function onOpenHistory(e: Event) {
  const d = (e as CustomEvent).detail || {};
  rail.value = 'explorer';
  historyTab.value = d.tab === 'messages' ? 'messages' : 'files';
}
function onOpenMessage(text: string) {
  rail.value = 'explorer';
  window.dispatchEvent(new CustomEvent('df-fill-composer', { detail: { text } }));
}
const detailToken = ref(0);
const detailPath = ref('');
function onDetailFile(projectId: string, path: string) {
  const q = path.replace(/\\/g, '/');
  const i = q.lastIndexOf('/');
  const name = i >= 0 ? q.slice(i + 1) : q;
  pushFileHistory(projectId, q);
  center.openFile(projectId, path, name);
  detailPath.value = q;
  detailToken.value++;
}
const locateToken = ref(0);
const locatePath = ref('');
const locateLine = ref(0);
const locateQuery = ref('');
const locateCaseSensitive = ref(false);
function onOpenFileAt(projectId: string, path: string, _name: string, line?: number, query?: string, caseSensitive?: boolean) {
  openFile(projectId, path);
  locatePath.value = path.replace(/\\/g, '/');
  locateLine.value = line || 0;
  locateQuery.value = query || '';
  locateCaseSensitive.value = !!caseSensitive;
  locateToken.value++;
}

// —— 打开文件历史（按节点公钥指纹隔离存储，同机多实例不串）——
interface FileRec { projectId: string; path: string; ts: number; }
function loadHistoryArr(raw: string | null): FileRec[] {
  try {
    const a = JSON.parse(raw || '[]');
    return Array.isArray(a) ? a.filter((x) => x && typeof x.projectId === 'string' && typeof x.path === 'string' && typeof x.ts === 'number') : [];
  } catch { return []; }
}
let fileHistKey = 'devflow-file-history';
const fileHistory = ref<FileRec[]>([]);
let fhTimer: ReturnType<typeof setTimeout> | null = null;
function persistFileHistory() {
  if (fhTimer) { clearTimeout(fhTimer); fhTimer = null; }
  try { localStorage.setItem(fileHistKey, JSON.stringify(fileHistory.value.slice(0, 200))); } catch { /* ignore */ }
}
// 内存优先：改动先落内存，随后防抖写盘（新增/删除/清空都走这里）
function schedulePersistFileHistory() {
  if (fhTimer) clearTimeout(fhTimer);
  fhTimer = setTimeout(() => { fhTimer = null; persistFileHistory(); }, 800);
}
async function initFileHistory() {
  try {
    const snap = await fetch('/api/collab/snapshot').then((r) => r.json()).catch(() => null);
    const pem: string = snap?.identity?.publicKey || '';
    let fp = 'none';
    if (pem) {
      try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pem));
        fp = Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
      } catch { fp = 'none'; }
    }
    fileHistKey = `devflow-file-history-${fp}`;
    fileHistory.value = loadHistoryArr(localStorage.getItem(fileHistKey));
  } catch { /* keep empty */ }
}
function pushFileHistory(projectId: string, path: string) {
  const q = path.replace(/\\/g, '/');
  const arr = fileHistory.value.filter((r) => !(r.projectId === projectId && r.path === q));
  arr.unshift({ projectId, path: q, ts: Date.now() });
  fileHistory.value = arr.slice(0, 200);
  schedulePersistFileHistory();
}
function removeFileHistory(projectId: string, path: string) {
  fileHistory.value = fileHistory.value.filter((r) => !(r.projectId === projectId && r.path === path));
  schedulePersistFileHistory();
}
function clearFileHistory() { fileHistory.value = []; schedulePersistFileHistory(); }
const historyItems = computed(() => fileHistory.value.map((r) => {
  const i = r.path.lastIndexOf('/');
  const name = i >= 0 ? r.path.slice(i + 1) : r.path;
  const projName = projects.value.find((p) => p.id === r.projectId)?.name || r.projectId;
  return { ...r, name, projName };
}));
function openFromHistory(it: FileRec & { name: string; projName: string }) {
  if (it.projectId) { currentProject.value = it.projectId; touchRecent(it.projectId); }
  pushFileHistory(it.projectId, it.path);
  center.openFile(it.projectId, it.path, it.name);
}

const currentProjectInfo = computed(() => projects.value.find((p) => p.id === currentProject.value) || null);
// 把当前选中项目根通知服务端：用量 stats 采集从该目录向上找 .git 执行，找不到回退用户主目录
watch(currentProjectInfo, (info) => {
  const root = info?.root || '';
  currentDirColorId.value = root ? assignDirColor(root) : '';
  try { void fetch('/api/usage/cwd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root }) }); } catch { /* ignore */ }
}, { immediate: true });
// 顶栏展示：优先「选中文件的绝对路径」，无选中文件则显示项目根绝对路径
const displayPath = computed(() => {
  const root = currentProjectInfo.value?.root || '';
  if (!root) return '';
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const af = center.active.value && center.active.value.kind === 'file' ? center.active.value.path : null;
  if (!af) return base;
  return base + '/' + af.replace(/\\/g, '/').replace(/^\/+/, '');
});
// 双击顶栏路径：在系统文件管理器打开对应目录（文件则定位到其所在目录）
async function revealDisplayPath() {
  const pid = currentProject.value;
  if (!pid) return;
  const a = center.active.value;
  const rel = a && a.kind === 'file' && a.projectId === pid ? (a.path || '') : '';
  try { await projectsApi.reveal(pid, rel); } catch { /* ignore */ }
}
// 发送按钮等强调色跟随当前目录颜色（无颜色时回退到主题主色）
watch(currentDirColor, (v) => {
  try {
    if (v) document.documentElement.style.setProperty('--window-ac', v);
    else document.documentElement.style.removeProperty('--window-ac');
  } catch { /* ignore */ }
}, { immediate: true });

const RECENT_KEY = 'devflow-recent-projects';
const RECENT_MAX = 100;
interface RecentRec { id: string; ts: number; }
function loadRecents(): RecentRec[] {
  try {
    const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(a) ? a.filter((x) => x && typeof x.id === 'string' && typeof x.ts === 'number') : [];
  } catch { return []; }
}
function saveRecents(a: RecentRec[]) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(a.slice(0, RECENT_MAX))); } catch { /* ignore */ } }
const recents = ref<RecentRec[]>(loadRecents());
function touchRecent(id: string) {
  const a = recents.value.filter((x) => x.id !== id);
  a.unshift({ id, ts: Date.now() });
  recents.value = a.slice(0, RECENT_MAX);
  saveRecents(a);
}
function fmtRecent(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.toDateString() === now.toDateString();
  const thisYear = d.getFullYear() === now.getFullYear();
  if (sameDay) return t('time.today', { hm });
  if (thisYear) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
interface OrderedItem { project: ProjectInfo; ts: number | null; }
const orderedProjects = computed<OrderedItem[]>(() => {
  const byId = new Map(projects.value.map((p) => [p.id, p]));
  const recent = recents.value
    .filter((r) => byId.has(r.id))
    .sort((a, b) => b.ts - a.ts)
    .map((r): OrderedItem => ({ project: byId.get(r.id)!, ts: r.ts }));
  const rest = projects.value.filter((p) => !recents.value.some((r) => r.id === p.id)).map((p): OrderedItem => ({ project: p, ts: null }));
  return recent.concat(rest).slice(0, RECENT_MAX);
});
const activeFilePath = computed(() => {
  const a = center.active.value;
  return a && a.kind === 'file' && a.projectId === currentProject.value ? (a.path ?? null) : null;
});

const SIDE_KEY = 'devflow-side-width';
function initialSideW(): number {
  try { const v = Number(localStorage.getItem(SIDE_KEY)); if (v >= 140 && v <= 700) return v; } catch { /* ignore */ }
  return 240;
}
const sideW = ref<number>(initialSideW());
const dragging = ref(false);
let dragStartX = 0;
let dragStartW = 0;
function onDividerDown(e: MouseEvent) {
  dragStartX = e.clientX;
  dragStartW = sideW.value;
  dragging.value = true;
  document.body.classList.add('dragging-side');
  document.addEventListener('mousemove', onDividerMove);
  document.addEventListener('mouseup', onDividerUp);
}
function onDividerMove(e: MouseEvent) {
  const w = clamp(dragStartW + (e.clientX - dragStartX), 140, 700);
  sideW.value = Math.round(w);
}
function onDividerUp() {
  dragging.value = false;
  document.body.classList.remove('dragging-side');
  document.removeEventListener('mousemove', onDividerMove);
  document.removeEventListener('mouseup', onDividerUp);
  try { localStorage.setItem(SIDE_KEY, String(sideW.value)); } catch { /* ignore */ }
}
function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }

async function loadProjects() {
  try { projects.value = await projectsApi.list(); } catch { projects.value = []; }
  if (!currentProject.value && projects.value.length) {
    const byId = new Set(projects.value.map((p) => p.id));
    const recent = recents.value.slice().sort((a, b) => b.ts - a.ts).find((r) => byId.has(r.id));
    currentProject.value = recent ? recent.id : projects.value[0].id;
    touchRecent(currentProject.value);
  } else if (!projects.value.length && !noProjectPrompted.value && !pendingAgentChoice.value) {
    noProjectPrompted.value = true;
    openAddFolder();
  }
}
function selectProject(id: string) {
  currentProject.value = id;
  if (id) touchRecent(id);
}
const addOpen = ref(false);
const addPath = ref('');
const noProjectPrompted = ref(false);
const pendingAgentChoice = ref(false);
async function checkFirstRunAgentChoice() {
  try {
    const r = await fetch('/api/agents').then((x) => x.json());
    const list = Array.isArray(r?.agents) ? r.agents : [];
    if (!r?.chosen && list.length >= 2) pendingAgentChoice.value = true;
  } catch { /* 引导失败不阻塞 */ }
}
const pendingFileAssoc = ref(false);
async function checkFirstRunFileAssoc() {
  try {
    const r = await fetch('/api/file-assoc').then((x) => x.json());
    if (r?.available && !r?.prompted) pendingFileAssoc.value = true;
  } catch { /* 探测失败不阻塞 */ }
}
function onSettingsClosed() {
  if (pendingAgentChoice.value && !projects.value.length && !noProjectPrompted.value) {
    noProjectPrompted.value = true;
    openAddFolder();
  }
}
function openAddFolder() { addPath.value = ''; addOpen.value = true; }
async function chooseFolder() {
  try {
    const r = await projectsApi.pickFolder();
    if (r.error) { alert(r.error === 'unsupported' ? t('top.pick_unsupported') : t('top.add_failed', { msg: r.message || r.error })); return; }
    if (r.path) addPath.value = r.path;
  } catch (e) { alert(t('top.add_failed', { msg: (e as Error).message || String(e) })); }
}
async function confirmAddFolder() {
  const p = addPath.value.trim();
  if (!p) return;
  const wasFirst = projects.value.length === 0;   // 添加前是否无项目：仅首次添加目录触发引导
  try {
    const proj = await projectsApi.add(p);
    await loadProjects();
    if (proj?.id) selectProject(proj.id);
    addOpen.value = false;
    if (wasFirst && proj?.id) {
      historyTab.value = 'tree';                  // 左侧切到「目录」页签（FileTree）
      await nextTick();                           // 等 currentProject 传导到 TerminalView 的 projectId
      window.dispatchEvent(new CustomEvent('df-refresh-tree'));   // 首次添加目录后左侧目录树自动刷新
    }
  } catch (e) { alert(t('top.add_failed', { msg: (e as Error).message || String(e) })); }
}
function openFile(projectId: string, path: string) {
  const q = path.replace(/\\/g, '/');
  const i = q.lastIndexOf('/');
  const name = i >= 0 ? q.slice(i + 1) : q;   // 文件名一律由 path 推导，避免上游传错标签
  void openFileAsync(projectId, path, q, name);
}
async function openFileAsync(projectId: string, path: string, q: string, name: string) {
  try {
    const meta = await projectsApi.fileMeta(projectId, path);
    if (meta && !meta.isDir && meta.abs && shouldOpenInNavicat(name, meta.sqlite === true)) {
      await useNavicatWorkbench().openSqliteFile(meta.abs, name);
      rail.value = 'explorer';
      center.openTool('navicat');
      return;
    }
  } catch { /* 探测失败：按普通文件打开 */ }
  pushFileHistory(projectId, q);
  center.openFile(projectId, path, name);
}
async function processOpenParam() {
  const p = parseOpenParam(window.location.search);
  if (!p) return;
  try {
    const r = await projectsApi.openPath(p);
    await loadProjects();
    if (r.project?.id) selectProject(r.project.id);
    deepLinkOpened = true;
    openFile(r.project.id, r.rel);
    const u = new URL(window.location.href);
    u.searchParams.delete('open');
    window.history.replaceState({}, '', u.pathname + u.search + u.hash);
  } catch (e) {
    alert(t('open.failed', { msg: (e as Error)?.message || String(e) }));
  }
}
async function processVoidProject() {
  const id = parseVoidProject(window.location.search);
  if (!id) return;
  const u = new URL(window.location.href);
  u.searchParams.delete('voidProject');
  window.history.replaceState({}, '', u.pathname + u.search + u.hash);
  if (!projects.value.some((p) => p.id === id)) await loadProjects();
  if (!projects.value.some((p) => p.id === id)) return;
  selectProject(id);
  rail.value = 'explorer';
  window.location.hash = '#explorer/tree';
  await nextTick();
  requestStartAgent();
}
function openAgentSettings(firstRun = false) {
  // 设置弹窗在 TerminalView 内，仅在「目录/历史」视图挂载；其他页（通讯录/统计/定时任务）需先切回目录
  if (rail.value !== 'explorer') { rail.value = 'explorer'; }
  setTimeout(() => window.dispatchEvent(new CustomEvent('df-open-agent-settings', { detail: { firstRun } })), 120);
}
onMounted(async () => {
  loadVersion();
  void loadUpgrade().finally(maybeUpgradePopup);
  void maybeSkillsPopup();
  try {
    const landing = readMobileLanding(window.localStorage, Date.now());
    writeMobileLanding(window.localStorage, landing);
    if (landing.openMobile) rail.value = 'mobile';
  } catch { /* ignore */ }
  applyHash();
  const editIntent = parseSchedulerEditFromSearch(window.location.search);
  const promptIntent = editIntent ? null : parseSchedulerPromptFromSearch(window.location.search);
  if (editIntent || promptIntent) {
    rail.value = 'scheduler';
    if (editIntent) requestSchedulerEdit(editIntent);
    else if (promptIntent) requestSchedulerPrompt(promptIntent.prompt, promptIntent.run, promptIntent.hideInput);
    syncHash();
    const u = new URL(window.location.href);
    for (const k of SCHEDULER_EDIT_PARAMS) u.searchParams.delete(k);
    for (const k of SCHEDULER_PROMPT_PARAMS) u.searchParams.delete(k);
    window.history.replaceState({}, '', u.pathname + u.search + u.hash);
  }
  initFileHistory();
  const projectsReady = (async () => { await checkFirstRunAgentChoice(); await checkFirstRunFileAssoc(); await loadProjects(); })();
  // 首启设置框只自动弹一次（本地记住），之后不再自动弹；用户仍可点 ⚙ 手动打开
  void restoreWindowState(projectsReady).finally(() => {
    void processVoidProject();
    let shown = false;
    try { shown = localStorage.getItem(SETTINGS_AUTO_KEY) === '1'; } catch { /* ignore */ }
    if (!shown && (pendingAgentChoice.value || pendingFileAssoc.value)) {
      try { localStorage.setItem(SETTINGS_AUTO_KEY, '1'); } catch { /* ignore */ }
      openAgentSettings(true);
    }
  });
  void loadSessionProjects();
  void loadLedgerSessions();
  processOpenParam();
  msgHistory.load();
  syncHash();
  window.addEventListener('hashchange', applyHash);
  window.addEventListener('df-open-history', onOpenHistory);
  window.addEventListener('df-settings-closed', onSettingsClosed);
  window.addEventListener('df-add-folder', openAddFolder);
  window.addEventListener('beforeunload', persistFileHistory);
  window.addEventListener('beforeunload', persistWindowState);
  terminal.connect();
  stopRemoteCoder = startDesktopRemoteCoder();
});
onBeforeUnmount(() => {
  stopRemoteCoder?.();
  stopRemoteCoder = null;
  window.removeEventListener('hashchange', applyHash);
  window.removeEventListener('df-open-history', onOpenHistory);
  window.removeEventListener('df-settings-closed', onSettingsClosed);
  window.removeEventListener('df-add-folder', openAddFolder);
  window.removeEventListener('beforeunload', persistFileHistory);
  window.removeEventListener('beforeunload', persistWindowState);
});
</script>

<template>
  <ElConfigProvider :locale="elementLocale">
  <div class="app" ref="appRef">
    <header class="top" :class="{ colored: !!currentDirColor }" :style="currentDirColor ? { background: currentDirColor } : undefined">
      <span class="logo">◈ {{ $t('brand.title') }}</span>
      <span v-if="appVersion" class="app-ver">{{ appVersion }}</span>
      <button v-if="upgradeInfo?.hasUpdate" class="upg-badge" :title="$t('upgrade.new')" @click="openUpgrade">↑ {{ $t('upgrade.new') }}</button>
      <button class="addproj" :title="$t('top.add_folder')" @click="openAddFolder">＋</button>
      <select v-if="orderedProjects.length" :value="currentProject || ''" class="proj-sel" :title="currentProjectInfo?.root || ''" @change="(e: any) => selectProject(e.target.value)">
        <option v-for="it in orderedProjects" :key="it.project.id" :value="it.project.id" :title="it.project.root">
          {{ it.project.name }}{{ it.ts ? ' · ' + fmtRecent(it.ts) : '' }}
        </option>
      </select>
      <span v-if="displayPath" class="projpath" :title="displayPath + '\n' + $t('top.path_open_dir')" @dblclick="revealDisplayPath">{{ displayPath }}</span>
      <div class="spacer" />
      <span v-if="terminal.state.status === 'reconnecting'" class="net">{{ $t('app.reconnecting') }}</span>
      <select v-if="currentProjectInfo" :value="currentDirColorId" class="color-sel" :title="$t('top.color.title')" @change="onDirColorChange">
        <option v-for="c in colorOptions" :key="c.id" :value="c.id">{{ $t(c.key) }}</option>
      </select>
      <button class="lang-btn" :title="$t('lang.switch')" @click="toggleLang">{{ locale === 'en' ? $t('lang.zh_short') : $t('lang.en_short') }}</button>
      <button class="theme-btn" :title="theme === 'dark' ? $t('app.theme.to_light') : $t('app.theme.to_dark')" @click="toggle">{{ theme === 'dark' ? '☀' : '🌙' }}</button>
    </header>

    <div class="main">
      <aside class="activity">
        <button class="a-btn" :class="{ on: rail === 'explorer' }" :title="$t('nav.explorer')" @click="rail = 'explorer'">▤</button>
        <button class="a-btn" :class="{ on: rail === 'scheduler' }" :title="$t('nav.scheduler')" @click="rail = 'scheduler'">📅</button>
        <button class="a-btn" :class="{ on: rail === 'proxy' }" :title="$t('nav.proxy')" @click="rail = 'proxy'">🔀</button>
        <button class="a-btn" :class="{ on: rail === 'mobile' }" :title="$t('nav.mobile')" @click="rail = 'mobile'">🧰</button>
        <button class="a-btn" :class="{ on: rail === 'stat' }" :title="$t('nav.stat')" @click="rail = 'stat'">📊</button>
        <button class="a-btn gearbot" :title="$t('nav.settings')" @click="openAgentSettings()">⚙</button>
      </aside>
      <template v-if="rail === 'stat'">
        <section class="center">
          <CodeStats :project-root="currentProjectInfo?.root || ''" :terminal="terminal" v-model:tab="statTab" />
        </section>
      </template>
      <template v-else-if="rail === 'scheduler'">
        <section class="center">
          <SchedulerView :terminal="terminal" :project-root="currentProjectInfo?.root || ''" :project-id="currentProject" :on-open-session="openLiveSession" />
        </section>
      </template>
      <template v-else-if="rail === 'proxy'">
        <section class="center">
          <ProxyHubView />
        </section>
      </template>
      <template v-else-if="rail === 'mobile'">
        <section class="center">
          <AppMarketView />
        </section>
      </template>
      <template v-else>
        <aside class="side" :style="{ width: sideW + 'px' }">
          <ToolSidebar v-if="activeTool" :tool="activeTool" />
          <LocalSidebar v-else-if="activeLocalRoot" />
          <HistoryList v-else :items="historyItems" :tab="historyTab" :messages="visibleMessages" :filter="msgFilter" :all-style="msgAllStyle"
            :live-session-ids="liveSessionIds" :sessions="scopedSessionExtras" :session-names="sessionNames" :project-id="currentProject" :active-path="activeFilePath"
            @update:tab="historyTab = $event" @open="openFromHistory" @remove="(pid, p) => removeFileHistory(pid, p)"
            @clear="clearFileHistory" @open-message="onOpenMessage" @remove-message="(m) => msgHistory.remove(m)"
            @update:filter="msgFilter = $event" @update:all-style="msgAllStyle = $event" @open-session="openHistorySession" @edit-session="editHistorySession"
            @open-file="openFile" @detail-file="onDetailFile" @open-file-at="onOpenFileAt" />
        </aside>
        <div class="divider" :class="{ on: dragging }" @mousedown.prevent="onDividerDown" />
        <section class="center">
          <TerminalView ref="termViewRef" :terminal="terminal" :center="center" :project-id="currentProject" :detail-token="detailToken" :detail-path="detailPath" :visible-session-ids="visibleSessionIds" :locate-token="locateToken" :locate-path="locatePath" :locate-line="locateLine" :locate-query="locateQuery" :locate-case-sensitive="locateCaseSensitive" />
        </section>
      </template>
    </div>

    <div v-if="addOpen" class="joinmask" @click.self="addOpen = false">
      <div class="addcard">
        <div class="addtitle">{{ $t('top.add_folder') }}</div>
        <div v-if="!projects.length" class="addhint">{{ $t('top.first_project_hint') }}</div>
        <div class="addrow2">
          <input v-model="addPath" :placeholder="$t('top.folder_path')" @keyup.enter="confirmAddFolder" />
          <button class="addchoose" @click="chooseFolder">{{ $t('top.choose') }}</button>
        </div>
        <div class="addacts">
          <button class="ghost" @click="addOpen = false">{{ $t('common.cancel') }}</button>
          <button class="ok" @click="confirmAddFolder">{{ $t('common.ok') }}</button>
        </div>
      </div>
    </div>
    <LocalDropOverlay v-if="localDragging" />
    <UpgradeDialog :open="showUpgrade" :current="appVersion" :latest="upgradeInfo?.latest || ''" :download-url="upgradeInfo?.downloadUrl || ''" @go="upgradeGo" @close="upgradeClose" @skip="upgradeSkip" />
    <SkillsInstallDialog :open="showSkillsInstall" :targets="skillsDialogTargets" :installing="skillsInstalling" @install="installSkillsNow" @close="showSkillsInstall = false" />
  </div>
  </ElConfigProvider>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; position: relative; }
.upg-badge { background: var(--warn); color: #fff; border: none; border-radius: 8px; padding: 1px 8px; font-size: 11px; font-weight: 700; cursor: pointer; }
.upg-badge:hover { filter: brightness(1.08); }
.top { display: flex; align-items: center; gap: 12px; min-height: 42px; padding: 0 12px; background: var(--bg1); border-bottom: 1px solid var(--bd); flex: none; }
.logo { color: var(--ac3); font-weight: 700; white-space: nowrap; }
.app-ver { color: var(--tx3); font-size: 12px; font-family: ui-monospace, Consolas, monospace; white-space: nowrap; }
.addproj { background: var(--bg5); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 13px; line-height: 1.2; }
.addproj:hover { border-color: var(--ac2); color: var(--ac2); }
.projpath { color: var(--tx5); font-size: 11px; font-family: ui-monospace, Consolas, monospace; flex: 0 1 auto; min-width: 0; white-space: normal; word-break: break-all; line-height: 1.35; cursor: pointer; padding: 6px 0; }
.projpath:hover { color: var(--tx2); }
.proj-sel { background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 2px 6px; max-width: 320px; }
.spacer { flex: 1; }
.theme-btn { background: var(--bg5); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 9px; cursor: pointer; font-size: 14px; line-height: 1; }
.theme-btn:hover { border-color: var(--ac2); }
.lang-btn { background: var(--bg5); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 12px; line-height: 1; }
.lang-btn:hover { border-color: var(--ac2); }
.color-sel { background: var(--bg5); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 2px 6px; font-size: 12px; line-height: 1; }
.top.colored .logo, .top.colored .projpath, .top.colored .net, .top.colored .app-ver { color: #fff; }
.top.colored .lang-btn, .top.colored .theme-btn, .top.colored .addproj { background: rgba(255,255,255,.16); color: #fff; border-color: rgba(255,255,255,.45); }
.top.colored .color-sel, .top.colored .proj-sel { background: var(--bg1); color: var(--tx); border-color: rgba(255,255,255,.45); }
.top.colored .color-sel option, .top.colored .proj-sel option { color: #111; background: #fff; }
.net { color: var(--warn); font-size: 12px; }
.main { flex: 1; display: flex; min-height: 0; }
.activity { width: 40px; background: var(--bg6); border-right: 1px solid var(--bd); display: flex; flex-direction: column; align-items: center; padding-top: 6px; gap: 2px; flex: none; }
.a-btn { background: none; border: none; color: var(--tx6); font-size: 17px; width: 34px; height: 30px; cursor: pointer; border-left: 2px solid transparent; }
.a-btn.on { color: var(--tx1); border-left-color: var(--ac); }
.a-btn.gearbot { margin-top: auto; margin-bottom: 8px; }
.side { width: 240px; background: var(--bg1); border-right: 1px solid var(--bd); overflow: auto; flex: none; }
.divider { width: 5px; flex: none; cursor: col-resize; background: transparent; margin: 0 -2px; z-index: 5; }
.divider:hover, .divider.on { background: var(--ac); opacity: .55; }
.center { flex: 1; min-width: 0; }
body.dragging-side { cursor: col-resize; user-select: none; }
.joinmask { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
.addcard { width: 420px; max-width: 92vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; padding: 16px; box-shadow: 0 16px 48px rgba(0,0,0,.5); }
.addtitle { color: var(--tx1); font-weight: 700; margin-bottom: 10px; }
.addhint { color: var(--tx5); font-size: 12px; margin: -4px 0 10px; }
.addrow2 { display: flex; gap: 8px; }
.addrow2 input { flex: 1; min-width: 0; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 6px 8px; box-sizing: border-box; }
.addchoose { background: var(--bg5); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 12px; cursor: pointer; white-space: nowrap; }
.addchoose:hover { border-color: var(--ac2); }
.addacts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.addacts .ghost { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 4px 14px; cursor: pointer; }
.addacts .ok { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 4px 16px; cursor: pointer; }
</style>
