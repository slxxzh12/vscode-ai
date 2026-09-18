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

type PostmanRecord = { id: string; command: string; result: any; updatedAt?: string; folder?: string };
type TreeRow =
  | { kind: 'folder'; key: string; path: string; name: string; depth: number }
  | { kind: 'record'; key: string; record: PostmanRecord; depth: number };

const open = ref<ToolId | null>(null);
const dlgOpen = computed({ get: () => open.value !== null, set: (v: boolean) => { if (!v) open.value = null; } });
const input = ref('');
const curlCmd = ref('');
const output = ref('');
const busy = ref(false);
const msg = ref('');
const copied = ref(false);
const history = ref<PostmanRecord[]>([]);
const folders = ref<string[]>([]);
const activeId = ref('');
const activeFolder = ref('');
const folderName = ref('');
const dragRecord = ref<PostmanRecord | null>(null);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

// 左侧树：文件夹按名排序，记录在各自目录内按时间倒序；根目录记录排在最后
const treeRows = computed<TreeRow[]>(() => {
  const byFolder = new Map<string, PostmanRecord[]>();
  for (const r of history.value) {
    const f = r.folder || '';
    if (!byFolder.has(f)) byFolder.set(f, []);
    byFolder.get(f)!.push(r);
  }
  for (const arr of byFolder.values()) arr.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const children = new Map<string, string[]>();
  for (const f of folders.value) {
    const parent = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(f);
  }
  for (const arr of children.values()) arr.sort();
  const rows: TreeRow[] = [];
  const pushRecords = (folder: string, depth: number) => {
    for (const r of byFolder.get(folder) || []) rows.push({ kind: 'record', key: `r:${r.id}`, record: r, depth });
  };
  const walk = (parent: string, depth: number) => {
    for (const f of children.get(parent) || []) {
      rows.push({ kind: 'folder', key: `d:${f}`, path: f, name: f.slice(f.lastIndexOf('/') + 1), depth });
      walk(f, depth + 1);
      pushRecords(f, depth + 1);
    }
  };
  walk('', 0);
  pushRecords('', 0);
  return rows;
});

function openTool(id: ToolId) {
  if (TOOLS.find((x) => x.id === id)?.disabled) return;
  open.value = id;
  input.value = '';
  curlCmd.value = '';
  output.value = '';
  msg.value = '';
  copied.value = false;
  activeId.value = '';
  activeFolder.value = '';
  folderName.value = '';
  if (id === 'postman') loadHistory();
}

async function loadHistory() {
  try {
    const res = await fetch('/api/postman/history');
    const j: any = await res.json().catch(() => ({}));
    history.value = Array.isArray(j.items) ? j.items : [];
    folders.value = Array.isArray(j.folders) ? j.folders : [];
    if (activeFolder.value && !folders.value.includes(activeFolder.value)) activeFolder.value = '';
  } catch { /* 列表拉取失败不影响执行 */ }
}

function pickRecord(r: PostmanRecord) {
  curlCmd.value = r.command;
  activeId.value = r.id;
  output.value = '';
  msg.value = '';
}

