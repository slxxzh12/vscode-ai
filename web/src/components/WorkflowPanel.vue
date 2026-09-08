<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import type { useTerminal } from '../useTerminal';
import type { RunSnapshot, RunStep, WorkflowTemplate } from '@devflow/shared';
import { C2S, S2C } from '@devflow/shared';

const props = defineProps<{ terminal: ReturnType<typeof useTerminal> }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const workflows = ref<WorkflowTemplate[]>([]);
const run = ref<RunSnapshot | null>(null);
const busy = ref(false);
const unsubs: Array<() => void> = [];

function icon(s: RunStep['status']) {
  return { waiting: '·', running: '▶', manual: '⏸', done: '✓', error: '✕' }[s] || '·';
}

unsubs.push(
  props.terminal.on(S2C.WF_LIST_RESULT, (m: any) => { workflows.value = m.workflows; }),
  props.terminal.on(S2C.WF_STARTED, (m: any) => { run.value = m.run; }),
  props.terminal.on(S2C.WF_STATUS, (m: any) => { run.value = m.run; }),
  props.terminal.on(S2C.WF_FINISHED, () => { busy.value = false; }),
);
onBeforeUnmount(() => { unsubs.forEach((u) => u()); });
watch(() => props.terminal.state.status, (s) => { if (s === 'open') props.terminal.send(C2S.WF_LIST); });
onMounted(() => props.terminal.send(C2S.WF_LIST));

function activeSession() { return props.terminal.state.activeSessionId; }

async function runWf(w: WorkflowTemplate) {
  if (!activeSession()) { alert('请先新建/选中一个终端会话'); return; }
  busy.value = true;
  run.value = null;
  props.terminal.send(C2S.WF_RUN, { workflowId: w.id, sessionId: activeSession() });
}
function next() { if (run.value) props.terminal.send(C2S.WF_NEXT, { runId: run.value.runId }); }
function abort() { if (run.value) props.terminal.send(C2S.WF_ABORT, { runId: run.value.runId }); }
</script>

<template>
  <div class="panel">
    <div class="ph">⚡ Workflows <button class="x" @click="emit('close')">×</button></div>
    <div v-if="run" class="run">
      <div class="run-title">{{ run.workflowName }}
        <span class="tag" :class="run.status">{{ run.status }}</span>
        <button v-if="run.status === 'paused' || run.status === 'running'" class="btn primary" @click="next">下一步 ▶</button>
        <button v-if="run.status === 'paused' || run.status === 'running'" class="btn" @click="abort">中止</button>
      </div>
      <div v-for="(s, i) in run.steps" :key="s.id" class="step" :class="{ cur: i === run.currentIndex }">
        <span class="ic" :class="s.status">{{ icon(s.status) }}</span>
        <code>{{ s.cmd }}</code>
        <span v-if="s.hint" class="hint">{{ s.hint }}</span>
      </div>
      <div v-if="run.errorMessage" class="err">⚠ {{ run.errorMessage }}</div>
    </div>
    <div v-else class="list">
      <div v-for="w in workflows" :key="w.id" class="wf" @click="runWf(w)">
        <b>{{ w.name }}</b>
        <span class="meta">{{ w.steps.length }} 步 · {{ w.steps.filter((x) => x.advance === 'auto').length }} 自动 / {{ w.steps.filter((x) => x.advance === 'manual').length }} 手动</span>
      </div>
      <div v-if="workflows.length === 0" class="empty">无模板（编辑 server/workflows.json）</div>
    </div>
    <div v-if="terminal.state.status !== 'open'" class="offline">连接已断开</div>
  </div>
</template>

<style scoped>
.panel { position: absolute; top: 42px; right: 8px; width: 380px; background: #1a1f27; border: 1px solid #2a323e; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,.5); z-index: 30; overflow: hidden; }
.ph { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #222932; color: #e6e9ef; }
.x { background: none; border: none; color: #8b96a5; cursor: pointer; font-size: 16px; }
.list, .run { padding: 8px; display: flex; flex-direction: column; gap: 6px; max-height: 60vh; overflow: auto; }
.wf { background: #141920; border: 1px solid #2a323e; border-radius: 6px; padding: 8px 10px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
.wf:hover { border-color: #4c9aff; }
.meta, .hint { color: #8b96a5; font-size: 11px; }
.run-title { display: flex; align-items: center; gap: 8px; font-weight: 600; flex-wrap: wrap; }
.tag { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: #2a323e; }
.tag.done { background: #14532d; color: #86efac; }
.tag.aborted { background: #7f1d1d; color: #fca5a5; }
.tag.running { background: #1e3a8a; color: #93c5fd; }
.tag.paused { background: #78350f; color: #fcd34d; }
.btn { background: #262c34; color: #c8d0da; border: none; border-radius: 4px; padding: 3px 10px; cursor: pointer; }
.btn.primary { background: #2f6feb; color: #fff; }
.step { display: flex; gap: 8px; align-items: baseline; padding: 5px 8px; border-radius: 4px; color: #c8d0da; }
.step.cur { background: #222932; }
.step code { white-space: pre-wrap; word-break: break-all; }
.ic { width: 16px; color: #8b96a5; }
.ic.done { color: #22c55e; }
.ic.error { color: #ef4444; }
.ic.manual { color: #fcd34d; }
.err { color: #fca5a5; font-size: 12px; padding: 4px 8px; background: #7f1d1d33; border-radius: 4px; }
.offline, .empty { color: #5b6472; padding: 8px 12px; }
</style>
