<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { t } from '../../i18n';
import NavicatList from './NavicatList.vue';
import { useNavicat, type ExecResult, type NavicatProfile, type NavicatType } from './useNavicat';

const { profiles, load, save, remove, rename, test, exec, reveal, connstr, exportNcx } = useNavicat();

const TYPES: NavicatType[] = ['mysql', 'postgres', 'sqlite', 'redis'];

const form = ref<NavicatProfile>(blank());
const sql = ref('');
const busy = ref(false);
const testing = ref(false);
const msg = ref('');
const result = ref<ExecResult | null>(null);

function blank(): NavicatProfile {
  return { name: '', type: 'mysql', host: '127.0.0.1', port: '3306', user: 'root', database: '', password: '' };
}

const isSqlite = computed(() => form.value.type === 'sqlite');
const isRedis = computed(() => form.value.type === 'redis');
const dbLabel = computed(() => (isSqlite.value ? t('nv.database') : isRedis.value ? t('nv.db_index') : t('nv.database')));

function defaultPort(type: NavicatType): string {
  return type === 'mysql' ? '3306' : type === 'postgres' ? '5432' : type === 'redis' ? '6379' : '';
}

function onTypeChange() {
  if (!form.value.port || ['3306', '5432', '6379', ''].includes(form.value.port)) form.value.port = defaultPort(form.value.type);
}

function selectProfile(id: string) {
  const p = profiles.value.find((x) => x.id === id);
  if (!p) return;
  form.value = { ...blank(), ...p, password: '' };
  result.value = null;
  msg.value = '';
}

function newProfile() {
  form.value = blank();
  result.value = null;
  msg.value = '';
}

async function doSave() {
  if (!form.value.name.trim()) { msg.value = t('nv.required_name'); return; }
  busy.value = true; msg.value = '';
  try {
    const saved = await save({ ...form.value });
    form.value = { ...form.value, id: saved.id, hasPassword: saved.hasPassword, password: '' };
    msg.value = t('nv.saved');
  } catch (e) { msg.value = (e as Error).message; } finally { busy.value = false; }
}

async function doTest() {
  testing.value = true; msg.value = '';
  try {
    if (form.value.id && !form.value.password) await test({ id: form.value.id });
    else await test({ profile: form.value });
    msg.value = t('nv.test_ok');
  } catch (e) { msg.value = (e as Error).message; } finally { testing.value = false; }
}

async function doExec() {
  if (!form.value.id) { msg.value = t('nv.save_first'); return; }
  if (!sql.value.trim()) return;
  busy.value = true; msg.value = '';
  try {
    let out = await exec(form.value.id, sql.value);
    if (out.needConfirm) {
      try {
        await ElMessageBox.confirm(t('nv.confirm_write'), t('nv.confirm_title'), { type: 'warning' });
      } catch { busy.value = false; return; }
      out = await exec(form.value.id, sql.value, true);
    }
    result.value = out.result || null;
  } catch (e) { msg.value = (e as Error).message; } finally { busy.value = false; }
}

async function doReveal() {
  if (!form.value.id) return;
  try { form.value.password = await reveal(form.value.id); } catch { /* ignore */ }
}

async function copyConn(withPassword: boolean) {
  if (!form.value.id) { msg.value = t('nv.save_first'); return; }
  try {
    const text = await connstr(form.value.id, withPassword);
    await navigator.clipboard.writeText(text);
    msg.value = t('nv.copied');
  } catch (e) { msg.value = (e as Error).message; }
}

