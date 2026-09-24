<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { t } from '../i18n';
import { fmtTime } from './usagePeers';

interface ProbeResult {
  agent?: string; days?: number; cmdline?: string;
  ok?: boolean; error?: string; code?: string | null;
  raw?: string; stderr?: string;
  parsed?: Record<string, number | null> | null;
  durationMs?: number;
  collectedAt?: number;
  cwd?: string; statsFileMtime?: number | null;
  cached?: boolean;
}

const props = defineProps<{ open: boolean; label?: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const loading = ref(false);
const result = ref<ProbeResult | null>(null);
const err = ref('');

const fields: { key: string; label: string }[] = [
  { key: 'sessions', label: 'usage.sessions' },
  { key: 'messages', label: 'usage.messages' },
  { key: 'days', label: 'usage.days' },
  { key: 'totalCost', label: 'usage.cost' },
  { key: 'input', label: 'usage.input' },
  { key: 'output', label: 'usage.output' },
  { key: 'cacheRead', label: 'usage.cache_read' },
  { key: 'cacheWrite', label: 'usage.cache_write' },
];

const raw = computed(() => (result.value?.raw || '').replace(/\s+$/, ''));
const parsedRows = computed(() => fields.map((f) => {
  const v = result.value?.parsed ? result.value.parsed[f.key] : null;
  return { label: f.label, value: v == null ? '-' : String(v) };
}));

// —— 截图识别统计：多模态识别截图 → 写回用量库 ——
const imgInput = ref<HTMLInputElement | null>(null);
const imageLoading = ref(false);
const imageResult = ref<{ metrics: Record<string, number | null>; model: string; reported: boolean } | null>(null);
const imageErr = ref('');
const imageRows = computed(() => fields.map((f) => {
  const v = imageResult.value?.metrics ? imageResult.value.metrics[f.key] : null;
  return { label: f.label, value: v == null ? '-' : String(v) };
}));

function pickImage() { imgInput.value?.click(); }
async function onImageChosen(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  imageLoading.value = true;
  imageErr.value = '';
  imageResult.value = null;
  try {
    const mime = f.type || 'image/png';
    const res = await fetch(`/api/usage/image?mime=${encodeURIComponent(mime)}`, { method: 'POST', body: f });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
    imageResult.value = data;
  } catch (err) {
    imageErr.value = (err as Error)?.message || String(err);
  } finally {
    imageLoading.value = false;
  }
}

// 打开即取上次采集缓存（本机落盘），点「重新采集」才现场跑一次
async function load() {
  loading.value = false;
  err.value = '';
  result.value = null;
  try {
    const res = await fetch('/api/usage/probe');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    result.value = data && data.none ? null : data;
  } catch (e) {
    err.value = (e as Error)?.message || String(e);
  }
}

async function recollect() {
  loading.value = true;
  err.value = '';
  try {
    const res = await fetch('/api/usage/probe', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    result.value = data;
  } catch (e) {
    err.value = (e as Error)?.message || String(e);
  } finally {
    loading.value = false;
  }
}

watch(() => props.open, (v) => { if (v) load(); });
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="mask" @click.self="emit('close')">
      <div class="box" role="dialog" aria-modal="true">
        <div class="title">{{ $t('usage.probe.title') }}</div>
        <div class="meta">{{ label || '' }}</div>

        <div v-if="loading" class="hint">{{ $t('usage.probe.loading') }}</div>
        <div v-else-if="err" class="err">{{ $t('usage.probe.load_failed', { msg: err }) }}</div>
        <div v-else-if="!result" class="hint">{{ $t('usage.probe.none') }}</div>

        <template v-else-if="result">
          <div v-if="result.cached" class="meta2">{{ $t('usage.probe.cached') }}</div>
          <div class="kv">
            <span class="k">{{ $t('usage.probe.command') }}</span>
            <code class="v">{{ result.cmdline || '-' }}</code>
          </div>
          <div class="kv">
            <span class="k">{{ $t('usage.probe.cwd') }}</span>
            <code class="v">{{ result.cwd || '-' }}</code>
          </div>
          <div class="kv">
            <span class="k">{{ $t('usage.probe.status') }}</span>
            <span class="v" :class="result.ok ? 'ok' : 'bad'">
              {{ result.ok ? $t('usage.probe.ok') : $t('usage.probe.failed', { msg: result.error || result.code || '' }) }}
            </span>
          </div>
          <div class="kv">
            <span class="k">{{ $t('usage.probe.file_mtime') }}</span>
            <span class="v">{{ result.statsFileMtime ? fmtTime(result.statsFileMtime) : '-' }}</span>
          </div>

          <div class="sec">{{ $t('usage.probe.raw') }}</div>
          <pre class="raw">{{ raw || $t('usage.probe.empty') }}</pre>

          <template v-if="result.stderr">
            <div class="sec">{{ $t('usage.probe.stderr') }}</div>
            <pre class="raw">{{ result.stderr }}</pre>
          </template>

          <div class="sec">{{ $t('usage.probe.parsed') }}</div>
          <div class="ptable">
            <div v-for="r in parsedRows" :key="r.label" class="prow">
              <span class="pk">{{ t(r.label) }}</span>
              <span class="pv">{{ r.value }}</span>
            </div>
          </div>
        </template>

        <div v-if="imageLoading" class="hint">{{ $t('usage.probe.image_loading') }}</div>
        <div v-else-if="imageErr" class="err">{{ $t('usage.probe.image_failed', { msg: imageErr }) }}</div>
        <template v-else-if="imageResult">
          <div class="sec">{{ $t('usage.probe.parsed') }}</div>
          <div class="ptable">
            <div v-for="r in imageRows" :key="r.label" class="prow">
              <span class="pk">{{ t(r.label) }}</span>
              <span class="pv">{{ r.value }}</span>
            </div>
          </div>
          <div class="hint">{{ imageResult.reported ? $t('usage.probe.image_success') : $t('usage.probe.image_failed', { msg: '' }) }}</div>
        </template>

        <div class="foot">
          <button class="btn" :disabled="loading" @click="recollect">{{ $t('usage.probe.recollect') }}</button>
          <button class="btn" :disabled="imageLoading" @click="pickImage">{{ $t('usage.probe.image') }}</button>
          <input ref="imgInput" type="file" accept="image/*" class="hidden-input" @change="onImageChosen" />
          <button class="btn primary" @click="emit('close')">{{ $t('common.ok') }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 3000; }
.box { width: 560px; max-width: 92vw; max-height: 86vh; overflow: auto; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); padding: 18px 20px 14px; }
.title { font-size: 15px; font-weight: 600; color: var(--tx1); }
.meta { color: var(--tx6); font-size: 12px; margin: 6px 0 10px; }
.meta2 { color: var(--tx6); font-size: 11px; margin: 0 0 8px; }
.hint { color: var(--tx6); font-size: 13px; padding: 12px 0; }
.err { color: var(--err); font-size: 12px; padding: 8px 0; }
.kv { display: flex; gap: 8px; font-size: 12px; margin: 4px 0; }
.kv .k { flex: none; color: var(--tx6); min-width: 48px; }
.kv .v { color: var(--tx); word-break: break-all; }
.kv .v.ok { color: #4caf50; }
.kv .v.bad { color: var(--err); }
.kv code.v { font-family: Consolas, monospace; }
.sec { margin: 12px 0 4px; color: var(--tx2); font-size: 11px; text-transform: uppercase; }
.raw { margin: 0; padding: 8px 10px; max-height: 200px; overflow: auto; background: var(--bg4); border: 1px solid var(--bd2); border-radius: 6px; color: var(--tx); font-family: Consolas, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
.ptable { border: 1px solid var(--bd2); border-radius: 6px; overflow: hidden; }
.prow { display: flex; justify-content: space-between; gap: 10px; padding: 5px 10px; font-size: 12px; border-bottom: 1px solid var(--bd2); }
.prow:last-child { border-bottom: none; }
.pk { color: var(--tx6); }
.pv { color: var(--tx); font-family: Consolas, monospace; }
.foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.btn { padding: 6px 16px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg2); color: var(--tx2); cursor: pointer; font-size: 13px; font-family: inherit; }
.btn.primary { background: var(--ac); border-color: var(--ac); color: #fff; }
.hidden-input { display: none; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
