<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '../../i18n';
import { usePostmanHistory, type PostmanActions, type PostmanRecord } from './usePostmanHistory';
import PostmanTree from './PostmanTree.vue';

const { history, folders, load, createFolder, renameFolder, renameRecord, removeFolder, removeRecord, moveRecord, runCurl } = usePostmanHistory();

const curlCmd = ref('');
const output = ref('');
const busy = ref(false);
const msg = ref('');
const copied = ref(false);
const activeId = ref('');
const activeFolder = ref('');
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const actions: PostmanActions = {
  createFolder: (parent, name) => createFolder(parent, name),
  renameFolder: async (path, name) => {
    const res = await renameFolder(path, name);
    if (res.ok && res.path) {
      if (activeFolder.value === path) activeFolder.value = res.path;
      else if (activeFolder.value.startsWith(`${path}/`)) activeFolder.value = res.path + activeFolder.value.slice(path.length);
    }
    return res;
  },
  renameRecord: (id, title) => renameRecord(id, title),
  removeFolder: async (path) => {
    const res = await removeFolder(path);
    if (res.ok && (activeFolder.value === path || activeFolder.value.startsWith(`${path}/`))) activeFolder.value = '';
    return res;
  },
  removeRecord: async (id) => {
    const res = await removeRecord(id);
    if (res.ok && activeId.value === id) activeId.value = '';
    return res;
  },
  moveRecord: (id, folder) => moveRecord(id, folder),
};

const saveTo = computed(() => (activeFolder.value ? `/${activeFolder.value}` : '/'));

function selectFolder(path: string) { activeFolder.value = path; }
function selectRecord(r: PostmanRecord) { curlCmd.value = r.command; activeId.value = r.id; output.value = ''; msg.value = ''; }

async function runCurlCmd() {
  if (busy.value) return;
  if (!curlCmd.value.trim()) { msg.value = t('et.empty'); return; }
  busy.value = true; msg.value = ''; output.value = '';
  try {
    const j = await runCurl(curlCmd.value, activeFolder.value);
    output.value = [j.stdout, j.stderr ? `--- stderr ---\n${j.stderr}` : ''].filter(Boolean).join(j.stdout ? '\n' : '');
    msg.value = j.timedOut ? t('tools.pm_timeout') : t('tools.pm_exit', { code: j.code });
  } catch (e) {
    msg.value = t('tools.failed', { msg: (e as Error)?.message || String(e) });
  } finally { busy.value = false; }
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

onMounted(() => { void load(); });
</script>

<template>
  <div class="pmbody">
    <aside class="pmside">
      <div class="pmsidehead">
        <span class="pmsidetitle">{{ $t('tools.pm_history') }}</span>
        <button class="pmmini" @click="load()">{{ $t('tools.pm_refresh') }}</button>
      </div>
      <PostmanTree
        :folders="folders"
        :records="history"
        :active-folder="activeFolder"
        :active-id="activeId"
        :actions="actions"
        @select-folder="selectFolder"
        @select-record="selectRecord"
      />
    </aside>

    <section class="pmmain">
      <div class="pmactsbar">
        <button class="pmbtn primary pmrun" :disabled="busy" @click="runCurlCmd">{{ busy ? $t('tools.pm_running') : $t('tools.run') }}</button>
        <button class="pmbtn" @click="curlCmd = ''; output = ''; msg = ''">{{ $t('tools.clear') }}</button>
        <span class="pmsave">{{ $t('tools.pm_saveto', { path: saveTo }) }}</span>
      </div>

      <div v-if="msg" class="pmmsg">{{ msg }}</div>

      <div class="pmcurlbox">
        <div class="pmcurlbar"><span class="pmcurlprompt">curl</span><span class="pmcurltip">{{ $t('tools.pm_tip') }}</span></div>
        <textarea v-model="curlCmd" class="pmcurl" :placeholder="$t('tools.pm_ph')" spellcheck="false" />
      </div>

      <label class="pmlabel">{{ $t('tools.pm_resp') }}</label>
      <div class="pmoutwrap">
        <textarea v-model="output" class="pmout" :placeholder="$t('tools.output')" spellcheck="false" readonly />
        <div class="pmoutacts">
          <button class="pmmini" :disabled="!output" @click="copyOut">{{ copied ? $t('tools.copied') : $t('tools.copy') }}</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pmbody { display: flex; flex-direction: row; gap: 12px; height: calc(100vh - 150px); }
.pmside { width: 280px; flex: none; display: flex; flex-direction: column; border: 1px solid var(--bd); border-radius: 8px; background: var(--bg2); overflow: hidden; padding: 6px; box-sizing: border-box; }
.pmsidehead { display: flex; align-items: center; justify-content: space-between; padding: 2px 4px 6px; }
.pmsidetitle { font-size: 12px; color: var(--tx3); }
.pmmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.pmactsbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pmbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.pmbtn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.pmbtn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.pmbtn:disabled { opacity: .55; cursor: default; }
.pmsave { color: var(--tx4); font-size: 12px; }
.pmmsg { color: var(--tx3); font-size: 12px; }
.pmlabel { color: var(--tx3); font-size: 12px; }
.pmcurlbox { display: flex; flex-direction: column; border: 1px solid var(--ac2); border-radius: 8px; overflow: hidden; background: var(--bg1); }
.pmcurlbar { display: flex; align-items: center; gap: 8px; padding: 4px 10px; background: var(--bg4); border-bottom: 1px solid var(--bd); }
.pmcurlprompt { font-family: ui-monospace, Consolas, monospace; font-size: 12px; font-weight: 700; color: var(--ac2); }
.pmcurltip { color: var(--tx4); font-size: 11px; }
.pmcurl { flex: none; min-height: 120px; resize: none; border: none; background: transparent; color: var(--tx); padding: 10px 12px; font-size: 13px; line-height: 1.6; font-family: ui-monospace, Consolas, monospace; box-sizing: border-box; }
.pmcurl:focus { outline: none; }
.pmoutwrap { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
.pmout { flex: 1; min-height: 120px; resize: none; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 6px; padding: 10px 12px; font-size: 13px; line-height: 1.6; font-family: ui-monospace, Consolas, monospace; box-sizing: border-box; }
.pmout:focus { outline: none; border-color: var(--ac2); }
.pmoutacts { display: flex; gap: 8px; justify-content: flex-end; }
.pmmini { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
.pmmini:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.pmmini:disabled { opacity: .5; cursor: default; }
</style>
