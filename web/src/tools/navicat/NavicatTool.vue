<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useNavicatWorkbench } from './useNavicatWorkbench';
import CodeEditor from '../../components/CodeEditor.vue';
import type { NavicatType } from './useNavicat';

const {
  activeProfile, activeDatabase, sql, result, busy, msg,
  dlg, dlgTab, dlgMsg, form, saving, testing,
  load, doSave, doTest, doExec, copyConn, doExport, editActive, onTypeChange,
} = useNavicatWorkbench();

const TYPES: NavicatType[] = ['mysql', 'postgres', 'sqlite', 'redis'];

const isSqlite = computed(() => form.value.type === 'sqlite');
const isRedis = computed(() => form.value.type === 'redis');
const ssl = computed({
  get: () => !!form.value.options?.ssl,
  set: (v: boolean) => { form.value = { ...form.value, options: { ...(form.value.options || {}), ssl: v } }; },
});

const exporting = ref(false);
async function onExport() { exporting.value = true; try { await doExport(); } finally { exporting.value = false; } }

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
    <section class="nvmain">
      <div class="nvtoolbar">
        <span class="nvactive">{{ activeProfile ? activeProfile.name : $t('nv.empty') }}</span>
        <span v-if="activeProfile && activeDatabase" class="nvactivedb">· {{ activeDatabase }}</span>
        <button v-if="activeProfile" class="nvbtn" @click="editActive">{{ $t('nv.edit') }}</button>
        <button v-if="activeProfile" class="nvbtn nv-copy" @click="copyConn(false)">{{ $t('nv.copy_connstr') }}</button>
        <button v-if="activeProfile" class="nvbtn nv-copy-pw" @click="copyConn(true)">{{ $t('nv.copy_with_pw') }}</button>
        <button v-if="activeProfile" class="nvbtn nv-export" :disabled="exporting" @click="onExport">{{ $t('nv.export_ncx') }}</button>
      </div>

      <div class="nvmsgrow"><div v-if="msg" class="nvmsg">{{ msg }}</div></div>

      <CodeEditor v-model="sql" class="nv-sql" language="query.sql" :placeholder="$t('nv.sql_ph')" />

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
.nvmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.nvtoolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.nvactive { color: var(--tx); font-size: 13px; font-weight: 600; }
.nvactivedb { color: var(--tx4); font-size: 12px; }
.nvbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.nvbtn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.nvbtn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.nvbtn:disabled { opacity: .55; cursor: default; }
/* 提示信息固定占一行，避免出现/消失时内容上下跳动 */
.nvmsgrow { min-height: 16px; }
.nvmsg { color: var(--tx3); font-size: 12px; line-height: 16px; }
.nv-sql { flex: none; --cm-min: 140px; }
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
