<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { S2C } from '@devflow/shared';
import type { useTerminal } from '../useTerminal';
import TerminalToolbar from './TerminalToolbar.vue';

const props = defineProps<{ terminal: ReturnType<typeof useTerminal>; projectId: string | null }>();

const hostRef = ref<HTMLDivElement | null>(null);
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let dataSub: { dispose(): void } | null = null;
let unsubList: (() => void) | null = null;
let autoTried = false;

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
  // 不盲建会话：等服务端回 list。仅当“无任何会话”时才自动建第一个，
  // 避免每次刷新重复生成（会话常驻服务端，刷新不该新增）。
  unsubList = props.terminal.on(S2C.SESSION_LIST, () => {
    if (!autoTried && !props.terminal.state.activeSessionId && props.terminal.state.sessions.length === 0) {
      autoTried = true;
      props.terminal.createSession({ projectId: props.projectId, ...dims() });
    }
  });
  if (props.terminal.state.activeSessionId) {
    props.terminal.switchTo(props.terminal.state.activeSessionId);
  }
}

function onResize() {
  if (!term || !fit) return;
  fit.fit();
  const d = fit.proposeDimensions();
  if (d) props.terminal.resize(d.cols, d.rows);
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
  <div class="terminal-wrap">
    <TerminalToolbar :terminal="terminal" :project-id="projectId" />
    <div ref="hostRef" class="terminal-host" />
  </div>
</template>

<style scoped>
.terminal-wrap { display: flex; flex-direction: column; height: 100%; background: #0e1116; }
.terminal-host { flex: 1; padding: 2px 6px; overflow: hidden; }
</style>
