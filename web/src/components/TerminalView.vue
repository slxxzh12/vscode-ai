<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { S2C } from '@devflow/shared';
import type { useTerminal } from '../useTerminal';
import type { useCenter } from '../useCenter';
import FilePreview from './FilePreview.vue';
import { useTheme } from '../theme';
import { nodeFp } from '../nodeKey';

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
let dataSub: { dispose(): void } | null = null;
let unsubList: (() => void) | null = null;
let autoTried = false;

const activeFile = computed(() => (props.center.active.value?.kind === 'file' ? props.center.active.value : null));
const isSessionView = computed(() => props.center.activeKind.value !== 'file');

function sessionState(id: string) {
  return props.terminal.state.sessions.find((s) => s.id === id)?.state || 'running';
}
function sessionLabel(id: string) {
  return props.terminal.state.sessions.find((s) => s.id === id)?.name || id;
}

// —— 固定 Agent 首标签：交互式 Agent（列表可配置）+ 工作流（跑 opencode 自定义命令）——
interface AgentDef { id: string; name: string; cmd: string; }
const DEFAULT_AGENTS: AgentDef[] = [
  { id: 'opencode', name: 'OpenCode', cmd: 'opencode' },
  { id: 'claudecode', name: 'ClaudeCode', cmd: 'claudecode' },
];
const agentSid = ref<string | null>(null);
const agents = ref<AgentDef[]>(DEFAULT_AGENTS.map((a) => ({ ...a })));
const agentId = ref('opencode');
const currentAgent = computed(() => agents.value.find((a) => a.id === agentId.value) || agents.value[0] || { id: '', name: '-', cmd: 'opencode' });
const agentCmd = computed(() => currentAgent.value.cmd || 'opencode');
const wfKind = ref<string>('dev');
const agentStarted = ref(false);
const agentCliReady = ref(false);   // agent CLI 是否已在固定会话里启动
// 工作流 → opencode 自定义命令（可配置，按节点公钥指纹持久化）
const wfCmds = ref<Record<string, string>>({ dev: '/dev', test: '/test', doc: '/doc' });
const agentAtStart = ref('opencode');   // 启动固定会话时所用的 agent id
const settingsOpen = ref(false);
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
  if (!p || p < 1 || p > 65535) { portMsg.value = '端口需为 1-65535'; return; }
  try {
    const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port: p }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    portMsg.value = '已保存，重启服务后生效';
  } catch (e: any) { portMsg.value = `保存失败：${e?.message || e}`; }
}
function onOpenSettings() { settingsOpen.value = true; loadSettings(); }

