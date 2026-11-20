<script setup lang="ts">
import { computed } from 'vue';
import { useNavicatWorkbench } from './useNavicatWorkbench';
import type { ImportField } from './csvImport';

const {
  importOpen, importName, importRows, importHasHeader, importMap, importError,
  importing, importHostMapped, importPreview, closeImportCsv, doImportCsv,
} = useNavicatWorkbench();

const FIELDS: ImportField[] = ['name', 'type', 'host', 'port', 'user', 'password', 'database'];
const FIELD_LABEL: Record<ImportField, string> = {
  name: 'nv.name',
  type: 'nv.type',
  host: 'nv.host',
  port: 'nv.port',
  user: 'nv.user',
  password: 'nv.password',
  database: 'nv.database',
};

const columnCount = computed(() => {
  let n = 0;
  for (const row of importRows.value.slice(0, 20)) n = Math.max(n, row.length);
  return n;
});
const columns = computed(() => Array.from({ length: columnCount.value }, (_, i) => i));
const previewRows = computed(() => {
  const start = importHasHeader.value ? 1 : 0;
  return importRows.value.slice(start, start + 5);
});
const parsed = computed(() => importPreview());
const canImport = computed(() => !importing.value && importHostMapped.value && parsed.value.profiles.length > 0);
</script>

<template>
  <el-dialog :model-value="importOpen" :title="$t('nv.import_title')" width="760px" append-to-body @close="closeImportCsv">
    <div class="nvi">
      <div class="nvi-head">
        <span class="nvi-file" :title="importName">{{ importName }}</span>
        <el-checkbox v-model="importHasHeader">{{ $t('nv.import_header') }}</el-checkbox>
        <span class="nvi-count">{{ $t('nv.import_ready', { n: parsed.profiles.length }) }}</span>
        <span v-if="parsed.errors.length" class="nvi-bad">{{ $t('nv.import_errors', { n: parsed.errors.length }) }}</span>
      </div>

      <div class="nvi-section">{{ $t('nv.import_mapping') }}</div>
      <div class="nvi-map">
        <div v-for="i in columns" :key="i" class="nvi-col">
          <div class="nvi-colidx">#{{ i + 1 }}</div>
          <el-select
            :model-value="importMap[i] ?? ''"
            size="small"
            class="nvi-sel"
            @update:model-value="(v: string) => (importMap[i] = v === '' ? null : (v as ImportField))"
          >
            <el-option :label="$t('nv.import_col_ignore')" value="" />
            <el-option v-for="f in FIELDS" :key="f" :label="$t(FIELD_LABEL[f])" :value="f" />
          </el-select>
        </div>
      </div>

      <div class="nvi-section">{{ $t('nv.import_preview') }}</div>
      <div class="nvi-preview">
        <table class="nvi-tbl">
          <thead>
            <tr>
              <th v-for="i in columns" :key="i">{{ importHasHeader && importRows[0] ? (importRows[0][i] || '') : `#${i + 1}` }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, ri) in previewRows" :key="ri">
              <td v-for="i in columns" :key="i">{{ row[i] || '' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="!previewRows.length" class="nvi-empty">{{ $t('nv.import_empty') }}</div>
      </div>

      <div v-if="importError" class="nvi-err">{{ importError }}</div>
    </div>
    <template #footer>
      <el-button size="small" :disabled="importing" @click="closeImportCsv">{{ $t('nv.cancel') }}</el-button>
      <el-button size="small" type="primary" :loading="importing" :disabled="!canImport" @click="doImportCsv">
        {{ $t('nv.import_confirm') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.nvi { display: flex; flex-direction: column; gap: 8px; }
.nvi-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.nvi-file { flex: 1 1 200px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tx2); font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.nvi-count { color: var(--ac2); font-size: 12px; }
.nvi-bad { color: var(--err); font-size: 12px; }
.nvi-section { color: var(--tx5); font-size: 11px; text-transform: uppercase; margin-top: 4px; }
.nvi-map { display: flex; gap: 6px; flex-wrap: wrap; }
.nvi-col { display: flex; flex-direction: column; gap: 3px; min-width: 120px; }
.nvi-colidx { color: var(--tx6); font-size: 11px; font-family: ui-monospace, Consolas, monospace; }
.nvi-sel { width: 100%; }
.nvi-preview { max-height: 220px; overflow: auto; border: 1px solid var(--bd); border-radius: 6px; }
.nvi-tbl { border-collapse: collapse; width: 100%; font-size: 12px; }
.nvi-tbl th, .nvi-tbl td { padding: 4px 8px; border-bottom: 1px solid var(--bd2); text-align: left; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.nvi-tbl th { color: var(--tx4); font-weight: 600; background: var(--bg4); position: sticky; top: 0; }
.nvi-tbl td { color: var(--tx2); }
.nvi-empty { padding: 12px; color: var(--tx6); font-size: 12px; text-align: center; }
.nvi-err { color: var(--err); font-size: 12px; }
</style>
