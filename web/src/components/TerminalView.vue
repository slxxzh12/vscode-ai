<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, computed, nextTick } from 'vue';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { S2C } from '@devflow/shared';
import type { useTerminal } from '../useTerminal';
import type { useCenter } from '../useCenter';
import FilePreview from './FilePreview.vue';
import { useTheme } from '../theme';
import { nodeFp } from '../nodeKey';
import { useMessageHistory } from '../useMessageHistory';
import { t } from '../i18n';
import WorkflowEditor from './WorkflowEditor.vue';

const props = defineProps<{
  terminal: ReturnType<typeof useTerminal>;
  center: ReturnType<typeof useCenter>;
  projectId: string | null;
  detailToken?: number;
  detailPath?: string;
}>();
const { theme, isDark } = useTheme();

const hostRef = ref<HTMLDivElement | null>(null);
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let resizeObserver: ResizeObserver | null = null;
let dataSub: { dispose(): void } | null = null;
let unsubList: (() => void) | null = null;
let unsubCfg: (() => void) | null = null;
let autoTried = false;

const activeFile = computed(() => (props.center.active.value?.kind === 'file' ? props.center.active.value : null));
const isSessionView = computed(() => props.center.activeKind.value !== 'file');
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
  return !!sid && agentSids.value.has(sid);
});
const composerCollapsed = computed(() => composerMin.value);

function sessionState(id: string) {
  return props.terminal.state.sessions.find((s) => s.id === id)?.state || 'running';
}
function sessionLabel(id: string) {
  return props.terminal.state.sessions.find((s) => s.id === id)?.name || id;
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
const renamingId = ref<string | null>(null);
const renameValue = ref('');
let renameInputEl: HTMLInputElement | null = null;
function setRenameInput(el: unknown) { renameInputEl = (el as HTMLInputElement | null) || null; }
function startRename(tabId: string) {
  if (!tabId.startsWith('s:')) return;   // 仅会话页签支持重命名
  renamingId.value = tabId;
  renameValue.value = props.center.tabs.value.find((t) => t.id === tabId)?.label || '';
  void nextTick(() => { renameInputEl?.focus(); renameInputEl?.select(); });
}
function commitRename(tabId: string) {
  if (renamingId.value !== tabId) return;
  renamingId.value = null;
  const sid = tabId.slice(2);
  const name = renameValue.value.trim();
  const next = { ...tabNames.value };
  if (name) next[sid] = name; else delete next[sid];
  tabNames.value = next;
  persistTabNames();
  props.center.ensureSession(sid, tabLabel(sid), sessionState(sid));
  msgHistory.renameTab(sid, tabLabel(sid));   // 同步更新历史消息里记录的页签名
}
function cancelRename() { renamingId.value = null; }

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
const agentStarted = ref(false);
const agentCliReady = ref(false);   // agent CLI 是否已在固定会话里启动
let agentLaunching = false;         // 启动命令注入中，避免重复注入
let agentGen = 0;                   // 启动代际：切换项目重建会话后，作废旧会话遗留的延时注入
// 工作流 → opencode 自定义命令（可配置，按节点公钥指纹持久化）
const wfCmds = ref<Record<string, string>>({ dev: '/dev', test: '/test', doc: '/doc' });
const agentAtStart = ref('opencode');   // 启动固定会话时所用的 agent id
const settingsOpen = ref(false);
const editorOpen = ref(false);
const settingsTab = ref<'general' | 'about'>('general');
const serverPort = ref<number | null>(null);
const portMsg = ref('');
async function loadSettings() {
  try {
    const r = await fetch('/api/settings').then((x) => x.json());
    serverPort.value = r?.settings?.port ?? r?.currentPort ?? null;
  } catch { /* ignore */ }
}
async function savePort() {
  portMsg.value = '';
  const p = Number(serverPort.value);
  if (!p || p < 1 || p > 65535) { portMsg.value = t('term.port_invalid'); return; }
  try {
    const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port: p }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    portMsg.value = t('term.port_saved');
  } catch (e: any) { portMsg.value = t('term.save_failed', { msg: e?.message || e }); }
}
function onOpenSettings() { settingsOpen.value = true; loadSettings(); }