// 新建会话：先选择要执行的命令（终端 cmd / 各 Agent）
const newOpen = ref(false);
const newChoices = computed(() => [
  { id: 'cmd', label: '终端（cmd / shell）', cmd: '' },
  ...agents.value.map((a) => ({ id: a.id, label: a.name, cmd: a.cmd })),
]);
async function createNew(id: string) {
  newOpen.value = false;
  const c = newChoices.value.find((x) => x.id === id) || newChoices.value[0];
  const s = await props.terminal.createSession({ projectId: props.projectId, cols: 80, rows: 24 });
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
      if (ok.length) agents.value = ok.map((a: any) => ({ id: a.id, name: a.name || a.id, cmd: a.cmd }));
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
  agents.value = DEFAULT_AGENTS.map((a) => ({ ...a }));
  agentId.value = 'opencode';
  wfKind.value = 'dev';
  wfCmds.value = { dev: '/dev', test: '/test', doc: '/doc' };
}
function addAgent() {
  agents.value.push({ id: `agent-${Date.now().toString(36)}`, name: '新 Agent', cmd: '' });
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
  const s = await props.terminal.createSession({ projectId: props.projectId, cols: 80, rows: 24 });
  agentSid.value = s.id;
  agentStarted.value = true;
  agentCliReady.value = false;
  agentAtStart.value = agentId.value;
  props.center.ensureSession(s.id, `◈ ${currentAgent.value.name}`, s.state || 'running');
  ensureAgentOrder();
  props.terminal.switchTo(s.id);
  setTimeout(() => launchAgentCmd(), 1200);
}
function launchAgentCmd() {
  if (!agentSid.value || !agentActive()) return;
  props.terminal.switchTo(agentSid.value);
  const cmd = agentCmd.value;
  // 先输入命令，稍后单独发回车（避免部分环境下 \r 未触发提交）
  props.terminal.input(cmd);
  setTimeout(() => {
    if (!agentSid.value || !agentActive()) return;
    props.terminal.input('\r');
    agentCliReady.value = true;
  }, 200);
}
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
const FALLBACK_WF: WfDef[] = [
  {
    id: 'dev', label: '开发工作流',
    stages: [
      { id: 'design', label: '需求设计', group: '需求', prompts: ['请使用 superpower brainstorm 来拆解下面需求：', '请澄清边界、非目标与验收标准。'] },
      { id: 'design-review', label: '需求 Review', group: '需求', prompts: ['请使用 gstack 的 autoplan skills 对刚才输入的文档进行 review'] },
      { id: 'code', label: '代码实现', group: '开发交付', prompts: ['请按需求文档实现功能，遵循仓库 AGENTS 约定，改完先跑测试与类型检查。'] },
      { id: 'optimize', label: '代码优化', group: '开发交付', prompts: ['请在不改变行为的前提下重构优化，每步跑测试确保不回归。'] },
      { id: 'test', label: '开发自测', group: '开发交付', prompts: ['请补齐并运行测试与类型检查，报告结果与风险。'] },
      { id: 'push-merge', label: 'Push&Merge 代码', group: '开发交付', prompts: ['请提交并 push 当前改动到当前分支，再合并到目标分支，写清提交信息。'] },
      { id: 'deploy', label: '环境部署', group: '交付运维', prompts: ['请给出构建/打包/发布步骤并执行，说明回滚方案。'] },
      { id: 'troubleshoot', label: '问题定位', group: '交付运维', prompts: ['请基于现象收集日志与复现步骤，列出可能原因并给出验证方法。'] },
    ],
  },
  { id: 'test', label: '测试工作流', stages: [{ id: 'scope', label: '测试范围', prompts: ['请梳理本次改动影响面，产出测试范围与优先级。'] }] },
  { id: 'doc', label: '文档工作流', stages: [{ id: 'scan', label: '盘点文档', prompts: ['请梳理本次改动需要更新哪些文档。'] }] },
];
const wfDefs = ref<WfDef[]>(FALLBACK_WF);
const composerText = ref('');
function fillPrompt(text: string) { composerText.value = text; }

// 底部框高度（可上下拖动）+ 最小化
const COMPOSER_H_KEY = 'devflow-composer-h';
const composerH = ref(240);
const composerMin = ref(false);
function loadComposerH() {
  try {
    const h = Number(localStorage.getItem(COMPOSER_H_KEY));
    if (h >= 120 && h <= 900) composerH.value = h;
  } catch { /* ignore */ }
}
function saveComposerH() { try { localStorage.setItem(COMPOSER_H_KEY, String(Math.round(composerH.value))); } catch { /* ignore */ } }
function onComposerDragDown(e: MouseEvent) {
  e.preventDefault();
  const startY = e.clientY;
  const startH = composerH.value;
  composerMin.value = false;
  const move = (ev: MouseEvent) => {
    const max = Math.max(200, window.innerHeight * 0.7);
    composerH.value = Math.min(max, Math.max(120, startH + (startY - ev.clientY)));
  };
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); saveComposerH(); };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

const curWf = computed<WfDef>(() => wfDefs.value.find((w) => w.id === wfKind.value) || wfDefs.value[0] || FALLBACK_WF[0]);
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
    if (!agentCliReady.value) {
      launchAgentCmd();
      setTimeout(() => sendAgentText(t), 3600);
    } else {
      setTimeout(() => sendAgentText(t), 150);
    }
    return;
  }
  await startAgent();
  setTimeout(() => sendAgentText(t), 4400);
}
function submitComposer() {
  const t = composerText.value.trim();
  if (!t) return;
  composerText.value = '';
  sendToAgent(t);
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
  dataSub = term.onData((d: string) => { props.terminal.input(d); });
  props.terminal.bindIO({
    output: (d) => term?.write(d),
    replay: (d) => { term?.clear(); term?.write(d); requestAnimationFrame(() => onResize()); },
  });
  watch(() => props.terminal.state.status, (s) => {
    if (s === 'reconnecting') term?.write('\x1b[33m-- 已断开，正在重连 --\x1b[0m\r\n');
  });
  const dims = () => { const d = fit?.proposeDimensions(); return { cols: d?.cols || 80, rows: d?.rows || 24 }; };
  unsubList = props.terminal.on(S2C.SESSION_LIST, () => {
    if (!autoTried && !props.terminal.state.activeSessionId && props.terminal.state.sessions.length === 0) {
      autoTried = true;
      startAgent();   // 首标签固定为 Agent 会话（opencode/claudecode）
    }
  });
}