async function removeRecord(r: PostmanRecord) {
  try {
    const res = await fetch(`/api/postman/history?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' });
    if (!res.ok) { loadHistory(); return; }
  } catch { loadHistory(); return; }
  history.value = history.value.filter((x) => x.id !== r.id);
  if (activeId.value === r.id) activeId.value = '';
}

async function createFolder() {
  const name = folderName.value.trim();
  if (!name) return;
  const target = activeFolder.value ? `${activeFolder.value}/${name}` : name;
  try {
    const res = await fetch('/api/postman/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: target }),
    });
    if (!res.ok) return;
    folderName.value = '';
    activeFolder.value = target;
    await loadHistory();
  } catch { /* ignore */ }
}

async function removeFolder(p: string) {
  try {
    const res = await fetch(`/api/postman/folder?path=${encodeURIComponent(p)}`, { method: 'DELETE' });
    if (!res.ok) { loadHistory(); return; }
  } catch { loadHistory(); return; }
  if (activeFolder.value === p || activeFolder.value.startsWith(`${p}/`)) activeFolder.value = '';
  await loadHistory();
}

async function dropInto(folder: string) {
  const r = dragRecord.value;
  dragRecord.value = null;
  if (!r || (r.folder || '') === folder) return;
  try {
    const res = await fetch('/api/postman/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: r.id, folder }),
    });
    if (res.ok) await loadHistory();
  } catch { /* ignore */ }
}

function fmtTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
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
      body: JSON.stringify({ command: curlCmd.value, folder: activeFolder.value }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) { msg.value = t('tools.failed', { msg: j.message || j.error || `HTTP ${res.status}` }); return; }
    output.value = [j.stdout, j.stderr ? `--- stderr ---\n${j.stderr}` : ''].filter(Boolean).join(j.stdout ? '\n' : '');
    msg.value = j.timedOut ? t('tools.pm_timeout') : t('tools.pm_exit', { code: j.code });
    loadHistory();
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
      <div v-if="open === 'postman'" class="mtbody mtpm">
        <aside class="mtpmside">
          <div class="mtpmsidehead">
            <span class="mtpmsidetitle">{{ $t('tools.pm_history') }}</span>
            <button class="mtmini" @click="loadHistory">{{ $t('tools.pm_refresh') }}</button>
          </div>
          <div class="mtpmkfolder">
            <input v-model="folderName" class="mtpminput" :placeholder="$t('tools.pm_folder_name')" @keyup.enter="createFolder" />
            <button class="mtmini" :disabled="!folderName.trim()" @click="createFolder">＋</button>
          </div>
          <div class="mtpmroot" :class="{ on: activeFolder === '' }" @click="activeFolder = ''" @dragover.prevent @drop.prevent="dropInto('')">
            {{ $t('tools.pm_root') }}
          </div>
          <div v-if="!treeRows.length" class="mtpmempty">{{ $t('tools.pm_empty') }}</div>
          <ul v-else class="mtpmlist" @dragover.prevent @drop.prevent="dropInto('')">
            <template v-for="row in treeRows" :key="row.key">
              <li v-if="row.kind === 'folder'" class="mtpmfolder" :class="{ on: activeFolder === row.path }" :style="{ paddingLeft: `${8 + row.depth * 12}px` }" @click="activeFolder = row.path" @dragover.prevent @drop.stop.prevent="dropInto(row.path)">
                <span class="mtpmfname">📁 {{ row.name }}</span>
                <button class="mtpmdel" :title="$t('tools.pm_delete')" @click.stop="removeFolder(row.path)">×</button>
              </li>
              <li v-else class="mtpmitem" :class="{ on: activeId === row.record.id }" :style="{ paddingLeft: `${8 + row.depth * 12}px` }" draggable="true" @dragstart="dragRecord = row.record" @click="pickRecord(row.record)">
                <div class="mtpmcmd">{{ row.record.command }}</div>
                <div class="mtpmtime">{{ fmtTime(row.record.updatedAt) }}</div>
                <button class="mtpmdel" :title="$t('tools.pm_delete')" @click.stop="removeRecord(row.record)">×</button>
              </li>
            </template>
          </ul>
        </aside>

        <section class="mtpmmain">
          <div class="mtacts">
            <button class="mtbtn primary" :disabled="busy" @click="runCurlCmd">{{ busy ? $t('tools.pm_running') : $t('tools.run') }}</button>
            <button class="mtbtn" @click="curlCmd = ''; output = ''; msg = ''">{{ $t('tools.clear') }}</button>
            <span class="mtpmsave">{{ $t('tools.pm_saveto', { path: activeFolder || '/' }) }}</span>
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
        </section>
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

.mtpm { flex-direction: row; gap: 12px; }
.mtpmside { width: 260px; flex: none; display: flex; flex-direction: column; border: 1px solid var(--bd); border-radius: 8px; background: var(--bg2); overflow: hidden; }
.mtpmsidehead { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid var(--bd); background: var(--bg4); }
.mtpmsidetitle { font-size: 12px; color: var(--tx3); }
.mtpmlist { list-style: none; margin: 0; padding: 6px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 6px; }
.mtpmitem { position: relative; border: 1px solid var(--bd); border-radius: 6px; padding: 6px 26px 6px 8px; cursor: pointer; background: var(--bg1); }
.mtpmitem:hover { border-color: var(--ac2); }
.mtpmitem.on { border-color: var(--ac); }
.mtpmcmd { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--tx2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mtpmtime { font-size: 11px; color: var(--tx4); margin-top: 2px; }
.mtpmdel { position: absolute; top: 4px; right: 4px; border: none; background: none; color: var(--tx4); cursor: pointer; font-size: 14px; line-height: 1; padding: 2px 4px; }
.mtpmdel:hover { color: var(--ac2); }
.mtpmempty { padding: 12px; font-size: 12px; color: var(--tx4); }
.mtpmmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.mtpmkfolder { display: flex; gap: 6px; padding: 6px 6px 0; }
.mtpminput { flex: 1; min-width: 0; background: var(--bg1); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 8px; font-size: 12px; box-sizing: border-box; }
.mtpminput:focus { outline: none; border-color: var(--ac2); }
.mtpmroot { margin: 6px 6px 0; padding: 5px 8px; font-size: 12px; color: var(--tx3); border: 1px solid var(--bd); border-radius: 6px; cursor: pointer; }
.mtpmroot.on { border-color: var(--ac); color: var(--ac2); }
.mtpmfolder { position: relative; display: flex; align-items: center; border: 1px solid var(--bd); border-radius: 6px; padding: 5px 26px 5px 8px; cursor: pointer; background: var(--bg1); }
.mtpmfolder:hover { border-color: var(--ac2); }
.mtpmfolder.on { border-color: var(--ac); }
.mtpmfname { font-size: 12px; color: var(--tx2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mtpmsave { align-self: center; color: var(--tx4); font-size: 12px; }

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
