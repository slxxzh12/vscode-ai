import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { t } from '../../i18n';
import { usePostmanHistory, type CurlResult, type PostmanRecord } from './usePostmanHistory';
import { postmanTreeSource } from './postmanTreeSource';
import { normalizeCurlCommand } from './curlCommand';
import type { TreeSource } from '../../tree/treeSource';

// Postman 工作台：模块级单例，左侧工具条/树与右侧内容共用同一份状态。
export interface PostmanWorkbench {
  history: Ref<PostmanRecord[]>;
  folders: Ref<string[]>;
  activeId: Ref<string>;
  activeFolder: Ref<string>;
  activeRecord: ComputedRef<PostmanRecord | null>;
  runStatus: Ref<Record<string, 'pass' | 'fail'>>;
  curlCmd: Ref<string>;
  respHeaders: Ref<string>;
  respBody: Ref<string>;
  respStderr: Ref<string>;
  status: Ref<number>;
  failed: Ref<boolean>;
  busy: Ref<boolean>;
  msg: Ref<string>;
  treeSource: TreeSource;
  load(): Promise<void>;
  openRecord(r: PostmanRecord): void;
  normalizeCurlCmd(): void;
  runCurlCmd(): Promise<void>;
  runOne(rec: PostmanRecord): Promise<CurlResult>;
  runFolder(path: string): Promise<void>;
  batchRun(): Promise<void>;
  clearResult(): void;
  clear(): void;
}

let cache: PostmanWorkbench | null = null;

export function usePostmanWorkbench(): PostmanWorkbench {
  if (cache) return cache;
  const hist = usePostmanHistory();
  const activeId = ref('');
  const activeFolder = ref('');
  const runStatus = ref<Record<string, 'pass' | 'fail'>>({});
  const curlCmd = ref('');
  const respHeaders = ref('');
  const respBody = ref('');
  const respStderr = ref('');
  const status = ref(0);
  const failed = ref(false);
  const busy = ref(false);
  const msg = ref('');

  const activeRecord = computed(() => hist.history.value.find((r) => r.id === activeId.value) || null);
  const recordById = (id: string) => hist.history.value.find((r) => r.id === id) || null;

  function clearResult() { respHeaders.value = ''; respBody.value = ''; respStderr.value = ''; status.value = 0; failed.value = false; }
  function openRecord(r: PostmanRecord) { curlCmd.value = r.command; activeId.value = r.id; clearResult(); msg.value = ''; }
  function setStatus(id: string, pass: boolean) { runStatus.value = { ...runStatus.value, [id]: pass ? 'pass' : 'fail' }; }
  function clearStatuses(ids: string[]) { const next = { ...runStatus.value }; for (const id of ids) delete next[id]; runStatus.value = next; }
  function isPass(j: CurlResult) { return !!j.ok && !j.error && !j.timedOut && (Number(j.status) || 0) < 400; }

  async function execCurl(command: string, folder: string): Promise<CurlResult> {
    const j = await hist.runCurl(normalizeCurlCommand(command), folder);
    status.value = Number(j.status) || 0;
    respHeaders.value = j.headers ?? '';
    respBody.value = j.body ?? j.stdout ?? '';
    respStderr.value = j.stderr ?? '';
    failed.value = !j.ok || !!j.error || (status.value === 0 && j.code !== 0);
    msg.value = j.timedOut ? t('tools.pm_timeout') : t('tools.pm_exit', { code: j.code });
    return j;
  }

  function normalizeCurlCmd() { curlCmd.value = normalizeCurlCommand(curlCmd.value); }

  async function runCurlCmd(): Promise<void> {
    if (busy.value) return;
    normalizeCurlCmd();
    if (!curlCmd.value) { msg.value = t('et.empty'); return; }
    busy.value = true; msg.value = ''; clearResult();
    try { await execCurl(curlCmd.value, activeFolder.value); }
    catch (e) { failed.value = true; msg.value = t('tools.failed', { msg: (e as Error)?.message || String(e) }); }
    finally { busy.value = false; }
  }

  async function runOne(rec: PostmanRecord): Promise<CurlResult> {
    curlCmd.value = rec.command; activeId.value = rec.id;
    try {
      const j = await execCurl(rec.command, rec.folder || '');
      setStatus(rec.id, isPass(j));
      return j;
    } catch (e) {
      setStatus(rec.id, false);
      failed.value = true;
      msg.value = t('tools.failed', { msg: (e as Error)?.message || String(e) });
      throw e;
    }
  }

  function folderRecords(path: string) {
    return hist.history.value.filter((r) => { const f = r.folder || ''; return f === path || f.startsWith(`${path}/`); });
  }

  async function runList(list: PostmanRecord[]): Promise<void> {
    if (busy.value) return;
    if (!list.length) { msg.value = t('tools.pm_folder_empty'); return; }
    clearStatuses(list.map((r) => r.id));
    busy.value = true; msg.value = ''; clearResult();
    try {
      for (let i = 0; i < list.length; i += 1) {
        msg.value = t('tools.pm_run_progress', { i: i + 1, total: list.length });
        await runOne(list[i]);
      }
      msg.value = t('tools.pm_run_done', { n: list.length });
    } catch { /* runOne 已记录失败；保持与旧行为一致：遇错停止 */ }
    finally { busy.value = false; }
  }

  async function runFolder(path: string): Promise<void> { await runList(folderRecords(path)); }
  // 未选目录时跑全部（含子目录）；选了目录只跑该目录。
  async function batchRun(): Promise<void> {
    await runList(activeFolder.value ? folderRecords(activeFolder.value) : hist.history.value);
  }
  function clear() { curlCmd.value = ''; clearResult(); msg.value = ''; }

  const treeSource = postmanTreeSource({
    history: () => hist.history.value,
    folders: () => hist.folders.value,
    statusOf: (id) => runStatus.value[id],
    recordById,
    openRecord,
    createFolder: (parent, name) => hist.createFolder(parent, name),
    renameFolder: (path, name) => hist.renameFolder(path, name),
    renameRecord: (id, title) => hist.renameRecord(id, title),
    removeFolder: async (path) => { const r = await hist.removeFolder(path); if (r.ok && (activeFolder.value === path || activeFolder.value.startsWith(`${path}/`))) activeFolder.value = ''; return r; },
    removeRecord: async (id) => { const r = await hist.removeRecord(id); if (r.ok && activeId.value === id) activeId.value = ''; return r; },
    moveRecord: (id, folder) => hist.moveRecord(id, folder),
    runRecord: (r) => { void runOne(r); },
    runFolder: (path) => { void runFolder(path); },
  });

  cache = {
    history: hist.history, folders: hist.folders, activeId, activeFolder, activeRecord, runStatus,
    curlCmd, respHeaders, respBody, respStderr, status, failed, busy, msg, treeSource,
    load: hist.load, openRecord, normalizeCurlCmd, runCurlCmd, runOne, runFolder, batchRun, clearResult, clear,
  };
  return cache;
}
