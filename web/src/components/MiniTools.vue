<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '../i18n';
import { parseYamlDoc, serializeYamlDoc } from '../yaml';
import { sortText, dedupText, type SortMode } from '../textTools';

type ToolId = 'translate' | 'yaml' | 'js' | 'sort' | 'postman';

const TOOLS: Array<{ id: ToolId; icon: string; label: string; disabled?: boolean; hint?: string }> = [
  { id: 'translate', icon: '🌐', label: 'tools.translate' },
  { id: 'yaml', icon: '🧾', label: 'tools.yaml' },
  { id: 'js', icon: '⚙', label: 'tools.js' },
  { id: 'sort', icon: '↕', label: 'tools.sort' },
  { id: 'postman', icon: '📮', label: 'tools.postman' },
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
const dlgOpen = computed({ get: () => open.value !== null, set: (v: boolean) => { if (!v) open.value = null; } });
const input = ref('');
const curlCmd = ref('');
const output = ref('');
const busy = ref(false);
const msg = ref('');
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

function openTool(id: ToolId) {
  if (TOOLS.find((x) => x.id === id)?.disabled) return;
  open.value = id;
  input.value = '';
  curlCmd.value = '';
  output.value = '';
  msg.value = '';
  copied.value = false;
}
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

async function runCurlCmd() {
  if (busy.value) return;
  if (!curlCmd.value.trim()) { msg.value = t('et.empty'); return; }
  busy.value = true; msg.value = ''; output.value = '';
  try {
    const res = await fetch('/api/curl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: curlCmd.value }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) { msg.value = t('tools.failed', { msg: j.message || j.error || `HTTP ${res.status}` }); return; }
    output.value = [j.stdout, j.stderr ? `--- stderr ---\n${j.stderr}` : ''].filter(Boolean).join(j.stdout ? '\n' : '');
    msg.value = j.timedOut ? t('tools.pm_timeout') : t('tools.pm_exit', { code: j.code });
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

    <el-dialog v-model="dlgOpen" :title="open ? titleOf(open) : ''" fullscreen append-to-body class="mtdlg">
      <div v-if="open === 'postman'" class="mtbody">
        <div class="mtacts">
          <button class="mtbtn primary" :disabled="busy" @click="runCurlCmd">{{ busy ? $t('tools.pm_running') : $t('tools.run') }}</button>
          <button class="mtbtn" @click="curlCmd = ''; output = ''; msg = ''">{{ $t('tools.clear') }}</button>
        </div>

        <div v-if="msg" class="mtmsg">{{ msg }}</div>

        <div class="mtcurlbox">
          <div class="mtcurlbar"><span class="mtcurlprompt">curl</span><span class="mtcurltip">{{ $t('tools.pm_tip') }}</span></div>
          <textarea v-model="curlCmd" class="mtarea mtcurl" :placeholder="$t('tools.pm_ph')" spellcheck="false" />
        </div>

        <label class="mtlabel">{{ $t('tools.pm_resp') }}</label>
        <div class="mtout">
          <textarea v-model="output" class="mtarea" :placeholder="$t('tools.output')" spellcheck="false" readonly />
          <div class="mtoutacts">
            <button class="mtmini" :disabled="!output" @click="copyOut">{{ copied ? $t('tools.copied') : $t('tools.copy') }}</button>
          </div>
        </div>
      </div>

      <div v-else class="mtbody">
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
    </el-dialog>
  </div>
</template>

<style scoped>
.mt { margin: 0 0 16px; }
.mtrow { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 14px; }
.mticon { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 16px; padding: 22px 12px; cursor: pointer; font-size: 15px; }
.mticon:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.mticon.on { border-color: var(--ac); color: var(--ac2); }
.mticon:disabled { opacity: .5; cursor: default; }
.mtglyph { font-size: 40px; line-height: 1; }
.mtname { text-align: center; line-height: 1.3; }
.mtlabel { color: var(--tx3); font-size: 12px; }
.mtcurlbox { display: flex; flex-direction: column; border: 1px solid var(--ac2); border-radius: 8px; overflow: hidden; background: var(--bg1); }
.mtcurlbar { display: flex; align-items: center; gap: 8px; padding: 4px 10px; background: var(--bg4); border-bottom: 1px solid var(--bd); }
.mtcurlprompt { font-family: ui-monospace, Consolas, monospace; font-size: 12px; font-weight: 700; color: var(--ac2); }
.mtcurltip { color: var(--tx4); font-size: 11px; }
.mtcurl { flex: none; min-height: 120px; border: none; border-radius: 0; background: transparent; }
.mtcurl:focus { border: none; }

.mtbody { display: flex; flex-direction: column; gap: 10px; height: calc(100vh - 150px); }
.mtacts { display: flex; flex-wrap: wrap; gap: 8px; }
.mtbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.mtbtn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.mtbtn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.mtbtn:disabled { opacity: .55; cursor: default; }
.mtmsg { color: var(--tx3); font-size: 12px; }
.mtarea { flex: 1; min-height: 140px; resize: none; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 6px; padding: 10px 12px; font-size: 13px; line-height: 1.6; font-family: ui-monospace, Consolas, monospace; box-sizing: border-box; }
.mtarea:focus { outline: none; border-color: var(--ac2); }
.mtout { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
.mtout .mtarea { min-height: 120px; }
.mtoutacts { display: flex; gap: 8px; justify-content: flex-end; }
.mtmini { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
.mtmini:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.mtmini:disabled { opacity: .5; cursor: default; }
</style>