// 新建会话：先选择要执行的命令（终端 cmd / 各 Agent），3 秒后自动执行选中项
const newOpen = ref(false);
const newSelected = ref('cmd');
const newCountdown = ref(3);
let newTimer: ReturnType<typeof setInterval> | null = null;
const newChoices = computed(() => [
  { id: 'cmd', label: t('term.new_cmd'), cmd: '' },
  ...agents.value.map((a) => ({ id: a.id, label: a.name, cmd: a.cmd })),
]);
function stopNewTimer() { if (newTimer) { clearInterval(newTimer); newTimer = null; } }
function openNew() {
  const ids = newChoices.value.map((c) => c.id);
  newSelected.value = ids.includes(agentId.value) ? agentId.value : (ids[0] || 'cmd');
  newOpen.value = true;
  newCountdown.value = 3;
  stopNewTimer();
  newTimer = setInterval(() => {
    newCountdown.value -= 1;
    if (newCountdown.value <= 0) { stopNewTimer(); createNew(newSelected.value); }
  }, 1000);
}
function closeNew() { stopNewTimer(); newOpen.value = false; }
async function createNew(id: string) {
  stopNewTimer();
  newOpen.value = false;
  const c = newChoices.value.find((x) => x.id === id) || newChoices.value[0];
  const s = await props.terminal.createSession({ projectId: props.projectId, cols: 80, rows: 24 });
  if (c.cmd) markAgent(s.id);
  props.center.ensureSession(s.id, c.cmd ? `◈ ${c.label}` : c.label, s.state || 'running');
  props.terminal.switchTo(s.id);
  if (c.cmd) setTimeout(() => { props.terminal.input(`${c.cmd}`); setTimeout(() => props.terminal.input('\r'), 200); }, 1200);
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
    if (c.cmds) for (const k of ['dev', 'test', 'doc'] as const) if (typeof c.cmds[k] === 'string') wfCmds.value[k] = c.cmds[k];
  } catch { /* ignore */ }
}
function saveCfg() {
  if (!cfgLoaded) return;   // 避免加载前用默认值覆盖
  try { localStorage.setItem(cfgKey, JSON.stringify({ agentId: agentId.value, agents: agents.value, wf: wfKind.value, cmds: wfCmds.value })); } catch { /* ignore */ }
}
function resetCfg() {
  agents.value = defaultAgents.value.map((a) => ({ ...a }));
  agentId.value = defaultAgentId.value;
  wfKind.value = 'dev';
  wfCmds.value = { dev: '/dev', test: '/test', doc: '/doc' };
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
  if (agentSid.value && agentActive()) {
    props.terminal.switchTo(agentSid.value);
    return;
  }
  const gen = ++agentGen;
  const pid = props.projectId;
  const s = await props.terminal.createSession({ projectId: pid, cols: 80, rows: 24 });
  if (gen !== agentGen) return;   // 期间已再次切换项目/重建：丢弃本次结果
  agentSid.value = s.id;
  agentProjectId.value = pid;
  markAgent(s.id);
  agentStarted.value = true;
  agentCliReady.value = false;
  agentLaunching = false;
  agentAtStart.value = agentId.value;
  props.center.ensureSession(s.id, `◈ ${currentAgent.value.name}`, s.state || 'running');
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
  if (!agentSid.value || !agentActive()) return;
  if (agentProjectId.value === nid) return;
  void restartAgentForProject();
});
function sendAgentText(text: string) {
  if (!agentSid.value || !agentActive()) return;
  props.terminal.input(text);
  setTimeout(() => {
    if (!agentSid.value || !agentActive()) return;
    props.terminal.input('\r');
  }, 150);
}

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
        { id: 'deploy', label: t('termwf.deploy.label'), group: t('termwf.group.ops'), prompts: [t('termwf.deploy.prompt')] },
        { id: 'troubleshoot', label: t('termwf.troubleshoot.label'), group: t('termwf.group.ops'), prompts: [t('termwf.troubleshoot.prompt')] },
      ],
    },
    { id: 'test', label: t('termwf.testflow.title'), stages: [{ id: 'scope', label: t('termwf.testflow.scope'), prompts: [t('termwf.testflow.prompt')] }] },
    { id: 'doc', label: t('termwf.docflow.title'), stages: [{ id: 'scan', label: t('termwf.docflow.scan'), prompts: [t('termwf.docflow.prompt')] }] },
  ];
}
const wfDefs = ref<WfDef[]>(buildFallbackWf());
const composerText = ref('');
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

