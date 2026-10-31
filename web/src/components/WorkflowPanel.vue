<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import type { useTerminal } from '../useTerminal';
import type { RunSnapshot, RunStep, WorkflowTemplate } from '@devflow/shared';
import { C2S, S2C } from '@devflow/shared';
import { t } from '../i18n';

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
  if (!activeSession()) { alert(t('wf.select_session')); return; }
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
        <button v-if="run.status === 'paused' || run.status === 'running'" class="btn primary" @click="next">{{ $t('wf.next') }}</button>
        <button v-if="run.status === 'paused' || run.status === 'running'" class="btn" @click="abort">{{ $t('wf.abort') }}</button>
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
        <span class="meta">{{ $t('wf.steps_meta', { steps: w.steps.length, auto: w.steps.filter((x) => x.advance === 'auto').length, manual: w.steps.filter((x) => x.advance === 'manual').length }) }}</span>
      </div>
      <div v-if="workflows.length === 0" class="empty">{{ $t('wf.empty') }}</div>
    </div>
    <div v-if="terminal.state.status !== 'open'" class="offline">{{ $t('wf.offline') }}</div>
  </div>
</template>

<style scoped>
.panel { position: absolute; top: 42px; right: 8px; width: 380px; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,.4); z-index: 30; overflow: hidden; }
.ph { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: var(--bg4); color: var(--tx1); }
.x { background: none; border: none; color: var(--tx3); cursor: pointer; font-size: 16px; }
.list, .run { padding: 8px; display: flex; flex-direction: column; gap: 6px; max-height: 60vh; overflow: auto; }
.wf { background: var(--bg2); border: 1px solid var(--bd); border-radius: 6px; padding: 8px 10px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
.wf:hover { border-color: var(--ac2); }
.meta, .hint { color: var(--tx3); font-size: 11px; }
.run-title { display: flex; align-items: center; gap: 8px; font-weight: 600; flex-wrap: wrap; }
.tag { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--bd); }
.tag.done { background: var(--okbg); color: var(--oktx); }
.tag.aborted { background: var(--errbg); color: var(--errtx); }
.tag.running { background: var(--ac); color: var(--onac); }
.tag.paused { background: var(--warnbg); color: var(--warn2); }
.btn { background: var(--bg5); color: var(--tx); border: none; border-radius: 4px; padding: 3px 10px; cursor: pointer; }
.btn.primary { background: var(--ac); color: var(--onac); }
.step { display: flex; gap: 8px; align-items: baseline; padding: 5px 8px; border-radius: 4px; color: var(--tx); }
.step.cur { background: var(--bg4); }
.step code { white-space: pre-wrap; word-break: break-all; }
.ic { width: 16px; color: var(--tx3); }
.ic.done { color: var(--ok); }
.ic.error { color: var(--err); }
.ic.manual { color: var(--warn2); }
.err { color: var(--errtx); font-size: 12px; padding: 4px 8px; background: var(--errbg); border-radius: 4px; }
.offline, .empty { color: var(--tx5); padding: 8px 12px; }
</style>
