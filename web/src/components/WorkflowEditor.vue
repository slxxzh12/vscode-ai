<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { t } from '../i18n';
import { sanitizeModel, validateModel, newWorkflow, type Workflow } from '../workflowModel';
import { serializeWorkflow, parseWorkflowsXml, sortWorkflows } from '@devflow/shared/workflow-xml';
import WorkflowFormTab from './WorkflowFormTab.vue';
import WorkflowXmlTab from './WorkflowXmlTab.vue';
import WorkflowPreviewTab from './WorkflowPreviewTab.vue';

const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>();
const tabs = ['form', 'xml', 'preview'] as const;
const model = ref<Workflow[]>([]);
const tab = ref<'form' | 'xml' | 'preview'>('form');
const busy = ref(false);
const msg = ref('');
const dirty = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const report = computed(() => validateModel(model.value));
const canSave = computed(() => report.value.errors.length === 0 && !busy.value);

const currentId = ref('');
const current = computed<Workflow | null>(() => model.value.find((w) => w.id === currentId.value) || model.value[0] || null);
watch(model, () => {
  if (!model.value.some((w) => w.id === currentId.value)) currentId.value = model.value[0]?.id || '';
}, { deep: true });

function applyWorkflow(wf: Workflow) {
  const next = model.value.slice();
  const i = next.findIndex((w) => w.id === wf.id);
  if (i >= 0) next[i] = wf; else next.push(wf);
  applyModel(sortWorkflows(next));
  currentId.value = wf.id;
}

// 左导航：新增工作流 / 删除整个工作流（选中态随增删保持有效）
function navAddWorkflow() {
  const wf = newWorkflow(t('wfe.new_workflow'));
  applyModel([...model.value, wf]);
  currentId.value = wf.id;
}
function navRemoveWorkflow(id: string) {
  if (!window.confirm(t('wfe.del_confirm'))) return;
  applyModel(model.value.filter((w) => w.id !== id));
}

const history = ref<string[]>([]);
const hIndex = ref(-1);

function pushHistory(snapshot: Workflow[]) {
  history.value = history.value.slice(0, hIndex.value + 1);
  history.value.push(JSON.stringify(snapshot));
  if (history.value.length > 50) history.value.shift();
  hIndex.value = history.value.length - 1;
}
function applyModel(next: Workflow[]) {
  if (JSON.stringify(next) === JSON.stringify(model.value)) return;
  pushHistory(next);
  model.value = next;
  dirty.value = true;
}
function undo() {
  if (hIndex.value <= 0) return;
  hIndex.value -= 1;
  model.value = JSON.parse(history.value[hIndex.value]);
  dirty.value = true;
}
function redo() {
  if (hIndex.value >= history.value.length - 1) return;
  hIndex.value += 1;
  model.value = JSON.parse(history.value[hIndex.value]);
  dirty.value = true;
}
function onKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
}

async function load() {
  try {
    const r = await fetch('/api/workflows-xml').then((x) => x.json());
    model.value = Array.isArray(r?.workflows) ? JSON.parse(JSON.stringify(r.workflows)) : [];
  } catch { model.value = []; }
  currentId.value = model.value[0]?.id || '';
  history.value = [JSON.stringify(model.value)];
  hIndex.value = 0;
  dirty.value = false;
}

