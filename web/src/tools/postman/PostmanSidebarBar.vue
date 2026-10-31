<script setup lang="ts">
import { usePostmanWorkbench } from './usePostmanWorkbench';

const { busy, batchRun } = usePostmanWorkbench();
</script>

<template>
  <div class="pmsb">
    <button class="pmsb-run" :disabled="busy" :title="$t('tools.pm_run_all_tip')" @click="batchRun">
      ▶ {{ $t('tools.pm_run_all') }}
    </button>
  </div>
</template>

<style scoped>
.pmsb { display: flex; align-items: center; gap: 6px; padding: 0 2px 6px; flex: none; }
.pmsb-run { flex: 1; min-width: 0; background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 12px; }
.pmsb-run:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.pmsb-run:disabled { opacity: .55; cursor: default; }
</style>
