<script setup lang="ts">
import { ref } from 'vue';
import { t } from '../i18n';
import { parseYamlDoc, serializeYamlDoc } from '../yaml';
import { sortText, dedupText, type SortMode } from '../textTools';

type ToolId = 'translate' | 'yaml' | 'js' | 'sort' | 'pick' | 'compact';

const TOOLS: Array<{ id: ToolId; icon: string; label: string; disabled?: boolean; hint?: string }> = [
  { id: 'translate', icon: '🌐', label: 'tools.translate' },
  { id: 'yaml', icon: '🧾', label: 'tools.yaml' },
  { id: 'js', icon: '⚙', label: 'tools.js' },
  { id: 'sort', icon: '↕', label: 'tools.sort' },
  { id: 'pick', icon: '📎', label: 'tools.pick_file' },
  { id: 'compact', icon: '🗜', label: 'tools.compact', disabled: true, hint: 'tools.compact_need' },
];
const SORT_BTNS: Array<{ mode: SortMode; key: string }> = [
  { mode: 'asc', key: 'fp.sort.short.asc' },
  { mode: 'desc', key: 'fp.sort.short.desc' },
  { mode: 'asc-ci', key: 'fp.sort.short.asc_ci' },
  { mode: 'desc-ci', key: 'fp.sort.short.desc_ci' },
  { mode: 'num-asc', key: 'fp.sort.short.num_asc' },
  { mode: 'num-desc', key: 'fp.sort.short.num_desc' },
];

const open = ref<ToolId | null>(null);
const input = ref('');
const output = ref('');
const busy = ref(false);
const msg = ref('');
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

function openTool(id: ToolId) {
  if (TOOLS.find((x) => x.id === id)?.disabled) return;
  open.value = id;
  input.value = '';
  output.value = '';
  msg.value = '';
  copied.value = false;
}
function closeTool() { open.value = null; }
function titleOf(id: ToolId) { return t(TOOLS.find((x) => x.id === id)?.label || 'tools.title'); }

function fail(e: unknown) {
  msg.value = t('tools.failed', { msg: (e as Error)?.message || String(e) });
}

async function runTranslate() {
  if (busy.value) return;
  if (!input.value.trim()) { msg.value = t('et.empty'); return; }
  busy.value = true; msg.value = '';
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input.value }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) { msg.value = t('et.failed', { msg: j.message || j.error || `HTTP ${res.status}` }); return; }
    output.value = j.text || '';
  } catch (e) { fail(e); } finally { busy.value = false; }
}

function runYaml(format: boolean) {
  const { doc, error } = parseYamlDoc(input.value);
  if (error || !doc) { msg.value = t('tools.yaml_fail', { msg: error || 'invalid' }); return; }
  msg.value = t('tools.yaml_ok');
  if (format) output.value = serializeYamlDoc(doc);
}

async function runJs() {
  if (busy.value) return;
  if (!input.value.trim()) { msg.value = t('et.empty'); return; }
  busy.value = true; msg.value = '';
  try {
    const res = await fetch('/api/format', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'snippet.js', content: input.value }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) { msg.value = t('tools.failed', { msg: j.message || j.error || `HTTP ${res.status}` }); return; }
    output.value = j.content || '';
  } catch (e) { fail(e); } finally { busy.value = false; }
}

async function runPick() {
  if (busy.value) return;
  busy.value = true; msg.value = '';
  try {
    const res = await fetch('/api/file/pick-path', { method: 'POST' });
    const j: any = await res.json().catch(() => ({}));
    if (j.error) {
      msg.value = j.error === 'unsupported' ? t('sched.pick_unsupported') : t('tools.failed', { msg: j.message || j.error });
      return;
    }
    if (j.cancelled || !j.path) return;
    output.value = j.path;
    msg.value = t('tools.pick_ok');
  } catch (e) { fail(e); } finally { busy.value = false; }
}

function runSort(mode: SortMode) { output.value = sortText(input.value, mode); msg.value = ''; }
function runDedup() { output.value = dedupText(input.value); msg.value = ''; }

function useOutputAsInput() {
  if (!output.value) return;
  input.value = output.value;
  output.value = '';
  msg.value = '';
}
async function copyOut() {
  if (!output.value) return;
  try { await navigator.clipboard.writeText(output.value); }
  catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = output.value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch { /* ignore */ }
  }
  copied.value = true;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copied.value = false; copyTimer = null; }, 2000);
}
</script>