// 会话列表 → 统一页签栏同步（保证顺序：会话在前，文件在后）
const knownSessions = ref<string[]>([]);
watch(() => props.terminal.state.sessions.map((s) => s.id), (ids) => {
  for (const id of ids) {
    const lbl = id === agentSid.value ? `◈ ${currentAgent.value.name}` : sessionLabel(id);
    props.center.ensureSession(id, lbl, sessionState(id));
  }
  for (const old of knownSessions.value) if (!ids.includes(old)) props.center.removeSession(old);
  knownSessions.value = ids;
  ensureAgentOrder();
}, { immediate: true });

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
  const t = props.center.tabs.value.find((x) => x.id === id);
  if (!t) return;
  if (t.kind === 'session' && t.id.startsWith('s:')) {
    const sid = t.id.slice(2);
    if (confirm('结束该会话？')) { props.terminal.killSession(sid); }
  } else {
    props.center.closeById(id);
  }
}

watch([agentId, agents, wfKind, wfCmds], saveCfg, { deep: true });

onMounted(async () => {
  init();
  window.addEventListener('resize', onResize);
  window.addEventListener('df-open-agent-settings', onOpenSettings);
  const fp = await nodeFp();
  cfgKey = `devflow-agent-cfg-${fp}`;
  loadCfg();
  cfgLoaded = true;
  loadWorkflows();
  loadComposerH();
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  window.removeEventListener('df-open-agent-settings', onOpenSettings);
  unsubList?.();
  dataSub?.dispose();
  term?.dispose();
  term = null;
});
</script>

