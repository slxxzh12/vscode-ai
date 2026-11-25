import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { t } from '../../i18n';
import { pickErrorText } from '../../pickFolder';
import { quoteIdent, useNavicat, type ExecResult, type NavicatProfile, type NavicatType } from './useNavicat';
import { navicatTreeSource } from './navicatTreeSource';
import { uniqueConnName } from './sqliteFile';
import { buildProfiles, dedupeKey, detectImportMapping, parseCsv, parseCsvProfiles, type CsvParseResult, type ImportField } from './csvImport';
import type { TreeSource } from '../../tree/treeSource';

// Navicat 工作台：模块级单例，左侧工具条/树与右侧内容、连接弹窗共用同一份状态。
export interface NavicatWorkbench {
  profiles: Ref<NavicatProfile[]>;
  activeId: Ref<string>;
  activeFolder: Ref<string>;
  activeDatabase: Ref<string>;
  activeProfile: ComputedRef<NavicatProfile | null>;
  sql: Ref<string>;
  result: Ref<ExecResult | null>;
  busy: Ref<boolean>;
  msg: Ref<string>;
  dlg: Ref<boolean>;
  dlgTab: Ref<string>;
  dlgMsg: Ref<string>;
  form: Ref<NavicatProfile>;
  saving: Ref<boolean>;
  testing: Ref<boolean>;
  importing: Ref<boolean>;
  importOpen: Ref<boolean>;
  importName: Ref<string>;
  importRows: Ref<string[][]>;
  importHasHeader: Ref<boolean>;
  importMap: Ref<Record<number, ImportField | null>>;
  importError: Ref<string>;
  importHostMapped: ComputedRef<boolean>;
  importPreview(): CsvParseResult;
  failedIds: Ref<Set<string>>;
  connStatus: Ref<Record<string, 'pass' | 'fail'>>;
  exportDlg: Ref<boolean>;
  exportIds: Ref<string[]>;
  exportDbs: Ref<Record<string, string>>;
  exportDbOptions: Ref<Record<string, string[]>>;
  ensureExportDbs(id: string): Promise<void>;
  exportProgress: Ref<any>;
  cancelExportRun(): Promise<void>;
  exportN: Ref<number>;
  exportSample: Ref<boolean>;
  exportOutDir: Ref<string>;
  pickExportOutDir(): Promise<void>;
  exportSql: Ref<boolean>;
  exportCsv: Ref<boolean>;
  exporting: Ref<boolean>;
  exportMsg: Ref<string>;
  treeSource: TreeSource;
  load(): Promise<void>;
  onFolder(key: string): void;
  onTypeChange(): void;
  pickTable(id: string, db: string, table: string): void;
  openNew(): void;
  openEdit(p: NavicatProfile): Promise<void>;
  doSave(): Promise<void>;
  doTest(): Promise<void>;
  importCsv(file: File): Promise<void>;
  openImportCsv(file: File): Promise<void>;
  closeImportCsv(): void;
  doImportCsv(): Promise<void>;
  openExport(): Promise<void>;
  toggleAllExport(on: boolean): void;
  doExportData(): Promise<void>;
  onRemove(p: NavicatProfile): Promise<void>;
  doExec(sqlText?: string): Promise<void>;
  copyConn(withPassword: boolean): Promise<void>;
  doExport(): Promise<void>;
  editActive(): void;
  browseFile(): Promise<void>;
  openSqliteFile(abs: string, name: string): Promise<void>;
}

function blank(): NavicatProfile {
  return { name: '', type: 'mysql', host: '127.0.0.1', port: '3306', user: 'root', database: '', password: '', options: { ssl: false } };
}
function defaultPort(type: NavicatType): string {
  return type === 'mysql' ? '3306' : type === 'postgres' ? '5432' : type === 'redis' ? '6379' : '';
}

let cache: NavicatWorkbench | null = null;