<template>
  <div class="mt">
    <div class="mtrow">
      <button v-for="x in TOOLS" :key="x.id" class="mticon" :class="{ on: open === x.id }" :disabled="x.disabled" :title="x.disabled && x.hint ? $t(x.hint) : $t(x.label)" @click="openTool(x.id)">
        <span class="mtglyph">{{ x.icon }}</span><span class="mtname">{{ $t(x.label) }}</span>
      </button>
    </div>

    <div v-if="open" class="mtmask" @click.self="closeTool">
      <div class="mtcard">
        <header class="mthead">
          <span>{{ titleOf(open) }}</span>
          <button class="mtx" @click="closeTool">×</button>
        </header>

        <div class="mtacts">
          <template v-if="open === 'translate'">
            <button class="mtbtn primary" :disabled="busy" @click="runTranslate">{{ busy ? $t('term.translating') : $t('tools.run') }}</button>
          </template>
          <template v-else-if="open === 'yaml'">
            <button class="mtbtn" @click="runYaml(false)">{{ $t('tools.yaml_check') }}</button>
            <button class="mtbtn primary" @click="runYaml(true)">{{ $t('tools.yaml_format') }}</button>
          </template>
          <template v-else-if="open === 'js'">
            <button class="mtbtn primary" :disabled="busy" @click="runJs">{{ $t('tools.js_min') }}</button>
          </template>
          <template v-else-if="open === 'pick'">
            <button class="mtbtn primary" :disabled="busy" @click="runPick">{{ $t('tools.pick_run') }}</button>
          </template>
          <template v-else>
            <button v-for="b in SORT_BTNS" :key="b.mode" class="mtbtn" @click="runSort(b.mode)">{{ $t(b.key) }}</button>
            <button class="mtbtn" @click="runDedup">{{ $t('tools.dedup') }}</button>
          </template>
        </div>

        <div v-if="msg" class="mtmsg">{{ msg }}</div>

        <textarea v-model="input" class="mtarea" :placeholder="$t('tools.input')" spellcheck="false" />
        <div class="mtout">
          <textarea v-model="output" class="mtarea" :placeholder="$t('tools.output')" spellcheck="false" />
          <div class="mtoutacts">
            <button class="mtmini" :disabled="!output" @click="copyOut">{{ copied ? $t('tools.copied') : $t('tools.copy') }}</button>
            <button class="mtmini" :disabled="!output" @click="useOutputAsInput">{{ $t('tools.to_input') }}</button>
            <button class="mtmini" @click="input = ''; output = ''; msg = ''">{{ $t('tools.clear') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mt { margin: 0 0 16px; }
.mtrow { display: flex; flex-wrap: wrap; gap: 8px; }
.mticon { display: inline-flex; align-items: center; gap: 6px; background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.mticon:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.mticon.on { border-color: var(--ac); color: var(--ac2); }
.mticon:disabled { opacity: .5; cursor: default; }
.mtglyph { font-size: 15px; line-height: 1; }

.mtmask { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 120; }
.mtcard { width: 640px; max-width: 94vw; max-height: 86vh; display: flex; flex-direction: column; gap: 8px; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; padding: 14px; box-shadow: 0 16px 48px rgba(0,0,0,.5); }
.mthead { display: flex; align-items: center; justify-content: space-between; color: var(--tx1); font-weight: 700; }
.mtx { background: none; border: none; color: var(--tx3); font-size: 18px; cursor: pointer; line-height: 1; }
.mtacts { display: flex; flex-wrap: wrap; gap: 6px; }
.mtbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 12px; cursor: pointer; font-size: 12px; }
.mtbtn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.mtbtn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.mtbtn:disabled { opacity: .55; cursor: default; }
.mtmsg { color: var(--tx3); font-size: 12px; }
.mtarea { flex: 1; min-height: 96px; resize: vertical; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 6px; padding: 8px 10px; font-size: 12px; line-height: 1.6; font-family: ui-monospace, Consolas, monospace; box-sizing: border-box; }
.mtarea:focus { outline: none; border-color: var(--ac2); }
.mtout { display: flex; flex-direction: column; gap: 6px; }
.mtoutacts { display: flex; gap: 6px; justify-content: flex-end; }
.mtmini { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
.mtmini:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.mtmini:disabled { opacity: .5; cursor: default; }
</style>
