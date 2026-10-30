<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, computed, nextTick } from 'vue';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { C2S, S2C } from '@devflow/shared';
import { promptStepId } from '@devflow/shared/workflow-group';
import type { useTerminal, SessionSummary } from '../useTerminal';
import type { useCenter } from '../useCenter';
import FilePreview from './FilePreview.vue';
import DocViewer from './DocViewer.vue';
import { ElMessageBox } from 'element-plus';
import ToolDocPane from '../tools/doc/ToolDocPane.vue';
import PostmanTool from '../tools/postman/PostmanTool.vue';
import NavicatTool from '../tools/navicat/NavicatTool.vue';
import NginxTool from '../tools/nginx/NginxTool.vue';
import { useLocalSources } from '../local/useLocalSources';
import { localRootDocSource, localFileDocSource } from '../local/localDocSource';
import type { DocSource } from '../tools/doc/docSource';
import TextToolBody from '../tools/text/TextToolBody.vue';
import Base64Tool from '../tools/base64/Base64Tool.vue';
import { useTheme } from '../theme';
import { nodeFp } from '../nodeKey';
import { useMessageHistory } from '../useMessageHistory';
import { t } from '../i18n';
import { useVersion } from '../useVersion';
import { useUpgrade } from '../useUpgrade';
import { canRestart, restartHintKey, planConfirm, type PortRuntimeState } from './portRestart';
import { getFileAssoc, setFileAssoc } from '../fileAssoc';
import { buildChips, appendText, type Chip } from '../phaseChips';
import WorkflowEditor from './WorkflowEditor.vue';
import { usePromptCollect } from '../prompts/usePromptCollect';
import PromptCollectAddon from '../prompts/PromptCollectAddon.vue';
import { useEnglishComposer } from '../useEnglishComposer';
import { getComposerDraft, setComposerDraft } from '../composerDrafts';
import { captureToPngDataUrl } from '../snapshot';
import { pickRestoredAgent, restoredAgentIds } from '../sessionRestore';
import { copyText } from '../clipboard';
import { MAX_RESTORE_TABS, restoreTabs, setRestoreTabs } from '../restorePrefs';
import { isAgentSession, phoneHintKey } from '../remote-coder/phoneMode';
import { createReadyGate, paletteOffersRename, renameDialogOpen, waitForScreen } from './sessionNaming';
import TabRenameDialog from './TabRenameDialog.vue';
import { setTabDescription } from './tabDescriptions';
import WelcomeView from './WelcomeView.vue';
import { pendingStartAgent, clearPendingStartAgent, requestTool, requestToolTab, requestProxyTab } from '../uiIntents';
import type { ToolId } from '../tools/catalog';

const props = defineProps<{
  terminal: ReturnType<typeof useTerminal>;
  center: ReturnType<typeof useCenter>;
  projectId: string | null;
  detailToken?: number;
  detailPath?: string;
  locateToken?: number;
  locatePath?: string;
  locateLine?: number;
  locateQuery?: string;
  locateCaseSensitive?: boolean;
  visibleSessionIds?: string[] | null;   // 非 null 时只自动建这些会话的页签（刷新恢复最近 N 个）
  phone?: boolean;                       // 手机页（/?phone=1）：不自动建会话、无会话显示空态
}>();
const { theme, isDark } = useTheme();

const hostRef = ref<HTMLDivElement | null>(null);
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let resizeObserver: ResizeObserver | null = null;
let repaintTimer: ReturnType<typeof setTimeout> | null = null;
let dataSub: { dispose(): void } | null = null;
let selSub: { dispose(): void } | null = null;
let unsubList: (() => void) | null = null;
let unsubCfg: (() => void) | null = null;
let autoTried = false;
const hasSelection = ref(false);
const copiedSel = ref(false);
let copySelTimer: ReturnType<typeof setTimeout> | null = null;

const activeFile = computed(() => (props.center.active.value?.kind === 'file' ? props.center.active.value : null));
const activeTool = computed(() => (props.center.active.value?.kind === 'tool' ? props.center.active.value : null));
// 本地来源页签（拖入文件/文件夹）
const local = useLocalSources();
const activeLocal = computed(() => (props.center.active.value?.kind === 'local' ? props.center.active.value : null));
const localIsRoot = computed(() => activeLocal.value?.id === 'l:root');
const localRootSource = localRootDocSource();
const localLeafName = computed(() => {
  const p = local.activePath.value;
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
});
const localFileEntry = computed(() => {
  const id = activeLocal.value?.id || '';
  if (!id.startsWith('l:f:')) return null;
  return local.files.value.get(id.slice(4)) || null;
});
const localFileSource = computed<DocSource | null>(() => {
  const e = localFileEntry.value;
  return e ? localFileDocSource(e.key) : null;
});