<template>
  <div class="center-wrap">

    <div v-if="newOpen" class="setmask" @click.self="newOpen = false">
      <div class="newmodal">
        <header class="seth"><span>新建会话 —— 选择要执行的命令</span><button class="setx" @click="newOpen = false">×</button></header>
        <div class="newlist">
          <button v-for="c in newChoices" :key="c.id" class="newitem" @click="createNew(c.id)">
            <span class="ni-label">{{ c.label }}</span>
            <span class="ni-cmd">{{ c.cmd || '默认 shell' }}</span>
          </button>
        </div>
      </div>
    </div>
    <div v-if="settingsOpen" class="setmask" @click.self="settingsOpen = false">
      <div class="setmodal">
        <header class="seth">
          <span>设置</span>
          <button class="setx" @click="settingsOpen = false">×</button>
        </header>
        <div class="setbody">
          <div class="setsec">
            <div class="settitle">Agent 列表 <button class="ghostcfg" @click="addAgent">＋ 新增</button></div>
            <div v-for="a in agents" :key="a.id" class="agentrow">
              <input v-model="a.name" class="ainput aname" placeholder="名称" />
              <input v-model="a.cmd" class="ainput acmd" placeholder="启动命令，如 opencode" />
              <button class="ghostcfg" :class="{ on: a.id === agentId }" :disabled="a.id === agentId" @click="agentId = a.id">{{ a.id === agentId ? '当前' : '设为当前' }}</button>
              <button class="ghostcfg" :disabled="agents.length <= 1" @click="removeAgent(a.id)">删除</button>
            </div>
            <div class="cfghint">启动命令会作为该固定会话的第一条命令输入（如 opencode / claudecode）。</div>
          </div>
          <div class="setsec">
            <div class="settitle">工作流命令（opencode command/）</div>
            <div class="cfgrow"><span>开发命令</span><input v-model="wfCmds.dev" placeholder="/dev" /></div>
            <div class="cfgrow"><span>测试命令</span><input v-model="wfCmds.test" placeholder="/test" /></div>
            <div class="cfgrow"><span>文档命令</span><input v-model="wfCmds.doc" placeholder="/doc" /></div>
          </div>
          <div class="setsec">
            <div class="settitle">服务</div>
            <div class="cfgrow"><span>启动端口</span><input v-model.number="serverPort" type="number" min="1" max="65535" placeholder="3001" /><button class="ghostcfg" @click="savePort">保存</button></div>
            <div v-if="portMsg" class="cfghint">{{ portMsg }}</div>
            <div class="cfghint">写入 config/server.json；端口修改需重启服务后生效（可用环境变量 DEVFLOW_PORT 覆盖）。</div>
          </div>
        </div>
        <footer class="setf">
          <button class="ghostcfg" @click="resetCfg">恢复默认</button>
          <button class="ago" @click="settingsOpen = false">完成</button>
        </footer>
      </div>
    </div>
    <div class="tabstrip">
      <div v-for="t in center.tabs.value" :key="t.id" class="tab"
        :class="{ active: center.activeId.value === t.id }" @click="onTabClick(t.id)">
        <span v-if="t.kind === 'session'" :class="['dot', sessionState(t.id.slice(2))]" />
        <span v-else class="file-ic">▤</span>
        <span class="nm" :title="t.kind === 'file' ? t.path : t.label">{{ t.label }}</span>
        <span v-if="t.id !== 's:' + agentSid" class="x" @click="onTabClose(t.id, $event)">×</span>
      </div>
      <button class="new" @click="newOpen = true">＋ 新建会话</button>
      <span v-if="terminal.state.status === 'reconnecting'" class="net">重连中…</span>
    </div>

    <div v-show="isSessionView" class="term-layer" ref="hostRef" />
    <div v-show="!isSessionView" class="file-layer">
      <FilePreview v-if="activeFile && activeFile.projectId && activeFile.path"
        :key="activeFile.id" :project-id="activeFile.projectId" :path="activeFile.path" :name="activeFile.label"
        :detail-token="detailToken" :detail-path="detailPath" />
    </div>

    <div v-if="isSessionView" class="composer" :class="{ light: !isDark, min: composerMin }" :style="{ height: (composerMin ? 40 : composerH) + 'px' }">
      <div class="cbar" @mousedown="onComposerDragDown">
        <div class="wfbtns" @mousedown.stop>
          <button v-for="w in wfDefs" :key="w.id" class="wfbtn" :class="{ on: wfKind === w.id }" @click="selectWf(w.id)">{{ w.label }}</button>
        </div>
        <button class="cmin" :title="composerMin ? '展开' : '最小化'" @mousedown.stop @click="composerMin = !composerMin">{{ composerMin ? '▲' : '▼' }}</button>
      </div>
      <template v-if="!composerMin">
        <div class="flowbar">
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
        <div class="cwrap">
          <textarea
            v-model="composerText"
            class="cinput"
            placeholder="输入内容，回车送入上方 Agent 会话；Shift+Enter 换行"
            @keydown="onComposerKey"
          />
          <button class="csend" @click="submitComposer">发送</button>
        </div>
      </template>
    </div>
  </div>
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
.cmin { margin-left: auto; }
.wfbtns { display: flex; gap: 0; flex: none; align-items: stretch; border-bottom: 2px solid transparent; }
.wfbtn { background: none; border: none; border-bottom: 2px solid transparent; color: var(--tx3); padding: 2px 12px 3px; cursor: pointer; font-size: 11px; }
.wfbtn:hover { color: var(--tx1); }
.wfbtn.on { color: var(--ac2); border-bottom-color: var(--ac2); font-weight: 700; }
.cmin { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 0 8px; line-height: 18px; cursor: pointer; font-size: 11px; }
.flowbar { display: flex; align-items: center; gap: 0; flex: none; flex-wrap: wrap; }
.fgroup { display: flex; align-items: center; gap: 0; border: 1px dashed color-mix(in srgb, var(--tx1) 45%, transparent); border-radius: 12px; padding: 2px 8px 2px 6px; margin: 2px 0; background: color-mix(in srgb, var(--ac) 3%, transparent); }
.fglabel { font-size: 10px; color: var(--tx4); margin-right: 6px; padding: 0 4px; border-right: 1px solid color-mix(in srgb, var(--tx1) 40%, transparent); white-space: nowrap; }
.fgap { width: 14px; flex: none; }
.stage { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 14px; padding: 3px 12px; cursor: pointer; font-size: 12px; }
.stage:hover { border-color: var(--ac2); color: var(--ac2); }
.stage.on { background: var(--ac); border-color: var(--ac); color: var(--onac); }
.flowline { flex: 1; height: 2px; min-width: 10px; background: linear-gradient(90deg, var(--ac2), var(--bd3)); margin: 0 4px; border-radius: 2px; }
.cwrap { position: relative; display: flex; align-items: stretch; gap: 8px; flex: 1; min-height: 0; }
.chipbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; flex: none; max-height: 56px; overflow-y: auto; }
.chips-label { color: var(--tx3); font-size: 11px; flex: none; margin-right: 2px; }
.chip { display: inline-flex; align-items: center; gap: 5px; background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 12px; padding: 2px 10px; cursor: pointer; font-size: 11px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip:hover { border-color: var(--ac2); color: var(--ac2); }
.cdot { width: 5px; height: 5px; border-radius: 50%; background: var(--ac2); flex: none; }
.cinput { flex: 1; min-width: 0; height: 100%; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 10px; padding: 10px 14px; font-size: 13px; line-height: 1.6; outline: none; resize: none; font-family: inherit; }
.cinput:focus { border-color: var(--ac2); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ac2) 22%, transparent); }
.cinput::placeholder { color: var(--tx3); }
.csend { background: var(--ac); color: var(--onac); border: none; border-radius: 10px; padding: 0 28px; cursor: pointer; font-size: 15px; font-weight: 700; flex: none; min-width: 100px; }
.cfgpop { position: absolute; top: calc(100% + 4px); left: 10px; z-index: 60; width: 280px; background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; box-shadow: 0 8px 26px rgba(0,0,0,.35); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.cfgrow { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--tx2); }
.cfgrow span { width: 62px; flex: none; }
.cfgrow input { flex: 1; min-width: 0; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 3px 6px; font-family: Consolas, monospace; font-size: 12px; }
.cfgacts { display: flex; align-items: center; gap: 10px; margin-top: 2px; }
.ghostcfg { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 2px 10px; cursor: pointer; font-size: 12px; }
.closecfg { color: var(--tx3); font-size: 12px; cursor: pointer; }
.cfghint { color: var(--tx6); font-size: 11px; }
.acfg.gear { flex: none; }
.setmask { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 200; display: flex; align-items: center; justify-content: center; }
.setmodal { width: 560px; max-width: 92vw; max-height: 84vh; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 16px 48px rgba(0,0,0,.5); display: flex; flex-direction: column; overflow: hidden; }
.seth { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--bg4); color: var(--tx1); font-weight: 700; flex: none; }
.setx { background: none; border: none; color: var(--tx3); font-size: 16px; cursor: pointer; }
.setbody { padding: 12px 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
.setsec { display: flex; flex-direction: column; gap: 6px; }
.settitle { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 700; color: var(--tx2); }
.agentrow { display: flex; align-items: center; gap: 8px; }
.ainput { background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 4px 8px; font-size: 12px; min-width: 0; }
.aname { width: 140px; flex: none; }
.acmd { flex: 1; font-family: Consolas, monospace; }
.setf { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--bd2); flex: none; }
.newmodal { width: 420px; max-width: 92vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 16px 48px rgba(0,0,0,.5); overflow: hidden; }
.newlist { display: flex; flex-direction: column; padding: 8px; gap: 4px; }
.newitem { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: none; border: 1px solid var(--bd); color: var(--tx1); border-radius: 6px; padding: 8px 12px; cursor: pointer; text-align: left; }
.newitem:hover { border-color: var(--ac2); background: color-mix(in srgb, var(--ac) 8%, transparent); }
.ni-label { font-size: 13px; font-weight: 600; }
.ni-cmd { color: var(--tx6); font-family: Consolas, monospace; font-size: 11px; }
.tabstrip { display: flex; align-items: center; gap: 2px; background: var(--bg2); border-bottom: 1px solid var(--bd); padding: 0 8px; height: 32px; overflow-x: auto; flex: none; }
.tab { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: none; color: var(--tx2); padding: 0 10px; height: 100%; cursor: pointer; border-right: 1px solid var(--bd); flex: none; max-width: 220px; }
.tab.active { background: var(--bg3); color: var(--tx1); }
.tab .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
