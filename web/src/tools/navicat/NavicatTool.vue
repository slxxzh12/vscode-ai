<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { t } from '../../i18n';
import { quoteIdent, useNavicat, type ExecResult, type NavicatProfile, type NavicatType } from './useNavicat';
import NavicatTree from './NavicatTree.vue';

const { profiles, load, save, remove, rename, test, exec, reveal, connstr, exportNcx, listDatabases, listTables } = useNavicat();

const TYPES: NavicatType[] = ['mysql', 'postgres', 'sqlite', 'redis'];

const search = ref('');
const activeId = ref('');
const activeDatabase = ref('');
const sql = ref('');
const busy = ref(false);
const testing = ref(false);
const saving = ref(false);
const msg = ref('');
const result = ref<ExecResult | null>(null);
const treeVersion = ref(0);

const dlg = ref(false);
const dlgTab = ref('general');
const dlgMsg = ref('');
const form = ref<NavicatProfile>(blank());

const isSqlite = computed(() => form.value.type === 'sqlite');
const isRedis = computed(() => form.value.type === 'redis');
const ssl = computed({
  get: () => !!form.value.options?.ssl,
  set: (v: boolean) => { form.value = { ...form.value, options: { ...(form.value.options || {}), ssl: v } }; },
});
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q ? profiles.value.filter((p) => p.name.toLowerCase().includes(q)) : profiles.value;
});
const activeProfile = computed(() => profiles.value.find((p) => p.id === activeId.value) || null);

function blank(): NavicatProfile {
  return { name: '', type: 'mysql', host: '127.0.0.1', port: '3306', user: 'root', database: '', password: '', options: { ssl: false } };
}

function defaultPort(type: NavicatType): string {
  return type === 'mysql' ? '3306' : type === 'postgres' ? '5432' : type === 'redis' ? '6379' : '';
}

function onTypeChange() {
  if (!form.value.port || ['3306', '5432', '6379', ''].includes(form.value.port)) form.value.port = defaultPort(form.value.type);
  if (form.value.type === 'sqlite') dlgTab.value = 'general';
}

function openNew() {
  form.value = blank();
  dlgMsg.value = '';
  dlgTab.value = 'general';
  dlg.value = true;
}

async function openEdit(p: NavicatProfile) {
  form.value = { ...blank(), ...p, password: '', options: { ssl: false, ...(p.options || {}) } };
  dlgMsg.value = '';
  dlgTab.value = 'general';
  dlg.value = true;
  if (p.hasPassword && p.id) {
    try { form.value.password = await reveal(p.id); } catch { /* ignore */ }
  }
}

function editActive() { if (activeProfile.value) void openEdit(activeProfile.value); }

async function doSave() {
  if (!form.value.name.trim()) { dlgMsg.value = t('nv.required_name'); return; }
  saving.value = true; dlgMsg.value = '';
  try {
    const payload = { ...form.value, database: form.value.type === 'sqlite' ? form.value.database : '' };
    const saved = await save(payload);
    dlg.value = false;
    activeId.value = saved.id || '';
    activeDatabase.value = saved.type === 'sqlite' ? '' : (saved.database || '');
    treeVersion.value += 1;
    msg.value = t('nv.saved');
  } catch (e) { dlgMsg.value = (e as Error).message; } finally { saving.value = false; }
}

async function doTest() {
  testing.value = true; dlgMsg.value = '';
  try {
    if (form.value.id && !form.value.password) await test({ id: form.value.id });
    else await test({ profile: form.value });
    dlgMsg.value = t('nv.test_ok');
  } catch (e) { dlgMsg.value = (e as Error).message; } finally { testing.value = false; }
}

function onSelectConn(p: NavicatProfile) {
  activeId.value = p.id || '';
  activeDatabase.value = p.type === 'sqlite' ? '' : (p.database || '');
  result.value = null;
  msg.value = '';
}

function onSelectDatabase(db: string) { activeDatabase.value = db; }