// Markdown 相对链接：项目文件开新页签；本地根目录切当前文件；单文件需先选所在文件夹
function onProjectLink(rel: string) {
  const f = activeFile.value;
  if (!f?.projectId) return;
  props.center.openFile(f.projectId, rel, rel.split('/').pop() || rel);
}
async function onLocalLink(rel: string) {
  if (!activeLocal.value) return;
  if (localIsRoot.value) { local.activePath.value = rel; return; }
  const pick = (window as unknown as { showDirectoryPicker?: (o?: { mode?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (typeof pick !== 'function') { alert(t('local.drag_folder_for_links')); return; }
  try {
    await ElMessageBox.confirm(t('local.link_folder_reason'), t('local.link_folder_title'), {
      type: 'info',
      confirmButtonText: t('local.pick_folder'),
      cancelButtonText: t('common.cancel'),
    });
  } catch { return; }
  try {
    const handle = await pick.call(window, { mode: 'read' });
    local.mountFolder(handle);
    props.center.openLocalRoot(handle.name);
    local.activePath.value = rel;
  } catch (e: any) {
    if (e?.name === 'AbortError') return; // 用户取消
    alert(t('local.pick_folder_failed', { msg: e?.message || e }));
  }
}
// 文档型工具（notepad/yaml/markdown）在主区用 DocViewer 展示
const activeDocTool = computed(() => {
  const x = activeTool.value?.tool;
  return x === 'notepad' || x === 'yaml' || x === 'markdown' || x === 'js' ? x : null;
});
const activeToolName = computed(() => activeTool.value?.tool ?? '');
const isSessionView = computed(() => props.center.activeKind.value === 'session');
// 页签标签：工具页签按当前语言显示
function tabDisplayLabel(tab: { kind: string; tool?: string; label: string }) {
  return tab.kind === 'tool' && tab.tool ? t(`tools.${tab.tool}`) : tab.label;
}
// 仅 Agent 会话显示工作流相关板块（终端 cmd/shell 等不显示）
const agentSids = ref<Set<string>>(new Set());
let agentSidsKey = 'devflow-agent-sids-none';
function persistAgentSids() { try { localStorage.setItem(agentSidsKey, JSON.stringify([...agentSids.value])); } catch { /* ignore */ } }
function markAgent(sid: string) { const s = new Set(agentSids.value); s.add(sid); agentSids.value = s; persistAgentSids(); }
function loadAgentSids() {
  try {
    const a = JSON.parse(localStorage.getItem(agentSidsKey) || '[]');
    agentSids.value = new Set(Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
  } catch { /* ignore */ }
}
const activeIsAgent = computed(() => {
  const sid = props.terminal.state.activeSessionId;
  if (!sid) return false;
  const session = props.terminal.state.sessions.find((s) => s.id === sid) || null;
  // 手机端 localStorage 没有 agentSids：按会话自身 kind/agentId 判定，保证工作流面板能显示
  if (props.phone) return isAgentSession(session);
  // 桌面端优先看本地标记；未标记的（从历史面板打开、刷新后漏标记等）按会话自身 kind/agentId 兜底
  return agentSids.value.has(sid) || isAgentSession(session);
});
// 手机模式：未选会话时的空态提示词条（桌面模式恒为 null）
const phoneHint = computed(() => (props.phone
  ? phoneHintKey({ sessions: props.terminal.state.sessions, activeSessionId: props.terminal.state.activeSessionId })
  : null));
const composerCollapsed = computed(() => composerMin.value);

function sessionState(id: string) {
  return props.terminal.state.sessions.find((s) => s.id === id)?.state || 'running';
}
function sessionLabel(id: string) {
  return props.terminal.state.sessions.find((s) => s.id === id)?.name || id;
}
function sessionProjectId(id: string): string | null {
  return props.terminal.state.sessions.find((s) => s.id === id)?.projectId ?? null;
}

// —— 页签重命名（双击会话页签改名；按节点公钥指纹隔离持久化）——
const tabNames = ref<Record<string, string>>({});
let tabNamesKey = 'devflow-tab-names-none';
function loadTabNames() {
  try {
    const a = JSON.parse(localStorage.getItem(tabNamesKey) || '{}');
    tabNames.value = (a && typeof a === 'object' && !Array.isArray(a)) ? a : {};
  } catch { tabNames.value = {}; }
}
function persistTabNames() { try { localStorage.setItem(tabNamesKey, JSON.stringify(tabNames.value)); } catch { /* ignore */ } }
// 页签显示名：自定义名优先，否则回退到默认（Agent 会话 / 服务端会话名）
function tabLabel(id: string) {
  const custom = (tabNames.value[id] || '').trim();
  if (custom) return custom;
  return id === agentSid.value ? `◈ ${currentAgent.value.name}` : sessionLabel(id);
}
// —— 页签双击弹框：页签名 + 详细描述（描述仅提示展示，随会话持久化）——
// 页签改名同步 Agent 期间：置 true 打开全屏蒙层并掐断终端输入，避免用户操作干扰脚本化 /rename 时序
const syncingRename = ref(false);
let renameMaskEl: HTMLDivElement | null = null;
function setRenameMask(el: unknown) { renameMaskEl = (el as HTMLDivElement | null) || null; }

const tabDescs = ref<Record<string, string>>({});
let tabDescsKey = 'devflow-tab-descs-none';
function loadTabDescs() {
  try {
    const a = JSON.parse(localStorage.getItem(tabDescsKey) || '{}');
    tabDescs.value = (a && typeof a === 'object' && !Array.isArray(a)) ? a : {};
  } catch { tabDescs.value = {}; }
}
function persistTabDescs() { try { localStorage.setItem(tabDescsKey, JSON.stringify(tabDescs.value)); } catch { /* ignore */ } }

const dialogSid = ref<string | null>(null);
const dialogName = ref('');
const dialogDesc = ref('');
const dialogPlaceholder = ref('');
function openDialogForSid(sid: string) {
  dialogSid.value = sid;
  dialogName.value = (tabNames.value[sid] || '').trim();
  dialogDesc.value = tabDescs.value[sid] || '';
  dialogPlaceholder.value = tabLabel(sid);   // 无自定义名时即默认显示名
}
function openTabDialog(tabId: string) {
  if (!tabId.startsWith('s:')) return;   // 仅会话页签
  openDialogForSid(tabId.slice(2));
}
// 左侧「全部会话」的编辑按钮：对已关闭的会话也允许打开同一个改名弹框
function editSession(sid: string) {
  if (!sid) return;
  openDialogForSid(sid);
}
defineExpose({ editSession });
function onTabDialogCancel() { dialogSid.value = null; }
function onTabDialogConfirm(payload: { name: string; description: string }) {
  const sid = dialogSid.value;
  if (!sid) return;
  dialogSid.value = null;
  const name = payload.name.trim();
  const next = { ...tabNames.value };
  if (name) next[sid] = name; else delete next[sid];
  tabNames.value = next;
  persistTabNames();
  // 页签改名：仅当该会话已打开页签时更新，避免给已关闭会话凭空建页签
  if (props.center.tabs.value.some((t) => t.id === `s:${sid}`)) {
    props.center.ensureSession(sid, tabLabel(sid), sessionState(sid), sessionProjectId(sid));
  }
  msgHistory.renameTab(sid, tabLabel(sid));   // 同步更新历史消息里记录的页签名
  if (name) syncAgentRename(sid, name);       // 同步改 Agent 内的对话名
  tabDescs.value = setTabDescription(tabDescs.value, sid, payload.description);
  persistTabDescs();
}

// composer 上当前会话的详细描述（双击可就地编辑，保存后随会话持久化）
const activeTabDesc = computed(() => {
  const sid = props.terminal.state.activeSessionId;
  return sid ? (tabDescs.value[sid] || '') : '';
});

const editingDesc = ref(false);
const descDraft = ref('');
const descInputEl = ref<HTMLInputElement | null>(null);
let descEditSid: string | null = null;   // 编辑期间锁定会话，避免切换会话后写错对象
function startEditDesc() {
  const sid = props.terminal.state.activeSessionId;
  if (!sid) return;
  descEditSid = sid;
  descDraft.value = tabDescs.value[sid] || '';
  editingDesc.value = true;
  void nextTick(() => { descInputEl.value?.focus(); descInputEl.value?.select(); });
}
function commitDesc() {
  if (!editingDesc.value) return;
  const sid = descEditSid;
  editingDesc.value = false;
  descEditSid = null;
  if (!sid) return;
  tabDescs.value = setTabDescription(tabDescs.value, sid, descDraft.value);
  persistTabDescs();
}
function cancelDesc() {
  editingDesc.value = false;
  descEditSid = null;
}

// 读当前活动会话 xterm 的可见屏（含滚动解析后的纯文本），用于判断 Agent TUI 现在处于什么状态。
function viewportLines(): string[] {
  const b = term?.buffer.active;
  const rows = term?.rows || 0;
  if (!b || !rows) return [];
  const out: string[] = [];
  for (let i = 0; i < rows; i += 1) {
    const line = b.getLine(b.viewportY + i);
    out.push(line ? line.translateToString(true) : '');
  }
  return out;
}
// 页签改名后让 Agent 内的对话名跟着改：向 Agent 发 `/rename` → 回车 → 清掉预填的旧标题 → 输入新名 → 回车。
// 关键：`/rename` 只有「已开始对话」的会话才有，且回车会选中面板高亮项——盲发会跑错命令，盲输的名字会被当消息发给模型。
// 所以每步都先断言屏幕：面板出现 /rename 才回车；改名框真弹出才输入；断言失败就删掉残留输入并收手（不清屏、不发 Esc，
// 避免打断正在生成的会话），同时提示用户没同步上。整个流程由全屏蒙层 + 输入闸门屏蔽用户操作。
function syncAgentRename(sid: string, name: string) {
  if (syncingRename.value) return;                     // 已在同步中：忽略再次触发，避免时序互相打架
  if (!agentSids.value.has(sid)) return;               // 仅 Agent 会话
  if (!props.terminal.state.sessions.some((s) => s.id === sid)) return;   // 会话已关闭：无处发送命令
  if (sessionState(sid) !== 'running') return;
  const prev = props.terminal.state.activeSessionId;
  const needSwitch = prev !== sid;                     // input 只作用于活动会话：后台页签先切过去
  syncingRename.value = true;
  void nextTick(() => renameMaskEl?.focus());          // 蒙层抢焦点：否则键盘仍会漏进 xterm
  if (needSwitch) props.terminal.switchTo(sid);
  const at = () => props.terminal.state.activeSessionId === sid;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const waitScreen = (pred: (lines: string[]) => boolean, timeoutMs: number) =>
    waitForScreen(pred, { readScreen: viewportLines, isActive: at, timeoutMs });
  const finish = (synced: boolean) => {
    const done = () => {
      syncingRename.value = false;
      if (!synced) showRenameSyncHint();
      void nextTick(() => term?.focus());
    };
    if (needSwitch && prev) setTimeout(() => { props.terminal.switchTo(prev); done(); }, 600);
    else done();
  };
  // 断言失败：只删掉残留字符收手，绝不给 Agent 发回车/Esc（Esc 会打断正在生成的会话）
  const abort = () => { if (at()) props.terminal.input('\x7f'.repeat(24)); finish(false); };
  void (async () => {
    if (needSwitch) await sleep(400);
    if (!at()) return finish(false);
    props.terminal.input('/rename');                   // 输入斜杠命令
    if (!(await waitScreen(paletteOffersRename, 2500))) return abort();   // 面板没有 /rename（新会话还没对话）：收手
    if (!at()) return finish(false);
    props.terminal.input('\r');                        // 回车执行面板高亮的 /rename，打开改名输入框
    if (!(await waitScreen(renameDialogOpen, 8000))) return abort();      // 改名框没弹出：收手
    props.terminal.input('\x7f'.repeat(200));          // 清掉预填的旧标题
    await sleep(200);
    if (!at()) return finish(false);
    props.terminal.input(name);                        // 输入新名
    await sleep(350);
    if (!at()) return finish(false);
    props.terminal.input('\r');                        // 回车确认
    await sleep(200);
    if (await waitScreen((l) => !renameDialogOpen(l), 1500)) return finish(true);
    if (!at()) return finish(false);
    props.terminal.input('\r');                        // 回车没生效：补一次
    await sleep(300);
    finish(await waitScreen((l) => !renameDialogOpen(l), 1500));
  })();
}

// —— 固定 Agent 首标签：交互式 Agent（列表可配置）+ 工作流（跑 opencode 自定义命令）——
interface AgentDef { id: string; name: string; cmd: string; }
// 仅作接口不可达时的最小兜底；正式列表来自 config/devflow.xml（GET /api/agents）
const DEFAULT_AGENTS: AgentDef[] = [{ id: 'opencode', name: 'OpenCode', cmd: 'opencode' }];
const agentSid = ref<string | null>(null);
const agentProjectId = ref<string | null>(null);   // 固定 Agent 会话创建时所用的项目（用于切换项目后重建）
const defaultAgents = ref<AgentDef[]>(DEFAULT_AGENTS.map((a) => ({ ...a })));
const defaultAgentId = ref('opencode');
const agents = ref<AgentDef[]>(DEFAULT_AGENTS.map((a) => ({ ...a })));
const agentId = ref('opencode');
async function loadAgents() {
  try {
    const r = await fetch('/api/agents').then((x) => x.json());
    const list = Array.isArray(r?.agents)
      ? r.agents.filter((a: any) => a && typeof a.id === 'string' && typeof a.cmd === 'string')
      : [];
    if (!list.length) return;
    defaultAgents.value = list.map((a: any) => ({ id: a.id, name: a.name || a.id, cmd: a.cmd }));
    defaultAgentId.value = (typeof r.default === 'string' && defaultAgents.value.some((a) => a.id === r.default))
      ? r.default : defaultAgents.value[0].id;
    agents.value = defaultAgents.value.map((a) => ({ ...a }));
    agentId.value = defaultAgentId.value;
  } catch { /* 保留最小兜底 */ }
}
const currentAgent = computed(() => agents.value.find((a) => a.id === agentId.value) || agents.value[0] || { id: '', name: '-', cmd: 'opencode' });
const agentCmd = computed(() => currentAgent.value.cmd || 'opencode');
const wfKind = ref<string>('dev');
const promptCollect = usePromptCollect();
const agentStarted = ref(false);
const agentCliReady = ref(false);   // agent CLI 是否已在固定会话里启动
let agentLaunching = false;         // 启动命令注入中，避免重复注入
let agentGen = 0;                   // 启动代际：切换项目重建会话后，作废旧会话遗留的延时注入
const agentAtStart = ref('opencode');   // 启动固定会话时所用的 agent id
const settingsOpen = ref(false);
const editorOpen = ref(false);
const settingsTab = ref<'general' | 'about'>('general');
const firstRunHint = ref(false);
const agentSecRef = ref<HTMLElement | null>(null);
// 刷新后恢复的页签数（设置面板即时生效，存 localStorage）
const restoreTabsCount = ref(restoreTabs.value);
function saveRestoreTabsCount() { restoreTabsCount.value = setRestoreTabs(restoreTabsCount.value); }
const { version: appVersion } = useVersion();
const { upgrade: upgradeInfo, loading: upgradeLoading, checkNow } = useUpgrade();
const serverPort = ref<number | null>(null);
const loadedPort = ref<number | null>(null);
const portMsg = ref('');
const portState = ref<PortRuntimeState>({});
const restartMsg = ref('');
const restarting = ref(false);
const assocAvailable = ref(false);
const assocEnabled = ref(false);
const assocLoaded = ref(false);
const assocPrompted = ref(true);
const assocExts = ref<{ ext: string; isDefault: boolean; enabled: boolean }[]>([]);
const assocMsg = ref('');
const assocLoadedSel = ref('');   // 已保存的逐扩展勾选（用于判断脏值）
const voidBusy = ref(false);
const voidMsg = ref('');
async function registerVoid() {
  if (voidBusy.value) return;
  voidBusy.value = true;
  voidMsg.value = '';
  try {
    const res = await fetch('/api/void/install', { method: 'POST' });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.message || j.error || `HTTP ${res.status}`);
    voidMsg.value = j.unsupported
      ? t('term.void_unsupported')
      : t(j.added ? 'term.void_registered' : 'term.void_already', { path: j.binDir || '' });
  } catch (e: any) {
    voidMsg.value = t('term.void_failed', { msg: String(e?.message || e) });
  } finally {
    voidBusy.value = false;
  }
}
async function loadFileAssoc() {
  const r = await getFileAssoc();
  if (!r) { assocAvailable.value = false; return; }
  assocAvailable.value = r.available;
  assocPrompted.value = r.prompted;
  assocEnabled.value = r.prompted ? r.enabled : true;   // 首启（未提示过）默认勾选
  assocLoaded.value = r.enabled;
  assocExts.value = r.extensions || [];
  assocLoadedSel.value = assocExts.value.filter((x) => x.enabled).map((x) => x.ext).join(',');
}
async function loadSettings() {
  try {
    const r = await fetch('/api/settings').then((x) => x.json());
    serverPort.value = r?.settings?.port ?? r?.currentPort ?? null;
    loadedPort.value = serverPort.value;
    portState.value = { restartable: r?.restartable, portSource: r?.portSource };
  } catch { /* ignore */ }
}
function persistPort(p: number) {
  return fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port: p }) })
    .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); });
}
// 右下角「确定」：保存当前设置并立即生效（端口变了就重启后端并重载页面）
async function confirmSettings() {
  portMsg.value = '';
  assocMsg.value = '';
  const sel = assocExts.value.filter((x) => x.enabled).map((x) => x.ext);
  const assocDirty = assocEnabled.value !== assocLoaded.value || sel.join(',') !== assocLoadedSel.value;
  if (assocAvailable.value && (!assocPrompted.value || assocDirty)) {
    const r = await setFileAssoc(assocEnabled.value, sel);
    if (r) {
      assocEnabled.value = r.enabled;
      assocLoaded.value = r.enabled;
      assocPrompted.value = r.prompted;
      assocExts.value = r.extensions || [];
      assocLoadedSel.value = assocExts.value.filter((x) => x.enabled).map((x) => x.ext).join(',');
    } else {
      assocMsg.value = t('term.file_assoc_failed');
    }
  }
  const plan = planConfirm({ port: Number(serverPort.value), loadedPort: loadedPort.value, state: portState.value });
  if (plan.action === 'blocked') { portMsg.value = t(plan.hintKey); return; }
  if (plan.action === 'close') { settingsOpen.value = false; return; }
  try {
    await persistPort(plan.port);
  } catch (e: any) {
    portMsg.value = t('term.save_failed', { msg: e?.message || e });
    return;
  }
  settingsOpen.value = false;
  await restartBackend();
  if (restartMsg.value) { settingsOpen.value = true; portMsg.value = restartMsg.value; }
}
async function restartBackend() {
  restartMsg.value = '';
  restarting.value = true;
  try {
    const res = await fetch('/api/server/restart', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
    restartMsg.value = t('term.port_restarting');
    const deadline = Date.now() + 30000;
    for (;;) {
      if (Date.now() > deadline) throw new Error(t('term.port_restarting'));
      await new Promise((r) => setTimeout(r, 500));
      try {
        const v = await fetch('/api/version', { cache: 'no-store' });
        if (v.ok) { location.reload(); return; }
      } catch { /* 服务重启中，继续等 */ }
    }
  } catch (e: any) {
    restartMsg.value = t('term.port_restart_failed', { msg: e?.message || e });
  } finally { restarting.value = false; }
}
function onOpenSettings(e: Event) {
  const firstRun = !!(e as CustomEvent).detail?.firstRun;
  settingsOpen.value = true;
  loadSettings();
  loadFileAssoc();
  firstRunHint.value = firstRun;
  if (firstRun) nextTick(() => agentSecRef.value?.scrollIntoView({ block: 'start' }));
}

// 新建会话：先输入任务名（可选）再选择要执行的命令；不再倒计时自动创建
const newOpen = ref(false);
const newSelected = ref('cmd');
const newName = ref('');
const newChoices = computed(() => [
  { id: 'cmd', label: t('term.new_cmd'), cmd: '' },
  ...agents.value.map((a) => ({ id: a.id, label: a.name, cmd: a.cmd })),
]);
function openNew() {
  const ids = newChoices.value.map((c) => c.id);
  newSelected.value = ids.includes(agentId.value) ? agentId.value : (ids[0] || 'cmd');
  newName.value = '';
  newOpen.value = true;
}
function closeNew() { newOpen.value = false; }
// 名字留空时创建后的短暂提示
const renameHint = ref('');
let renameHintTimer: ReturnType<typeof setTimeout> | null = null;
function showRenameHint(msg: string) {
  renameHint.value = msg;
  if (renameHintTimer) clearTimeout(renameHintTimer);
  renameHintTimer = setTimeout(() => { renameHint.value = ''; renameHintTimer = null; }, 4000);
}
// Agent 侧改名没同步上（新会话还没对话、或会话正忙导致 /rename 打不开）：只提示，不误发消息
function showRenameSyncHint() { showRenameHint(t('term.rename_sync_skipped')); }
// 创建会话失败（服务端 reject）时的提示：项目目录不存在给专门文案，其余带原始错误
function createErrorText(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === 'cwd-missing') {
    const path = (err.message || '').replace(/^working directory does not exist:\s*/i, '') || (props.projectId || '');
    return t('term.create_cwd_missing', { path });
  }
  return t('term.create_failed', { msg: err?.message || String(e) });
}
async function createNew(id: string) {
  newOpen.value = false;
  const c = newChoices.value.find((x) => x.id === id) || newChoices.value[0];
  const name = newName.value.trim();
  newName.value = '';
  let s: SessionSummary;
  try {
    s = await props.terminal.createSession({
      projectId: props.projectId, cols: 80, rows: 24,
      kind: c.cmd ? 'agent' : 'shell', agentId: c.cmd ? c.id : null, agentCmd: c.cmd || null,
    });
  } catch (e) {
    alert(createErrorText(e));
    return;
  }
  if (c.cmd) markAgent(s.id);
  const label = c.cmd ? `◈ ${c.label}` : c.label;
  props.center.ensureSession(s.id, name || label, s.state || 'running', s.projectId ?? null);
  if (name) {
    const next = { ...tabNames.value };
    next[s.id] = name;
    tabNames.value = next;
    persistTabNames();
    msgHistory.renameTab(s.id, name);
  } else {
    showRenameHint(t('term.rename_hint'));
  }
  props.terminal.switchTo(s.id);
  if (c.cmd) setTimeout(() => {
    props.terminal.input(`${c.cmd}`);
    setTimeout(() => props.terminal.input('\r'), 200);
    if (name) void syncNewAgentName(s.id, name);
  }, 1200);
}
// 新 Agent 会话就绪后同步对话名：最短 3s + 输出静默 1.2s，超时 30s 放弃
async function syncNewAgentName(sid: string, name: string) {
  const gate = createReadyGate({ now: () => Date.now() });
  const unsub = props.terminal.on(S2C.OUTPUT, (msg: any) => { if (msg.sessionId === sid) gate.output(); });
  const ok = await new Promise<boolean>((resolve) => {
    const timer = setInterval(() => {
      if (props.terminal.state.activeSessionId !== sid) { clearInterval(timer); unsub(); resolve(false); return; }
      const st = gate.poll();
      if (st === 'waiting') return;
      clearInterval(timer);
      unsub();
      resolve(st === 'ready');
    }, 200);
  });
  if (ok) syncAgentRename(sid, name);
}
let cfgKey = 'devflow-agent-cfg-none';
let cfgLoaded = false;
function loadCfg() {
  try {
    const raw = localStorage.getItem(cfgKey);
    if (!raw) return;
    const c = JSON.parse(raw);
    if (Array.isArray(c.agents) && c.agents.length) {
      const ok = c.agents.filter((a: any) => a && typeof a.id === 'string' && typeof a.cmd === 'string');
      if (ok.length) {
        const merged: AgentDef[] = ok.map((a: any) => ({ id: a.id, name: a.name || a.id, cmd: a.cmd }));
        const ids = new Set(merged.map((a) => a.id));
        for (const d of defaultAgents.value) if (!ids.has(d.id)) merged.push({ ...d });   // 配置里新增的 Agent 始终保留
        agents.value = merged;
      }
    }
    if (typeof c.agentId === 'string' && agents.value.some((a) => a.id === c.agentId)) agentId.value = c.agentId;
    else if (c.engine === 'opencode' || c.engine === 'claudecode') agentId.value = c.engine;   // 兼容旧配置
    if (typeof c.wf === 'string') wfKind.value = c.wf;
  } catch { /* ignore */ }
}
function saveCfg() {
  if (!cfgLoaded) return;   // 避免加载前用默认值覆盖
  try { localStorage.setItem(cfgKey, JSON.stringify({ agentId: agentId.value, agents: agents.value, wf: wfKind.value })); } catch { /* ignore */ }
}
function resetCfg() {
  agents.value = defaultAgents.value.map((a) => ({ ...a }));
  agentId.value = defaultAgentId.value;
  wfKind.value = 'dev';
}
function addAgent() {
  agents.value.push({ id: `agent-${Date.now().toString(36)}`, name: t('term.new_agent_name'), cmd: '' });
}
function removeAgent(id: string) {
  if (agents.value.length <= 1) return;
  agents.value = agents.value.filter((a) => a.id !== id);
  if (agentId.value === id) agentId.value = agents.value[0].id;
}

