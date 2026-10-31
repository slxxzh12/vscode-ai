<script setup lang="ts">
import { useNavicatWorkbench } from './useNavicatWorkbench';

const { openNew } = useNavicatWorkbench();
</script>

<template>
  <div class="nvsb">
    <button class="nvsb-new" @click="openNew">＋ {{ $t('nv.new') }}</button>
  </div>
</template>

<style scoped>
.nvsb { display: flex; align-items: center; gap: 6px; padding: 0 2px 6px; flex: none; }
.nvsb-new { flex: 1; min-width: 0; background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 12px; }
.nvsb-new:hover { border-color: var(--ac2); color: var(--ac2); }
</style>
