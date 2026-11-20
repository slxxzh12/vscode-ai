<script setup lang="ts">
import { ref } from 'vue';
import { useNavicatWorkbench } from './useNavicatWorkbench';
import NavicatImportDialog from './NavicatImportDialog.vue';
import { csvImportTemplate } from './csvImport';

const { openNew, openImportCsv, importing, importOpen, openExport, exporting } = useNavicatWorkbench();
const fileInput = ref<HTMLInputElement | null>(null);

function pickCsv() { fileInput.value?.click(); }
function downloadTemplate() {
  const blob = new Blob([csvImportTemplate()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'navicat-import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}
async function onChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) await openImportCsv(file);
  input.value = '';
}
</script>

<template>
  <div class="nvsb">
    <button class="nvsb-new" @click="openNew">＋ {{ $t('nv.new') }}</button>
    <button class="nvsb-import" :disabled="importing" @click="pickCsv">
      {{ importing ? $t('nv.importing') : $t('nv.import_csv') }}
    </button>
    <button class="nvsb-template" :title="$t('nv.import_template_hint')" @click="downloadTemplate">{{ $t('nv.import_template') }}</button>
    <button class="nvsb-export" :disabled="exporting" @click="openExport">{{ $t('nv.export_data') }}</button>
    <input ref="fileInput" class="nvsb-file" type="file" accept=".csv,text/csv" @change="onChange" />
    <NavicatImportDialog v-if="importOpen" />
  </div>
</template>

<style scoped>
.nvsb { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 0 2px 6px; flex: none; }
.nvsb-new, .nvsb-import, .nvsb-template, .nvsb-export { flex: 1 1 auto; min-width: 0; background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; cursor: pointer; font-size: 12px; white-space: nowrap; }
.nvsb-new:hover, .nvsb-import:hover:not(:disabled), .nvsb-template:hover, .nvsb-export:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.nvsb-import:disabled, .nvsb-export:disabled { opacity: .55; cursor: default; }
.nvsb-file { display: none; }
</style>
