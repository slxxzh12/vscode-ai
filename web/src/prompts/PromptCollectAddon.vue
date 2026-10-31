<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { t } from '../i18n';
import { usePromptCollect, type CollectTarget } from './usePromptCollect';

const props = defineProps<{
  text: string;
  editable?: boolean;
  workflowId?: string;
  stageId?: string;
  promptIndex?: number;
}>();
const emit = defineEmits<{ (e: 'edited', text: string): void }>();
// 根节点是 fragment（触发区 + Teleport），需手动把外部 class 落到触发区上（如 HistoryList 的 .mpc）
defineOptions({ inheritAttrs: false });
const pc = usePromptCollect();

const rootEl = ref<HTMLElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
const open = ref(false);
const selWf = ref('');
// 面板 teleport 到 body 并固定定位：消息行 / chip 都处在 overflow:hidden|auto 的滚动容器里，
// 就地绝对定位会被裁掉，所以按触发点坐标算位置。
const panelStyle = ref<Record<string, string>>({});

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

function positionPanel() {
  const el = rootEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const width = Math.min(300, Math.max(200, window.innerWidth - 16));
  const margin = 8;
  const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
  const spaceBelow = window.innerHeight - r.bottom;
  const style: Record<string, string> = { left: `${left}px`, width: `${width}px` };
  if (spaceBelow < 280) style.bottom = `${Math.max(margin, window.innerHeight - r.top + 4)}px`;
  else style.top = `${r.bottom + 4}px`;
  panelStyle.value = style;
}

function toast(status: string, target: CollectTarget | null) {
  if (status === 'ok' && target) {
    ElMessage.success(t('pc.ok', { wf: wfLabel(target.workflowId), stage: stageLabel(target.workflowId, target.stageId) }));
  } else if (status === 'exists') {
    ElMessage.warning(t('pc.exists', { stage: target ? stageLabel(target.workflowId, target.stageId) : '' }));
  } else if (status === 'no-stage') {
    ElMessage.error(t('pc.no_stages'));
  } else {
    ElMessage.error(t('pc.failed', { msg: t('pc.network') }));
  }
}