function onPickTable(db: string, table: string) {
  const p = activeProfile.value;
  if (!p) return;
  if (p.type !== 'sqlite') activeDatabase.value = db;
  const stmt = `SELECT * FROM ${quoteIdent(p.type, table)}`;
  const cur = sql.value.replace(/\s+$/, '');
  sql.value = cur ? `${cur}\n${stmt}` : stmt;
}

async function doExec() {
  if (!activeId.value) { msg.value = t('nv.save_first'); return; }
  if (!sql.value.trim()) return;
  busy.value = true; msg.value = '';
  try {
    let out = await exec(activeId.value, sql.value, activeDatabase.value);
    if (out.needConfirm) {
      try {
        await ElMessageBox.confirm(t('nv.confirm_write'), t('nv.confirm_title'), { type: 'warning' });
      } catch { busy.value = false; return; }
      out = await exec(activeId.value, sql.value, activeDatabase.value, true);
    }
    result.value = out.result || null;
  } catch (e) { msg.value = (e as Error).message; } finally { busy.value = false; }
}

async function copyConn(withPassword: boolean) {
  if (!activeId.value) { msg.value = t('nv.save_first'); return; }
  try {
    const text = await connstr(activeId.value, withPassword);
    await navigator.clipboard.writeText(text);
    msg.value = t('nv.copied');
  } catch (e) { msg.value = (e as Error).message; }
}