function ensureAgentOrder() {
  if (!agentSid.value) return;
  const arr = props.center.tabs.value;
  const i = arr.findIndex((t) => t.id === `s:${agentSid.value}`);
  if (i <= 0) return;
  const [tab] = arr.splice(i, 1);
  arr.unshift(tab);
  props.center.tabs.value = [...arr];
}
function agentActive() {
  return !!agentSid.value && props.terminal.state.sessions.some((s) => s.id === agentSid.value);
}
async function startAgent() {
  if (agentSid.value && agentActive() && (agentProjectId.value ?? null) === (props.projectId ?? null)) {
    props.terminal.switchTo(agentSid.value);
    return;
  }
  const gen = ++agentGen;
  const pid = props.projectId;
  let s: SessionSummary;
  try {
    s = await props.terminal.createSession({
      projectId: pid, cols: 80, rows: 24,
      kind: 'agent', agentId: agentId.value, agentCmd: agentCmd.value,
    });
  } catch (e) {
    if (gen === agentGen) alert(createErrorText(e));   // 重建代际已过期则静默丢弃
    return;
  }
  if (gen !== agentGen) return;   // 期间已再次切换项目/重建：丢弃本次结果
  agentSid.value = s.id;
  agentProjectId.value = pid;
  markAgent(s.id);
  agentStarted.value = true;
  agentCliReady.value = false;
  agentLaunching = false;
  agentAtStart.value = agentId.value;
  props.center.ensureSession(s.id, `◈ ${currentAgent.value.name}`, s.state || 'running', s.projectId ?? null);
  ensureAgentOrder();
  props.terminal.switchTo(s.id);
  if (props.projectId !== pid) { void restartAgentForProject(); return; }   // 创建期间项目已切换：再来一次
  setTimeout(() => launchAgentCmd(gen), 1200);
}
function launchAgentCmd(gen = agentGen) {
  if (gen !== agentGen) return;
  if (!agentSid.value || !agentActive()) return;
  if (agentCliReady.value || agentLaunching) return;   // 已就绪/正在启动：绝不重复注入启动命令
  agentLaunching = true;
  props.terminal.switchTo(agentSid.value);
  const cmd = agentCmd.value;
  // 先输入命令，稍后单独发回车（避免部分环境下 \r 未触发提交）
  props.terminal.input(cmd);
  setTimeout(() => {
    agentLaunching = false;
    if (gen !== agentGen) return;
    if (!agentSid.value || !agentActive()) return;
    props.terminal.input('\r');
    agentCliReady.value = true;
  }, 200);
}
// 顶栏切换项目 → 固定 Agent 会话以新项目根为 cwd 重建（相当于“重新加载”）
async function restartAgentForProject() {
  const old = agentSid.value;
  if (!old || !agentActive()) return;
  props.terminal.killSession(old);
  if (agentSid.value === old) agentSid.value = null;
  agentCliReady.value = false;
  agentLaunching = false;
  agentStarted.value = false;
  await new Promise((r) => setTimeout(r, 400));
  await startAgent();
}
watch(() => props.projectId, (nid, oid) => {
  if (nid === oid) return;
  // 作用域切到新目录：隐藏异目录会话页签（进程保留），并纠正活动页签
  props.center.scopeProjectId.value = nid ?? null;
  const visible = props.center.visibleTabs.value;
  if (!visible.some((t) => t.id === props.center.activeId.value)) {
    const pref = visible.find((t) => t.kind === 'session' && t.id === `s:${agentSid.value}`) || visible[0] || null;
    if (pref) {
      props.center.setActive(pref.id);
      if (pref.kind === 'session') props.terminal.switchTo(pref.id.slice(2));
    } else {
      props.center.setActive(null);
      props.terminal.setOutput(null);
    }
  }
  // 切换项目目录：不自动重启/重建固定 Agent 会话（由用户手动开启）
});
// —— 空白首页：无页签时显示欢迎页（不再自动强开 Agent）——
const showWelcome = computed(() => !props.phone && props.center.visibleTabs.value.length === 0);
function onWelcomeNewAgent() {
  if (props.phone) return;
  if (!props.projectId) { window.dispatchEvent(new CustomEvent('df-add-folder')); return; }
  void startAgent();
}
function onWelcomeOpenTool(id: ToolId) {
  if (id === 'nginx') { requestProxyTab('nginx'); return; }
  if (id === 'notepad' || id === 'yaml' || id === 'translate' || id === 'markdown' || id === 'js' || id === 'base64') { requestToolTab(id); return; }
  requestTool(id);
  window.location.hash = '#mobile';
}
watch(pendingStartAgent, () => {
  if (!pendingStartAgent.value) return;
  clearPendingStartAgent();
  onWelcomeNewAgent();
}, { immediate: true });
function sendAgentText(text: string) {
  if (!agentSid.value || !agentActive()) return;
  props.terminal.input(text);
  setTimeout(() => {
    if (!agentSid.value || !agentActive()) return;
    props.terminal.input('\r');
  }, 150);
}
// 手机模式：把当前选中的 Agent 会话绑定为「固定会话」，复用现有发送/工作流逻辑，且绝不新建会话
watch(() => props.terminal.state.activeSessionId, (sid) => {
  if (!props.phone) return;
  if (!sid) { agentSid.value = null; return; }
  const s = props.terminal.state.sessions.find((x) => x.id === sid) || null;
  if (!isAgentSession(s)) { agentSid.value = null; return; }
  agentSid.value = sid;
  agentProjectId.value = s?.projectId ?? null;
  agentAtStart.value = s?.agentId || agentId.value;
  agentStarted.value = true;
  agentCliReady.value = true;   // 会话里 CLI 已在运行，手机端不再注入启动命令
}, { immediate: true });