async function quickAdd() {
  const status = await pc.collect(props.text);
  toast(status, pc.lastTarget.value);
}
function addToMine() { open.value = false; void quickAdd(); }
async function pick(target: CollectTarget) {
  const status = await pc.collect(props.text, target);
  toast(status, target);
  open.value = false;
}
function pickLast() { if (pc.lastTarget.value) void pick(pc.lastTarget.value); }
async function toggle() {
  open.value = !open.value;
  if (!open.value) return;
  positionPanel();
  await pc.loadWorkflows();
  selWf.value = resolveWfId();
  await nextTick();
  positionPanel();
}
function onDocDown(e: MouseEvent) {
  if (!open.value) return;
  const target = e.target as Node;
  if (rootEl.value?.contains(target) || panelEl.value?.contains(target)) return;
  open.value = false;
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') open.value = false; }

const editing = ref(false);
const draft = ref('');
const saving = ref(false);
function openEdit() {
  draft.value = props.text;
  editing.value = true;
}
async function saveEdit() {
  const text = draft.value;
  if (!text.trim()) { ElMessage.warning(t('pc.edit_empty')); return; }
  if (!props.workflowId || !props.stageId || props.promptIndex == null) { editing.value = false; return; }
  saving.value = true;
  try {
    const status = await pc.updatePrompt({ workflowId: props.workflowId, stageId: props.stageId }, props.promptIndex, text);
    if (status === 'ok') {
      ElMessage.success(t('pc.edit_saved'));
      editing.value = false;
      emit('edited', text);
    } else {
      ElMessage.error(t('pc.edit_failed', { msg: t('pc.network') }));
    }
  } finally {
    saving.value = false;
  }
}
onMounted(() => {
  document.addEventListener('mousedown', onDocDown);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', positionPanel);
  window.addEventListener('scroll', positionPanel, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown);
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', positionPanel);
  window.removeEventListener('scroll', positionPanel, true);
});
</script>

<template>
  <span ref="rootEl" v-bind="$attrs" class="pcwrap">
    <span v-if="editable" class="pcedit" :title="$t('pc.edit')" @mousedown.stop @click.stop="openEdit">✎</span>
    <span v-else class="pcadd" :title="quickTitle" @mousedown.stop @click.stop="quickAdd">＋</span>
    <span class="pccaret" :title="$t('pc.choose')" @mousedown.stop @click.stop="toggle">▾</span>
  </span>
  <Teleport to="body">
    <div v-if="open" ref="panelEl" class="pcpanel" :style="panelStyle" @mousedown.stop @click.stop>
      <template v-if="hasWorkflows">
        <div v-if="lastLabel" class="pclast" @click="pickLast">{{ $t('pc.last_used') }}：{{ lastLabel }}</div>
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
      <div v-else class="pcnone">
        <button class="pcaddmine" @click="addToMine">{{ $t('pc.add_to_mine') }}</button>
      </div>
    </div>
  </Teleport>
  <Teleport to="body">
    <el-dialog v-model="editing" :title="$t('pc.edit_title')" width="min(720px, 92vw)" append-to-body>
      <textarea v-model="draft" class="pcedita" rows="12" :placeholder="$t('pc.edit_ph')" @keydown.ctrl.enter.prevent="saveEdit" />
      <div class="pcedittip">{{ $t('pc.edit_tip') }}</div>
      <template #footer>
        <button class="pcbtn" @click="editing = false">{{ $t('common.cancel') }}</button>
        <button class="pcbtn primary" :disabled="saving" @click="saveEdit">{{ $t('common.save') }}</button>
      </template>
    </el-dialog>
  </Teleport>
</template>

<style scoped>
.pcwrap { position: relative; display: inline-flex; align-items: center; flex: none; }
.pcadd, .pccaret { cursor: pointer; color: var(--tx5); user-select: none; line-height: 1; }
.pcadd { font-size: 13px; padding: 0 2px; }
.pcadd:hover { color: var(--ac2); }
.pcedit { cursor: pointer; color: var(--tx5); user-select: none; line-height: 1; font-size: 12px; padding: 0 2px; }
.pcedit:hover { color: var(--ac2); }
.pccaret { font-size: 9px; padding: 0 1px; }
.pccaret:hover { color: var(--ac2); }
.pcpanel { position: fixed; z-index: 3000; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.35); padding: 6px; font-size: 12px; }
.pclast { padding: 4px 6px; margin-bottom: 4px; border-bottom: 1px solid var(--bd2); color: var(--ac2); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pccols { display: flex; gap: 6px; }
.pccol { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; max-height: 220px; overflow-y: auto; }
.pch { color: var(--tx5); font-size: 11px; padding: 2px 4px; }
.pcwf, .pcst { text-align: left; background: none; border: 1px solid transparent; color: var(--tx2); border-radius: 4px; padding: 3px 6px; cursor: pointer; font-family: inherit; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pcwf:hover, .pcst:hover { background: var(--bg3); }
.pcwf.on { color: var(--ac2); border-color: var(--ac2); }
.pcempty { color: var(--tx6); padding: 8px; }
.pcnone { padding: 4px; }
.pcaddmine { width: 100%; text-align: left; background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 5px 8px; cursor: pointer; font-family: inherit; font-size: 12px; }
.pcaddmine:hover { border-color: var(--ac2); color: var(--ac2); }
.pcedita { width: 100%; box-sizing: border-box; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 8px 10px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.5; resize: vertical; min-height: 180px; }
.pcedita:focus { outline: none; border-color: var(--ac2); }
.pcedittip { margin-top: 6px; color: var(--tx5); font-size: 11px; }
.pcbtn { background: var(--bg5); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 14px; cursor: pointer; font-family: inherit; font-size: 12px; }
.pcbtn:hover:not(:disabled) { border-color: var(--ac2); }
.pcbtn.primary { background: var(--ac); color: var(--onac); border-color: var(--ac); }
.pcbtn:disabled { opacity: .5; cursor: default; }
</style>