async function doExport() {
  if (!activeId.value) { msg.value = t('nv.save_first'); return; }
  try {
    const xml = await exportNcx([activeId.value]);
    const blob = new Blob([xml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'navicat.ncx';
    a.click();
    URL.revokeObjectURL(a.href);
    msg.value = t('nv.exported');
  } catch (e) { msg.value = (e as Error).message; }
}

async function onRename(p: NavicatProfile) {
  try {
    const res = await ElMessageBox.prompt(t('nv.rename'), t('nv.rename_ph'), { inputValue: p.name }) as any;
    if (res?.value) await rename(p.id!, res.value);
  } catch { /* cancelled */ }
}

async function onRemove(p: NavicatProfile) {
  try {
    await ElMessageBox.confirm(t('nv.delete_confirm'), t('nv.delete'), { type: 'warning' });
  } catch { return; }
  await remove(p.id!);
  if (activeId.value === p.id) { activeId.value = ''; activeDatabase.value = ''; result.value = null; }
  treeVersion.value += 1;
}

function exportCsv() {
  if (!result.value) return;
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [result.value.columns.map(esc).join(',')];
  for (const row of result.value.rows) lines.push(row.map(esc).join(','));
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'result.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

onMounted(() => { void load(); });
</script>

<template>
  <div class="nvbody">
    <aside class="nvside">
      <div class="nvsidehead">
        <button class="nvbtn primary nvnewbtn" @click="openNew">{{ $t('nv.new') }}</button>
        <button class="nvmini" :title="$t('nv.refresh')" @click="treeVersion += 1">⟳</button>
      </div>
      <input v-model="search" class="nvsearch" :placeholder="$t('nv.search_ph')" />
      <NavicatTree
        :profiles="filtered"
        :active-id="activeId"
        :active-database="activeDatabase"
        :version="treeVersion"
        :fetch-databases="listDatabases"
        :fetch-tables="listTables"
        @select-conn="onSelectConn"
        @select-database="onSelectDatabase"
        @pick-table="onPickTable"
        @edit="openEdit"
        @rename="onRename"
        @remove="onRemove"
      />
    </aside>

    <section class="nvmain">
      <div class="nvtoolbar">
        <span class="nvactive">{{ activeProfile ? activeProfile.name : $t('nv.empty') }}</span>
        <span v-if="activeProfile && activeDatabase" class="nvactivedb">· {{ activeDatabase }}</span>
        <button v-if="activeProfile" class="nvbtn" @click="editActive">{{ $t('nv.edit') }}</button>
        <button v-if="activeProfile" class="nvbtn nv-copy" @click="copyConn(false)">{{ $t('nv.copy_connstr') }}</button>
        <button v-if="activeProfile" class="nvbtn nv-copy-pw" @click="copyConn(true)">{{ $t('nv.copy_with_pw') }}</button>
        <button v-if="activeProfile" class="nvbtn nv-export" @click="doExport">{{ $t('nv.export_ncx') }}</button>
      </div>

      <div v-if="msg" class="nvmsg">{{ msg }}</div>

      <textarea v-model="sql" class="nv-sql" :placeholder="$t('nv.sql_ph')" spellcheck="false" />

      <div class="nvresbar">
        <button class="nvbtn primary nv-run" :disabled="busy" @click="doExec">{{ busy ? $t('nv.running') : $t('nv.exec') }}</button>
        <button class="nvbtn" @click="sql = ''; result = null; msg = ''">{{ $t('nv.clear') }}</button>
        <span class="nv-meta">
          <template v-if="result">
            <span v-if="result.truncated">{{ $t('nv.truncated', { n: result.rows.length }) }} · </span>
            <span v-if="result.affected !== null">{{ $t('nv.affected', { n: result.affected }) }} · </span>
            <span>{{ $t('nv.duration', { ms: result.durationMs }) }}</span>
          </template>
        </span>
        <button v-if="result && result.columns.length" class="nvbtn nvexport" style="margin-left:auto" @click="exportCsv">CSV</button>
      </div>

      <div class="nvresult">
        <table v-if="result && result.columns.length" class="nv-table">
          <thead><tr><th v-for="c in result.columns" :key="c">{{ c }}</th></tr></thead>
          <tbody><tr v-for="(row, i) in result.rows" :key="i"><td v-for="(cell, j) in row" :key="j">{{ cell }}</td></tr></tbody>
        </table>
        <pre v-else-if="result && result.raw" class="nv-raw">{{ result.raw }}</pre>
        <div v-else class="nv-noresult">{{ $t('nv.no_result') }}</div>
      </div>
    </section>

    <el-dialog v-model="dlg" :title="form.id ? $t('nv.edit_title') : $t('nv.new_title')" width="560px" class="nvdlg">
      <el-tabs v-model="dlgTab" class="nv-tabs">
        <el-tab-pane :label="$t('nv.tab_general')" name="general">
          <div class="nvform">
            <label class="nvrow">
              <span class="nvlbl">{{ $t('nv.name') }}</span>
              <el-input v-model="form.name" size="small" class="nv-name-input" />
            </label>
            <label class="nvrow">
              <span class="nvlbl">{{ $t('nv.type') }}</span>
              <select v-model="form.type" class="nv-type" @change="onTypeChange">
                <option v-for="ty in TYPES" :key="ty" :value="ty">{{ ty }}</option>
              </select>
            </label>
            <template v-if="isSqlite">
              <label class="nvrow">
                <span class="nvlbl">{{ $t('nv.database_file') }}</span>
                <el-input v-model="form.database" size="small" class="nv-db-file" />
              </label>
            </template>
            <template v-else>
              <label class="nvrow">
                <span class="nvlbl">{{ $t('nv.host') }}</span>
                <el-input v-model="form.host" size="small" class="nv-host" />
              </label>
              <label class="nvrow">
                <span class="nvlbl">{{ $t('nv.port') }}</span>
                <el-input v-model="form.port" size="small" class="nv-port" />
              </label>
              <label v-if="!isRedis" class="nvrow">
                <span class="nvlbl">{{ $t('nv.user') }}</span>
                <el-input v-model="form.user" size="small" class="nv-user" />
              </label>
              <label class="nvrow">
                <span class="nvlbl">{{ $t('nv.password') }}</span>
                <el-input v-model="form.password" size="small" type="password" show-password class="nv-pw"
                          :placeholder="form.hasPassword && !form.password ? '••••••' : ''" />
              </label>
            </template>
          </div>
        </el-tab-pane>
        <el-tab-pane v-if="!isSqlite" :label="$t('nv.tab_advanced')" name="advanced">
          <div class="nvform">
            <label class="nvrow">
              <span class="nvlbl">{{ $t('nv.ssl') }}</span>
              <el-switch v-model="ssl" class="nv-ssl" />
            </label>
          </div>
        </el-tab-pane>
      </el-tabs>
      <div v-if="dlgMsg" class="nvmsg nvdlgmsg">{{ dlgMsg }}</div>
      <template #footer>
        <button class="nvbtn nv-test" :disabled="testing" @click="doTest">{{ testing ? $t('nv.testing') : $t('nv.test') }}</button>
        <button class="nvbtn nv-cancel" @click="dlg = false">{{ $t('nv.cancel') }}</button>
        <button class="nvbtn primary nv-save" :disabled="saving" @click="doSave">{{ $t('nv.ok') }}</button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.nvbody { display: flex; flex-direction: row; gap: 12px; height: calc(100vh - 150px); }
.nvside { width: 260px; flex: none; display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--bd); border-radius: 8px; background: var(--bg2); overflow: hidden; padding: 6px; box-sizing: border-box; }
.nvsidehead { display: flex; align-items: center; gap: 6px; }
.nvsidehead .nvnewbtn { flex: 1; }
.nvsearch { width: 100%; box-sizing: border-box; background: var(--bg1); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 8px; font-size: 12px; }
.nvsearch:focus { outline: none; border-color: var(--ac2); }
.nvmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.nvtoolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.nvactive { color: var(--tx); font-size: 13px; font-weight: 600; }
.nvactivedb { color: var(--tx4); font-size: 12px; }
.nvbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.nvbtn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.nvbtn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.nvbtn:disabled { opacity: .55; cursor: default; }
.nvmini { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 6px 10px; cursor: pointer; font-size: 13px; }
.nvmini:hover { border-color: var(--ac2); color: var(--ac2); }
.nvmsg { color: var(--tx3); font-size: 12px; }
.nv-sql { flex: none; min-height: 140px; resize: vertical; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 6px; padding: 10px 12px; font-size: 13px; line-height: 1.6; font-family: ui-monospace, Consolas, monospace; box-sizing: border-box; }
.nv-sql:focus { outline: none; border-color: var(--ac2); }
.nvresbar { display: flex; gap: 8px; align-items: center; }
.nv-meta { color: var(--tx4); font-size: 12px; }
.nvresult { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--bd); border-radius: 6px; background: var(--bg2); }
.nv-table { border-collapse: collapse; font-size: 12px; font-family: ui-monospace, Consolas, monospace; width: max-content; min-width: 100%; }
.nv-table th, .nv-table td { border: 1px solid var(--bd); padding: 4px 8px; text-align: left; white-space: nowrap; color: var(--tx); }
.nv-table th { background: var(--bg4); position: sticky; top: 0; }
.nv-raw { margin: 0; padding: 10px 12px; font-size: 13px; color: var(--tx); white-space: pre-wrap; }
.nv-noresult { color: var(--tx4); font-size: 12px; padding: 14px; text-align: center; }
.nv-tabs { margin-top: -6px; }
.nvform { display: flex; flex-direction: column; gap: 10px; padding: 4px 2px; }
.nvrow { display: flex; align-items: center; gap: 10px; }
.nvlbl { flex: none; width: 96px; text-align: right; color: var(--tx3); font-size: 13px; }
.nvrow .el-input { flex: 1; }
.nv-type { flex: 1; height: 32px; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 0 8px; font-size: 13px; }
.nv-type:focus { outline: none; border-color: var(--ac2); }
.nvdlg :deep(.el-dialog__footer) { display: flex; align-items: center; }
.nv-test { margin-right: auto; }
</style>
