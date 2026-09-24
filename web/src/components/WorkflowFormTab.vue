<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '../i18n';
import { promptAbbr } from '../prompts/promptCollect';
import CodeEditor from './CodeEditor.vue';
import {
  groupBands, moveItem, moveStageToIndex, duplicateWorkflow, duplicateStage,
  newWorkflow, newStage, validateModel,
  type Workflow, type WorkflowStage, type ModelIssue, type GroupBand,
} from '../workflowModel';

const props = defineProps<{ model: Workflow[]; activeId?: string }>();
const emit = defineEmits<{ (e: 'update:model', m: Workflow[]): void }>();

type Drag =
  | { kind: 'workflow'; index: number }
  | { kind: 'stage'; wfIndex: number; index: number }
  | { kind: 'prompt'; wfIndex: number; stageIndex: number; index: number };

const drag = ref<Drag | null>(null);
const report = computed(() => validateModel(props.model));
// 展示行：未指定 activeId 时展示全部；指定则只展示该工作流（保留原模型下标供增删改回写）
const rows = computed(() => props.model
  .map((w, wi) => ({ w, wi }))
  .filter(({ w }) => !props.activeId || w.id === props.activeId));
const errAt = computed(() => {
  const map = new Map<string, ModelIssue>();
  for (const e of report.value.errors) map.set(e.path, e);
  return map;
});
const warnAt = computed(() => {
  const map = new Map<string, ModelIssue>();
  for (const e of report.value.warnings) map.set(e.path, e);
  return map;
});

function val(e: Event): string {
  return (e.target as HTMLInputElement | HTMLTextAreaElement).value;
}
function emitModel(next: Workflow[]) { emit('update:model', next); }
function wfPath(wi: number) { return `workflow[${wi}]`; }
function stPath(wi: number, si: number) { return `${wfPath(wi)}.stage[${si}]`; }
function issueText(i?: ModelIssue) { return i ? t(i.key, i.params) : ''; }

function onDragStart(e: DragEvent, d: Drag) {
  drag.value = d;
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', JSON.stringify(d)); }
}
function onDragEnd() { drag.value = null; }

function updateStages(wi: number, stages: WorkflowStage[]) {
  const next = props.model.slice(); next[wi] = { ...next[wi], stages }; emitModel(next);
}
function setWorkflowLabel(wi: number, value: string) {
  const next = props.model.slice(); next[wi] = { ...next[wi], label: value }; emitModel(next);
}
function setWorkflowId(wi: number, value: string) {
  const next = props.model.slice(); next[wi] = { ...next[wi], id: value }; emitModel(next);
}
function addWorkflow() { emitModel([...props.model, newWorkflow(t('wfe.new_workflow'))]); }
function removeWorkflow(wi: number) {
  if (!window.confirm(t('wfe.del_confirm'))) return;
  emitModel(props.model.filter((_, i) => i !== wi));
}
function copyWorkflow(wi: number) { emitModel([...props.model, duplicateWorkflow(props.model[wi], t('wfe.dup_suffix'))]); }
function dropWorkflow(wi: number) {
  if (drag.value?.kind !== 'workflow') return;
  emitModel(moveItem(props.model, drag.value.index, wi));
  drag.value = null;
}

function setStage(wi: number, si: number, patch: Partial<WorkflowStage>) {
  const stages = props.model[wi].stages.map((s, i) => (i === si ? { ...s, ...patch } : s));
  updateStages(wi, stages);
}
function addStage(wi: number, group = '') {
  updateStages(wi, [...props.model[wi].stages, { ...newStage(t('wfe.new_stage')), group }]);
}
function removeStage(wi: number, si: number) {
  if (!window.confirm(t('wfe.del_confirm'))) return;
  updateStages(wi, props.model[wi].stages.filter((_, i) => i !== si));
}
function copyStage(wi: number, si: number) {
  const stages = props.model[wi].stages.slice();
  stages.splice(si + 1, 0, duplicateStage(stages[si]));
  updateStages(wi, stages);
}
function renameBand(wi: number, band: GroupBand, name: string) {
  const target = new Set(band.stages.map((s) => s.id));
  const stages = props.model[wi].stages.map((s) => (target.has(s.id) ? { ...s, group: name.trim() } : s));
  updateStages(wi, stages);
}
function promptBandRename(wi: number, band: GroupBand) {
  const v = window.prompt(t('wfe.group_rename_tip'), band.name || '');
  if (v === null) return;
  renameBand(wi, band, v);
}