// 底部框高度（可上下拖动）+ 最小化
const COMPOSER_H_KEY = 'devflow-composer-h';
const composerH = ref(240);
const composerMin = ref(true);
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
// 当前是 Agent 会话才默认展开；其他（含未选中）默认最小化；用户仍可手动折叠/展开
watch([() => props.terminal.state.activeSessionId, agentSids], ([sid]) => {
  composerMin.value = !(sid && agentSids.value.has(sid));
});

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
const chips = computed<string[]>(() => {
  const st = curWf.value.stages.find((s) => s.id === activeStage.value) || curWf.value.stages[0];
  return st ? st.prompts : [];
});
function pickStage(s: StageDef) {
  activeStage.value = s.id;
  if (s.prompts.length) composerText.value = s.prompts[0];   // 阶段首句填入输入框
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
  if (!sid) { sendToAgent(t); return; }   // 没有任何会话时回退：启动 Agent 会话再发送
  props.terminal.input(t);
  setTimeout(() => {
    if (props.terminal.state.activeSessionId !== sid) return;
    props.terminal.input('\r');
  }, 150);
}
function submitComposer() {
  const t = composerText.value.trim();
  if (!t) return;
  composerText.value = '';
  const sid = props.terminal.state.activeSessionId;
  void msgHistory.push(t, sid ? { sessionId: sid, tabName: tabLabel(sid) } : {});
  sendToActive(t);
}
function onComposerKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComposer(); }
}
async function selectWf(id: string) {
  wfKind.value = id;
  await onWfChange();
}
async function onWfChange() {
  const first = curWf.value.stages[0];
  if (first) pickStage(first);
  runWorkflow();   // 切换工作流后仍自动起 agent 并执行对应命令
}
async function runWorkflow() {
  const cmd = wfCmds.value[wfKind.value] || '';
  if (!cmd) return;
  // Agent 变更时先重启固定会话
  if (agentSid.value && agentActive() && agentAtStart.value !== agentId.value) {
    props.terminal.killSession(agentSid.value);
    agentSid.value = null;
    agentCliReady.value = false;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (agentSid.value && agentActive()) {
    props.terminal.switchTo(agentSid.value);
    if (!agentCliReady.value) {
      // 会话在但 agent 尚未启动：先自动输入对应 agent，再送工作流命令
      launchAgentCmd();
      setTimeout(() => sendAgentText(cmd), 3600);
    } else {
      setTimeout(() => sendAgentText(cmd), 600);
    }
    return;
  }
  await startAgent();
  setTimeout(() => sendAgentText(cmd), 4400);
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
  dataSub = term.onData((d: string) => { props.terminal.input(d); });
  props.terminal.bindIO({
    output: (d) => term?.write(d),
    replay: (d) => { term?.clear(); term?.write(d); requestAnimationFrame(() => onResize()); },
  });
  watch(() => props.terminal.state.status, (s) => {
    if (s === 'reconnecting') term?.write('\x1b[33m' + t('term.disconnected') + '\x1b[0m\r\n');
  });
  const dims = () => { const d = fit?.proposeDimensions(); return { cols: d?.cols || 80, rows: d?.rows || 24 }; };
  unsubList = props.terminal.on(S2C.SESSION_LIST, () => {
    if (autoTried || props.terminal.state.activeSessionId) return;
    autoTried = true;
    const existing = props.terminal.state.sessions.find((s) => agentSids.value.has(s.id));
    if (existing) {
      agentSid.value = existing.id;                       // 重新挂载后绑定回固定 Agent 会话
      agentProjectId.value = existing.projectId ?? null;
      props.terminal.switchTo(existing.id);               // 复用已存在的 Agent 会话
      if (props.projectId && existing.projectId !== props.projectId) void restartAgentForProject();   // 项目已切换：换到当前目录
    } else startAgent();                                  // 默认先开一个默认 Agent 会话
  });
  unsubCfg = props.terminal.on(S2C.CONFIG_CHANGED, async () => {
    await loadAgents();
    loadCfg();
    loadWorkflows();
    loadSettings();
  });
}

// 会话列表 → 统一页签栏同步（保证顺序：会话在前，文件在后）
const knownSessions = ref<string[]>([]);
watch(() => props.terminal.state.sessions.map((s) => s.id), (ids) => {
  for (const id of ids) {
    props.center.ensureSession(id, tabLabel(id), sessionState(id));
  }
  for (const old of knownSessions.value) if (!ids.includes(old)) props.center.removeSession(old);
  knownSessions.value = ids;
  ensureAgentOrder();
}, { immediate: true });

// 页签自定义名加载/变更后，刷新已存在会话页签的显示名（覆盖加载时序差异）
watch(tabNames, () => {
  for (const s of props.terminal.state.sessions) {
    props.center.ensureSession(s.id, tabLabel(s.id), s.state || 'running');
  }
}, { deep: true });

// 激活会话变化 → 中心激活对应会话页签（新建/切换时回到终端视图）
watch(() => props.terminal.state.activeSessionId, (id) => {
  if (id) props.center.activateSession(id);
});
// 从文件视图切回终端时重排尺寸
watch(isSessionView, (v) => { if (v) requestAnimationFrame(() => onResize()); });

function onResize() {
  if (!term || !fit) return;
  fit.fit();
  const d = fit.proposeDimensions();
  if (d) props.terminal.resize(d.cols, d.rows);
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

function onTabClick(id: string) {
  const t = props.center.tabs.value.find((x) => x.id === id);
  if (!t) return;
  if (t.kind === 'session' && t.id.startsWith('s:')) {
    const sid = t.id.slice(2);
    props.center.activateSession(sid);  // 直接激活中心页签（避免 activeSessionId 未变导致 watcher 不触发）
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
    if (confirm(t('term.kill_confirm'))) { props.terminal.killSession(sid); }
  } else {
    props.center.closeById(id);
  }
}

watch([agentId, agents, wfKind, wfCmds], saveCfg, { deep: true });

onMounted(async () => {
  init();
  window.addEventListener('resize', onResize);
  window.addEventListener('df-open-agent-settings', onOpenSettings);
  window.addEventListener('df-fill-composer', onFillComposer);
  const fp = await nodeFp();
  cfgKey = `devflow-agent-cfg-${fp}`;
  agentSidsKey = `devflow-agent-sids-${fp}`;
  tabNamesKey = `devflow-tab-names-${fp}`;
  loadAgentSids();
  loadTabNames();
  await loadAgents();
  loadCfg();           // 本地已保存配置优先覆盖 API 默认
  cfgLoaded = true;
  loadWorkflows();
  loadComposerH();
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener('df-open-agent-settings', onOpenSettings);
  window.removeEventListener('df-fill-composer', onFillComposer);
  unsubList?.();
  unsubCfg?.();
  stopNewTimer();
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
        <div class="newlist">
          <button v-for="c in newChoices" :key="c.id" class="newitem" :class="{ on: newSelected === c.id }" @click="createNew(c.id)">
            <span class="ni-label">{{ c.label }}</span>
            <span class="ni-cmd">{{ c.cmd || $t('term.default_shell') }}</span>
          </button>
        </div>
        <div class="newhint">{{ $t('term.auto_start_in', { n: newCountdown }) }}</div>
      </div>
    </div>
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
          <div class="setsec">
            <div class="settitle">{{ $t('term.agent_list') }} <button class="ghostcfg" @click="addAgent">{{ $t('term.add') }}</button></div>
            <div v-for="a in agents" :key="a.id" class="agentrow">
              <input v-model="a.name" class="ainput aname" :placeholder="$t('term.name')" />
              <input v-model="a.cmd" class="ainput acmd" :placeholder="$t('term.agent_cmd_placeholder')" />
              <button class="ghostcfg setbtn" :class="{ on: a.id === agentId }" :disabled="a.id === agentId" @click="agentId = a.id">{{ a.id === agentId ? $t('term.is_default') : $t('term.set_default') }}</button>
              <button class="ghostcfg delbtn" :disabled="agents.length <= 1" @click="removeAgent(a.id)">{{ $t('term.delete') }}</button>
            </div>
            <div class="cfghint">{{ $t('term.agent_hint') }}</div>
          </div>
          <div class="setsec">
            <div class="settitle">{{ $t('term.service') }}</div>
            <div class="cfgrow"><span>{{ $t('term.port') }}</span><input v-model.number="serverPort" type="number" min="1" max="65535" placeholder="22222" /><button class="ghostcfg" @click="savePort">{{ $t('common.save') }}</button></div>
            <div v-if="portMsg" class="cfghint">{{ portMsg }}</div>
            <div class="cfghint">{{ $t('term.service_hint') }}</div>
          </div>
          </template>
          <template v-else>
            <div class="setsec">
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.author') }}</span><span class="aboutval">Samuel Tsang</span></div>
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.software') }}</span><span class="aboutv">{{ $t('term.about.name_value') }}</span></div>
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.location') }}</span><span class="aboutv">{{ $t('term.about.location_value') }}</span></div>
            </div>
            <div class="setsec">
              <div class="settitle">{{ $t('term.about.contacts_cn') }}</div>
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
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.email') }}</span><a class="aboutv link" href="mailto:914300336@qq.com">914300336@qq.com</a></div>
            </div>
            <div class="setsec">
              <div class="settitle">{{ $t('term.about.contacts_overseas') }}</div>
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.email') }}</span><a class="aboutv link" href="mailto:samuel.tsang@outlook.com">samuel.tsang@outlook.com</a></div>
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.tiktok') }}</span><span class="aboutv">slxxzh12</span></div>
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.instagram') }}</span><span class="aboutv">slxxzh12</span></div>
            </div>
            <div class="setsec">
              <div class="settitle">{{ $t('term.about.license') }}</div>
              <div class="aboutrow"><span class="aboutk">{{ $t('term.about.repo') }}</span><a class="aboutv link" href="https://gitee.com/slxxzh12/vscode-ai" target="_blank" rel="noopener">https://gitee.com/slxxzh12/vscode-ai</a></div>
              <div class="aboutrow"><span class="aboutk"></span><a class="aboutv link" href="https://github.com/slxxzh12/vscode-ai" target="_blank" rel="noopener">https://github.com/slxxzh12/vscode-ai</a></div>
              <pre class="license">{{ $t('term.about.mit') }}</pre>
              <div class="licnote">{{ $t('term.about.note') }}</div>
            </div>
          </template>
          </div>
        </div>
        <footer class="setf">
          <button class="ghostcfg" @click="resetCfg">{{ $t('term.restore_default') }}</button>
          <button class="ago" @click="settingsOpen = false">{{ $t('term.done') }}</button>
        </footer>
      </div>
    </div>
    <div class="tabstrip">
      <div v-for="t in center.tabs.value" :key="t.id" class="tab"
        :class="{ active: center.activeId.value === t.id }" @click="onTabClick(t.id)"
        @dblclick="t.kind === 'session' && startRename(t.id)">
        <span v-if="t.kind === 'session'" :class="['dot', sessionState(t.id.slice(2))]" />
        <span v-else class="file-ic">▤</span>
        <input v-if="renamingId === t.id" v-model="renameValue" class="rename-input"
          :ref="setRenameInput" :title="$t('term.tab_rename')"
          @click.stop @dblclick.stop @keyup.enter="commitRename(t.id)" @keyup.esc="cancelRename" @blur="commitRename(t.id)" />
        <span v-else class="nm" :title="t.kind === 'file' ? t.path : (t.label + ' — ' + $t('term.tab_rename'))">{{ t.label }}</span>
        <span v-if="t.id !== 's:' + agentSid" class="x" @click="onTabClose(t.id, $event)" @dblclick.stop>×</span>
      </div>
      <button class="new" @click="openNew">{{ $t('term.new_session_btn') }}</button>
      <span v-if="terminal.state.status === 'reconnecting'" class="net">{{ $t('app.reconnecting') }}</span>
    </div>

    <div v-show="isSessionView" class="term-layer" ref="hostRef" />
    <div v-show="!isSessionView" class="file-layer">
      <FilePreview v-if="activeFile && activeFile.projectId && activeFile.path"
        :key="activeFile.id" :project-id="activeFile.projectId" :path="activeFile.path" :name="activeFile.label"
        :detail-token="detailToken" :detail-path="detailPath" />
    </div>

    <div v-if="isSessionView" class="composer" :class="{ light: !isDark, min: composerCollapsed }" :style="{ height: (composerCollapsed ? 40 : composerH) + 'px' }">
      <div class="cbar" @mousedown="onComposerDragDown">
        <div v-if="activeIsAgent" class="wfbtns" @mousedown.stop>
          <button v-for="w in wfDefs" :key="w.id" class="wfbtn" :class="{ on: wfKind === w.id }" @click="selectWf(w.id)">{{ w.label }}</button>
          <button class="wfbtn edit" :title="$t('wfe.title')" @click="editorOpen = true">✎</button>
        </div>
        <button class="cmin" :title="composerCollapsed ? $t('term.composer_expand') : $t('term.composer_min')" @mousedown.stop @click="composerMin = !composerMin">{{ composerCollapsed ? '❐' : '—' }}</button>
      </div>
      <template v-if="!composerCollapsed">
        <div v-if="activeIsAgent" class="flowbar">
          <template v-for="(g, gi) in stageGroups" :key="gi">
            <div class="fgroup">
              <span v-if="g.name" class="fglabel">{{ g.name }}</span>
              <template v-for="(s, i) in g.stages" :key="s.id">
                <button class="stage" :class="{ on: activeStage === s.id }" @click="pickStage(s)">{{ s.label }}</button>
                <span v-if="i < g.stages.length - 1" class="flowline" />
              </template>
            </div>
            <span v-if="gi < stageGroups.length - 1" class="fgap" />
          </template>
        </div>
        <div v-if="activeIsAgent && chips.length" class="chipbar" :title="$t('term.phase_hints')">
          <span class="chips-label">{{ $t('term.common') }}</span>
          <button
            v-for="(p, i) in chips"
            :key="i"
            class="chip"
            :class="{ on: composerText === p }"
            @click="composerText = p"
          ><span class="cdot" />{{ p }}</button>
        </div>
        <div class="cwrap">
          <div class="cinputwrap">
            <textarea
              v-model="composerText"
              class="cinput"
              :placeholder="$t('term.composer_placeholder')"
              @keydown="onComposerKey"
            />
            <button class="chist" :title="$t('term.history')" @mousedown.stop @click="openHistory">{{ $t('term.history') }}</button>
          </div>
          <button class="csend" @click="submitComposer">{{ $t('common.send') }}</button>
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
.chist { position: absolute; top: 6px; right: 8px; z-index: 2; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx3); border-radius: 6px; padding: 1px 8px; line-height: 18px; cursor: pointer; font-size: 11px; }
.chist:hover { border-color: var(--ac2); color: var(--ac2); }
.cmin { margin-left: auto; background: none; border: 1px solid transparent; color: var(--tx2); border-radius: 4px; width: 28px; height: 20px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 13px; }
.cmin:hover { background: color-mix(in srgb, var(--tx1) 14%, transparent); color: var(--tx1); }
.wfbtns { display: flex; gap: 0; flex: none; align-items: stretch; border-bottom: 2px solid transparent; }
.wfbtn { background: none; border: none; border-bottom: 2px solid transparent; color: var(--tx3); padding: 2px 12px 3px; cursor: pointer; font-size: 11px; }
.wfbtn:hover { color: var(--tx1); }
.wfbtn.on { color: var(--ac2); border-bottom-color: var(--ac2); font-weight: 700; }
.wfbtn.edit { padding: 2px 7px; color: var(--tx5); }
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
.chipbar { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 6px; flex: none; max-height: 84px; overflow-y: auto; }
.chips-label { color: var(--tx3); font-size: 11px; flex: none; margin-right: 2px; line-height: 20px; }
.chip { display: inline-flex; align-items: flex-start; gap: 5px; background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 12px; padding: 2px 10px; cursor: pointer; font-size: 11px; line-height: 16px; text-align: left; white-space: normal; max-width: 100%; }
.chip:hover { border-color: var(--ac2); color: var(--ac2); }
.chip.on { background: var(--ac); border-color: var(--ac); color: var(--onac); }
.cdot { width: 5px; height: 5px; margin-top: 5px; border-radius: 50%; background: var(--ac2); flex: none; }
.chip.on .cdot { background: var(--onac); }
.cinput { flex: 1; min-width: 0; height: 100%; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 10px; padding: 10px 86px 10px 14px; font-size: 13px; line-height: 1.6; outline: none; resize: none; font-family: inherit; }
.cinput:focus { border-color: var(--ac2); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ac2) 22%, transparent); }
.cinput::placeholder { color: var(--tx3); }
.csend { background: var(--window-ac, var(--ac)); color: var(--onac); border: none; border-radius: 10px; padding: 0 28px; cursor: pointer; font-size: 15px; font-weight: 700; flex: none; min-width: 100px; }
.cfgpop { position: absolute; top: calc(100% + 4px); left: 10px; z-index: 60; width: 280px; background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; box-shadow: 0 8px 26px rgba(0,0,0,.35); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.cfgrow { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--tx2); }
.cfgrow span { width: 62px; flex: none; }
.cfgrow input { flex: 1; min-width: 0; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 3px 6px; font-family: Consolas, monospace; font-size: 12px; }
.cfgacts { display: flex; align-items: center; gap: 10px; margin-top: 2px; }
.ghostcfg { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 2px 10px; cursor: pointer; font-size: 12px; }
.ghostcfg:disabled { opacity: .6; cursor: default; }
.ghostcfg.on:disabled { opacity: 1; background: var(--ac); color: var(--onac); border-color: var(--ac); }
.closecfg { color: var(--tx3); font-size: 12px; cursor: pointer; }
.cfghint { color: var(--tx6); font-size: 11px; }
.cfghint.warn { color: var(--warn2); }
.acfg.gear { flex: none; }
.setmask { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 200; display: flex; align-items: center; justify-content: center; }
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
.newhint { padding: 6px 14px 12px; color: var(--tx6); font-size: 12px; text-align: center; }
.ni-label { font-size: 13px; font-weight: 600; }
.ni-cmd { color: var(--tx6); font-family: Consolas, monospace; font-size: 11px; }
.tabstrip { display: flex; align-items: center; gap: 2px; background: var(--bg2); border-bottom: 1px solid var(--bd); padding: 0 8px; height: 32px; overflow-x: auto; flex: none; }
.tab { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: none; color: var(--tx2); padding: 0 10px; height: 100%; cursor: pointer; border-right: 1px solid var(--bd); flex: none; max-width: 220px; }
.tab.active { background: var(--bg3); color: var(--tx1); }
.tab .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab .rename-input { background: var(--bg4); color: var(--tx1); border: 1px solid var(--ac2); border-radius: 3px; padding: 1px 6px; font-size: 12px; min-width: 60px; max-width: 160px; outline: none; }
.tab .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dot.running { background: var(--ok); }
.dot.exited { background: var(--tx5); }
.file-ic { color: var(--ac2); font-size: 11px; }
.tab .x { color: var(--tx3); padding: 0 3px; }
.tab .x:hover { color: var(--err); }
.new { background: none; border: none; color: var(--ac2); cursor: pointer; flex: none; margin-left: 4px; }
.net { margin-left: auto; color: var(--warn); flex: none; }
.term-layer { flex: 1; padding: 2px 6px; overflow: hidden; min-height: 0; }
.file-layer { flex: 1; min-height: 0; overflow: hidden; }
</style>
