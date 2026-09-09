<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { S2C } from '@devflow/shared';
import type { useTerminal } from '../useTerminal';
import type { useCenter } from '../useCenter';
import FilePreview from './FilePreview.vue';

const props = defineProps<{ terminal: ReturnType<typeof useTerminal>; center: ReturnType<typeof useCenter>; projectId: string | null }>();

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

function init() {
  if (!hostRef.value || term) return;
  term = new Terminal({
    cursorBlink: true, fontSize: 13, fontFamily: 'Consolas, "Courier New", monospace',
    theme: { background: '#0e1116', foreground: '#d5dae1' },
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
      props.terminal.createSession({ projectId: props.projectId, ...dims() });
    }
  });
}

// 会话列表 → 统一页签栏同步（保证顺序：会话在前，文件在后）
const knownSessions = ref<string[]>([]);
watch(() => props.terminal.state.sessions.map((s) => s.id), (ids) => {
  for (const id of ids) props.center.ensureSession(id, sessionLabel(id), sessionState(id));
  for (const old of knownSessions.value) if (!ids.includes(old)) props.center.removeSession(old);
  knownSessions.value = ids;
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

onMounted(() => {
  init();
  window.addEventListener('resize', onResize);
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
    <div class="tabstrip">
      <div v-for="t in center.tabs.value" :key="t.id" class="tab"
        :class="{ active: center.activeId.value === t.id }" @click="onTabClick(t.id)">
        <span v-if="t.kind === 'session'" :class="['dot', sessionState(t.id.slice(2))]" />
        <span v-else class="file-ic">▤</span>
        <span class="nm" :title="t.kind === 'file' ? t.path : t.label">{{ t.label }}</span>
        <span class="x" @click="onTabClose(t.id, $event)">×</span>
      </div>
      <button class="new" @click="terminal.createSession({ projectId, cols: 80, rows: 24 })">＋ 新建会话</button>
      <span v-if="terminal.state.status === 'reconnecting'" class="net">重连中…</span>
    </div>

    <div v-show="isSessionView" class="term-layer" ref="hostRef" />
    <div v-show="!isSessionView" class="file-layer">
      <FilePreview v-if="activeFile && activeFile.projectId && activeFile.path"
        :key="activeFile.id" :project-id="activeFile.projectId" :path="activeFile.path" :name="activeFile.label" />
    </div>
  </div>
</template>

<style scoped>
.center-wrap { display: flex; flex-direction: column; height: 100%; background: #0e1116; position: relative; }
.tabstrip { display: flex; align-items: center; gap: 2px; background: #141920; border-bottom: 1px solid #2a323e; padding: 0 8px; height: 32px; overflow-x: auto; flex: none; }
.tab { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: none; color: #9aa4b2; padding: 0 10px; height: 100%; cursor: pointer; border-right: 1px solid #2a323e; flex: none; max-width: 220px; }
.tab.active { background: #0e1116; color: #e6e9ef; }
.tab .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dot.running { background: #22c55e; }
.dot.exited { background: #64748b; }
.file-ic { color: #4c9aff; font-size: 11px; }
.tab .x { color: #5b6472; padding: 0 3px; }
.tab .x:hover { color: #fff; }
.new { background: none; border: none; color: #4c9aff; cursor: pointer; flex: none; margin-left: 4px; }
.net { margin-left: auto; color: #eab308; flex: none; }
.term-layer { flex: 1; padding: 2px 6px; overflow: hidden; min-height: 0; }
.file-layer { flex: 1; min-height: 0; overflow: hidden; }
</style>