function dropOnStage(wi: number, si: number) {
  if (drag.value?.kind !== 'stage' || drag.value.wfIndex !== wi) { drag.value = null; return; }
  const from = drag.value.index;
  const finalIndex = from < si ? si - 1 : si;
  updateStages(wi, moveStageToIndex(props.model[wi].stages, from, finalIndex, props.model[wi].stages[si].group || ''));
  drag.value = null;
}
function dropOnBand(wi: number, band: GroupBand) {
  if (drag.value?.kind !== 'stage' || drag.value.wfIndex !== wi) { drag.value = null; return; }
  const from = drag.value.index;
  const end = band.startIndex + band.stages.length;
  const finalIndex = from < end ? end - 1 : end;
  updateStages(wi, moveStageToIndex(props.model[wi].stages, from, finalIndex, band.name));
  drag.value = null;
}

function setPrompt(wi: number, si: number, pi: number, value: string) {
  const prompts = props.model[wi].stages[si].prompts.map((p, i) => (i === pi ? value : p));
  setStage(wi, si, { prompts });
}
function addPrompt(wi: number, si: number) {
  setStage(wi, si, { prompts: [...props.model[wi].stages[si].prompts, ''] });
}
function removePrompt(wi: number, si: number, pi: number) {
  setStage(wi, si, { prompts: props.model[wi].stages[si].prompts.filter((_, i) => i !== pi) });
}
function dropPrompt(wi: number, si: number, pi: number) {
  if (drag.value?.kind !== 'prompt' || drag.value.wfIndex !== wi || drag.value.stageIndex !== si) { drag.value = null; return; }
  setStage(wi, si, { prompts: moveItem(props.model[wi].stages[si].prompts, drag.value.index, pi) });
  drag.value = null;
}
</script>

<template>
  <div class="ft">
    <div v-if="report.errors.length" class="errbar">
      <div v-for="(e, i) in report.errors" :key="i">{{ issueText(e) }}</div>
    </div>
    <div v-else-if="report.warnings.length" class="warnbar">
      <div v-for="(e, i) in report.warnings" :key="i">{{ issueText(e) }}</div>
    </div>
    <div v-else class="okbar">{{ $t('wfe.valid') }}</div>

    <div v-for="row in rows" :key="row.w.id" class="wcard"
      :class="{ dragging: drag?.kind === 'workflow' && drag.index === row.wi }"
      @dragover.prevent @drop="dropWorkflow(row.wi)">
      <div class="wrow">
        <span class="handle" draggable="true" :title="$t('wfe.drag_hint')"
          @dragstart="onDragStart($event, { kind: 'workflow', index: row.wi })" @dragend="onDragEnd">⋮⋮</span>
        <input class="in wlabel" :value="row.w.label" :placeholder="$t('wfe.workflow_label')" @input="setWorkflowLabel(row.wi, val($event))" />
        <input class="in id" :value="row.w.id" :placeholder="$t('wfe.id_label')" @input="setWorkflowId(row.wi, val($event))" />
        <button class="mini" @click="copyWorkflow(row.wi)">{{ $t('wfe.duplicate') }}</button>
        <button class="mini danger" @click="removeWorkflow(row.wi)">{{ $t('wfe.del') }}</button>
      </div>
      <div v-if="errAt.get(wfPath(row.wi))" class="ln err">{{ issueText(errAt.get(wfPath(row.wi))) }}</div>
      <div v-else-if="warnAt.get(wfPath(row.wi))" class="ln warn">{{ issueText(warnAt.get(wfPath(row.wi))) }}</div>

      <div v-for="(band, bi) in groupBands(row.w.stages)" :key="bi" class="band"
        @dragover.prevent @drop="dropOnBand(row.wi, band)">
        <div class="bhead">
          <span class="bname" :class="{ unnamed: !band.name }" :title="$t('wfe.group_rename_tip')"
            @dblclick="promptBandRename(row.wi, band)">
            {{ band.name || $t('wfe.group_unnamed') }}
          </span>
          <button class="mini add" @click="addStage(row.wi, band.name)">{{ $t('wfe.add_stage') }}</button>
        </div>
        <div v-for="(s, sInBand) in band.stages" :key="s.id" class="scard"
          :class="{ dragging: drag?.kind === 'stage' && drag.wfIndex === row.wi && drag.index === band.startIndex + sInBand }"
          @dragover.prevent @drop.stop="dropOnStage(row.wi, band.startIndex + sInBand)">
          <div class="srow">
            <span class="handle" draggable="true" :title="$t('wfe.drag_hint')"
              @dragstart="onDragStart($event, { kind: 'stage', wfIndex: row.wi, index: band.startIndex + sInBand })" @dragend="onDragEnd">⋮⋮</span>
            <input class="in" :value="s.label" :placeholder="$t('wfe.stage_label')" @input="setStage(row.wi, band.startIndex + sInBand, { label: val($event) })" />
            <button class="mini" @click="copyStage(row.wi, band.startIndex + sInBand)">{{ $t('wfe.duplicate') }}</button>
            <button class="mini danger" @click="removeStage(row.wi, band.startIndex + sInBand)">{{ $t('wfe.del') }}</button>
          </div>
          <div v-if="errAt.get(stPath(row.wi, band.startIndex + sInBand))" class="ln err">{{ issueText(errAt.get(stPath(row.wi, band.startIndex + sInBand))) }}</div>
          <div v-else-if="warnAt.get(stPath(row.wi, band.startIndex + sInBand))" class="ln warn">{{ issueText(warnAt.get(stPath(row.wi, band.startIndex + sInBand))) }}</div>
          <div v-for="(p, pi) in s.prompts" :key="pi" class="prow"
            @dragover.prevent @drop.stop="dropPrompt(row.wi, band.startIndex + sInBand, pi)">
            <span class="handle" draggable="true" :title="$t('wfe.drag_hint')"
              @dragstart="onDragStart($event, { kind: 'prompt', wfIndex: row.wi, stageIndex: band.startIndex + sInBand, index: pi })" @dragend="onDragEnd">⋮</span>
            <span v-if="p.trim()" class="pabbr" :title="p">{{ promptAbbr(p) }}</span>
            <CodeEditor class="ta" :model-value="p" :placeholder="$t('wfe.prompt')" @change="setPrompt(row.wi, band.startIndex + sInBand, pi, $event)" />
            <button class="mini danger" @click="removePrompt(row.wi, band.startIndex + sInBand, pi)">×</button>
          </div>
          <button class="mini add" @click="addPrompt(row.wi, band.startIndex + sInBand)">{{ $t('wfe.add_prompt') }}</button>
        </div>
      </div>
    </div>
    <button v-if="!activeId" class="mini add big" @click="addWorkflow">{{ $t('wfe.add_workflow') }}</button>
  </div>
