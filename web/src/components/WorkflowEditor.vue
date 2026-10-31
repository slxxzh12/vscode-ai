<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { t } from '../i18n';
import type { Workflow } from '../workflowModel';
import WorkflowFilesTab from './WorkflowFilesTab.vue';
import WorkflowPreviewTab from './WorkflowPreviewTab.vue';

const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>();
const tabs = ['files', 'preview'] as const;
const model = ref<Workflow[]>([]);
const tab = ref<'files' | 'preview'>('files');
const busy = ref(false);
const msg = ref('');
const reloadToken = ref(0);

const currentId = ref('');
const current = computed<Workflow | null>(() => model.value.find((w) => w.id === currentId.value) || model.value[0] || null);
watch(model, () => {
  if (!model.value.some((w) => w.id === currentId.value)) currentId.value = model.value[0]?.id || '';
});

async function load(keep = false) {
  const prev = currentId.value;
  try {
    const r = await fetch('/api/workflows-xml').then((x) => x.json());
    model.value = Array.isArray(r?.workflows) ? JSON.parse(JSON.stringify(r.workflows)) : [];
  } catch { if (!keep) model.value = []; return; }
  currentId.value = keep && model.value.some((w) => w.id === prev) ? prev : model.value[0]?.id || '';
}

async function refreshModel() {
  const keep = currentId.value;
  await load();
  if (model.value.some((w) => w.id === keep)) currentId.value = keep;
}

async function restoreDefault() {
  if (!current.value) return;
  const name = current.value.label || current.value.id;
  if (!window.confirm(t('wfe.restore_confirm', { name }))) return;
  busy.value = true;
  msg.value = '';
  try {
    const res = await fetch('/api/workflows-restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId: currentId.value }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.message || j.error || `HTTP ${res.status}`);
    if (Array.isArray(j.workflows)) model.value = JSON.parse(JSON.stringify(j.workflows));
    if (!model.value.some((w) => w.id === currentId.value)) currentId.value = model.value[0]?.id || '';
    reloadToken.value += 1;
    emit('saved');
    msg.value = t('wfe.restored');
  } catch (e: any) {
    msg.value = t('wfe.failed', { msg: String(e?.message || e) });
  } finally {
    busy.value = false;
  }
}

async function forceOverwriteAll() {
  if (!model.value.length) return;
  if (!window.confirm(t('wfe.force_confirm'))) return;
  busy.value = true;
  msg.value = '';
  try {
    const res = await fetch('/api/workflows-restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.message || j.error || `HTTP ${res.status}`);
    if (Array.isArray(j.workflows)) model.value = JSON.parse(JSON.stringify(j.workflows));
    if (!model.value.some((w) => w.id === currentId.value)) currentId.value = model.value[0]?.id || '';
    reloadToken.value += 1;
    emit('saved');
    msg.value = t('wfe.force_restored');
  } catch (e: any) {
    msg.value = t('wfe.failed', { msg: String(e?.message || e) });
  } finally {
    busy.value = false;
  }
}

async function openPromptsDir() {
  msg.value = '';
  try {
    const res = await fetch('/api/workflows-reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '' }),
    });
    if (!res.ok) {
      const j: any = await res.json().catch(() => ({}));
      throw new Error(j?.error || `HTTP ${res.status}`);
    }
  } catch (e: any) {
    msg.value = t('wfe.files.reveal_failed', { msg: String(e?.message || e) });
  }
}

function close() { emit('close'); }
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void load();
  timer = setInterval(() => { if (!busy.value) void load(true); }, 2000);
});
onBeforeUnmount(() => { if (timer) clearInterval(timer); timer = null; });
</script>

<template>
  <div class="weoverlay">
    <div class="webox">
      <header class="weh">
        <span class="wtitle">{{ $t('wfe.title') }}</span>
        <nav class="tabs">
          <button v-for="k in tabs" :key="k" class="tab" :class="{ on: tab === k }" @click="tab = k">{{ $t('wfe.tab.' + k) }}</button>
        </nav>
        <button class="weopen" :title="$t('wfe.open_prompts_hint')" @click="openPromptsDir">{{ $t('wfe.open_prompts') }}</button>
        <button class="wex" @click="close">×</button>
      </header>
      <div class="web">
        <aside class="wenav">
          <div class="wnhead">
            <span class="wnlabel">{{ $t('pc.workflow') }}</span>
          </div>
          <div class="wnlist">
            <button v-for="w in model" :key="w.id" class="wnitem" :class="{ on: w.id === currentId }" :title="w.id" @click="currentId = w.id">
              <span class="wnname">{{ w.label || w.id }}</span>
            </button>
            <div v-if="model.length === 0" class="wnempty">{{ $t('wfe.preview.empty') }}</div>
          </div>
        </aside>
        <div class="wemain">
          <WorkflowFilesTab v-if="tab === 'files'" :key="currentId + ':' + reloadToken" :workflow-id="currentId" @deleted="refreshModel" />
          <WorkflowPreviewTab v-else :model="model" />
        </div>
      </div>
      <footer class="wef">
        <span class="wemsg">{{ msg }}</span>
        <button class="webtn" :disabled="busy || !model.length" :title="$t('wfe.force_hint')" @click="forceOverwriteAll">{{ $t('wfe.force_overwrite') }}</button>
        <button class="webtn" :disabled="busy || !current" :title="$t('wfe.restore_hint')" @click="restoreDefault">{{ $t('wfe.restore_default') }}</button>
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
.weopen { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 4px 10px; font-size: 12px; cursor: pointer; font-family: inherit; }
.weopen:hover { border-color: var(--ac2); color: var(--ac2); }
.wex { background: none; border: none; color: var(--tx3); font-size: 18px; cursor: pointer; }
.web { flex: 1; min-height: 0; display: flex; padding: 12px 14px; gap: 12px; }
.wenav { flex: none; width: 200px; display: flex; flex-direction: column; border: 1px solid var(--bd); border-radius: 6px; overflow: hidden; background: var(--bg2); }
.wnhead { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid var(--bd2); }
.wnlabel { font-size: 11px; text-transform: uppercase; color: var(--ac2); }
.wnlist { flex: 1; min-height: 0; overflow-y: auto; padding: 4px; }
.wnitem { display: flex; align-items: center; gap: 4px; width: 100%; background: none; border: 1px solid transparent; border-radius: 4px; color: var(--tx1); padding: 5px 6px; cursor: pointer; font-size: 12px; font-family: inherit; text-align: left; }
.wnitem:hover { background: var(--bg3); }
.wnitem.on { color: var(--ac2); border-color: var(--ac2); }
.wnname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wnempty { color: var(--tx6); font-size: 12px; padding: 12px 6px; }
.wemain { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; }
.wef { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--bd2); }
.wemsg { flex: 1; min-width: 0; color: var(--tx3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.webtn { background: var(--bg5); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-family: inherit; }
.webtn:hover:not(:disabled) { border-color: var(--ac2); }
.webtn:disabled { opacity: .5; cursor: default; }
</style>
