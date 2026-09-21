<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '../../i18n';
import { usePostmanHistory, type CurlResult, type PostmanActions, type PostmanRecord } from './usePostmanHistory';
import PostmanTree from './PostmanTree.vue';
import CodeEditor from '../../components/CodeEditor.vue';
import { DIALOG_ACTIONS_TARGET } from '../dialogActions';

const { history, folders, load, createFolder, renameFolder, renameRecord, removeFolder, removeRecord, moveRecord, runCurl } = usePostmanHistory();

const actionsTarget = inject(DIALOG_ACTIONS_TARGET, '');

const curlCmd = ref('');
const respHeaders = ref('');
const respBody = ref('');
const respStderr = ref('');
const status = ref(0);
const failed = ref(false);
const busy = ref(false);
const msg = ref('');
const copied = ref(false);
const activeId = ref('');
const activeFolder = ref('');
const runStatus = ref<Record<string, 'pass' | 'fail'>>({});
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const hasOutput = computed(() => !!(respHeaders.value || respBody.value || respStderr.value));
const respState = computed(() => {
  if (status.value >= 400) return 'err';
  if (status.value >= 200 && status.value < 300) return 'ok';
  if (status.value > 0) return 'neutral';
  return failed.value ? 'warn' : 'neutral';
});

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

function clearResult() { respHeaders.value = ''; respBody.value = ''; respStderr.value = ''; status.value = 0; failed.value = false; }

function selectFolder(path: string) { activeFolder.value = path; }
function selectRecord(r: PostmanRecord) { curlCmd.value = r.command; activeId.value = r.id; clearResult(); msg.value = ''; }

function setStatus(id: string, pass: boolean) { runStatus.value = { ...runStatus.value, [id]: pass ? 'pass' : 'fail' }; }
function clearStatuses(ids: string[]) {
  const next = { ...runStatus.value };
  for (const id of ids) delete next[id];
  runStatus.value = next;
}
function isPass(j: CurlResult) { return !!j.ok && !j.error && !j.timedOut && (Number(j.status) || 0) < 400; }

async function execCurl(command: string, folder: string): Promise<CurlResult> {
  const j = await runCurl(command, folder);
  status.value = Number(j.status) || 0;
  respHeaders.value = j.headers ?? '';
  respBody.value = j.body ?? j.stdout ?? '';
  respStderr.value = j.stderr ?? '';
  failed.value = !j.ok || !!j.error || (status.value === 0 && j.code !== 0);
  msg.value = j.timedOut ? t('tools.pm_timeout') : t('tools.pm_exit', { code: j.code });
  return j;
}

async function runCurlCmd() {
  if (busy.value) return;
  if (!curlCmd.value.trim()) { msg.value = t('et.empty'); return; }
  busy.value = true; msg.value = ''; clearResult();
  try { await execCurl(curlCmd.value, activeFolder.value); }
  catch (e) {
    failed.value = true;
    msg.value = t('tools.failed', { msg: (e as Error)?.message || String(e) });
  } finally { busy.value = false; }
}

async function runRecord(rec: PostmanRecord) {
  if (busy.value) return;
  curlCmd.value = rec.command; activeId.value = rec.id;
  busy.value = true; msg.value = ''; clearResult();
  try { setStatus(rec.id, isPass(await execCurl(rec.command, rec.folder || ''))); }
  catch (e) {
    setStatus(rec.id, false);
    failed.value = true;
    msg.value = t('tools.failed', { msg: (e as Error)?.message || String(e) });
  } finally { busy.value = false; }
}

function folderRecords(path: string) {
  return history.value.filter((r) => { const f = r.folder || ''; return f === path || f.startsWith(`${path}/`); });
}

