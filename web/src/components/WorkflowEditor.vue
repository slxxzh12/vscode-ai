<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { t } from '../i18n';

interface StageDef { id: string; label: string; prompts: string[]; group?: string; }
interface WfDef { id: string; label: string; stages: StageDef[]; }

const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>();
const workflows = ref<WfDef[]>([]);
const busy = ref(false);
const msg = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

async function load() {
  try {
    const r = await fetch('/api/workflows-xml').then((x) => x.json());
    workflows.value = Array.isArray(r?.workflows) ? JSON.parse(JSON.stringify(r.workflows)) : [];
  } catch { workflows.value = []; }
}
onMounted(load);

function uid(prefix: string) { return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`; }
function addWorkflow() { workflows.value.push({ id: uid('wf'), label: t('wfe.new_workflow'), stages: [] }); }
function removeWorkflow(i: number) { workflows.value.splice(i, 1); }
function addStage(w: WfDef) { w.stages.push({ id: uid('st'), label: t('wfe.new_stage'), group: '', prompts: [''] }); }
function removeStage(w: WfDef, i: number) { w.stages.splice(i, 1); }
function moveStage(w: WfDef, i: number, dir: number) {
  const j = i + dir;
  if (j < 0 || j >= w.stages.length) return;
  const a = w.stages[i]; w.stages[i] = w.stages[j]; w.stages[j] = a;
}
function addPrompt(s: StageDef) { s.prompts.push(''); }
function removePrompt(s: StageDef, i: number) { s.prompts.splice(i, 1); }

async function save(): Promise<boolean> {
  busy.value = true; msg.value = '';
  try {
    const res = await fetch('/api/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflows: workflows.value }) });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.message || j.error || `HTTP ${res.status}`);
    if (Array.isArray(j.workflows)) workflows.value = JSON.parse(JSON.stringify(j.workflows));
    emit('saved');
    msg.value = t('wfe.saved');
    return true;
  } catch (e: any) { msg.value = t('wfe.failed', { msg: String(e?.message || e) }); return false; }
  finally { busy.value = false; }
}

async function exportXml() {
  if (!(await save())) return;
  try {
    const xml = await fetch('/api/config/xml').then((r) => r.text());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    a.download = 'devflow.xml';
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
  busy.value = true; msg.value = '';
  try {
    const res = await fetch('/api/config/xml', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ xml }) });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.message || j.error || `HTTP ${res.status}`);
    await load();
    emit('saved');
    msg.value = t('wfe.imported');
  } catch (e2: any) { msg.value = t('wfe.failed', { msg: String(e2?.message || e2) }); }
  finally { busy.value = false; inp.value = ''; }
}
</script>

<template>
  <div class="weoverlay" @click.self="emit('close')">
    <div class="webox">
      <header class="weh">
        <span>{{ $t('wfe.title') }}</span>
        <button class="wex" @click="emit('close')">×</button>
      </header>
      <div class="web">
        <div v-for="(w, wi) in workflows" :key="w.id" class="wcard">
          <div class="wrow">
            <input v-model="w.label" class="in wlabel" :placeholder="$t('wfe.workflow_label')" />
            <button class="mini danger" :disabled="busy" @click="removeWorkflow(wi)">{{ $t('wfe.del') }}</button>
          </div>
          <div v-for="(s, si) in w.stages" :key="s.id" class="scard">
            <div class="srow">
              <input v-model="s.label" class="in" :placeholder="$t('wfe.stage_label')" />
              <input v-model="s.group" class="in grp" :placeholder="$t('wfe.group_label')" />
              <button class="mini" :disabled="busy || si === 0" @click="moveStage(w, si, -1)">↑</button>
              <button class="mini" :disabled="busy || si === w.stages.length - 1" @click="moveStage(w, si, 1)">↓</button>
              <button class="mini danger" :disabled="busy" @click="removeStage(w, si)">{{ $t('wfe.del') }}</button>
            </div>
            <div v-for="(p, pi) in s.prompts" :key="pi" class="prow">
              <textarea v-model="s.prompts[pi]" class="ta" rows="2" :placeholder="$t('wfe.prompt')" />
              <button class="mini danger" :disabled="busy" @click="removePrompt(s, pi)">×</button>
            </div>
            <button class="mini add" :disabled="busy" @click="addPrompt(s)">{{ $t('wfe.add_prompt') }}</button>
          </div>
          <button class="mini add" :disabled="busy" @click="addStage(w)">{{ $t('wfe.add_stage') }}</button>
        </div>
        <button class="mini add big" :disabled="busy" @click="addWorkflow">{{ $t('wfe.add_workflow') }}</button>
      </div>
      <footer class="wef">
        <span class="wemsg">{{ msg }}</span>
        <input ref="fileInput" type="file" accept=".xml,text/xml,application/xml" class="hidden" @change="onFile" />
        <button class="webtn" :disabled="busy" @click="pickFile">{{ $t('wfe.import') }}</button>
        <button class="webtn" :disabled="busy" @click="exportXml">{{ $t('wfe.export') }}</button>
        <button class="webtn primary" :disabled="busy" @click="save">{{ $t('wfe.save') }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.weoverlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 60; }
.webox { width: 720px; max-width: 94vw; height: 82vh; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 10px; box-shadow: 0 18px 50px rgba(0,0,0,.45); display: flex; flex-direction: column; overflow: hidden; }
.weh { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--bg4); font-weight: 700; }
.wex { background: none; border: none; color: var(--tx3); font-size: 18px; cursor: pointer; }
.web { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 12px; }
.wcard { border: 1px solid var(--bd); border-radius: 8px; padding: 10px; background: var(--bg2); display: flex; flex-direction: column; gap: 8px; }
.wrow { display: flex; gap: 8px; align-items: center; }
.scard { border: 1px dashed var(--bd); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: var(--bg3); }
.srow { display: flex; gap: 6px; align-items: center; }
.prow { display: flex; gap: 6px; align-items: flex-start; }
.in { flex: 1; min-width: 0; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 12px; font-family: inherit; box-sizing: border-box; }
.in.wlabel { font-weight: 700; }
.in.grp { flex: 0 0 140px; }
.ta { flex: 1; min-width: 0; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 12px; font-family: ui-monospace, Consolas, monospace; resize: vertical; box-sizing: border-box; }
.in:focus, .ta:focus { outline: none; border-color: var(--ac2); }
.mini { flex: none; background: var(--bg5); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 8px; font-size: 11px; cursor: pointer; font-family: inherit; }
.mini:hover:not(:disabled) { border-color: var(--ac2); color: var(--tx1); }
.mini:disabled { opacity: .45; cursor: default; }
.mini.danger:hover:not(:disabled) { border-color: var(--err); color: var(--err); }
.mini.add { align-self: flex-start; background: none; }
.mini.add.big { margin: 4px 0 8px; }
.hidden { display: none; }
.wef { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--bd2); }
.wemsg { flex: 1; min-width: 0; color: var(--tx3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.webtn { background: var(--bg5); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-family: inherit; }
.webtn:hover:not(:disabled) { border-color: var(--ac2); }
.webtn:disabled { opacity: .5; cursor: default; }
.webtn.primary { background: var(--ac); color: var(--onac); border-color: var(--ac); }
</style>