async function doExport() {
  if (!form.value.id) { msg.value = t('nv.save_first'); return; }
  try {
    const xml = await exportNcx([form.value.id]);
    const blob = new Blob([xml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'navicat.ncx';
    a.click();
    URL.revokeObjectURL(a.href);
    msg.value = t('nv.exported');
  } catch (e) { msg.value = (e as Error).message; }
}

async function onRename(id: string) {
  try {
    const res = await ElMessageBox.prompt(t('nv.rename'), t('nv.rename_ph'), { inputValue: profiles.value.find((p) => p.id === id)?.name || '' }) as any;
    if (res?.value) await rename(id, res.value);
  } catch { /* cancelled */ }
}

async function onRemove(id: string) {
  try {
    await ElMessageBox.confirm(t('nv.delete_confirm'), t('nv.delete'), { type: 'warning' });
  } catch { return; }
  await remove(id);
  if (form.value.id === id) newProfile();
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
    <NavicatList :profiles="profiles" :active-id="form.id || ''" @select="selectProfile" @create="newProfile" @rename="onRename" @remove="onRemove" />

    <section class="nvmain">
      <div class="nvform">
        <el-input v-model="form.name" class="nv-name-input" size="small" :placeholder="$t('nv.name')" />
        <select v-model="form.type" class="nv-type" @change="onTypeChange">
          <option v-for="ty in TYPES" :key="ty" :value="ty">{{ ty }}</option>
        </select>
        <template v-if="!isSqlite">
          <el-input v-model="form.host" size="small" class="nv-host" :placeholder="$t('nv.host')" />
          <el-input v-model="form.port" size="small" class="nv-port" :placeholder="$t('nv.port')" />
          <el-input v-if="!isRedis" v-model="form.user" size="small" class="nv-user" :placeholder="$t('nv.user')" />
          <div v-if="!isRedis" class="nv-pw">
            <el-input v-model="form.password" size="small" type="password" show-password :placeholder="form.hasPassword && !form.password ? '••••••' : $t('nv.password')" />
            <button v-if="form.id && form.hasPassword" class="nvbtn nv-reveal" :title="$t('nv.password')" @click="doReveal">👁</button>
          </div>
        </template>
        <el-input v-model="form.database" size="small" class="nv-db" :placeholder="dbLabel" />
        <div class="nvactions">
          <button class="nvbtn primary nv-save" :disabled="busy" @click="doSave">{{ $t('nv.save') }}</button>
          <button class="nvbtn nv-test" :disabled="testing" @click="doTest">{{ testing ? $t('nv.testing') : $t('nv.test') }}</button>
          <button class="nvbtn nv-copy" @click="copyConn(false)">{{ $t('nv.copy_connstr') }}</button>
          <button class="nvbtn nv-copy-pw" @click="copyConn(true)">{{ $t('nv.copy_with_pw') }}</button>
          <button class="nvbtn nv-export" @click="doExport">{{ $t('nv.export_ncx') }}</button>
        </div>
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
  </div>
</template>

<style scoped>
.nvbody { display: flex; flex-direction: row; gap: 12px; height: calc(100vh - 150px); }
.nvmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.nvform { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.nv-name-input { width: 150px; }
.nv-type { width: 110px; height: 28px; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 0 6px; font-size: 13px; }
.nv-type:focus { outline: none; border-color: var(--ac2); }
.nv-host { width: 140px; }
.nv-port { width: 80px; }
.nv-user { width: 100px; }
.nv-db { width: 170px; }
.nv-pw { display: flex; gap: 4px; align-items: center; width: 190px; }
.nvform .el-input { flex: none; }
.nvactions { display: flex; flex-wrap: wrap; gap: 6px; }
.nvbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.nvbtn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.nvbtn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.nvbtn:disabled { opacity: .55; cursor: default; }
.nvmsg { color: var(--tx3); font-size: 12px; }
.nv-sql { flex: none; min-height: 110px; resize: vertical; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 6px; padding: 10px 12px; font-size: 13px; line-height: 1.6; font-family: ui-monospace, Consolas, monospace; box-sizing: border-box; }
.nv-sql:focus { outline: none; border-color: var(--ac2); }
.nvresbar { display: flex; gap: 8px; align-items: center; }
.nv-meta { color: var(--tx4); font-size: 12px; }
.nvresult { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--bd); border-radius: 6px; background: var(--bg2); }
.nv-table { border-collapse: collapse; font-size: 12px; font-family: ui-monospace, Consolas, monospace; width: max-content; min-width: 100%; }
.nv-table th, .nv-table td { border: 1px solid var(--bd); padding: 4px 8px; text-align: left; white-space: nowrap; color: var(--tx); }
.nv-table th { background: var(--bg4); position: sticky; top: 0; }
.nv-raw { margin: 0; padding: 10px 12px; font-size: 13px; color: var(--tx); white-space: pre-wrap; }
.nv-noresult { color: var(--tx4); font-size: 12px; padding: 14px; text-align: center; }
</style>
