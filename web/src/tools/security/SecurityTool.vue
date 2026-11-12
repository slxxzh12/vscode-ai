<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { t } from '../../i18n';
import { useProjects } from '../../useProjects';

interface Finding {
  root: string;
  path: string;
  line: number;
  rule: string;
  severity: 'high' | 'medium' | 'low';
}
interface ScanResult {
  findings: Finding[];
  summary: { high: number; medium: number; low: number; total: number };
  scanned: { dirs: number; files: number; bytes: number };
}

const projects = useProjects();
const dirs = ref<string[]>(['']);
const scanning = ref(false);
const error = ref('');
const result = ref<ScanResult | null>(null);
let storageKey = 'devflow-security-scan-dirs';

function ruleText(rule: string): string {
  const key = `security.rule.${rule}`;
  const text = t(key);
  return text === key ? rule : text;
}
function sevText(sev: string): string {
  return t(`security.sev.${sev}`);
}

async function pickDir(i: number) {
  error.value = '';
  try {
    const r = await projects.pickFolder();
    if (r.error) { error.value = r.error === 'unsupported' ? t('top.pick_unsupported') : t('top.add_failed', { msg: r.message || r.error }); return; }
    if (r.path) dirs.value[i] = r.path;
  } catch (e: any) {
    error.value = t('top.add_failed', { msg: e?.message || String(e) });
  }
}
function addDir() { dirs.value.push(''); }
function removeDir(i: number) { dirs.value.splice(i, 1); if (!dirs.value.length) dirs.value = ['']; }
function saveDirs() {
  try { localStorage.setItem(storageKey, JSON.stringify(dirs.value.filter((x) => x.trim()))); } catch { /* ignore */ }
}

async function scan() {
  const list = dirs.value.map((x) => x.trim()).filter(Boolean);
  if (!list.length) { error.value = t('security.need_dir'); return; }
  saveDirs();
  scanning.value = true;
  error.value = '';
  result.value = null;
  try {
    const res = await fetch('/api/security/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dirs: list }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    result.value = await res.json();
  } catch (e: any) {
    error.value = String(e?.message || e);
  } finally {
    scanning.value = false;
  }
}

onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(saved) && saved.length) dirs.value = saved.filter((x) => typeof x === 'string' && x.trim());
  } catch { /* ignore */ }
});
</script>

<template>
  <div class="sec">
    <div class="head">
      <div class="ttl">{{ $t('security.title') }}</div>
      <div class="desc">{{ $t('security.desc') }}</div>
    </div>
    <div class="dirs">
      <div v-for="(d, i) in dirs" :key="i" class="dirrow">
        <input v-model="dirs[i]" :placeholder="$t('security.dir_placeholder')" @change="saveDirs" />
        <button class="btn" @click="pickDir(i)">{{ $t('top.choose') }}</button>
        <button class="btn" :disabled="dirs.length <= 1" @click="removeDir(i)">×</button>
      </div>
      <div class="acts">
        <button class="btn" @click="addDir">＋ {{ $t('security.add_dir') }}</button>
        <button class="btn primary" :disabled="scanning" @click="scan">{{ scanning ? $t('security.scanning') : $t('security.scan') }}</button>
      </div>
    </div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="result" class="result">
      <div class="summary">
        <span class="card high">{{ $t('security.sev.high') }} <b>{{ result.summary.high }}</b></span>
        <span class="card medium">{{ $t('security.sev.medium') }} <b>{{ result.summary.medium }}</b></span>
        <span class="card low">{{ $t('security.sev.low') }} <b>{{ result.summary.low }}</b></span>
        <span class="meta">{{ $t('security.summary', { files: result.scanned.files, total: result.summary.total }) }}</span>
      </div>
      <div v-if="!result.findings.length" class="clean">{{ $t('security.clean') }}</div>
      <div v-else class="list">
        <div v-for="(f, i) in result.findings" :key="i" class="row" :class="f.severity">
          <span class="sev">{{ sevText(f.severity) }}</span>
          <span class="rule">{{ ruleText(f.rule) }}</span>
          <span class="path" :title="f.root + '\\' + f.path">{{ f.path }}<template v-if="f.line">:{{ f.line }}</template></span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sec { height: 100%; overflow: auto; padding: 16px 18px; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; }
.head .ttl { font-size: 16px; font-weight: 700; color: var(--tx1); }
.head .desc { margin-top: 4px; font-size: 12px; color: var(--tx3); }
.dirs { display: flex; flex-direction: column; gap: 8px; max-width: 920px; }
.dirrow { display: flex; gap: 8px; }
.dirrow input { flex: 1; min-width: 0; background: var(--bg2); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 8px; }
.acts { display: flex; gap: 8px; }
.btn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.btn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.btn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.btn:disabled { opacity: .5; cursor: default; }
.err { color: var(--err); font-size: 12px; }
.result { display: flex; flex-direction: column; gap: 10px; }
.summary { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.card { border: 1px solid var(--bd); border-radius: 6px; padding: 6px 12px; font-size: 12px; }
.card.high { color: var(--err); border-color: var(--err); }
.card.medium { color: var(--warn2); }
.meta { color: var(--tx3); font-size: 12px; }
.clean { color: var(--ok); font-size: 13px; padding: 12px 0; }
.list { display: flex; flex-direction: column; border-top: 1px solid var(--bd2); }
.row { display: grid; grid-template-columns: 62px 150px 1fr; gap: 10px; align-items: center; padding: 6px 4px; border-bottom: 1px solid var(--bd2); font-size: 12px; }
.sev { font-weight: 700; }
.row.high .sev { color: var(--err); }
.row.medium .sev { color: var(--warn2); }
.rule { color: var(--tx2); }
.path { color: var(--tx3); font-family: ui-monospace, Consolas, monospace; word-break: break-all; }
</style>