// 工作流定义来自 config/workflow.xml（GET /api/workflows-xml）；下面为兜底
interface StageDef { id: string; label: string; prompts: string[]; group?: string; }
interface WfDef { id: string; label: string; stages: StageDef[]; }
function buildFallbackWf(): WfDef[] {
  return [
    {
      id: 'dev', label: t('termwf.dev.title'),
      stages: [
        { id: 'env-check', label: t('termwf.envcheck.label'), group: t('termwf.group.requirement'), prompts: [t('termwf.envcheck.prompt')] },
        { id: 'design', label: t('termwf.design.label'), group: t('termwf.group.requirement'), prompts: [t('termwf.design.prompt1'), t('termwf.design.prompt2')] },
        { id: 'design-review', label: t('termwf.design_review.label'), group: t('termwf.group.requirement'), prompts: [t('termwf.design_review.prompt')] },
        { id: 'code', label: t('termwf.code.label'), group: t('termwf.group.delivery'), prompts: [t('termwf.code.prompt')] },
        { id: 'optimize', label: t('termwf.optimize.label'), group: t('termwf.group.delivery'), prompts: [t('termwf.optimize.prompt')] },
        { id: 'test', label: t('termwf.test.label'), group: t('termwf.group.delivery'), prompts: [t('termwf.test.prompt')] },
        { id: 'push-merge', label: t('termwf.push.label'), group: t('termwf.group.delivery'), prompts: [t('termwf.push.prompt')] },
        { id: 'package', label: t('termwf.package.label'), group: t('termwf.group.ops'), prompts: [t('termwf.package.prompt')] },
        { id: 'push-release', label: t('termwf.pushRelease.label'), group: t('termwf.group.ops'), prompts: [t('termwf.pushRelease.prompt')] },
        { id: 'deploy', label: t('termwf.deploy.label'), group: t('termwf.group.ops'), prompts: [t('termwf.deploy.prompt')] },
        { id: 'troubleshoot', label: t('termwf.troubleshoot.label'), group: t('termwf.group.ops'), prompts: [t('termwf.troubleshoot.prompt')] },
      ],
    },
    { id: 'test', label: t('termwf.testflow.title'), stages: [{ id: 'scope', label: t('termwf.testflow.scope'), prompts: [t('termwf.testflow.prompt')] }] },
    { id: 'doc', label: t('termwf.docflow.title'), stages: [{ id: 'scan', label: t('termwf.docflow.scan'), prompts: [t('termwf.docflow.prompt')] }] },
  ];
}
const wfDefs = ref<WfDef[]>(buildFallbackWf());
const {
  translateMode,
  source: composerText,
  translated: translatedText,
  translating,
  autoSend,
  countdown,
  load: loadComposerPrefs,
  toggleTranslate,
  translateNow,
  sendAction,
  onLeftEnter,
  clear,
} = useEnglishComposer({
  getActiveSessionId: () => props.terminal.state.activeSessionId,
  send: (text, sid) => sendPromptTo(text, sid),
  recordHistory: (text, sid) => { void msgHistory.push(text, sid ? { sessionId: sid, tabName: tabLabel(sid) } : {}); },
  onSent: () => notePromptSent(),
});
// 提示词草稿按会话恢复：切换页签/会话、切换活动栏再回来都不丢
let draftSid: string | null = props.terminal.state.activeSessionId;
composerText.value = getComposerDraft(draftSid);
watch(composerText, (v) => { setComposerDraft(draftSid, v); });
watch(() => props.terminal.state.activeSessionId, (id, oldId) => {
  setComposerDraft(oldId ?? null, composerText.value);
  draftSid = id;
  composerText.value = getComposerDraft(id);
});

function fillPrompt(text: string) { composerText.value = text; }

// —— 输入历史：点击工具栏「历史」→ 打开左侧历史面板的「消息」页签 ——
const msgHistory = useMessageHistory();
function openHistory() {
  window.dispatchEvent(new CustomEvent('df-open-history', { detail: { tab: 'messages' } }));
}
function onFillComposer(e: Event) {
  const t = (e as CustomEvent).detail?.text;
  if (typeof t === 'string') composerText.value = t;
}

// —— remote_coder：手机端发起发消息/截图 ——
function onRemoteSend(e: Event) {
  const text = (e as CustomEvent).detail?.text;
  if (typeof text === 'string' && text.trim()) sendToActive(text);
}
async function onRemoteScreen() {
  const el = hostRef.value;
  if (!el) return;
  try {
    // 隐藏/最小化标签页 rAF 不触发：用定时器兜底 + 整体超时，避免无限等待
    await new Promise<void>((r) => setTimeout(r, 50));
    const dataUrl = await Promise.race([
      captureToPngDataUrl(el),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('capture-timeout')), 10000)),
    ]);
    const res = await fetch('/api/remote-coder/screen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (data.reason) console.warn('remote-coder commit failed:', data.reason);
  } catch (e) {
    console.warn('remote-coder capture failed:', (e as Error).message);
  }
}

// 选文件：把路径（带引号）插到输入框，由所用 Agent 自行读取/识别
function insertComposerPath(p: string) {
  composerText.value = appendText(composerText.value, `"${p}"`);
}
async function pickFileForPrompt() {
  try {
    const res = await fetch('/api/file/pick-path', { method: 'POST' });
    const j: any = await res.json().catch(() => ({}));
    if (j.error) { alert(j.error === 'unsupported' ? t('sched.pick_unsupported') : t('sched.pick_failed', { msg: j.message || j.error })); return; }
    if (j.cancelled || !j.path) return;
    insertComposerPath(j.path);
  } catch (e) { alert(t('sched.pick_failed', { msg: (e as Error).message || String(e) })); }
}

// —— 英文翻译模式的翻译/倒计时/自动发送逻辑见 useEnglishComposer ——

// 底部框高度（可上下拖动）+ 最小化
const COMPOSER_H_KEY = props.phone ? 'devflow-composer-h-phone' : 'devflow-composer-h';
const composerH = ref(props.phone ? 200 : 240);
const composerMin = ref(props.phone ? false : true);   // 手机首次进入即展开；桌面保持收起
function loadComposerH() {
  try {
    const h = Number(localStorage.getItem(COMPOSER_H_KEY));
    if (h >= 120 && h <= 900) composerH.value = h;
  } catch { /* ignore */ }
}
function saveComposerH() { try { localStorage.setItem(COMPOSER_H_KEY, String(Math.round(composerH.value))); } catch { /* ignore */ } }
function onComposerDragDown(e: MouseEvent) {
  if (composerCollapsed.value) return;
  e.preventDefault();
  const startY = e.clientY;
  const startH = composerH.value;
  const move = (ev: MouseEvent) => {
    const max = Math.max(200, window.innerHeight * 0.7);
    composerH.value = Math.min(max, Math.max(120, startH + (startY - ev.clientY)));
  };
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); saveComposerH(); };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}
// 切到任意会话页签都展开输入框（Agent 与非 Agent 会话均可输入）；无会话时保持最小化；用户仍可手动折叠/展开
watch(() => props.terminal.state.activeSessionId, (id) => { if (id) composerMin.value = false; }, { immediate: true });

const curWf = computed<WfDef>(() => wfDefs.value.find((w) => w.id === wfKind.value) || wfDefs.value[0] || buildFallbackWf()[0]);
const STAGES = computed(() => curWf.value.stages);
const stageGroups = computed(() => {
  const out: { name: string; stages: StageDef[] }[] = [];
  for (const s of STAGES.value) {
    const name = s.group || '';
    const last = out[out.length - 1];
    if (!last || last.name !== name) out.push({ name, stages: [s] });
    else last.stages.push(s);
  }
  return out;
});
const activeStage = ref('');
// 把当前工作流/高亮阶段上报给提示词收藏（供历史面板与 chips 的「+」快速追加）
watch([wfKind, activeStage], () => { promptCollect.setCurrent(wfKind.value, activeStage.value); }, { immediate: true });
const chips = computed<Chip[]>(() => {
  const st = curWf.value.stages.find((s) => s.id === activeStage.value) || curWf.value.stages[0];
  // 阶段提示（替换型）+ 固定附加项 1/2/3/4/5（追加型），见 phaseChips.ts
  return buildChips(st?.prompts);
});
const stageChips = computed(() => chips.value.filter((c) => !c.append));   // 工作流阶段提示（左侧，可被挤/滚动）
const extraChips = computed(() => chips.value.filter((c) => c.append));    // 固定附加项 1/2/3/4/5（右侧，固定位置）
// —— 分组自动执行：run 状态与回退 ——
interface WfRunStep { id: string; stageId: string; status: string; }
interface WfRunSnap { runId: string; workflowId: string; groupName: string; status: string; currentIndex: number; steps: WfRunStep[]; }
const wfRun = ref<WfRunSnap | null>(null);
const wfAnchor = ref<string>('');
const wfStepStatus = computed(() => {
  const m = new Map<string, string>();
  for (const s of wfRun.value?.steps || []) m.set(s.id, s.status);
  return m;
});
const wfUnsubs: Array<() => void> = [
  props.terminal.on(S2C.WF_STARTED, (m: any) => { wfRun.value = m.run; }),
  props.terminal.on(S2C.WF_STATUS, (m: any) => { wfRun.value = m.run; }),
  props.terminal.on(S2C.WF_FINISHED, () => { wfRun.value = null; wfAnchor.value = ''; }),
];
function groupRunning(anchor: string): boolean { return wfAnchor.value === anchor && wfRun.value?.status === 'running'; }
function startGroupRun(anchor: string) {
  const sid = props.terminal.state.activeSessionId;
  if (!sid || !activeIsAgent.value) return;
  wfRun.value = null;
  wfAnchor.value = anchor;
  props.terminal.send(C2S.WF_RUN, { workflowId: wfKind.value, groupAnchor: anchor, sessionId: sid });
}
function stopGroupRun() {
  if (wfRun.value) props.terminal.send(C2S.WF_ABORT, { runId: wfRun.value.runId });
  wfRun.value = null;
  wfAnchor.value = '';
}
function rollbackStep(stepId: string) {
  if (stepId && wfRun.value) props.terminal.send(C2S.WF_ROLLBACK, { runId: wfRun.value.runId, stepId });
}
function activeStageDef() { return curWf.value.stages.find((s) => s.id === activeStage.value) || curWf.value.stages[0] || null; }
function chipStepId(c: Chip): string {
  const st = activeStageDef();
  if (!st) return '';
  const idx = (st.prompts || []).findIndex((p) => String(p).trim() === c.text);
  return idx >= 0 ? promptStepId(st.id, idx) : '';
}
function chipStatus(c: Chip): string { const id = chipStepId(c); return id ? (wfStepStatus.value.get(id) || '') : ''; }
function chipRetryable(c: Chip): boolean { const s = chipStatus(c); return s === 'error' || s === 'done'; }
function stageStatus(s: StageDef): string {
  const list = (s.prompts || []).map((_, i) => wfStepStatus.value.get(promptStepId(s.id, i)) || '');
  if (!list.length) return '';
  if (list.includes('running')) return 'running';
  if (list.includes('error')) return 'error';
  if (list.every((x) => x === 'done')) return 'done';
  return '';
}
function stageIcon(st: string): string { return st === 'running' ? '▶' : st === 'done' ? '✓' : st === 'error' ? '✕' : ''; }
watch(() => props.terminal.state.activeSessionId, () => { wfRun.value = null; wfAnchor.value = ''; });

// 替换型 chip 整段填入输入框；追加型 chip（编号）点击即直接发送
function onChipClick(c: Chip) {
  if (!c.append) {
    composerText.value = c.text;
    return;
  }
  composerText.value = appendText(composerText.value, c.text);
  void submitComposer();
}
function chipText(s: string) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 40 ? t.slice(0, 40) + '…' : t;
}
function pickStage(s: StageDef) {
  activeStage.value = s.id;
  if (s.prompts.length) composerText.value = s.prompts[0];   // 阶段首句填入输入框
}
// 清空提示词：两栏一起清、取消倒计时，并去掉阶段高亮
function clearPrompt() {
  clear();
  activeStage.value = '';
}
async function loadWorkflows() {
  try {
    const r = await fetch('/api/workflows-xml').then((x) => x.json());
    if (Array.isArray(r?.workflows) && r.workflows.length) {
      wfDefs.value = r.workflows;
      if (!r.workflows.some((w: WfDef) => w.id === wfKind.value)) wfKind.value = r.workflows[0].id as any;
    }
  } catch { /* 用兜底 */ }
  // 默认选中当前工作流首阶段，展示其常用语
  const first = curWf.value.stages[0];
  if (first) activeStage.value = first.id;
}
async function sendToAgent(text: string) {
  const t = text.trim();
  if (!t) return;
  if (agentSid.value && agentActive()) {
    props.terminal.switchTo(agentSid.value);
    // 注意：这里绝不能再次注入 Agent 启动命令（否则会把 opencode 之类的命令敲进输入框）。
    // CLI 尚在启动中时，多等一会儿再写入用户内容。
    setTimeout(() => sendAgentText(t), agentCliReady.value ? 150 : 2200);
    return;
  }
  await startAgent();
  setTimeout(() => sendAgentText(t), 4400);
}
// 把输入框内容直接打进「当前上面显示的会话」（opencode / claudecode / cmd 等一律适配）
function sendToActive(text: string) {
  const t = text.trim();
  if (!t) return;
  const sid = props.terminal.state.activeSessionId;
  if (!sid) { if (props.phone) return; sendToAgent(t); return; }   // 手机模式没有选中会话就不发；桌面回退：启动 Agent 会话再发送
  props.terminal.input(t);
  setTimeout(() => {
    if (props.terminal.state.activeSessionId !== sid) return;
    props.terminal.input('\r');
  }, 150);
}
// 定向发送：sid 明确时直接写入该会话，不受当前活动标签影响；无 sid 时沿用 sendToActive
function sendPromptTo(text: string, sid: string | null) {
  if (!sid) { sendToActive(text); return; }
  props.terminal.input(text, sid);
  setTimeout(() => { props.terminal.input('\r', sid); }, 150);
}
function compactContext() {
  resetAutoCompact();
  sendToActive('/compact');   // opencode TUI 的上下文压缩命令
}
// 取消：给当前会话发 /undo，撤销 Agent 上一步操作
function undoContext() {
  sendToActive('/undo');
}
// 清空上下文：给当前会话发 /clear（opencode 里是 /new 的别名，清空当前会话上下文并开始新会话）
function endTask() {
  resetAutoCompact();
  sendToActive('/clear');
  refreshTerminalView();
}
// /clear 后 TUI 会整屏重画，稍后强制重绘并重新 fit 一次，消除残影/错位（保留已有输出）
function refreshTerminalView() {
  setTimeout(() => {
    if (!term) return;
    term.refresh(0, term.rows - 1);
    onResize();
  }, 400);
}