async function save(): Promise<boolean> {
  if (report.value.errors.length) { msg.value = report.value.errors.map((e) => t(e.key, e.params)).join('；'); return false; }
  busy.value = true; msg.value = '';
  try {
    const payload = sanitizeModel(model.value);
    const res = await fetch('/api/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflows: payload }) });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.message || j.error || `HTTP ${res.status}`);
    if (Array.isArray(j.workflows)) {
      model.value = JSON.parse(JSON.stringify(j.workflows));
      history.value = [JSON.stringify(model.value)];
      hIndex.value = 0;
    }
    dirty.value = false;
    emit('saved');
    msg.value = t('wfe.saved');
    return true;
  } catch (e: any) { msg.value = t('wfe.failed', { msg: String(e?.message || e) }); return false; }
  finally { busy.value = false; }
}

function close() {
  if (dirty.value && !window.confirm(t('wfe.unsaved'))) return;
  emit('close');
}

function exportXml() {
  if (!current.value) return;
  try {
    const xml = serializeWorkflow(current.value) + '\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    a.download = `${current.value.id || 'workflow'}.xml`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e: any) { msg.value = t('wfe.failed', { msg: String(e?.message || e) }); }
}

function pickFile() { fileInput.value?.click(); }
async function onFile(e: Event) {
  const inp = e.target as HTMLInputElement;
  const f = inp.files?.[0];
  if (!f) return;
  const xml = await f.text();
  const wf = parseWorkflowsXml(xml)[0];
  if (!wf) { msg.value = t('wfe.failed', { msg: 'no workflow in file' }); inp.value = ''; return; }
  applyWorkflow(wf);
  emit('saved');
  msg.value = t('wfe.imported');
  inp.value = '';
}

onMounted(() => { load(); window.addEventListener('keydown', onKey); });
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="weoverlay">
    <div class="webox">
      <header class="weh">
        <span class="wtitle">{{ $t('wfe.title') }}</span>
        <nav class="tabs">
          <button v-for="k in tabs" :key="k" class="tab" :class="{ on: tab === k }" @click="tab = k">{{ $t('wfe.tab.' + k) }}</button>
        </nav>
        <button class="wex" @click="close">×</button>
      </header>
      <div class="web">
        <aside class="wenav">
          <div class="wnhead">
            <span class="wnlabel">{{ $t('pc.workflow') }}</span>
            <button class="wnadd" :title="$t('wfe.add_workflow')" @click="navAddWorkflow">＋</button>
          </div>
          <div class="wnlist">
            <button v-for="w in model" :key="w.id" class="wnitem" :class="{ on: w.id === currentId }" :title="w.id" @click="currentId = w.id">
              <span class="wnname">{{ w.label || w.id }}</span>
              <span class="wndel" :title="$t('wfe.del')" @click.stop="navRemoveWorkflow(w.id)">×</span>
            </button>
            <div v-if="model.length === 0" class="wnempty">{{ $t('wfe.preview.empty') }}</div>
          </div>
        </aside>
        <div class="wemain">
          <WorkflowFormTab v-if="tab === 'form'" :model="model" :active-id="currentId" @update:model="applyModel" />
          <WorkflowXmlTab v-else-if="tab === 'xml'" :workflow="current" @update:workflow="applyWorkflow" />
          <WorkflowPreviewTab v-else :model="model" />
        </div>
      </div>
      <footer class="wef">
        <span class="wemsg">{{ msg }}</span>
        <input ref="fileInput" type="file" accept=".xml,text/xml,application/xml" class="hidden" @change="onFile" />
        <button class="webtn" :disabled="busy" @click="pickFile">{{ $t('wfe.import_workflow') }}</button>
        <button class="webtn" :disabled="busy || !current" @click="exportXml">{{ $t('wfe.export_workflow') }}</button>
        <button class="webtn primary" :disabled="!canSave" @click="save">{{ $t('wfe.save') }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.weoverlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 60; }
.webox { width: 94vw; height: 90vh; max-width: 1600px; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 10px; box-shadow: 0 18px 50px rgba(0,0,0,.45); display: flex; flex-direction: column; overflow: hidden; }
.weh { display: flex; align-items: center; gap: 14px; padding: 10px 14px; background: var(--bg4); }
.wtitle { font-weight: 700; }
.tabs { display: flex; gap: 4px; margin-left: auto; }
.tab { background: none; border: 1px solid transparent; color: var(--tx3); border-radius: 4px; padding: 3px 12px; font-size: 12px; cursor: pointer; font-family: inherit; }
.tab.on { background: var(--bg1); border-color: var(--bd); color: var(--tx1); }
.wex { background: none; border: none; color: var(--tx3); font-size: 18px; cursor: pointer; }
.web { flex: 1; min-height: 0; display: flex; padding: 12px 14px; gap: 12px; }
.wenav { flex: none; width: 200px; display: flex; flex-direction: column; border: 1px solid var(--bd); border-radius: 6px; overflow: hidden; background: var(--bg2); }
.wnhead { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid var(--bd2); }
.wnlabel { font-size: 11px; text-transform: uppercase; color: var(--ac2); }
.wnadd { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; width: 22px; height: 22px; line-height: 1; cursor: pointer; font-size: 14px; }
.wnadd:hover { border-color: var(--ac2); color: var(--ac2); }
.wnlist { flex: 1; min-height: 0; overflow-y: auto; padding: 4px; }
.wnitem { display: flex; align-items: center; gap: 4px; width: 100%; background: none; border: 1px solid transparent; border-radius: 4px; color: var(--tx1); padding: 5px 6px; cursor: pointer; font-size: 12px; font-family: inherit; text-align: left; }
.wnitem:hover { background: var(--bg3); }
.wnitem.on { color: var(--ac2); border-color: var(--ac2); }
.wnname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wndel { flex: none; color: var(--tx5); font-size: 14px; line-height: 1; opacity: 0; }
.wnitem:hover .wndel { opacity: 1; }
.wndel:hover { color: var(--err); }
.wnempty { color: var(--tx6); font-size: 12px; padding: 12px 6px; }
.wemain { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; }
.wef { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--bd2); }
.wemsg { flex: 1; min-width: 0; color: var(--tx3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hidden { display: none; }
.wesched { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 14px; border-top: 1px solid var(--bd2); font-size: 12px; color: var(--tx2); }
.wechk { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.wesel, .wetime, .wenum { background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 6px; font-family: inherit; }
.wenum { width: 64px; }
.wewd { display: inline-flex; align-items: center; gap: 2px; }
.wedim { color: var(--tx5); }
.webtn { background: var(--bg5); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-family: inherit; }
.webtn:hover:not(:disabled) { border-color: var(--ac2); }
.webtn:disabled { opacity: .5; cursor: default; }
.webtn.primary { background: var(--ac); color: var(--onac); border-color: var(--ac); }
</style>