export function useNavicatWorkbench(): NavicatWorkbench {
  if (cache) return cache;
  const nav = useNavicat();
  const activeId = ref('');
  const activeFolder = ref('');
  const activeDatabase = ref('');
  const sql = ref('');
  const result = ref<ExecResult | null>(null);
  const busy = ref(false);
  const msg = ref('');
  const dlg = ref(false);
  const dlgTab = ref('general');
  const dlgMsg = ref('');
  const form = ref<NavicatProfile>(blank());
  const saving = ref(false);
  const testing = ref(false);
  const importing = ref(false);
  const importOpen = ref(false);
  const importName = ref('');
  const importRows = ref<string[][]>([]);
  const importHasHeader = ref(false);
  const importMap = ref<Record<number, ImportField | null>>({});
  const importError = ref('');
  const failedIds = ref<Set<string>>(new Set());
  const connStatus = ref<Record<string, 'pass' | 'fail'>>({});
  const exportDlg = ref(false);
  const exportIds = ref<string[]>([]);
  const exportDbs = ref<Record<string, string>>({});
  const exportDbOptions = ref<Record<string, string[]>>({});
  const exportProgress = ref<any>(null);
  const exportJobId = ref('');
  const exportN = ref(30);
  const exportSample = ref(true);
  const exportOutDir = ref('');
  const exportSql = ref(true);
  const exportCsv = ref(true);
  const exporting = ref(false);
  const exportMsg = ref('');

  const activeProfile = computed(() => nav.profiles.value.find((p) => p.id === activeId.value) || null);
  const profileById = (id: string) => nav.profiles.value.find((p) => String(p.id) === id) || null;

  function selectConn(p: NavicatProfile) {
    activeId.value = p.id || '';
    activeDatabase.value = p.type === 'sqlite' ? '' : (p.database || '');
    result.value = null;
    msg.value = '';
  }

  function onFolder(key: string) {
    activeFolder.value = key;
    if (!key) { activeId.value = ''; activeDatabase.value = ''; return; }
    const parts = key.split('\u0000');
    const [kind, id] = parts[0].split(':');
    const p = profileById(id);
    if (!p) return;
    if (kind === 'c') selectConn(p);
    else if (kind === 'd') { selectConn(p); activeDatabase.value = parts[1] || ''; }
  }

  function pickTable(id: string, db: string, table: string) {
    const p = profileById(id);
    if (!p) return;
    if (p.type !== 'sqlite') activeDatabase.value = db;
    const stmt = `SELECT * FROM ${quoteIdent(p.type, table)}`;
    const cur = sql.value.replace(/\s+$/, '');
    sql.value = cur ? `${cur}\n${stmt}` : stmt;
  }

  function onTypeChange() {
    if (!form.value.port || ['3306', '5432', '6379', ''].includes(form.value.port)) form.value.port = defaultPort(form.value.type);
    if (form.value.type === 'sqlite') dlgTab.value = 'general';
  }

  function openNew() { form.value = blank(); dlgMsg.value = ''; dlgTab.value = 'general'; dlg.value = true; }
  async function openEdit(p: NavicatProfile) {
    form.value = { ...blank(), ...p, password: '', options: { ssl: false, ...(p.options || {}) } };
    dlgMsg.value = ''; dlgTab.value = 'general'; dlg.value = true;
    if (p.hasPassword && p.id) { try { form.value.password = await nav.reveal(p.id); } catch { /* ignore */ } }
  }
  function editActive() { if (activeProfile.value) void openEdit(activeProfile.value); }

  async function browseFile() {
    dlgMsg.value = '';
    try {
      const r = await nav.pickFile();
      if (r.path) { form.value = { ...form.value, database: r.path }; return; }
      if (r.error) dlgMsg.value = t('nv.pick_failed');
    } catch (e) { dlgMsg.value = (e as Error).message; }
  }

  async function openSqliteFile(abs: string, name: string) {
    if (!abs) return;
    await nav.load();
    const ex = nav.profiles.value.find((p) => p.type === 'sqlite' && p.database === abs);
    if (ex) { selectConn(ex); if (ex.id) activeFolder.value = `c:${ex.id}`; return; }
    const names = nav.profiles.value.map((p) => p.name);
    const saved = await nav.save({ name: uniqueConnName(name, names), type: 'sqlite', host: '', port: '', user: '', database: abs, password: '' });
    selectConn(saved);
    if (saved.id) activeFolder.value = `c:${saved.id}`;
  }

  async function doSave() {
    if (!form.value.name.trim()) { dlgMsg.value = t('nv.required_name'); return; }
    saving.value = true; dlgMsg.value = '';
    try {
      const payload = { ...form.value, database: form.value.type === 'sqlite' ? form.value.database : '' };
      const saved = await nav.save(payload);
      dlg.value = false;
      activeId.value = saved.id || '';
      activeDatabase.value = saved.type === 'sqlite' ? '' : (saved.database || '');
      activeFolder.value = saved.id ? `c:${saved.id}` : '';
      msg.value = t('nv.saved');
    } catch (e) { dlgMsg.value = (e as Error).message; } finally { saving.value = false; }
  }

  async function doTest() {
    testing.value = true; dlgMsg.value = '';
    try {
      if (form.value.id && !form.value.password) await nav.test({ id: form.value.id });
      else await nav.test({ profile: form.value });
      if (form.value.id) connStatus.value = { ...connStatus.value, [String(form.value.id)]: 'pass' };
      dlgMsg.value = t('nv.test_ok');
    } catch (e) {
      if (form.value.id) connStatus.value = { ...connStatus.value, [String(form.value.id)]: 'fail' };
      dlgMsg.value = (e as Error).message;
    } finally { testing.value = false; }
  }

  const importHostMapped = computed(() => Object.values(importMap.value).includes('host'));

  function importPreview(): CsvParseResult {
    return buildProfiles(importRows.value, { hasHeader: importHasHeader.value, map: importMap.value });
  }

  async function applyProfiles(parsed: CsvParseResult): Promise<void> {
    await nav.load();
    const seen = new Set(nav.profiles.value.map(dedupeKey));
    const fresh: NavicatProfile[] = [];
    let skipped = 0;
    for (const p of parsed.profiles) {
      const key = dedupeKey(p);
      if (seen.has(key)) { skipped += 1; continue; }
      seen.add(key);
      fresh.push(p);
    }

    const created: NavicatProfile[] = [];
    const saveFailLines: string[] = [];
    for (const p of fresh) {
      try { created.push(await nav.save(p)); }
      catch (e) { saveFailLines.push(t('nv.import_fail_line', { name: p.name, msg: (e as Error).message })); }
    }

    let pass = 0;
    let fail = 0;
    const testFailLines: string[] = [];
    for (let i = 0; i < created.length; i += 1) {
      msg.value = t('nv.import_testing', { i: i + 1, n: created.length });
      const c = created[i];
      try {
        await nav.test({ id: String(c.id || '') });
        pass += 1;
        if (c.id) connStatus.value = { ...connStatus.value, [String(c.id)]: 'pass' };
      } catch (e) {
        fail += 1;
        if (c.id) {
          failedIds.value.add(String(c.id));
          connStatus.value = { ...connStatus.value, [String(c.id)]: 'fail' };
        }
        testFailLines.push(t('nv.import_fail_line', { name: c.name, msg: (e as Error).message }));
      }
    }

    let summary = t('nv.import_done', {
      ok: created.length, dup: skipped, bad: parsed.errors.length, pass, fail,
    });
    const details = [...saveFailLines, ...testFailLines];
    if (details.length) summary += `\n${details.join('\n')}`;
    msg.value = summary;
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('df-refresh-tree'));
  }

  async function importCsv(file: File): Promise<void> {
    if (!file) return;
    importing.value = true;
    msg.value = '';
    try {
      const parsed = parseCsvProfiles(await file.text());
      if (!parsed.profiles.length) { msg.value = t('nv.import_empty'); return; }
      await applyProfiles(parsed);
    } catch (e) {
      msg.value = (e as Error).message;
    } finally {
      importing.value = false;
    }
  }

  // 选文件后先解析并打开预览：用户可改「列 → 字段」映射，再确认批量导入。
  async function openImportCsv(file: File): Promise<void> {
    if (!file) return;
    msg.value = '';
    importError.value = '';
    try {
      const rows = parseCsv(await file.text());
      if (!rows.length) { msg.value = t('nv.import_empty'); return; }
      const mapping = detectImportMapping(rows);
      importName.value = file.name || '';
      importRows.value = rows;
      importHasHeader.value = mapping.hasHeader;
      importMap.value = mapping.map;
      importOpen.value = true;
    } catch (e) {
      msg.value = (e as Error).message;
    }
  }

  function closeImportCsv(): void {
    if (importing.value) return;
    importOpen.value = false;
    importError.value = '';
  }

  async function doImportCsv(): Promise<void> {
    const preview = importPreview();
    if (!preview.profiles.length) { importError.value = t('nv.import_empty'); return; }
    importing.value = true;
    importError.value = '';
    msg.value = '';
    try {
      await applyProfiles(preview);
      importOpen.value = false;
    } catch (e) {
      importError.value = (e as Error).message;
    } finally {
      importing.value = false;
    }
  }

  async function openExport(): Promise<void> {
    await nav.load();
    exportIds.value = nav.profiles.value.filter((p) => p.id).map((p) => String(p.id));
    exportDbs.value = {};
    exportDbOptions.value = {};
    for (const p of nav.profiles.value.filter((p) => p.id)) exportDbs.value[String(p.id)] = '';
    exportN.value = 30;
    exportSample.value = true;
    exportOutDir.value = '';
    exportSql.value = true;
    exportCsv.value = true;
    exportMsg.value = '';
    exportDlg.value = true;
  }

  // 数据库可能很多：只在展开某个连接的库下拉时按需拉取，避免打开导出框就批量查询。
  function ensureExportDbs(id: string): Promise<void> {
    const key = String(id || '');
    const p = nav.profiles.value.find((x) => String(x.id) === key);
    if (!p || (p.type !== 'mysql' && p.type !== 'postgres')) return Promise.resolve();
    if (exportDbOptions.value[key]) return Promise.resolve();
    return nav.listDatabases(key)
      .then((list) => { exportDbOptions.value = { ...exportDbOptions.value, [key]: list }; })
      .catch(() => { exportDbOptions.value = { ...exportDbOptions.value, [key]: [] }; });
  }

  function toggleAllExport(on: boolean) {
    exportIds.value = on ? nav.profiles.value.filter((p) => p.id).map((p) => String(p.id)) : [];
  }

  async function doExportData(): Promise<void> {
    if (!exportIds.value.length) { exportMsg.value = t('nv.export_pick_conn'); return; }
    const formats = [exportSql.value ? 'sql' : '', exportCsv.value ? 'csv' : ''].filter(Boolean);
    if (!formats.length) { exportMsg.value = t('nv.export_pick_format'); return; }
    exporting.value = true;
    exportMsg.value = '';
    exportProgress.value = null;
    exportJobId.value = '';
    try {
      const jobId = await nav.startExport(exportIds.value, exportN.value, formats, exportDbs.value, exportSample.value, exportOutDir.value);
      if (!jobId) throw new Error('export job not created');
      exportJobId.value = jobId;
      for (;;) {
        await new Promise((r) => setTimeout(r, 700));
        const st = await nav.exportJob(jobId);
        exportProgress.value = st.progress || null;
        if (st.status === 'done') {
          if (st.outputDir) {
            exportDlg.value = false;
            msg.value = st.errorsCount ? t('nv.export_done_dir_errors', { dir: st.outputDir, n: st.errorsCount }) : t('nv.export_done_dir', { dir: st.outputDir });
            break;
          }
          const blob = await nav.downloadExport(jobId);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `navicat-export-${Date.now()}.zip`;
          a.click();
          URL.revokeObjectURL(url);
          exportDlg.value = false;
          msg.value = st.errorsCount ? t('nv.export_done_errors', { n: st.errorsCount }) : t('nv.exported');
          break;
        }
        if (st.status === 'cancelled') { exportMsg.value = t('nv.export_cancelled'); break; }
        if (st.status === 'error') throw new Error(st.error || 'export failed');
      }
    } catch (e) {
      exportMsg.value = (e as Error).message;
    } finally {
      exporting.value = false;
      exportJobId.value = '';
      exportProgress.value = null;
    }
  }

  async function pickExportOutDir(): Promise<void> {
    try {
      const r = await nav.pickFolder();
      if (r?.error) { exportMsg.value = pickErrorText(r); return; }
      if (r?.cancelled || !r?.path) return;
      exportOutDir.value = r.path;
    } catch (e) {
      exportMsg.value = (e as Error).message;
    }
  }

  async function cancelExportRun(): Promise<void> {
    const id = exportJobId.value;
    if (!id) return;
    try { await nav.cancelExport(id); } catch { /* ignore */ }
  }

  async function onRemove(p: NavicatProfile) {
    try { await ElMessageBox.confirm(t('nv.delete_confirm'), t('nv.delete'), { type: 'warning' }); }
    catch { return; }
    await nav.remove(p.id!);
    if (p.id) { failedIds.value.delete(p.id); const next = { ...connStatus.value }; delete next[String(p.id)]; connStatus.value = next; }
    if (activeId.value === p.id) { activeId.value = ''; activeDatabase.value = ''; activeFolder.value = ''; result.value = null; }
  }

  async function doExec(sqlText?: string) {
    if (!activeId.value) { msg.value = t('nv.save_first'); return; }
    const stmt = String(sqlText ?? sql.value);
    if (!stmt.trim()) return;
    busy.value = true; msg.value = '';
    try {
      let out = await nav.exec(activeId.value, stmt, activeDatabase.value);
      if (out.needConfirm) {
        try { await ElMessageBox.confirm(t('nv.confirm_write'), t('nv.confirm_title'), { type: 'warning' }); }
        catch { busy.value = false; return; }
        out = await nav.exec(activeId.value, stmt, activeDatabase.value, true);
      }
      result.value = out.result || null;
    } catch (e) { msg.value = (e as Error).message; } finally { busy.value = false; }
  }

  async function copyConn(withPassword: boolean) {
    if (!activeId.value) { msg.value = t('nv.save_first'); return; }
    try { const text = await nav.connstr(activeId.value, withPassword); await navigator.clipboard.writeText(text); msg.value = t('nv.copied'); }
    catch (e) { msg.value = (e as Error).message; }
  }

  async function doExport() {
    if (!activeId.value) { msg.value = t('nv.save_first'); return; }
    try {
      const xml = await nav.exportNcx([activeId.value]);
      const blob = new Blob([xml], { type: 'application/xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'navicat.ncx';
      a.click();
      URL.revokeObjectURL(a.href);
      msg.value = t('nv.exported');
    } catch (e) { msg.value = (e as Error).message; }
  }

  const treeSource = navicatTreeSource({
    profiles: () => nav.profiles.value,
    profileById,
    failedIds: () => failedIds.value,
    statusOf: (id) => connStatus.value[String(id)],
    databases: (id) => nav.listDatabases(id),
    tables: (id, db) => nav.listTables(id, db),
    openConnection: (id) => { const p = profileById(id); if (p) selectConn(p); },
    openDatabase: (id, db) => { const p = profileById(id); if (p) { selectConn(p); activeDatabase.value = db; } },
    pickTable,
    renameConnection: async (id, name) => { await nav.rename(id, name); if (activeId.value === id) msg.value = ''; },
    removeConnection: async (id) => { const p = profileById(id); if (p) await onRemove(p); },
  });

  cache = {
    profiles: nav.profiles, activeId, activeFolder, activeDatabase, activeProfile, sql, result, busy, msg,
    dlg, dlgTab, dlgMsg, form, saving, testing, importing, failedIds, connStatus,
    importOpen, importName, importRows, importHasHeader, importMap, importError, importHostMapped, importPreview,
    exportDlg, exportIds, exportDbs, exportDbOptions, exportN, exportSample, exportOutDir, exportSql, exportCsv, exporting, exportMsg, treeSource,
    load: nav.load, onFolder, onTypeChange, pickTable, openNew, openEdit, doSave, doTest, importCsv,
    openImportCsv, closeImportCsv, doImportCsv,
    openExport, ensureExportDbs, pickExportOutDir, exportProgress, cancelExportRun, toggleAllExport, doExportData, onRemove, doExec, copyConn, doExport, editActive, browseFile, openSqliteFile,
  };
  return cache;
}