async function runFolder(path: string) {
  if (busy.value) return;
  const list = folderRecords(path);
  if (!list.length) { msg.value = t('tools.pm_folder_empty'); return; }
  clearStatuses(list.map((r) => r.id));
  busy.value = true; msg.value = ''; clearResult();
  try {
    for (let i = 0; i < list.length; i += 1) {
      const r = list[i];
      activeId.value = r.id;
      msg.value = t('tools.pm_run_progress', { i: i + 1, total: list.length });
      setStatus(r.id, isPass(await execCurl(r.command, r.folder || '')));
    }
    msg.value = t('tools.pm_run_done', { n: list.length });
  } catch (e) {
    failed.value = true;
    msg.value = t('tools.failed', { msg: (e as Error)?.message || String(e) });
  } finally { busy.value = false; }
}

function allOutput() {
  const parts: string[] = [];
  if (respHeaders.value) parts.push(respHeaders.value);
  if (respBody.value) parts.push(respBody.value);
  if (respStderr.value) parts.push(respStderr.value);
  return parts.join('\n');
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
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

async function copyOut() {
  if (!hasOutput.value) return;
  await copyText(allOutput());
}

type EnlargeKey = 'headers' | 'body' | 'stderr';
const enlarged = ref<{ title: string; value: string; placeholder: string } | null>(null);
const enlargeMeta: Record<EnlargeKey, { titleKey: string; phKey: string; read: () => string }> = {
  headers: { titleKey: 'tools.pm_headers', phKey: 'tools.pm_noheaders', read: () => respHeaders.value },
  body: { titleKey: 'tools.pm_body', phKey: 'tools.output', read: () => respBody.value },
  stderr: { titleKey: 'tools.pm_stderr', phKey: 'tools.pm_nostderr', read: () => respStderr.value },
};

function openEnlarge(key: EnlargeKey) {
  const m = enlargeMeta[key];
  enlarged.value = { title: t(m.titleKey), value: m.read(), placeholder: t(m.phKey) };
}
function closeEnlarge() { enlarged.value = null; }
function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape' && enlarged.value) closeEnlarge(); }

onMounted(() => { void load(); window.addEventListener('keydown', onKeydown); });
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
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
        :statuses="runStatus"
        @select-folder="selectFolder"
        @select-record="selectRecord"
        @run-folder="runFolder"
        @run-record="runRecord"
      />
    </aside>

    <section class="pmmain">
      <Teleport :to="actionsTarget || 'body'" :disabled="!actionsTarget" defer>
        <div class="pmactsbar">
          <button class="pmbtn primary pmrun" :disabled="busy" @click="runCurlCmd">{{ busy ? $t('tools.pm_running') : $t('tools.run') }}</button>
          <button class="pmbtn" @click="curlCmd = ''; clearResult(); msg = ''">{{ $t('tools.clear') }}</button>
          <span class="pmsave">{{ $t('tools.pm_saveto', { path: saveTo }) }}</span>
        </div>
      </Teleport>

      <div class="pmmsgrow"><div v-if="msg" class="pmmsg">{{ msg }}</div></div>

      <div class="pmcurlbox">
        <div class="pmcurlbar"><span class="pmcurlprompt">curl</span><span class="pmcurltip">{{ $t('tools.pm_tip') }}</span></div>
        <CodeEditor v-model="curlCmd" class="pmcurl" language="cmd.sh" :placeholder="$t('tools.pm_ph')" />
      </div>

      <label class="pmlabel">{{ $t('tools.pm_resp') }}</label>
      <div class="pmresp" :class="respState">
        <div class="pmfieldbox">
          <div class="pmfieldhead">
            <span class="pmfieldlabel">{{ $t('tools.pm_headers') }}</span>
            <button class="pmmini pmenlarge" :disabled="!respHeaders" @click="openEnlarge('headers')">{{ $t('tools.pm_enlarge') }}</button>
          </div>
          <CodeEditor v-model="respHeaders" class="pmfield pmheaders" readonly :placeholder="$t('tools.pm_noheaders')" />
        </div>
        <div class="pmfieldbox">
          <div class="pmfieldhead">
            <span class="pmfieldlabel">{{ $t('tools.pm_body') }}</span>
            <button class="pmmini pmenlarge" :disabled="!respBody" @click="openEnlarge('body')">{{ $t('tools.pm_enlarge') }}</button>
          </div>
          <CodeEditor v-model="respBody" class="pmfield pmout" readonly :placeholder="$t('tools.output')" />
        </div>
        <div class="pmfieldbox">
          <div class="pmfieldhead">
            <span class="pmfieldlabel">{{ $t('tools.pm_stderr') }}</span>
            <button class="pmmini pmenlarge" :disabled="!respStderr" @click="openEnlarge('stderr')">{{ $t('tools.pm_enlarge') }}</button>
          </div>
          <CodeEditor v-model="respStderr" class="pmfield pmstderr" readonly :placeholder="$t('tools.pm_nostderr')" />
        </div>
        <div class="pmoutacts">
          <button class="pmmini" :disabled="!hasOutput" @click="copyOut">{{ copied ? $t('tools.copied') : $t('tools.copy') }}</button>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="enlarged" class="pmoverlay" @click.self="closeEnlarge">
        <div class="pmmodal" role="dialog" aria-modal="true">
          <header class="pmmodalhead">
            <span class="pmmodaltitle">{{ enlarged?.title }}</span>
            <div class="pmmodalacts">
              <button class="pmmini" @click="copyText(enlarged?.value ?? '')">{{ copied ? $t('tools.copied') : $t('tools.copy') }}</button>
              <button class="pmmini pmclose" @click="closeEnlarge">{{ $t('tools.pm_close') }}</button>
            </div>
          </header>
          <CodeEditor :model-value="enlarged?.value ?? ''" class="pmmodaledit" readonly :placeholder="enlarged?.placeholder ?? ''" />
        </div>
      </div>
    </Teleport>
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
/* 提示信息固定占一行，避免出现/消失时内容上下跳动 */
.pmmsgrow { min-height: 16px; }
.pmmsg { color: var(--tx3); font-size: 12px; line-height: 16px; }
.pmlabel { color: var(--tx3); font-size: 12px; }
.pmcurlbox { display: flex; flex-direction: column; border: 1px solid var(--ac2); border-radius: 8px; overflow: hidden; background: var(--bg1); }
.pmcurlbar { display: flex; align-items: center; gap: 8px; padding: 4px 10px; background: var(--bg4); border-bottom: 1px solid var(--bd); }
.pmcurlprompt { font-family: ui-monospace, Consolas, monospace; font-size: 12px; font-weight: 700; color: var(--ac2); }
.pmcurltip { color: var(--tx4); font-size: 11px; }
.pmcurl { flex: none; --cm-min: 120px; --cm-border: none; --cm-radius: 0; background: transparent; }
/* 响应区：三个框固定高度，超出时整区滚动，避免互相挤压 */
.pmresp { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; padding-right: 4px; }
.pmfieldbox { flex: none; display: flex; flex-direction: column; gap: 4px; }
.pmfieldhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pmfieldlabel { color: var(--tx4); font-size: 12px; font-family: ui-monospace, Consolas, monospace; }
.pmfield { --cm-min: 96px; }
.pmheaders { height: 120px; }
.pmout { height: 260px; }
.pmstderr { height: 160px; }
.pmenlarge { padding: 2px 10px; font-size: 12px; }
.pmresp.ok .pmfield { border-color: #2e7d32; }
.pmresp.err .pmfield { border-color: #c62828; }
.pmresp.warn .pmfield { border-color: #f9a825; }
.pmoutacts { display: flex; gap: 8px; justify-content: flex-end; }
.pmmini { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
.pmmini:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.pmmini:disabled { opacity: .5; cursor: default; }
/* 放大浮层：固定尺寸居中，不拖拽/缩放 */
.pmoverlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 80; }
.pmmodal { width: min(1100px, 92vw); height: 86vh; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 16px 48px rgba(0, 0, 0, .5); display: flex; flex-direction: column; overflow: hidden; }
.pmmodalhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--bd); }
.pmmodaltitle { color: var(--tx2); font-size: 13px; font-family: ui-monospace, Consolas, monospace; }
.pmmodalacts { display: flex; gap: 8px; }
.pmmodaledit { flex: 1; min-height: 0; --cm-min: 0; --cm-border: none; --cm-radius: 0; }
</style>
