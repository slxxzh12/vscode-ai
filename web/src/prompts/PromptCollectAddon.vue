<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { t } from '../i18n';
import { usePromptCollect, type CollectTarget } from './usePromptCollect';

const props = defineProps<{ text: string }>();
const pc = usePromptCollect();

const rootEl = ref<HTMLElement | null>(null);
const open = ref(false);
const selWf = ref('');

const workflows = computed(() => pc.workflows.value);
const hasWorkflows = computed(() => workflows.value.length > 0);
const stages = computed(() => {
  const w = workflows.value.find((x) => x.id === selWf.value);
  return w ? (w.stages || []) : [];
});

function wfLabel(id: string): string {
  const w = workflows.value.find((x) => x.id === id);
  return w ? (w.label || w.id) : id;
}
function stageLabel(wfId: string, stageId: string): string {
  const s = (workflows.value.find((x) => x.id === wfId)?.stages || []).find((y) => y.id === stageId);
  return s ? (s.label || s.id) : stageId;
}
function resolveWfId(): string {
  const lt = pc.lastTarget.value;
  if (lt && workflows.value.some((w) => w.id === lt.workflowId)) return lt.workflowId;
  const cur = pc.current.value;
  if (cur.workflowId && workflows.value.some((w) => w.id === cur.workflowId)) return cur.workflowId;
  return workflows.value[0]?.id || '';
}
const lastLabel = computed(() => {
  const lt = pc.lastTarget.value;
  if (!lt || !workflows.value.some((w) => w.id === lt.workflowId)) return '';
  return `${wfLabel(lt.workflowId)} / ${stageLabel(lt.workflowId, lt.stageId)}`;
});
const quickTitle = computed(() => {
  const lt = pc.lastTarget.value;
  if (lt && workflows.value.some((w) => w.id === lt.workflowId)) {
    return t('pc.quick', { wf: wfLabel(lt.workflowId), stage: stageLabel(lt.workflowId, lt.stageId) });
  }
  const cur = pc.current.value;
  if (cur.workflowId && cur.stageId) return t('pc.quick', { wf: wfLabel(cur.workflowId), stage: stageLabel(cur.workflowId, cur.stageId) });
  return t('pc.add');
});

function toast(status: string, target: CollectTarget | null) {
  if (status === 'ok' && target) {
    ElMessage.success(t('pc.ok', { wf: wfLabel(target.workflowId), stage: stageLabel(target.workflowId, target.stageId) }));
  } else if (status === 'exists') {
    ElMessage.warning(t('pc.exists', { stage: target ? stageLabel(target.workflowId, target.stageId) : '' }));
  } else if (status === 'no-workflow') {
    ElMessage.error(t('pc.no_workflows'));
  } else if (status === 'no-stage') {
    ElMessage.error(t('pc.no_stages'));
  } else {
    ElMessage.error(t('pc.failed', { msg: t('pc.network') }));
  }
}

async function quickAdd() {
  if (!hasWorkflows.value) { ElMessage.error(t('pc.no_workflows')); return; }
  const status = await pc.collect(props.text);
  toast(status, pc.lastTarget.value);
}
async function pick(target: CollectTarget) {
  const status = await pc.collect(props.text, target);
  toast(status, target);
  open.value = false;
}
async function toggle() {
  open.value = !open.value;
  if (!open.value) return;
  await pc.loadWorkflows();
  selWf.value = resolveWfId();
}
function onDocDown(e: MouseEvent) {
  if (!open.value) return;
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener('mousedown', onDocDown));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown));
</script>

<template>
  <span ref="rootEl" class="pcwrap">
    <span class="pcadd" :title="quickTitle" @mousedown.stop @click.stop="quickAdd">＋</span>
    <span class="pccaret" :title="$t('pc.choose')" @mousedown.stop @click.stop="toggle">▾</span>
    <div v-if="open" class="pcpanel" @mousedown.stop @click.stop>
      <template v-if="hasWorkflows">
        <div v-if="lastLabel" class="pclast" @click="pc.lastTarget.value && pick(pc.lastTarget.value)">{{ $t('pc.last_used') }}：{{ lastLabel }}</div>
        <div class="pccols">
          <div class="pccol">
            <div class="pch">{{ $t('pc.workflow') }}</div>
            <button v-for="w in workflows" :key="w.id" class="pcwf" :class="{ on: w.id === selWf }" @click="selWf = w.id">{{ w.label || w.id }}</button>
          </div>
          <div class="pccol">
            <div class="pch">{{ $t('pc.stage') }}</div>
            <button v-for="s in stages" :key="s.id" class="pcst" @click="pick({ workflowId: selWf, stageId: s.id })">{{ s.label || s.id }}</button>
            <div v-if="!stages.length" class="pcempty">{{ $t('pc.no_stages') }}</div>
          </div>
        </div>
      </template>
      <div v-else class="pcempty">{{ $t('pc.no_workflows') }}</div>
    </div>
  </span>
</template>

<style scoped>
.pcwrap { position: relative; display: inline-flex; align-items: center; flex: none; }
.pcadd, .pccaret { cursor: pointer; color: var(--tx5); user-select: none; line-height: 1; }
.pcadd { font-size: 13px; padding: 0 2px; }
.pcadd:hover { color: var(--ac2); }
.pccaret { font-size: 9px; padding: 0 1px; }
.pccaret:hover { color: var(--ac2); }
.pcpanel { position: absolute; bottom: 100%; left: 0; z-index: 70; margin-bottom: 4px; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.35); padding: 6px; min-width: 260px; font-size: 12px; }
.pclast { padding: 4px 6px; margin-bottom: 4px; border-bottom: 1px solid var(--bd2); color: var(--ac2); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pccols { display: flex; gap: 6px; }
.pccol { display: flex; flex-direction: column; gap: 2px; min-width: 110px; max-height: 220px; overflow-y: auto; }
.pch { color: var(--tx5); font-size: 11px; padding: 2px 4px; }
.pcwf, .pcst { text-align: left; background: none; border: 1px solid transparent; color: var(--tx2); border-radius: 4px; padding: 3px 6px; cursor: pointer; font-family: inherit; font-size: 12px; white-space: nowrap; }
.pcwf:hover, .pcst:hover { background: var(--bg3); }
.pcwf.on { color: var(--ac2); border-color: var(--ac2); }
.pcempty { color: var(--tx6); padding: 8px; }
</style>
