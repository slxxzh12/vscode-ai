<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { t } from '../i18n';
import { usePromptCollect } from './usePromptCollect';

const pc = usePromptCollect();
const workflows = pc.workflows;
const collapsed = ref<Set<string>>(new Set());

function toggle(wfId: string) {
  const next = new Set(collapsed.value);
  if (next.has(wfId)) next.delete(wfId); else next.add(wfId);
  collapsed.value = next;
}
function val(e: Event): string {
  return (e.target as HTMLInputElement | HTMLTextAreaElement).value;
}
function fail() { ElMessage.error(t('pc.failed', { msg: t('pc.network') })); }

async function addWorkflow() { if (!(await pc.addWorkflow())) fail(); }
async function removeWorkflow(wfId: string) {
  if (!window.confirm(t('pc.del_workflow_confirm'))) return;
  if (!(await pc.removeWorkflow(wfId))) fail();
}
async function renameWorkflow(wfId: string, label: string) { if (!(await pc.renameWorkflow(wfId, label))) fail(); }
async function addStage(wfId: string) { if (!(await pc.addStage(wfId))) fail(); }
async function removeStage(wfId: string, stageId: string) {
  if (!window.confirm(t('pc.del_stage_confirm'))) return;
  if (!(await pc.removeStage(wfId, stageId))) fail();
}
async function renameStage(wfId: string, stageId: string, label: string) { if (!(await pc.renameStage(wfId, stageId, label))) fail(); }
async function addPrompt(wfId: string, stageId: string) { if (!(await pc.addPrompt(wfId, stageId))) fail(); }
async function removePrompt(wfId: string, stageId: string, index: number) { if (!(await pc.removePrompt(wfId, stageId, index))) fail(); }
async function setPrompt(wfId: string, stageId: string, index: number, text: string) { if (!(await pc.setPrompt(wfId, stageId, index, text))) fail(); }

onMounted(() => { void pc.loadWorkflows(); });
</script>

<template>
  <div class="wlp">
    <div v-if="workflows.length === 0" class="empty">{{ $t('pc.empty') }}</div>
    <button class="wadd" @click="addWorkflow">{{ $t('pc.add_workflow') }}</button>
    <div v-for="w in workflows" :key="w.id" class="wcard">
      <div class="wrow">
        <button class="caret" @click="toggle(w.id)">{{ collapsed.has(w.id) ? '▸' : '▾' }}</button>
        <input class="wlabel" :value="w.label" :placeholder="$t('pc.new_workflow')"
          @change="renameWorkflow(w.id, val($event))" />
        <button class="wdel" :title="$t('pc.del_workflow')" @click="removeWorkflow(w.id)">−</button>
      </div>
      <template v-if="!collapsed.has(w.id)">
        <div v-for="s in w.stages" :key="s.id" class="scard">
          <div class="srow">
            <input class="slabel" :value="s.label" :placeholder="$t('pc.new_stage')"
              @change="renameStage(w.id, s.id, val($event))" />
            <button class="sadd" :title="$t('pc.add_prompt')" @click="addPrompt(w.id, s.id)">＋</button>
            <button class="sdel" :title="$t('pc.del_stage')" @click="removeStage(w.id, s.id)">−</button>
          </div>
          <div v-for="(p, pi) in s.prompts" :key="pi" class="prow">
            <textarea class="ptext" :value="p" :placeholder="$t('wfe.prompt')"
              @change="setPrompt(w.id, s.id, pi, val($event))" />
            <button class="pdel" :title="$t('pc.del_prompt')" @click="removePrompt(w.id, s.id, pi)">−</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wlp { display: flex; flex-direction: column; gap: 6px; }
.empty { color: var(--tx6); padding: 16px 12px; font-size: 12px; }
.wadd { align-self: flex-start; background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer; font-family: inherit; }
.wadd:hover { border-color: var(--ac2); color: var(--ac2); }
.wcard { border: 1px solid var(--bd); border-radius: 6px; padding: 6px; background: var(--bg2); display: flex; flex-direction: column; gap: 4px; }
.wrow, .srow, .prow { display: flex; gap: 4px; align-items: center; }
.caret { flex: none; width: 14px; background: none; border: none; color: var(--tx5); cursor: pointer; font-size: 10px; }
.wlabel { flex: 1; min-width: 0; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 6px; font-size: 12px; font-weight: 700; font-family: inherit; box-sizing: border-box; }
.slabel { flex: 1; min-width: 0; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 6px; font-size: 12px; font-family: inherit; box-sizing: border-box; }
.wlabel:focus, .slabel:focus, .ptext:focus { outline: none; border-color: var(--ac2); }
.wdel, .sdel, .pdel, .sadd { flex: none; background: none; border: 1px solid var(--bd); color: var(--tx5); border-radius: 4px; font-size: 12px; line-height: 1; padding: 2px 6px; cursor: pointer; }
.wdel:hover, .sdel:hover, .pdel:hover { color: var(--err); border-color: var(--err); }
.sadd:hover { color: var(--ac2); border-color: var(--ac2); }
.scard { border-left: 2px solid var(--bd); padding-left: 6px; display: flex; flex-direction: column; gap: 4px; }
.prow { align-items: flex-start; }
.ptext { flex: 1; min-width: 0; min-height: 28px; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 6px; font-size: 12px; font-family: inherit; box-sizing: border-box; resize: vertical; white-space: pre-wrap; }
</style>
