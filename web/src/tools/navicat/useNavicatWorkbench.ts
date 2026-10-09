import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { t } from '../../i18n';
import { quoteIdent, useNavicat, type ExecResult, type NavicatProfile, type NavicatType } from './useNavicat';
import { navicatTreeSource } from './navicatTreeSource';
import { uniqueConnName } from './sqliteFile';
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
  treeSource: TreeSource;
  load(): Promise<void>;
  onFolder(key: string): void;
  onTypeChange(): void;
  pickTable(id: string, db: string, table: string): void;
  openNew(): void;
  openEdit(p: NavicatProfile): Promise<void>;
  doSave(): Promise<void>;
  doTest(): Promise<void>;
  onRemove(p: NavicatProfile): Promise<void>;
  doExec(): Promise<void>;
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
      dlgMsg.value = t('nv.test_ok');
    } catch (e) { dlgMsg.value = (e as Error).message; } finally { testing.value = false; }
  }

  async function onRemove(p: NavicatProfile) {
    try { await ElMessageBox.confirm(t('nv.delete_confirm'), t('nv.delete'), { type: 'warning' }); }
    catch { return; }
    await nav.remove(p.id!);
    if (activeId.value === p.id) { activeId.value = ''; activeDatabase.value = ''; activeFolder.value = ''; result.value = null; }
  }

  async function doExec() {
    if (!activeId.value) { msg.value = t('nv.save_first'); return; }
    if (!sql.value.trim()) return;
    busy.value = true; msg.value = '';
    try {
      let out = await nav.exec(activeId.value, sql.value, activeDatabase.value);
      if (out.needConfirm) {
        try { await ElMessageBox.confirm(t('nv.confirm_write'), t('nv.confirm_title'), { type: 'warning' }); }
        catch { busy.value = false; return; }
        out = await nav.exec(activeId.value, sql.value, activeDatabase.value, true);
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
    dlg, dlgTab, dlgMsg, form, saving, testing, treeSource,
    load: nav.load, onFolder, onTypeChange, pickTable, openNew, openEdit, doSave, doTest, onRemove, doExec, copyConn, doExport, editActive, browseFile, openSqliteFile,
  };
  return cache;
}
