<script setup lang="ts">
import { ref, computed } from 'vue';
import type { CollabApi } from './useCollab';
import type { AssetManifest } from './types';
import { t } from '../i18n';

const props = defineProps<{ open: boolean; collab: CollabApi }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const fileInput = ref<HTMLInputElement | null>(null);
const stagedId = ref('');
const manifest = ref<AssetManifest | null>(null);
const busy = ref(false);
const msg = ref('');
const msgErr = ref('');
const done = ref<Record<string, number> | null>(null);

const ERR_KEYS: Record<string, string> = {
  'invalid-zip': 'collab.import.err.invalid_zip',
  'manifest-missing': 'collab.import.err.manifest_missing',
  'bad-format': 'collab.import.err.bad_format',
  'bad-manifest': 'collab.import.err.bad_manifest',
  too_large: 'collab.import.err.too_large',
};
function errText(e: unknown) {
  const code = String((e as Error)?.message || e);
  return ERR_KEYS[code] ? t(ERR_KEYS[code]) : code;
}
const typeLabel = computed(() => (manifest.value ? t(`collab.import.type.${manifest.value.type}`) : ''));
const sourceLabel = computed(() => {
  const s = manifest.value?.source;
  if (!s) return '—';
  const id = s.employeeId || s.machineId || '';
  return id ? `${id}@${s.host || ''}:${s.port || ''}` : `${s.host || ''}:${s.port || ''}`;
});
const exportedAt = computed(() => (manifest.value?.exportedAt ? new Date(manifest.value.exportedAt).toLocaleString() : '—'));

function reset() {
  stagedId.value = ''; manifest.value = null; busy.value = false;
  msg.value = ''; msgErr.value = ''; done.value = null;
  if (fileInput.value) fileInput.value.value = '';
}
function pick() { msg.value = ''; msgErr.value = ''; done.value = null; fileInput.value?.click(); }
async function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  if (stagedId.value) { try { await props.collab.discardImport(stagedId.value); } catch { /* ignore */ } stagedId.value = ''; }
  busy.value = true; msgErr.value = ''; manifest.value = null; done.value = null;
  try {
    const r = await props.collab.importAsset(f);
    stagedId.value = r.id;
    manifest.value = r.manifest;
  } catch (err) { msgErr.value = errText(err); }
  finally { busy.value = false; if (fileInput.value) fileInput.value.value = ''; }
}
async function confirmImport() {
  if (!stagedId.value) return;
  busy.value = true; msgErr.value = '';
  try {
    const r = await props.collab.applyImport(stagedId.value);
    done.value = r.counts || {};
    msg.value = t('collab.import.done');
    stagedId.value = '';
    manifest.value = null;
  } catch (err) { msgErr.value = errText(err); }
  finally { busy.value = false; }
}
async function close() {
  if (stagedId.value) { try { await props.collab.discardImport(stagedId.value); } catch { /* ignore */ } }
  reset();
  emit('close');
}
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="mask" @click.self="close">
      <div class="box" role="dialog" aria-modal="true">
        <div class="title">{{ $t('collab.import.title') }}</div>
        <input ref="fileInput" type="file" accept=".zip,application/zip" class="hidden" @change="onFile" />
        <div class="rowbtns">
          <button class="btn pick" :disabled="busy" @click="pick">{{ $t('collab.import.pick') }}</button>
        </div>
        <div v-if="manifest" class="preview">
          <div class="pline"><span class="pk">{{ $t('collab.import.type') }}</span><span class="pv">{{ typeLabel }}</span></div>
          <div class="pline"><span class="pk">{{ $t('collab.import.source') }}</span><span class="pv">{{ sourceLabel }}</span></div>
          <div class="pline"><span class="pk">{{ $t('collab.import.exported_at') }}</span><span class="pv">{{ exportedAt }}</span></div>
          <template v-if="manifest.skills.length">
            <div class="sec">{{ $t('collab.dist.skills', { count: manifest.skills.length }) }}</div>
            <div v-for="s in manifest.skills" :key="'s-' + s.name" class="item">🛠 {{ s.name }}</div>
          </template>
          <template v-if="manifest.command.length">
            <div class="sec">{{ $t('collab.dist.command', { count: manifest.command.length }) }}</div>
            <div v-for="c in manifest.command" :key="'c-' + c.name" class="item">⌨ {{ c.name }}</div>
          </template>
          <template v-if="manifest.agent.length">
            <div class="sec">{{ $t('collab.dist.agent', { count: manifest.agent.length }) }}</div>
            <div v-for="a in manifest.agent" :key="'a-' + a.name" class="item">🤖 {{ a.name }}</div>
          </template>
          <template v-if="manifest.workflow.length">
            <div class="sec">{{ $t('collab.dist.workflow', { count: manifest.workflow.length }) }}</div>
            <div v-for="w in manifest.workflow" :key="'w-' + w.id" class="item">🧩 {{ w.label || w.id }}</div>
          </template>
        </div>
        <div v-if="done" class="ok">{{ msg }} · {{ $t('collab.import.done_counts', { skills: done.skills || 0, command: done.command || 0, agent: done.agent || 0, workflow: done.workflow || 0 }) }}</div>
        <div v-if="msgErr" class="err">{{ msgErr }}</div>
        <div class="foot">
          <button class="btn close" :disabled="busy" @click="close">{{ $t('collab.import.cancel') }}</button>
          <button v-if="manifest" class="btn primary confirm" :disabled="busy" @click="confirmImport">{{ $t('collab.import.confirm') }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 3000; }
.box { width: 520px; max-width: 92vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); padding: 18px 20px 14px; }
.title { font-size: 15px; font-weight: 600; color: var(--tx1); }
.hidden { display: none; }
.rowbtns { margin: 10px 0; }
.preview { max-height: 300px; overflow: auto; border: 1px solid var(--bd2); border-radius: 6px; padding: 8px 10px; }
.pline { display: flex; gap: 8px; font-size: 12px; padding: 2px 0; }
.pk { color: var(--tx6); flex: none; min-width: 64px; }
.pv { color: var(--tx1); word-break: break-all; }
.sec { color: var(--tx2); text-transform: uppercase; font-size: 11px; margin: 8px 0 2px; font-weight: 600; }
.item { color: var(--tx1); font-size: 13px; padding: 2px 0; word-break: break-all; }
.ok { color: var(--ok, #22c55e); font-size: 13px; margin-top: 10px; }
.err { color: var(--err); font-size: 13px; margin-top: 10px; }
.foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.btn { padding: 5px 14px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg2); color: var(--tx2); cursor: pointer; font-size: 13px; font-family: inherit; }
.btn.primary { background: var(--ac); border-color: var(--ac); color: #fff; }
.btn:disabled { opacity: .55; cursor: default; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