</template>

<style scoped>
.ft { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 4px; }
.errbar { background: color-mix(in srgb, var(--err) 12%, transparent); color: var(--err); border: 1px solid var(--err); border-radius: 6px; padding: 6px 10px; font-size: 12px; }
.warnbar { background: color-mix(in srgb, var(--warn, #d19a00) 12%, transparent); color: var(--warn, #d19a00); border: 1px solid var(--warn, #d19a00); border-radius: 6px; padding: 6px 10px; font-size: 12px; }
.okbar { color: var(--tx3); font-size: 12px; }
.wcard { border: 1px solid var(--bd); border-radius: 8px; padding: 10px; background: var(--bg2); display: flex; flex-direction: column; gap: 8px; }
.wcard.dragging, .scard.dragging { opacity: .5; }
.wrow { display: flex; gap: 8px; align-items: center; }
.handle { cursor: grab; color: var(--tx3); user-select: none; }
.band { border: 1px dashed var(--bd); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: var(--bg3); }
.bhead { display: flex; align-items: center; gap: 8px; }
.bname { font-size: 12px; color: var(--tx2); cursor: text; }
.bname.unnamed { color: var(--tx6); }
.scard { border: 1px solid var(--bd); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: var(--bg2); }
.srow, .prow { display: flex; gap: 6px; align-items: flex-start; }
.in { flex: 1; min-width: 0; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 12px; font-family: inherit; box-sizing: border-box; }
.in.wlabel { font-weight: 700; }
.in.id { flex: 0 0 150px; font-family: ui-monospace, Consolas, monospace; color: var(--tx3); }
.ta { flex: 1; min-width: 0; --cm-min: 56px; }
.in:focus, .ta:focus { outline: none; border-color: var(--ac2); }
.mini { flex: none; background: var(--bg5); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 8px; font-size: 11px; cursor: pointer; font-family: inherit; }
.mini:hover { border-color: var(--ac2); color: var(--tx1); }
.mini.danger:hover { border-color: var(--err); color: var(--err); }
.mini.add { align-self: flex-start; background: none; }
.mini.add.big { margin: 4px 0 8px; }
.ln { font-size: 11px; }
.ln.err { color: var(--err); }
.ln.warn { color: var(--warn, #d19a00); }
.pabbr { flex: none; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--tx3); align-self: center; }
</style>
