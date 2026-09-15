<script setup lang="ts">
import { computed } from 'vue';
import type { GitAuthorRow } from '../gitStat';

const props = defineProps<{ rows: GitAuthorRow[] }>();

const totalLines = computed(() => props.rows.reduce((s, r) => s + r.linesAdded, 0));
function pct(r: GitAuthorRow): number {
  return totalLines.value > 0 ? (r.linesAdded / totalLines.value) * 100 : 0;
}
function pctText(r: GitAuthorRow): string {
  return `${pct(r).toFixed(1)}%`;
}
</script>

<template>
  <div v-if="rows.length" class="authors">
    <h3 class="sub">{{ $t('gitstat.by_author') }}</h3>
    <table class="tbl">
      <thead>
        <tr>
          <th>{{ $t('gitstat.col.author') }}</th>
          <th class="num">{{ $t('gitstat.stat.commits') }}</th>
          <th class="num">{{ $t('gitstat.stat.files') }}</th>
          <th class="num">{{ $t('gitstat.stat.added') }}</th>
          <th class="num">{{ $t('gitstat.stat.modified') }}</th>
          <th class="num">{{ $t('gitstat.stat.deleted') }}</th>
          <th class="num">{{ $t('gitstat.stat.renamed') }}</th>
          <th class="num">{{ $t('gitstat.col.added_lines') }}</th>
          <th class="num">{{ $t('gitstat.col.deleted_lines') }}</th>
          <th class="share">{{ $t('gitstat.col.share') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.email || r.author">
          <td class="auth">{{ r.author }}</td>
          <td class="num">{{ r.commits }}</td>
          <td class="num">{{ r.files }}</td>
          <td class="num add">{{ r.added }}</td>
          <td class="num mod">{{ r.modified }}</td>
          <td class="num del">{{ r.deleted }}</td>
          <td class="num ren">{{ r.renamed }}</td>
          <td class="num add">{{ r.linesAdded }}</td>
          <td class="num del">{{ r.linesDeleted }}</td>
          <td class="share">
            <div class="pwrap">
              <div class="pbar"><i :style="{ width: pct(r) + '%' }" /></div>
              <span class="ptxt">{{ pctText(r) }}</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.sub { color: var(--tx1); font-size: 13px; margin: 16px 0 6px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.tbl th { text-align: left; color: var(--tx4); font-weight: 500; padding: 4px 8px; border-bottom: 1px solid var(--bd2); white-space: nowrap; }
.tbl td { padding: 4px 8px; border-bottom: 1px solid var(--bd2); vertical-align: top; }
.tbl .num { text-align: right; color: var(--tx4); white-space: nowrap; font-variant-numeric: tabular-nums; }
.tbl .num.add { color: var(--ok, #3fb950); }
.tbl .num.mod { color: var(--ac2); }
.tbl .num.del { color: var(--err); }
.tbl .num.ren { color: var(--warn); }
.auth { color: var(--tx3); white-space: nowrap; }
.share { width: 140px; }
.pwrap { display: flex; align-items: center; gap: 6px; }
.pbar { flex: 1; height: 6px; border-radius: 3px; background: var(--bg4); overflow: hidden; }
.pbar i { display: block; height: 100%; background: var(--ac); }
.ptxt { flex: none; width: 44px; text-align: right; color: var(--tx3); font-variant-numeric: tabular-nums; }
</style>
