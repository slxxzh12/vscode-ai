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
const wfKind = ref<'dev' | 'test' | 'doc'>('dev');
const agentStarted = ref(false);
const agentCliReady = ref(false);   // agent CLI 是否已在固定会话里启动
// 工作流 → opencode 自定义命令（可配置，按节点公钥指纹持久化）
const wfCmds = ref<Record<'dev' | 'test' | 'doc', string>>({ dev: '/dev', test: '/test', doc: '/doc' });
const agentAtStart = ref('opencode');   // 启动固定会话时所用的 agent id
const settingsOpen = ref(false);
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
    if (c.wf === 'dev' || c.wf === 'test' || c.wf === 'doc') wfKind.value = c.wf;
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

// 常用提示语（底部类百度下拉：可输入筛选、选中填入，回车送进上方终端）
const PROMPTS: { label: string; text: string }[] = [
  { label: '需求澄清', text: '请使用 superpower brainstorm 来拆解下面需求：' },
  { label: '需求确认', text: '请使用 gstack 的 autoplan skills 对刚才输入的文档进行 review' },
];
const composerText = ref('');
const suggestOpen = ref(false);
const suggestions = computed(() => {
  const q = composerText.value.trim().toLowerCase();
  if (!q) return PROMPTS;
  return PROMPTS.filter((p) => (p.label + p.text).toLowerCase().includes(q));
});
function pickPrompt(text: string) { composerText.value = text; suggestOpen.value = false; }

// 阶段电子流：需求设计 → 需求 Review → 代码实现 → 开发自测 → 代码优化 → 环境部署
const STAGES: { key: string; label: string; prompt: string }[] = [
  { key: 'design', label: '需求设计', prompt: '进入「需求设计」阶段：请先澄清并输出需求文档（可用 superpower brainstorm 拆解），明确边界、非目标与验收标准。' },
  { key: 'design-review', label: '需求 Review', prompt: '进入「需求 Review」阶段：请使用 gstack 的 autoplan / plan-ceo-review / plan-eng-review 对需求文档做评审，指出缺口、歧义、风险与优先级建议。' },
  { key: 'code', label: '代码实现', prompt: '进入「代码实现」阶段：按需求文档实现，遵循仓库 AGENTS 约定，改完先跑测试与类型检查再继续。' },
  { key: 'test', label: '开发自测', prompt: '进入「开发自测」阶段：补齐并运行单元/集成测试与类型检查，做必要手工验证，报告结果、覆盖与风险。' },
  { key: 'optimize', label: '代码优化', prompt: '进入「代码优化」阶段：在不改变行为的前提下重构与优化（可读性/性能/去重/边界处理），每次改动后跑测试与类型检查确保不回归。' },
  { key: 'deploy', label: '环境部署', prompt: '进入「环境部署」阶段：给出构建/打包/发布步骤并执行，说明所需环境变量与回滚方案。' },
];
const activeStage = ref('');
function pickStage(s: { key: string; prompt: string }) {
  activeStage.value = s.key;
  sendToAgent(s.prompt);
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
  suggestOpen.value = false;
  sendToAgent(t);
}
function onComposerKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComposer(); }
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
  return dark
    ? { background: '#0e1116', foreground: '#d5dae1', cursor: '#6aa2ff', selectionBackground: '#2f6feb66' }
    : { background: '#ffffff', foreground: '#1f2937', cursor: '#2563eb', selectionBackground: '#93c5fd99' };
}
watch(isDark, (d) => { if (term) { term.options.theme = termTheme(d); requestAnimationFrame(() => onResize()); } });

function onTabClick(id: string) {
  const t = props.center.tabs.value.find((x) => x.id === id);
  if (!t) return;
  if (t.kind === 'session' && t.id.startsWith('s:')) {
    const sid = t.id.slice(2);
    props.terminal.switchTo(sid);       // 触发 activeSessionId watcher → activateSession
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
  const fp = await nodeFp();
  cfgKey = `devflow-agent-cfg-${fp}`;
  loadCfg();
  cfgLoaded = true;
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  unsubList?.();
  dataSub?.dispose();
  term?.dispose();
  term = null;
});
</script>

