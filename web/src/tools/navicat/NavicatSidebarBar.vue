<script setup lang="ts">
import { ref } from 'vue';
import { useNavicatWorkbench } from './useNavicatWorkbench';

const { openNew, importCsv, importing, openExport, exporting } = useNavicatWorkbench();
const fileInput = ref<HTMLInputElement | null>(null);

function pickCsv() { fileInput.value?.click(); }
async function onChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) await importCsv(file);
  input.value = '';
}
</script>

<template>
  <div class="nvsb">
    <button class="nvsb-new" @click="openNew">＋ {{ $t('nv.new') }}</button>
    <button class="nvsb-import" :disabled="importing" @click="pickCsv">
      {{ importing ? $t('nv.importing') : $t('nv.import_csv') }}
    </button>
    <button class="nvsb-export" :disabled="exporting" @click="openExport">{{ $t('nv.export_data') }}</button>
    <input ref="fileInput" class="nvsb-file" type="file" accept=".csv,text/csv" @change="onChange" />
  </div>
</template>

<style scoped>
.nvsb { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 0 2px 6px; flex: none; }
.nvsb-new, .nvsb-import, .nvsb-export { flex: 1 1 auto; min-width: 0; background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; cursor: pointer; font-size: 12px; white-space: nowrap; }
.nvsb-new:hover, .nvsb-import:hover:not(:disabled), .nvsb-export:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.nvsb-import:disabled, .nvsb-export:disabled { opacity: .55; cursor: default; }
.nvsb-file { display: none; }
</style>
