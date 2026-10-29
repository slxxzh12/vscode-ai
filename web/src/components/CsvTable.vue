<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { parseCsv } from '../csv';

const props = defineProps<{ text: string }>();
const PAGE_SIZE = 200;
const page = ref(1);
const parsed = computed(() => parseCsv(props.text));
const headers = computed(() => parsed.value.headers);
const rows = computed(() => parsed.value.rows);

type SortOrder = 'ascending' | 'descending';
const filters = ref<Record<number, string[]>>({});
const sort = ref<{ col: number; order: SortOrder } | null>(null);

function cmp(a: string, b: string): number {
  const sa = a.trim();
  const sb = b.trim();
  const na = Number(sa.replace(/,/g, ''));
  const nb = Number(sb.replace(/,/g, ''));
  if (sa && sb && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
}

function filterOptionsFor(col: number): Array<{ text: string; value: string }> {
  const seen = new Map<string, string>();
  for (const row of rows.value) {
    const value = row[col] ?? '';
    if (!seen.has(value)) seen.set(value, value || '—');
    if (seen.size > 200) return [];
  }
  if (seen.size > 50) return [];
  return [...seen.entries()].map(([value, text]) => ({ text, value }));
}

const filterOptions = computed(() => headers.value.map((_, i) => filterOptionsFor(i)));
const viewRows = computed(() => {
  let out = rows.value;
  const active = Object.entries(filters.value).filter(([, values]) => values.length);
  if (active.length) {
    out = out.filter((row) => active.every(([key, values]) => values.includes(row[Number(key)] ?? '')));
  }
  if (sort.value) {
    const { col, order } = sort.value;
    out = out.slice().sort((a, b) => cmp(a[col] ?? '', b[col] ?? '') * (order === 'descending' ? -1 : 1));
  }
  return out;
});
const total = computed(() => viewRows.value.length);
const pageRows = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return viewRows.value.slice(start, start + PAGE_SIZE).map((r) => {
    const o: Record<string, string> = {};
    headers.value.forEach((_, i) => { o[`c${i}`] = r[i] ?? ''; });
    return o;
  });
});

watch(() => props.text, () => { page.value = 1; filters.value = {}; sort.value = null; });

function onFilterChange(map: Record<string, string[]>) {
  const patch: Record<number, string[]> = {};
  for (const [key, values] of Object.entries(map)) patch[Number(key.replace(/^c/, ''))] = values;
  filters.value = { ...filters.value, ...patch };
  page.value = 1;
}
function onSortChange(e: { prop: string; order: SortOrder | null }) {
  sort.value = e.prop && e.order ? { col: Number(e.prop.replace(/^c/, '')), order: e.order } : null;
  page.value = 1;
}
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
      @filter-change="onFilterChange"
      @sort-change="onSortChange"
    >
      <el-table-column
        v-for="(h, i) in headers"
        :key="i"
        :prop="`c${i}`"
        :column-key="`c${i}`"
        :label="h || `${$t('fp.csv.column')} ${i + 1}`"
        min-width="140"
        show-overflow-tooltip
        sortable="custom"
        :filters="filterOptions[i].length ? filterOptions[i] : undefined"
        :filter-method="() => true"
        filter-placement="bottom-end"
      />
    </el-table>
    <div v-else class="csv-empty">{{ $t('fp.csv.empty') }}</div>
  </div>
</template>

<style scoped>
.csv { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; box-sizing: border-box; }
.csv-bar { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.csv-sum { color: var(--tx3); font-size: 12px; }
.csv-table { flex: 1; min-height: 0; border-radius: 8px; overflow: hidden; }
.csv-table :deep(.el-table__header th.el-table__cell) {
  background: linear-gradient(180deg, var(--bg5), var(--bg4));
  color: var(--tx1);
  font-weight: 600;
  border-bottom: 2px solid var(--ac2) !important;
}
.csv-table :deep(.el-table__row--striped td.el-table__cell) { background: var(--bg2); }
.csv-table :deep(.el-table__body tr:hover > td.el-table__cell) { background: var(--bg5) !important; }
.csv-table :deep(.caret-wrapper i),
.csv-table :deep(.el-table__column-filter-trigger i) { color: var(--ac2); }
.csv-empty { color: var(--tx5); font-size: 12px; padding: 20px; text-align: center; }
</style>