<template>
  <div class="center-wrap">
    <div class="agentbar">
      <button class="acfg gear" title="设置" @click.stop="settingsOpen = true">⚙</button>
      <span class="alab">Agent</span>
      <select v-model="agentId" class="asel">
        <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
      <span class="alab">工作流</span>
      <select v-model="wfKind" class="asel" @change="runWorkflow">
        <option value="dev">开发工作流</option>
        <option value="test">测试工作流</option>
        <option value="doc">文档工作流</option>
      </select>
      <button class="ago" @click="runWorkflow">▶ 启动/执行</button>
      <span class="ahint">首标签固定为 Agent 会话（不可关闭）</span>
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
      <button class="new" @click="terminal.createSession({ projectId, cols: 80, rows: 24 })">＋ 新建会话</button>
      <span v-if="terminal.state.status === 'reconnecting'" class="net">重连中…</span>
    </div>

    <div v-show="isSessionView" class="term-layer" ref="hostRef" />
    <div v-show="!isSessionView" class="file-layer">
      <FilePreview v-if="activeFile && activeFile.projectId && activeFile.path"
        :key="activeFile.id" :project-id="activeFile.projectId" :path="activeFile.path" :name="activeFile.label"
        :detail-token="detailToken" :detail-path="detailPath" />
    </div>

    <div v-if="isSessionView" class="composer">
      <div class="flowbar">
        <template v-for="(s, i) in STAGES" :key="s.key">
          <button class="stage" :class="{ on: activeStage === s.key }" @click="pickStage(s)">{{ s.label }}</button>
          <span v-if="i < STAGES.length - 1" class="flowline" />
        </template>
      </div>
      <div class="cwrap">
        <div v-if="suggestOpen && suggestions.length" class="suglist">
          <div v-for="p in suggestions" :key="p.label" class="sug" @mousedown.prevent="pickPrompt(p.text)">
            <span class="suglab">{{ p.label }}</span>
            <span class="sugtxt">{{ p.text }}</span>
          </div>
        </div>
        <textarea
          v-model="composerText"
          class="cinput"
          rows="3"
          placeholder="输入内容，回车送入上方 Agent 会话；Shift+Enter 换行；可输入关键字筛选常用提示语"
          @focus="suggestOpen = true"
          @input="suggestOpen = true"
          @keydown="onComposerKey"
          @blur="suggestOpen = false"
        />
        <button class="csend" @click="submitComposer">发送</button>
      </div>
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
.composer { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px 10px; background: var(--bg2); border-top: 1px solid var(--bd2); flex: none; }
.flowbar { display: flex; align-items: center; gap: 0; }
.stage { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 14px; padding: 3px 12px; cursor: pointer; font-size: 12px; }
.stage:hover { border-color: var(--ac2); color: var(--ac2); }
.stage.on { background: var(--ac); border-color: var(--ac); color: var(--onac); }
.flowline { flex: 1; height: 2px; min-width: 10px; background: linear-gradient(90deg, var(--ac2), var(--bd3)); margin: 0 4px; border-radius: 2px; }
.cwrap { position: relative; display: flex; align-items: flex-end; gap: 8px; }
.cinput { flex: 1; min-width: 0; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 8px; padding: 8px 12px; font-size: 12.5px; line-height: 1.5; outline: none; resize: vertical; font-family: inherit; min-height: 64px; }
.cinput:focus { border-color: var(--ac2); }
.csend { background: var(--ac); color: var(--onac); border: none; border-radius: 8px; padding: 8px 18px; cursor: pointer; font-size: 12px; font-weight: 600; flex: none; }
.suglist { position: absolute; left: 0; right: 80px; bottom: calc(100% + 4px); z-index: 80; max-height: 240px; overflow-y: auto; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 8px 26px rgba(0,0,0,.35); padding: 4px; }
.sug { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.sug:hover { background: var(--bg3); }
.suglab { color: var(--ac2); font-size: 12px; font-weight: 600; }
.sugtxt { color: var(--tx3); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
