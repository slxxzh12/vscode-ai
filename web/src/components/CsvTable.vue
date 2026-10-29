<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { parseCsv } from '../csv';

const props = defineProps<{ text: string }>();
const PAGE_SIZE = 200;
const page = ref(1);
const parsed = computed(() => parseCsv(props.text));
const headers = computed(() => parsed.value.headers);
const rows = computed(() => parsed.value.rows);
const total = computed(() => rows.value.length);
const pageRows = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return rows.value.slice(start, start + PAGE_SIZE).map((r) => {
    const o: Record<string, string> = {};
    headers.value.forEach((_, i) => { o[`c${i}`] = r[i] ?? ''; });
    return o;
  });
});

watch(() => props.text, () => { page.value = 1; });
</script>

<template>
  <div class="csv">
    <div class="csv-bar">
      <span class="csv-sum">{{ $t('fp.csv.summary', { rows: total, cols: headers.length }) }}</span>
      <el-pagination
        v-if="total > PAGE_SIZE"
        v-model:current-page="page"
        :page-size="PAGE_SIZE"
        :total="total"
        layout="total, prev, pager, next"
        small
        background
      />
    </div>
    <el-table
      v-if="headers.length"
      :data="pageRows"
      stripe
      border
      size="small"
      height="100%"
      class="csv-table"
      :empty-text="$t('fp.csv.empty')"
    >
      <el-table-column
        v-for="(h, i) in headers"
        :key="i"
        :prop="`c${i}`"
        :label="h || `${$t('fp.csv.column')} ${i + 1}`"
        min-width="140"
        show-overflow-tooltip
      />
    </el-table>
    <div v-else class="csv-empty">{{ $t('fp.csv.empty') }}</div>
  </div>
</template>

<style scoped>
.csv { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; box-sizing: border-box; }
.csv-bar { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.csv-sum { color: var(--tx3); font-size: 12px; }
.csv-table { flex: 1; min-height: 0; }
.csv-empty { color: var(--tx5); font-size: 12px; padding: 20px; text-align: center; }
</style>
