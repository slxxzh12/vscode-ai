<script setup lang="ts">
import { computed } from 'vue';
import { useNavicatWorkbench } from './useNavicatWorkbench';

const {
  profiles, exportDlg, exportIds, exportN, exportSql, exportCsv, exporting, exportMsg,
  toggleAllExport, doExportData,
} = useNavicatWorkbench();

const allOn = computed(() => profiles.value.length > 0 && exportIds.value.length === profiles.value.length);
</script>

<template>
  <el-dialog v-model="exportDlg" :title="$t('nv.export_title')" width="500px" class="nvexpdlg">
    <div class="nvexp">
      <div class="nvexp-head">
        <span class="nvexp-label">{{ $t('nv.export_conns') }}</span>
        <button type="button" class="nvexp-link" @click="toggleAllExport(!allOn)">
          {{ allOn ? $t('nv.export_none') : $t('nv.export_all') }}
        </button>
      </div>
      <div class="nvexp-conns">
        <el-checkbox-group v-model="exportIds">
          <el-checkbox v-for="p in profiles" :key="p.id" :value="String(p.id)" class="nvexp-conn">
            {{ p.name }}
          </el-checkbox>
        </el-checkbox-group>
      </div>

      <div class="nvexp-row">
        <span class="nvexp-label">{{ $t('nv.export_n') }}</span>
        <el-input-number v-model="exportN" :min="1" :max="1000" size="small" class="nvexp-n" />
      </div>
      <div class="nvexp-row">
        <span class="nvexp-label">{{ $t('nv.export_formats') }}</span>
        <el-checkbox v-model="exportSql">SQL</el-checkbox>
        <el-checkbox v-model="exportCsv">CSV</el-checkbox>
      </div>
      <div v-if="exportMsg" class="nvexp-msg">{{ exportMsg }}</div>
    </div>
    <template #footer>
      <button class="nvexp-btn" @click="exportDlg = false">{{ $t('nv.cancel') }}</button>
      <button class="nvexp-btn primary" :disabled="exporting" @click="doExportData">
        {{ exporting ? $t('nv.exporting') : $t('nv.export_start') }}
      </button>
    </template>
  </el-dialog>
</template>

<style scoped>
.nvexp { display: flex; flex-direction: column; gap: 10px; }
.nvexp-head { display: flex; align-items: center; justify-content: space-between; }
.nvexp-label { color: var(--tx3); font-size: 13px; }
.nvexp-link { background: none; border: none; color: var(--ac2); cursor: pointer; font-size: 12px; padding: 0; }
.nvexp-conns { max-height: 200px; overflow: auto; border: 1px solid var(--bd); border-radius: 6px; padding: 6px 10px; background: var(--bg2); }
.nvexp-conn { display: flex; margin: 2px 0; }
.nvexp-row { display: flex; align-items: center; gap: 12px; }
.nvexp-n { width: 120px; }
.nvexp-msg { color: #e06c75; font-size: 12px; }
.nvexp-btn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; margin-left: 8px; }
.nvexp-btn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.nvexp-btn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.nvexp-btn:disabled { opacity: .55; cursor: default; }
</style>