// —— 自动压缩上下文：默认开启；用户发送超过 30 次后，空闲 10 分钟无接续则自动 /compact ——
const AUTO_COMPACT_SENDS = 30;
const AUTO_COMPACT_IDLE_MS = 10 * 60 * 1000;
const AUTO_COMPACT_KEY = 'devflow-auto-compact';
const sendCount = ref(0);
let autoCompactTimer: ReturnType<typeof setTimeout> | null = null;
function loadAutoCompact(): boolean {
  try { return localStorage.getItem(AUTO_COMPACT_KEY) !== '0'; } catch { return true; }
}
const autoCompactOn = ref(loadAutoCompact());
function setAutoCompact(v: boolean) {
  autoCompactOn.value = v;
  try { localStorage.setItem(AUTO_COMPACT_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  if (!v) resetAutoCompact();
}
function resetAutoCompact() {
  sendCount.value = 0;
  if (autoCompactTimer) { clearTimeout(autoCompactTimer); autoCompactTimer = null; }
}
function notePromptSent() {
  if (!autoCompactOn.value) return;
  sendCount.value += 1;
  if (autoCompactTimer) clearTimeout(autoCompactTimer);
  autoCompactTimer = setTimeout(() => {
    autoCompactTimer = null;
    if (!autoCompactOn.value || !activeIsAgent.value) return;
    if (sendCount.value <= AUTO_COMPACT_SENDS) return;
    compactContext();
  }, AUTO_COMPACT_IDLE_MS);
}
// 非翻译模式：回车直接把输入框内容送入当前会话
async function submitComposer() {
  const text = composerText.value.trim() || 'ok';
  composerText.value = '';
  const sid = props.terminal.state.activeSessionId;
  void msgHistory.push(text, sid ? { sessionId: sid, tabName: tabLabel(sid) } : {});
  sendToActive(text);
  notePromptSent();
}
function onComposerKey(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  if (translateMode.value) void onLeftEnter();
  else void submitComposer();
}
function onOutKey(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  void sendAction();
}
function onSendClick() {
  if (translateMode.value) void sendAction();
  else void submitComposer();
}
function selectWf(id: string) {
  wfKind.value = id;
  const first = curWf.value.stages[0];
  if (first) pickStage(first);   // 仅切换工作流并更新下方提示词，不触发 Agent
}

function init() {
  if (!hostRef.value || term) return;
  term = new Terminal({
    cursorBlink: true, fontSize: 13, fontFamily: 'Consolas, "Courier New", monospace',
    theme: termTheme(isDark.value),
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(hostRef.value);
  fit.fit();
  resizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(() => onResize());
  });
  resizeObserver.observe(hostRef.value!);
  dataSub = term.onData((d: string) => { if (syncingRename.value) return; props.terminal.input(d); });
  selSub = term.onSelectionChange(() => { hasSelection.value = !!term?.hasSelection(); });
  props.terminal.bindIO({
    output: (d) => term?.write(d),
    replay: (d) => { term?.clear(); term?.write(d); requestAnimationFrame(() => { onResize(); scheduleRepaint(60); }); },
  });
  watch(() => props.terminal.state.status, (s) => {
    if (s === 'reconnecting') term?.write('\x1b[33m' + t('term.disconnected') + '\x1b[0m\r\n');
  });
  const dims = () => { const d = fit?.proposeDimensions(); return { cols: d?.cols || 80, rows: d?.rows || 24 }; };
  unsubList = props.terminal.on(S2C.SESSION_LIST, () => {
    if (props.phone) return;   // 手机模式：不自动 adopt/新建会话，交给用户点页签
    if (autoTried || props.terminal.state.activeSessionId) return;
    autoTried = true;
    const adopted = pickRestoredAgent(props.terminal.state.sessions);
    if (adopted) {
      for (const id of restoredAgentIds(props.terminal.state.sessions)) markAgent(id);
      agentSid.value = adopted.id;
      agentProjectId.value = adopted.projectId ?? null;
      agentAtStart.value = adopted.agentId || agentId.value;
      agentStarted.value = true;
      agentCliReady.value = true;                 // 服务端已注入续会话命令，不再重复注入
      props.terminal.switchTo(adopted.id);
      return;
    }
    const existing = props.terminal.state.sessions.find((s) => agentSids.value.has(s.id));
    if (existing) {
      agentSid.value = existing.id;                       // 重新挂载后绑定回固定 Agent 会话
      agentProjectId.value = existing.projectId ?? null;
      props.terminal.switchTo(existing.id);               // 复用已存在的 Agent 会话（项目不同也不自动重建）
    }
  });
  unsubCfg = props.terminal.on(S2C.CONFIG_CHANGED, async () => {
    await loadAgents();
    loadCfg();
    loadWorkflows();
    loadSettings();
  });
}

// 刷新恢复：只给「最近点击的 N 个」会话自动建页签；其余会话仍由历史面板按需打开。
// null = 无历史，不限制。当前活动会话始终建页签（新建/历史打开时由 activeSessionId watcher 兜底）。
const visibleSessionSet = computed(() => (props.visibleSessionIds == null ? null : new Set(props.visibleSessionIds)));
// 会话列表 → 统一页签栏同步（保证顺序：会话在前，文件在后）
const knownSessions = ref<string[]>([]);
watch(() => props.terminal.state.sessions.map((s) => s.id), (ids) => {
  const visible = visibleSessionSet.value;
  const active = props.terminal.state.activeSessionId;
  for (const id of ids) {
    if (visible && !visible.has(id) && id !== active) continue;
    props.center.ensureSession(id, tabLabel(id), sessionState(id), sessionProjectId(id));
  }
  for (const old of knownSessions.value) if (!ids.includes(old)) props.center.removeSession(old);
  knownSessions.value = ids;
  ensureAgentOrder();
}, { immediate: true });

// 页签自定义名加载/变更后，刷新已存在会话页签的显示名（覆盖加载时序差异）
watch(tabNames, () => {
  const visible = visibleSessionSet.value;
  const active = props.terminal.state.activeSessionId;
  for (const s of props.terminal.state.sessions) {
    if (visible && !visible.has(s.id) && s.id !== active) continue;
    props.center.ensureSession(s.id, tabLabel(s.id), s.state || 'running', s.projectId ?? null);
  }
}, { deep: true });

// 激活会话变化 → 中心激活对应会话页签（新建/切换/历史打开时回到终端视图）
// 先 ensureSession 保证被 visibleSessionIds 过滤掉的会话也能拿到正确标题的页签
watch(() => props.terminal.state.activeSessionId, (id) => {
  resetAutoCompact();
  if (id) {
    props.center.ensureSession(id, tabLabel(id), sessionState(id), sessionProjectId(id));
    props.center.activateSession(id, sessionProjectId(id));
  }
});
// 从文件视图切回终端时重排尺寸
watch(isSessionView, (v) => { if (v) requestAnimationFrame(() => onResize()); });

function onResize() {
  if (!term || !fit) return;
  fit.fit();
  const d = fit.proposeDimensions();
  if (d) props.terminal.resize(d.cols, d.rows);
  scheduleRepaint();
}
// xterm 的 DOM 渲染器在大块重画/改尺寸后会残留旧行；而 fit 在行列数不变时不会触发重绘。
// 这里在尺寸变化（含拖动输入框边框）、切换会话回放后，延迟强制整屏 refresh 一次，消除残影。
function scheduleRepaint(delay = 80) {
  if (repaintTimer) clearTimeout(repaintTimer);
  repaintTimer = setTimeout(() => {
    repaintTimer = null;
    if (term) term.refresh(0, term.rows - 1);
  }, delay);
}
function termTheme(dark: boolean) {
  const base = dark
    ? { background: '#0e1116', foreground: '#d5dae1', cursor: '#6aa2ff', selectionBackground: '#2f6feb66' }
    : { background: '#ffffff', foreground: '#1f2937', cursor: '#2563eb', selectionBackground: '#93c5fd99' };
  // 浅色（白天）背景：把 PowerShell 命令行高亮的黄改为黑色；深色保持原黄色
  if (dark) return base;
  return { ...base, yellow: '#111111', brightYellow: '#000000' };
}
watch(isDark, (d) => { if (term) { term.options.theme = termTheme(d); requestAnimationFrame(() => onResize()); } });

async function copySel() {
  const ok = await copyText(term?.getSelection() ?? '');
  if (!ok) return;
  copiedSel.value = true;
  if (copySelTimer) clearTimeout(copySelTimer);
  copySelTimer = setTimeout(() => { copiedSel.value = false; copySelTimer = null; }, 1500);
}
function onTabClick(id: string) {
  const t = props.center.tabs.value.find((x) => x.id === id);
  if (!t) return;
  if (t.kind === 'session' && t.id.startsWith('s:')) {
    const sid = t.id.slice(2);
    props.center.activateSession(sid, sessionProjectId(sid));  // 直接激活中心页签（避免 activeSessionId 未变导致 watcher 不触发）
    props.terminal.switchTo(sid);
  } else {
    props.center.activateFileTab(id);
  }
}
function onTabClose(id: string, ev: Event) {
  ev.stopPropagation();
  const tab = props.center.tabs.value.find((x) => x.id === id);
  if (!tab) return;
  if (tab.kind === 'session' && tab.id.startsWith('s:')) {
    const sid = tab.id.slice(2);
    props.terminal.killSession(sid);   // 关闭会话需确认弹窗
  } else {
    props.center.closeById(id);
  }
}

watch([agentId, agents, wfKind], saveCfg, { deep: true });

watch(settingsOpen, (open, was) => {
  if (was && !open) {
    firstRunHint.value = false;
    window.dispatchEvent(new Event('df-settings-closed'));
  }
});
async function setDefaultAgent(id: string) {
  agentId.value = id;                    // 本机当前项目即时生效
  try {
    const res = await fetch('/api/agents/default', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    firstRunHint.value = false;
  } catch (e: any) {
    alert(t('term.agent_set_default_failed', { msg: e?.message || e }));
  }
}

onMounted(async () => {
  props.center.scopeProjectId.value = props.projectId ?? null;
  init();
  window.addEventListener('resize', onResize);
  window.addEventListener('df-open-agent-settings', onOpenSettings);
  window.addEventListener('df-fill-composer', onFillComposer);
  window.addEventListener('df-remote-send', onRemoteSend);
  window.addEventListener('df-remote-screen', onRemoteScreen);
  const fp = await nodeFp();
  cfgKey = `devflow-agent-cfg-${fp}`;
  agentSidsKey = `devflow-agent-sids-${fp}`;
  tabNamesKey = `devflow-tab-names-${fp}`;
  tabDescsKey = `devflow-tab-descs-${fp}`;
  loadAgentSids();
  void loadComposerPrefs();
  loadTabNames();
  msgHistory.setNames(tabNames.value);   // 回灌会话自定义名，供左侧「全部会话」树展示
  loadTabDescs();
  await loadAgents();
  loadCfg();           // 本地已保存配置优先覆盖 API 默认
  cfgLoaded = true;
  loadWorkflows();
  loadComposerH();
});
onBeforeUnmount(() => {
  setComposerDraft(draftSid, composerText.value);
  window.removeEventListener('resize', onResize);
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener('df-open-agent-settings', onOpenSettings);
  window.removeEventListener('df-fill-composer', onFillComposer);
  window.removeEventListener('df-remote-send', onRemoteSend);
  window.removeEventListener('df-remote-screen', onRemoteScreen);
  if (autoCompactTimer) { clearTimeout(autoCompactTimer); autoCompactTimer = null; }
  if (copySelTimer) { clearTimeout(copySelTimer); copySelTimer = null; }
  if (repaintTimer) { clearTimeout(repaintTimer); repaintTimer = null; }
  for (const u of wfUnsubs) u();
  unsubList?.();
  unsubCfg?.();
  if (renameHintTimer) { clearTimeout(renameHintTimer); renameHintTimer = null; }
  selSub?.dispose();
  selSub = null;
  dataSub?.dispose();
  term?.dispose();
  term = null;
});
</script>

<template>
  <div class="center-wrap">

    <div v-if="newOpen" class="setmask" @click.self="closeNew">
      <div class="newmodal">
        <header class="seth"><span>{{ $t('term.new_session') }}</span><button class="setx" @click="closeNew">×</button></header>
        <div class="newname">
          <input v-model="newName" class="newname-input" :placeholder="$t('term.new_task_name')" @keyup.enter="createNew(newSelected)" />
          <div class="newname-hint">{{ $t('term.new_task_name_hint') }}</div>
        </div>
        <div class="newlist">
          <button v-for="c in newChoices" :key="c.id" class="newitem" :class="{ on: newSelected === c.id }" @click="createNew(c.id)">
            <span class="ni-label">{{ c.label }}</span>
            <span class="ni-cmd">{{ c.cmd || $t('term.default_shell') }}</span>
          </button>
        </div>
      </div>
    </div>
    <div v-if="renameHint" class="renamehint">{{ renameHint }}</div>
    <div v-if="settingsOpen" class="setmask" @click.self="settingsOpen = false">
      <div class="setmodal">
        <header class="seth">
          <span>{{ $t('term.settings') }}</span>
          <button class="setx" @click="settingsOpen = false">×</button>
        </header>
        <div class="setmain">
          <nav class="setnav">
            <button type="button" :class="{ on: settingsTab === 'general' }" @click="settingsTab = 'general'">{{ $t('term.settings') }}</button>
            <button type="button" :class="{ on: settingsTab === 'about' }" @click="settingsTab = 'about'">{{ $t('term.about.tab') }}</button>
          </nav>
          <div class="setbody">
          <template v-if="settingsTab === 'general'">
          <div ref="agentSecRef" class="setsec">
            <div class="settitle">{{ $t('term.agent_list') }} <button class="ghostcfg" @click="addAgent">{{ $t('term.add') }}</button></div>
            <div v-if="firstRunHint" class="cfghint warn">{{ $t('term.agent_first_run_hint') }}</div>
            <div v-for="a in agents" :key="a.id" class="agentrow">
              <input v-model="a.name" class="ainput aname" :placeholder="$t('term.name')" />
              <input v-model="a.cmd" class="ainput acmd" :placeholder="$t('term.agent_cmd_placeholder')" />
              <button class="ghostcfg setbtn" :class="{ on: a.id === agentId }" :disabled="a.id === agentId" @click="setDefaultAgent(a.id)">{{ a.id === agentId ? $t('term.is_default') : $t('term.set_default') }}</button>
              <button class="ghostcfg delbtn" :disabled="agents.length <= 1" @click="removeAgent(a.id)">{{ $t('term.delete') }}</button>
            </div>
            <div class="cfghint">{{ $t('term.agent_hint') }}</div>
          </div>
          <div class="setsec">
            <div class="settitle">{{ $t('term.service') }}</div>
            <div class="cfgrow"><span>{{ $t('term.port') }}</span><input v-model.number="serverPort" type="number" min="1" max="65535" placeholder="22222" @keyup.enter="confirmSettings" /><button class="ghostcfg" :disabled="!canRestart(portState) || restarting" @click="restartBackend">{{ $t('term.port_restart') }}</button></div>
            <div v-if="!canRestart(portState)" class="cfghint">{{ $t(restartHintKey(portState)) }}</div>
            <div v-if="portMsg" class="cfghint warn">{{ portMsg }}</div>
            <div v-if="restartMsg" class="cfghint warn">{{ restartMsg }}</div>
            <div class="cfghint">{{ $t('term.service_hint') }}</div>
          </div>
          <div class="setsec">
            <div class="settitle">{{ $t('term.void_title') }}</div>
            <div class="cfgrow">
              <button class="ghostcfg" :disabled="voidBusy" @click="registerVoid">{{ $t('term.void_register') }}</button>
              <span v-if="voidMsg" class="cfghint">{{ voidMsg }}</span>
            </div>
            <div class="cfghint">{{ $t('term.void_hint') }}</div>
          </div>
          <div v-if="assocAvailable" class="setsec">
            <div class="settitle">{{ $t('term.file_assoc') }}</div>
            <label class="chkrow">
              <input type="checkbox" v-model="assocEnabled" />
              <span>{{ $t('term.file_assoc_label') }}</span>
            </label>
            <div class="cfghint">{{ $t('term.file_assoc_hint') }}</div>
            <div class="cfghint assoc-exts">
              <label v-for="x in assocExts" :key="x.ext" class="assoc-ext">
                <input type="checkbox" v-model="x.enabled" />
                <span>{{ x.ext }}</span>
                <span v-if="x.isDefault" class="assoc-on">✓</span>
              </label>
            </div>
            <div class="cfghint">{{ $t('term.file_assoc_common') }}</div>
            <div v-if="assocMsg" class="cfghint warn">{{ assocMsg }}</div>
          </div>
          <div class="setsec">
            <div class="settitle">{{ $t('term.auto_compact') }}</div>
            <label class="chkrow">
              <input type="checkbox" :checked="autoCompactOn" @change="setAutoCompact(($event.target as HTMLInputElement).checked)" />
              <span>{{ $t('term.auto_compact_hint') }}</span>
            </label>
          </div>
          <div class="setsec">
            <div class="settitle">{{ $t('term.restore_tabs') }}</div>
            <div class="cfgrow">
              <span>{{ $t('term.restore_tabs_label') }}</span>
              <input v-model.number="restoreTabsCount" type="number" min="1" :max="MAX_RESTORE_TABS" @change="saveRestoreTabsCount" />
            </div>
            <div class="cfghint">{{ $t('term.restore_tabs_hint') }}</div>
          </div>
          </template>
          <template v-else>
            <div class="setsec">
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.version') }}</span><span class="aboutv">{{ appVersion || '-' }}</span></div>
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.author') }}</span><span class="aboutval">Samuel Tsang</span></div>
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.software') }}</span><span class="aboutv">{{ $t('term.about.name_value') }}</span></div>
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.download') }}</span><a class="aboutv link" href="https://gitee.com/slxxzh12/vscode-ai/releases" target="_blank" rel="noopener">{{ $t('term.about.download_desktop') }}</a></div>
              <div class="aboutrow"><span class="aboutk"></span><a class="aboutv link" href="https://gitee.com/slxxzh12/vscode-ai-mobile/releases" target="_blank" rel="noopener">{{ $t('term.about.download_mobile') }}</a></div>
            </div>
            <div class="setsec">
              <div class="settitle">{{ $t('upgrade.check') }}</div>
              <div class="aboutrow"><span class="aboutk">{{ $t('upgrade.current') }}</span><span class="aboutv">{{ appVersion || '-' }}</span></div>
              <div class="aboutrow"><span class="aboutk">{{ $t('upgrade.latest') }}</span><span class="aboutv">{{ upgradeInfo?.latest || '-' }}</span></div>
              <div class="aboutrow"><span class="aboutk">{{ $t('upgrade.download_url') }}</span>
                <a v-if="upgradeInfo?.downloadUrl" class="aboutv link" :href="upgradeInfo.downloadUrl" target="_blank" rel="noopener">{{ upgradeInfo.downloadUrl }}</a>
                <span v-else class="aboutv">-</span>
              </div>
              <div class="aboutrow"><span class="aboutk"></span>
                <button class="upgbtn" :disabled="upgradeLoading" @click="checkNow">{{ upgradeLoading ? $t('upgrade.checking') : $t('upgrade.check_now') }}</button>
              </div>
            </div>
            <div class="setsec">
              <div class="settitle">{{ $t('term.about.contacts') }}</div>
              <div class="aboutrow"><span class="aboutk">QQ</span><span class="aboutv">914300336</span></div>
              <div class="aboutrow wechat">
                <span class="aboutk">{{ $t('term.about.wechat') }}</span>
                <span class="aboutcol">
                  <span class="aboutv">yes8sir</span>
                  <a class="wxqrlink" href="/wechat.png" target="_blank" rel="noopener" :title="$t('term.about.wechat_qr')">
                    <img class="wxqr" src="/wechat.png" :alt="$t('term.about.wechat_qr')" />
                  </a>
                </span>
              </div>
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.email') }}</span><a class="aboutv link" href="mailto:samuel.tsang@outlook.com">samuel.tsang@outlook.com</a></div>
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.tiktok') }}</span><span class="aboutv">slxxzh12</span></div>
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.instagram') }}</span><span class="aboutv">slxxzh12</span></div>
            </div>
            <div class="setsec">
              <div class="settitle">{{ $t('term.about.license') }}</div>
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.download_url') }}</span><a class="aboutv link" href="https://gitee.com/slxxzh12/vscode-ai/releases" target="_blank" rel="noopener">https://gitee.com/slxxzh12/vscode-ai/releases</a></div>
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.feedback') }}</span><a class="aboutv link" href="https://gitee.com/slxxzh12/vscode-ai/issues" target="_blank" rel="noopener">https://gitee.com/slxxzh12/vscode-ai/issues</a></div>
              <pre class="license">{{ $t('term.about.mit') }}</pre>
              <div class="licnote">{{ $t('term.about.note') }}</div>
            </div>
          </template>
          </div>
        </div>
        <footer class="setf">
          <button class="ghostcfg" @click="resetCfg">{{ $t('term.restore_default') }}</button>
          <button class="ago" @click="confirmSettings" :disabled="restarting">{{ restarting ? $t('term.port_restarting') : $t('term.done') }}</button>
        </footer>
      </div>
    </div>
    <div v-if="syncingRename" :ref="setRenameMask" class="renamemask" tabindex="-1" @keydown.prevent @mousedown.prevent>
      <div class="renamemask-box"><span class="renamemask-spin" />{{ $t('term.rename_syncing') }}</div>
    </div>
    <TabRenameDialog v-if="dialogSid"
      :name="dialogName" :description="dialogDesc" :placeholder="dialogPlaceholder"
      @confirm="onTabDialogConfirm" @cancel="onTabDialogCancel" />
    <div class="tabstrip">
      <div v-for="t in center.visibleTabs.value" :key="t.id" class="tab"
        :class="{ active: center.activeId.value === t.id }" @click="onTabClick(t.id)"
        @dblclick="t.kind === 'session' && openTabDialog(t.id)">
        <span v-if="t.kind === 'session'" :class="['dot', sessionState(t.id.slice(2))]" />
        <span v-else class="file-ic">▤</span>
        <span class="nm" :title="t.kind === 'file' ? t.path : (tabDisplayLabel(t) + ' — ' + $t('term.tab_rename'))">{{ tabDisplayLabel(t) }}</span>
        <span class="x" @click="onTabClose(t.id, $event)" @dblclick.stop>×</span>
      </div>
      <button v-if="!phone" class="new" @click="openNew">{{ $t('term.new_session_btn') }}</button>
      <span v-if="terminal.state.status === 'reconnecting'" class="net">{{ $t('app.reconnecting') }}</span>
    </div>

    <WelcomeView v-if="showWelcome" @new-agent="onWelcomeNewAgent" @open-tool="onWelcomeOpenTool" />

    <div v-show="isSessionView" class="term-wrap">
      <div class="term-layer" ref="hostRef" />
      <div v-if="phoneHint" class="phone-empty">{{ $t(phoneHint) }}</div>
      <button class="copyfloat" :disabled="!hasSelection" :title="$t('term.copy_sel')" @mousedown.stop @click="copySel">{{ copiedSel ? $t('term.copied') : $t('term.copy_sel') }}</button>
    </div>
    <div v-show="props.center.activeKind.value === 'file'" class="file-layer">
      <FilePreview v-if="activeFile && activeFile.projectId && activeFile.path"
        :key="activeFile.id" :project-id="activeFile.projectId" :path="activeFile.path" :name="activeFile.label"
        :detail-token="detailToken" :detail-path="detailPath"
        :locate-token="locateToken" :locate-path="locatePath" :locate-line="locateLine"
        :locate-query="locateQuery" :locate-case-sensitive="locateCaseSensitive"
        @open-link="onProjectLink" />
    </div>
    <div v-show="!!activeTool" class="tool-layer">
      <ToolDocPane v-if="activeDocTool" :key="activeDocTool" :tool="activeDocTool" />
      <TextToolBody v-else-if="activeToolName === 'translate'" />
      <Base64Tool v-else-if="activeToolName === 'base64'" />
      <PostmanTool v-else-if="activeToolName === 'postman'" />
      <NavicatTool v-else-if="activeToolName === 'navicat'" />
      <NginxTool v-else-if="activeToolName === 'nginx'" />
    </div>
    <div v-show="!!activeLocal" class="local-layer">
      <template v-if="localIsRoot">
        <DocViewer
          v-if="local.activePath.value"
          :source="localRootSource"
          :path="local.activePath.value"
          :name="localLeafName"
          intercept-links
          @open-link="onLocalLink"
        />
        <div v-else class="local-empty">{{ $t('local.empty') }}</div>
      </template>
      <DocViewer
        v-else-if="localFileSource && localFileEntry"
        :key="localFileEntry.key"
        :source="localFileSource"
        :path="localFileEntry.name"
        :name="localFileEntry.name"
        intercept-links
        @open-link="onLocalLink"
      />
    </div>

    <div v-if="isSessionView" class="composer" :class="{ light: !isDark, min: composerCollapsed, phone }" :style="{ height: (composerCollapsed ? 40 : composerH) + 'px' }">
      <div class="cbar" @mousedown="onComposerDragDown">
        <div v-if="activeIsAgent" class="wfbtns" @mousedown.stop>
          <button v-for="w in wfDefs" :key="w.id" class="wfbtn" :class="{ on: wfKind === w.id }" @click="selectWf(w.id)">{{ w.label }}</button>
        </div>
        <button v-if="activeIsAgent && wfDefs.length" class="wfbtn edit" :title="$t('wfe.title')" @mousedown.stop @click="editorOpen = true"><svg class="ico" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>{{ $t('wfe.open') }}</button>
        <button class="cmin" :title="composerCollapsed ? $t('term.composer_expand') : $t('term.composer_min')" @mousedown.stop @click="composerMin = !composerMin">{{ composerCollapsed ? '❐' : '—' }}</button>
      </div>
      <template v-if="!composerCollapsed">
        <div v-if="activeIsAgent" class="flowbar">
          <template v-for="(g, gi) in stageGroups" :key="gi">
            <div class="fgroup">
              <button
                class="gplay"
                :class="{ stop: groupRunning(g.stages[0].id) }"
                :title="groupRunning(g.stages[0].id) ? $t('wf.group.stop') : $t('wf.group.run')"
                @mousedown.stop
                @click.stop="groupRunning(g.stages[0].id) ? stopGroupRun() : startGroupRun(g.stages[0].id)"
              >{{ groupRunning(g.stages[0].id) ? '■' : '▶' }}</button>
              <span v-if="g.name" class="fglabel">{{ g.name }}</span>
              <template v-for="(s, i) in g.stages" :key="s.id">
                <button class="stage" :class="{ on: activeStage === s.id }" @click="pickStage(s)">{{ s.label }}<span v-if="stageStatus(s)" class="stic" :class="stageStatus(s)">{{ stageIcon(stageStatus(s)) }}</span></button>
                <span v-if="i < g.stages.length - 1" class="flowline" />
              </template>
            </div>
            <span v-if="gi < stageGroups.length - 1" class="fgap" />
          </template>
        </div>
        <div v-if="activeIsAgent && chips.length" class="chipbar" :title="$t('term.phase_hints')">
          <span class="chips-label">{{ $t('term.common') }}</span>
          <div class="chipstage">
            <span v-for="(c, i) in stageChips" :key="i" class="chipwrap">
              <button
                class="chip"
                :class="[{ on: composerText === c.text }, chipStatus(c)]"
                :title="c.text"
                @click="onChipClick(c)"
              ><span class="cdot" />{{ chipText(c.text) }}<span v-if="stageIcon(chipStatus(c))" class="stic">{{ stageIcon(chipStatus(c)) }}</span></button>
              <button v-if="chipRetryable(c)" class="rback" :title="$t('wf.step.rollback')" @mousedown.stop @click.stop="rollbackStep(chipStepId(c))">↺</button>
              <PromptCollectAddon :text="c.text" />
            </span>
          </div>
          <div class="chipextra">
            <button
              v-for="(c, i) in extraChips"
              :key="i"
              class="chip"
              :title="c.text"
              @click="onChipClick(c)"
            ><span class="cdot" />{{ chipText(c.text) }}</button>
          </div>
        </div>
        <div class="cwrap">
          <div class="cinputwrap">
            <textarea
              v-model="composerText"
              class="cinput"
              :placeholder="$t('term.composer_placeholder')"
              @keydown="onComposerKey"
            />
            <div class="ctools">
              <input v-if="editingDesc" ref="descInputEl" v-model="descDraft" class="cdsc cdsc-edit"
                :placeholder="$t('term.tab_dialog_desc_ph')" @keydown.enter.prevent="commitDesc"
                @keydown.esc.prevent="cancelDesc" @blur="commitDesc" @mousedown.stop />
              <span v-else-if="activeTabDesc" class="cdsc" :title="activeTabDesc + ' — ' + $t('term.tab_desc_edit')"
                @dblclick.stop="startEditDesc" @mousedown.stop>{{ activeTabDesc }}</span>
              <button class="cbtn" :title="$t('term.pick_file')" @mousedown.stop @click="pickFileForPrompt">{{ $t('term.pick_file') }}</button>
              <button class="cbtn" :disabled="!composerText && !translatedText && !activeStage" :title="$t('term.clear_prompt')" @mousedown.stop @click="clearPrompt">{{ $t('term.clear_prompt') }}</button>
              <button v-if="translateMode" class="cbtn" :disabled="translating || !composerText.trim()" :title="$t('term.translate')" @mousedown.stop @click="translateNow">{{ translating ? $t('term.translating') : $t('term.translate') }}</button>
              <button class="cbtn" :class="{ on: translateMode }" :title="$t('term.translate_toggle')" @mousedown.stop @click="toggleTranslate">{{ $t('term.translate_toggle') }}</button>
              <button v-if="!phone" class="cbtn" :title="$t('term.history')" @mousedown.stop @click="openHistory">{{ $t('term.history') }}</button>
            </div>
          </div>
          <div v-if="translateMode" class="cinputwrap">
            <textarea
              v-model="translatedText"
              class="cinput out"
              :placeholder="$t('term.translated_ph')"
              @keydown="onOutKey"
            />
            <div class="cauto">
              <label :title="$t('term.auto_send_hint')">
                <input type="checkbox" v-model="autoSend" />{{ $t('term.auto_send') }}
              </label>
              <span v-if="countdown !== null" class="cnt">{{ $t('term.auto_send_countdown', { n: countdown }) }}</span>
            </div>
            <div v-if="countdown !== null" class="cprog" :style="{ width: ((countdown ?? 0) / 3) * 100 + '%' }" />
          </div>
          <div v-if="activeIsAgent" class="cagentacts">
            <button class="cact compact" :title="$t('term.compact_hint')" @click="compactContext">{{ $t('term.compact') }}</button>
            <button class="cact cancel" :title="$t('term.undo_hint')" @click="undoContext">{{ $t('term.cancel_exec') }}</button>
            <button class="cact endtask" :title="$t('term.end_task_hint')" @click="endTask">{{ $t('term.end_task') }}</button>
          </div>
          <button class="csend" @click="onSendClick">{{ countdown !== null ? $t('term.send_countdown', { n: countdown }) : $t('common.send') }}</button>
        </div>
      </template>
    </div>
  </div>
  <WorkflowEditor v-if="editorOpen" @close="editorOpen = false" @saved="loadWorkflows" />
</template>

<style scoped>
.center-wrap { display: flex; flex-direction: column; height: 100%; background: var(--bg3); position: relative; }
.agentbar { display: flex; align-items: center; gap: 8px; padding: 0 10px; height: 30px; background: var(--bg1); border-bottom: 1px solid var(--bd2); flex: none; position: relative; }
.alab { color: var(--tx3); font-size: 11px; }
.asel { background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 1px 6px; font-size: 12px; }
.ago { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 2px 12px; cursor: pointer; font-size: 12px; font-weight: 600; }
.acfg { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 1px 8px; cursor: pointer; font-size: 12px; }
.ahint { margin-left: auto; color: var(--tx6); font-size: 11px; }
.composer { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 0 10px 10px; background: var(--bg2); border-top: 1px solid var(--bd2); flex: none; overflow: hidden; box-sizing: border-box; }
.composer.min { padding-bottom: 6px; }
.cbar { flex: none; display: flex; align-items: center; gap: 8px; height: 26px; cursor: row-resize; user-select: none; }
.cbar button, .cbar select { cursor: pointer; }
.clabel { color: var(--tx3); font-size: 11px; }
.cstart { padding: 2px 14px; }
.cbar .gear { margin-left: 4px; }
.cbar .asel { height: 20px; padding: 0 6px; }
.ctools { position: absolute; top: 6px; right: 8px; z-index: 2; display: flex; gap: 6px; }
.ctools .cdsc { flex: 0 1 auto; min-width: 0; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: color-mix(in srgb, var(--warn2) 16%, transparent); border: 1px solid color-mix(in srgb, var(--warn2) 60%, transparent); color: var(--warn2); border-radius: 6px; padding: 1px 8px; line-height: 18px; font-size: 11px; cursor: text; }
.ctools .cdsc-edit { width: 220px; max-width: 40vw; outline: none; }
.ctools .cdsc-edit:focus { border-color: var(--ac2); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ac2) 22%, transparent); }
.cbtn { background: var(--bg4); border: 1px solid var(--bd); color: var(--tx3); border-radius: 6px; padding: 1px 8px; line-height: 18px; cursor: pointer; font-size: 11px; }
.cbtn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.cbtn:disabled { opacity: .55; cursor: default; }
.cbtn.on { border-color: var(--ac); color: var(--ac2); }
.cmin { margin-left: auto; background: none; border: 1px solid transparent; color: var(--tx2); border-radius: 4px; width: 28px; height: 20px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 13px; }
.cmin:hover { background: color-mix(in srgb, var(--tx1) 14%, transparent); color: var(--tx1); }
.cinput.out { padding-right: 14px; padding-top: 30px; }
.cauto { position: absolute; top: 6px; right: 10px; z-index: 2; display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--tx3); }
.cauto label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.cauto input { margin: 0; cursor: pointer; }
.cauto .cnt { color: var(--ac2); }
.cprog { position: absolute; left: 10px; bottom: 4px; height: 2px; background: var(--ac2); border-radius: 2px; transition: width .95s linear; pointer-events: none; }
.wfbtns { display: flex; gap: 0; flex: none; align-items: stretch; border-bottom: 2px solid transparent; }
.wfbtn { background: none; border: none; border-bottom: 2px solid transparent; color: var(--tx3); padding: 2px 12px 3px; cursor: pointer; font-size: 11px; }
.wfbtn:hover { color: var(--tx1); }
.wfbtn.on { color: var(--ac2); border-bottom-color: var(--ac2); font-weight: 700; }
.wfbtn.edit { display: inline-flex; align-items: center; gap: 4px; padding: 2px 9px; color: var(--warn2); border: 1px solid color-mix(in srgb, var(--warn2) 60%, transparent); background: color-mix(in srgb, var(--warn2) 12%, transparent); border-radius: 4px; }
.wfbtn.edit:hover { border-color: var(--warn2); background: color-mix(in srgb, var(--warn2) 22%, transparent); }
.wfbtn.edit .ico { flex: none; }
.flowbar { display: flex; align-items: center; gap: 0; flex: none; flex-wrap: wrap; }
.fgroup { display: flex; align-items: center; gap: 0; border: 1px dashed color-mix(in srgb, var(--tx1) 45%, transparent); border-radius: 12px; padding: 2px 8px 2px 6px; margin: 2px 0; background: color-mix(in srgb, var(--ac) 3%, transparent); }
.fglabel { font-size: 10px; color: var(--tx4); margin-right: 6px; padding: 0 4px; border-right: 1px solid color-mix(in srgb, var(--tx1) 40%, transparent); white-space: nowrap; }
.fgap { width: 14px; flex: none; }
.stage { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 14px; padding: 3px 12px; cursor: pointer; font-size: 12px; }
.stage:hover { border-color: var(--ac2); color: var(--ac2); }
.stage.on { background: var(--ac); border-color: var(--ac); color: var(--onac); }
.flowline { flex: 1; height: 2px; min-width: 10px; background: linear-gradient(90deg, var(--ac2), var(--bd3)); margin: 0 4px; border-radius: 2px; }
.cwrap { position: relative; display: flex; align-items: stretch; gap: 8px; flex: 1; min-height: 0; }
.cinputwrap { position: relative; flex: 1; min-width: 0; display: flex; }
.chipbar { display: flex; align-items: flex-start; gap: 6px; flex: none; }
.chipstage { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 6px; flex: 1; min-width: 0; max-height: 84px; overflow-y: auto; }
.chipextra { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 6px; flex: none; }
.chipextra .chip { padding: 3px 12px; gap: 4px; min-width: 34px; font-size: 13px; line-height: 18px; justify-content: center; }
.chipextra .cdot { width: 5px; height: 5px; margin-top: 6px; }
.chips-label { color: var(--tx3); font-size: 11px; flex: none; margin-right: 2px; line-height: 20px; }
.chip { display: inline-flex; align-items: flex-start; gap: 5px; background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 12px; padding: 2px 10px; cursor: pointer; font-size: 11px; line-height: 16px; text-align: left; white-space: normal; max-width: 100%; }
.chip:hover { border-color: var(--ac2); color: var(--ac2); }
.chip.on { background: var(--ac); border-color: var(--ac); color: var(--onac); }
.cdot { width: 5px; height: 5px; margin-top: 5px; border-radius: 50%; background: var(--ac2); flex: none; }
.chip.on .cdot { background: var(--onac); }
.cinput { flex: 1; min-width: 0; height: 100%; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 10px; padding: 30px 180px 10px 14px; font-size: 13px; line-height: 1.6; outline: none; resize: none; font-family: inherit; }
.cinput:focus { border-color: var(--ac2); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ac2) 22%, transparent); }
.cinput::placeholder { color: var(--tx3); }
.csend { background: var(--window-ac, var(--ac)); color: var(--onac); border: none; border-radius: 10px; padding: 0 28px; cursor: pointer; font-size: 16px; font-weight: 700; flex: none; min-width: 156px; }
.cagentacts { display: flex; flex-direction: column; gap: 6px; flex: none; min-width: 84px; }
.cact { flex: 1; min-height: 0; background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 10px; padding: 0 10px; cursor: pointer; font-size: 12px; font-weight: 700; }
.cact.compact { flex: 50; border-color: var(--ok); color: var(--ok); }
.cact.compact:hover { background: color-mix(in srgb, var(--ok) 18%, transparent); }
.cact.cancel { flex: 30; border-color: var(--err); color: var(--err); }
.cact.cancel:hover { background: color-mix(in srgb, var(--err) 18%, transparent); }
.cact.endtask { flex: 20; border-color: var(--warn2); color: var(--warn2); }
.cact.endtask:hover { background: color-mix(in srgb, var(--warn2) 18%, transparent); }
/* 手机页：工作流/提示条改为单行横向滚动，保证输入框与发送按钮始终有高度、不被挤出 */
.composer.phone { padding: 0 8px 8px; gap: 4px; }
.composer.phone:not(.min) { min-height: 148px; }
.composer.phone .cbar { height: 30px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.composer.phone .cbar::-webkit-scrollbar { display: none; }
.composer.phone .flowbar,
.composer.phone .chipbar { flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.composer.phone .flowbar::-webkit-scrollbar,
.composer.phone .chipbar::-webkit-scrollbar { display: none; }
.composer.phone .fgroup { flex: none; }
.composer.phone .chipstage { flex: none; flex-wrap: nowrap; max-height: none; overflow: visible; }
.composer.phone .chipextra { flex-wrap: nowrap; }
.composer.phone .stage { font-size: 13px; padding: 4px 14px; }
.composer.phone .chip { font-size: 12px; padding: 3px 12px; }
.composer.phone .cwrap { min-height: 46px; }
.composer.phone .cinput { padding: 30px 12px 8px 12px; font-size: 15px; }
.composer.phone .cbtn { font-size: 13px; padding: 3px 10px; line-height: 20px; }
.composer.phone .csend { min-width: 0; padding: 0 20px; font-size: 17px; }
.composer.phone .cact { font-size: 14px; }
.composer.phone .cagentacts { min-width: 72px; }
.cfgpop { position: absolute; top: calc(100% + 4px); left: 10px; z-index: 60; width: 280px; background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; box-shadow: 0 8px 26px rgba(0,0,0,.35); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.cfgrow { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--tx2); }
.cfgrow span { width: 62px; flex: none; }
.cfgrow input { flex: 1; min-width: 0; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 3px 6px; font-family: Consolas, monospace; font-size: 12px; }
.cfgacts { display: flex; align-items: center; gap: 10px; margin-top: 2px; }
.ghostcfg { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 2px 10px; cursor: pointer; font-size: 12px; }
.ghostcfg:disabled { opacity: .6; cursor: default; }
.ghostcfg.on:disabled { opacity: 1; background: var(--ac); color: var(--onac); border-color: var(--ac); }
.closecfg { color: var(--tx3); font-size: 12px; cursor: pointer; }
.chkrow { display: flex; align-items: flex-start; gap: 8px; color: var(--tx2); font-size: 12px; line-height: 1.6; }
.chkrow input { margin-top: 2px; cursor: pointer; }
.cfghint { color: var(--tx6); font-size: 11px; }
.cfghint.warn { color: var(--warn2); }
.assoc-exts { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.assoc-ext { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; font-family: Consolas, monospace; }
.assoc-ext input { cursor: pointer; }
.assoc-on { color: var(--ac2); }
.acfg.gear { flex: none; }
.setmask { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 200; display: flex; align-items: center; justify-content: center; }
.renamemask { position: fixed; inset: 0; z-index: 4000; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; cursor: wait; outline: none; }
.renamemask-box { display: inline-flex; align-items: center; gap: 10px; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; padding: 12px 20px; color: var(--tx1); font-size: 13px; box-shadow: 0 10px 34px rgba(0,0,0,.45); }
.renamemask-spin { width: 14px; height: 14px; flex: none; border: 2px solid color-mix(in srgb, var(--ac2) 35%, transparent); border-top-color: var(--ac2); border-radius: 50%; animation: renamemask-rotate .7s linear infinite; }
@keyframes renamemask-rotate { to { transform: rotate(360deg); } }
.setmodal { width: 1080px; max-width: 96vw; height: 92vh; max-height: 92vh; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 16px 48px rgba(0,0,0,.5); display: flex; flex-direction: column; overflow: hidden; }
.seth { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--bg4); color: var(--tx1); font-weight: 700; flex: none; }
.setx { background: none; border: none; color: var(--tx3); font-size: 16px; cursor: pointer; }
.setmain { flex: 1; display: flex; min-height: 0; }
.setnav { width: 168px; flex: none; border-right: 1px solid var(--bd2); padding: 10px 8px; display: flex; flex-direction: column; gap: 4px; background: var(--bg2); }
.setnav button { text-align: left; background: none; border: none; color: var(--tx2); font-size: 13px; padding: 9px 12px; cursor: pointer; border-radius: 6px; white-space: nowrap; }
.setnav button:hover { color: var(--tx1); background: var(--bg3); }
.setnav button.on { background: var(--ac); color: var(--onac); }
.setbody { flex: 1; min-width: 0; padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
.setsec { display: flex; flex-direction: column; gap: 6px; }
.aboutval { font-size: 13px; font-weight: 400; color: var(--tx1); white-space: nowrap; word-break: keep-all; }
.aboutrow { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.aboutk { color: var(--tx3); width: 74px; flex: none; }
.aboutv { color: var(--tx1); font-family: ui-monospace, Consolas, monospace; word-break: break-all; }
.aboutv.link { color: var(--ac2); text-decoration: none; cursor: pointer; }
.aboutv.link:hover { text-decoration: underline; }
.upgbtn { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 4px 12px; cursor: pointer; font-size: 12px; }
.upgbtn:hover { border-color: var(--ac); color: var(--ac); }
.upgbtn:disabled { opacity: .55; cursor: default; }
.wxqrlink { display: inline-block; line-height: 0; }
.aboutrow.wechat { align-items: flex-start; }
.aboutcol { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; min-width: 0; }
.wxqr { width: 104px; height: 104px; border: 1px solid var(--bd); border-radius: 6px; background: #fff; display: block; }
.license { margin: 0; padding: 10px 12px; background: var(--bg3); border: 1px solid var(--bd); border-radius: 6px; color: var(--tx2); font-size: 11px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow: auto; }
.licnote { color: var(--warn2); font-size: 12px; line-height: 1.6; }
.settitle { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 700; color: var(--tx2); }
.agentrow { display: flex; align-items: center; gap: 8px; }
.agentrow .ghostcfg { flex: none; }
.agentrow .setbtn { min-width: 76px; }
.agentrow .delbtn { min-width: 48px; }
.ainput { background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 4px 8px; font-size: 12px; min-width: 0; }
.aname { width: 110px; flex: none; }
.acmd { flex: 1; font-family: Consolas, monospace; }
.setf { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--bd2); flex: none; }
.newmodal { width: 420px; max-width: 92vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 16px 48px rgba(0,0,0,.5); overflow: hidden; }
.newlist { display: flex; flex-direction: column; padding: 8px; gap: 4px; }
.newitem { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: none; border: 1px solid var(--bd); color: var(--tx1); border-radius: 6px; padding: 8px 12px; cursor: pointer; text-align: left; }
.newitem:hover { border-color: var(--ac2); background: color-mix(in srgb, var(--ac) 8%, transparent); }
.newitem.on { border-color: var(--ac); background: color-mix(in srgb, var(--ac) 16%, transparent); }
.newname { padding: 10px 12px 0; }
.newname-input { width: 100%; box-sizing: border-box; background: var(--bg4); color: var(--tx1); border: 1px solid var(--bd); border-radius: 6px; padding: 7px 10px; font-size: 13px; outline: none; }
.newname-input:focus { border-color: var(--ac2); }
.newname-hint { margin-top: 6px; color: var(--tx6); font-size: 11px; }
.renamehint { position: absolute; left: 50%; transform: translateX(-50%); bottom: 16px; z-index: 3000; background: var(--bg1); border: 1px solid var(--bd2); color: var(--tx1); border-radius: 6px; padding: 8px 16px; font-size: 13px; box-shadow: 0 8px 24px rgba(0,0,0,.4); }
.ni-label { font-size: 13px; font-weight: 600; }
.ni-cmd { color: var(--tx6); font-family: Consolas, monospace; font-size: 11px; }
.tabstrip { display: flex; align-items: center; gap: 2px; background: var(--bg2); border-bottom: 1px solid var(--bd); padding: 0 8px; height: 32px; overflow-x: auto; flex: none; }
.tab { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: none; color: var(--tx2); padding: 0 10px; height: 100%; cursor: pointer; border-right: 1px solid var(--bd); flex: none; max-width: 220px; }
.tab.active { background: color-mix(in srgb, var(--ac) 22%, var(--bg1)); color: var(--tx1); }
.tab .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dot.running { background: var(--ok); }
.dot.exited { background: var(--tx5); }
.file-ic { color: var(--ac2); font-size: 11px; }
.tab .x { color: var(--tx3); padding: 0 3px; }
.tab .x:hover { color: var(--err); }
.new { background: none; border: none; color: var(--ac2); cursor: pointer; flex: none; margin-left: 4px; }
.net { margin-left: auto; color: var(--warn); flex: none; }
.term-wrap { flex: 1; min-height: 0; position: relative; display: flex; }
.term-layer { flex: 1; padding: 2px 6px; overflow: hidden; min-height: 0; }
.copyfloat { position: absolute; top: 8px; right: 14px; z-index: 3; background: color-mix(in srgb, var(--bg4) 85%, transparent); border: 1px solid var(--bd); color: var(--tx3); border-radius: 6px; padding: 2px 8px; line-height: 18px; font-size: 11px; cursor: pointer; }
.copyfloat:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.copyfloat:disabled { opacity: .4; cursor: default; pointer-events: none; }
.file-layer { flex: 1; min-height: 0; overflow: hidden; }
.tool-layer { flex: 1; min-height: 0; overflow: hidden; }
.local-layer { flex: 1; min-height: 0; overflow: hidden; }
.local-empty { height: 100%; display: flex; align-items: center; justify-content: center; color: var(--tx4); font-size: 13px; }
.phone-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 0 24px; text-align: center; color: var(--tx4); font-size: 13px; background: var(--bg3); z-index: 2; }
.fgroup .gplay { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 0 5px; cursor: pointer; font-size: 10px; line-height: 16px; }
.fgroup .gplay.stop { color: var(--err); border-color: var(--err); }
.stic { margin-left: 3px; font-size: 10px; }
.stic.done { color: var(--ok); }
.stic.error { color: var(--err); }
.chipwrap { display: inline-flex; align-items: center; gap: 2px; }
.chip.done { color: var(--ok); }
.chip.error { color: var(--err); }
.rback { background: none; border: none; color: var(--warn2); cursor: pointer; font-size: 11px; padding: 0 2px; }
</style>
