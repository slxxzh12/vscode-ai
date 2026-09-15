<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  statusLabel, statusClass, aggregateByAuthor,
  type GitChangesResult, type GitStatus, type GitSummaryRow,
} from '../gitStat';
import GitAuthorTable from './GitAuthorTable.vue';
import { t } from '../i18n';

const props = defineProps<{ result: GitChangesResult }>();

const FILTERS = ['all', 'added', 'modified', 'deleted', 'renamed'] as const;

const filter = ref<GitStatus | 'all'>('all');
const openCommits = ref<Set<string>>(new Set());

const filteredSummary = computed<GitSummaryRow[]>(() => {
  const rows = props.result.summary || [];
  return filter.value === 'all' ? rows : rows.filter((r) => r.status === filter.value);
});

const authorRows = computed(() => aggregateByAuthor(props.result.commits));

function toggleCommit(hash: string) {
  const s = new Set(openCommits.value);
  if (s.has(hash)) s.delete(hash); else s.add(hash);
  openCommits.value = s;
}
function filterLabel(f: GitStatus | 'all'): string { return f === 'all' ? t('gitstat.all') : statusLabel(f); }
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
</script>

<template>
  <div class="repo">
    <div class="cards">
      <div class="card"><b>{{ result.stats.commits }}</b><span>{{ $t('gitstat.stat.commits') }}</span></div>
      <div class="card"><b>{{ result.stats.files }}</b><span>{{ $t('gitstat.stat.files') }}</span></div>
      <div class="card st-added"><b>{{ result.stats.added }}</b><span>{{ $t('gitstat.stat.added') }}</span></div>
      <div class="card st-modified"><b>{{ result.stats.modified }}</b><span>{{ $t('gitstat.stat.modified') }}</span></div>
      <div class="card st-deleted"><b>{{ result.stats.deleted }}</b><span>{{ $t('gitstat.stat.deleted') }}</span></div>
      <div class="card st-renamed"><b>{{ result.stats.renamed }}</b><span>{{ $t('gitstat.stat.renamed') }}</span></div>
    </div>
    <div v-if="result.truncated" class="warn">{{ $t('gitstat.truncated') }}</div>
    <div class="repoline">
      {{ $t('gitstat.repo_prefix') }}{{ result.repo.path }}<template v-if="result.repo.branch"> @ {{ result.repo.branch }}</template>
      · {{ result.range.since }} ~ {{ result.range.until }}
    </div>

    <div v-if="result.summary.length === 0" class="empty">{{ $t('gitstat.empty') }}</div>
    <template v-else>
      <div class="filters">
        <button v-for="f in FILTERS" :key="f" :class="{ on: filter === f }" @click="filter = f">{{ filterLabel(f) }}</button>
      </div>
      <table class="tbl">
        <thead><tr><th>{{ $t('gitstat.col.status') }}</th><th>{{ $t('gitstat.col.file') }}</th><th>{{ $t('gitstat.col.author') }}</th><th>{{ $t('gitstat.col.touches') }}</th><th>{{ $t('gitstat.col.added_lines') }}</th><th>{{ $t('gitstat.col.deleted_lines') }}</th><th>{{ $t('gitstat.col.last') }}</th></tr></thead>
        <tbody>
          <tr v-for="row in filteredSummary" :key="row.path">
            <td><span class="badge" :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span></td>
            <td class="pth"><template v-if="row.oldPath"><span class="old">{{ row.oldPath }}</span> → </template>{{ row.path }}</td>
            <td class="auth">{{ row.lastAuthor }}</td>
            <td class="num">{{ row.touches }}</td>
            <td class="num add">{{ row.added }}</td>
            <td class="num del">{{ row.deleted }}</td>
            <td class="num">{{ fmtDate(row.lastDate) }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <GitAuthorTable :rows="authorRows" />

    <h3 class="sub">{{ $t('gitstat.commits_title', { count: result.commits.length }) }}</h3>
    <div v-for="c in result.commits" :key="c.hash" class="cmt">
      <button class="chead" @click="toggleCommit(c.hash)">
        <span class="cx">{{ openCommits.has(c.hash) ? '▾' : '▸' }}</span>
        <code class="ch">{{ c.short }}</code>
        <span class="cs">{{ c.subject }}</span>
        <span class="ca">{{ c.author }} · {{ fmtDate(c.date) }}</span>
        <span class="cn">{{ c.files.length }}</span>
      </button>
      <div v-if="openCommits.has(c.hash)" class="cbody">
        <div v-for="(f, i) in c.files" :key="i" class="cf">
          <span class="badge" :class="statusClass(f.status)">{{ statusLabel(f.status) }}</span>
          <span class="cp"><template v-if="f.oldPath"><span class="old">{{ f.oldPath }}</span> → </template>{{ f.path }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.repo { min-width: 0; }
.cards { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 10px; }
.card { display: flex; flex-direction: column; align-items: center; min-width: 64px; padding: 6px 12px; border: 1px solid var(--bd); border-radius: 6px; background: var(--bg2); }
.card b { font-size: 18px; color: var(--tx1); }
.card span { font-size: 11px; color: var(--tx3); }
.card.st-added b { color: var(--ok, #3fb950); }
.card.st-modified b { color: var(--ac2); }
.card.st-deleted b { color: var(--err); }
.card.st-renamed b { color: var(--warn); }
.warn { margin: 4px 0; padding: 6px 10px; border-radius: 4px; background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); font-size: 12px; }
.repoline { color: var(--tx5); font-size: 11px; font-family: ui-monospace, Consolas, monospace; margin-bottom: 8px; word-break: break-all; }
.empty { color: var(--tx4); font-size: 12px; padding: 16px 0; }
.filters { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.filters button { background: var(--bg4); color: var(--tx3); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
.filters button.on { border-color: var(--ac); color: var(--tx1); }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.tbl th { text-align: left; color: var(--tx4); font-weight: 500; padding: 4px 8px; border-bottom: 1px solid var(--bd2); }
.tbl td { padding: 4px 8px; border-bottom: 1px solid var(--bd2); vertical-align: top; }
.tbl .num { text-align: right; color: var(--tx4); white-space: nowrap; }
.tbl .num.add { color: var(--ok, #3fb950); font-variant-numeric: tabular-nums; }
.tbl .num.del { color: var(--err); font-variant-numeric: tabular-nums; }
.auth { color: var(--tx3); white-space: nowrap; }
.pth { font-family: ui-monospace, Consolas, monospace; color: var(--tx); word-break: break-all; }
.old { color: var(--tx5); text-decoration: line-through; }
.badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; white-space: nowrap; }
.badge.st-added { background: color-mix(in srgb, var(--ok, #3fb950) 20%, transparent); color: var(--ok, #3fb950); }
.badge.st-modified { background: color-mix(in srgb, var(--ac2) 20%, transparent); color: var(--ac2); }
.badge.st-deleted { background: color-mix(in srgb, var(--err) 20%, transparent); color: var(--err); }
.badge.st-renamed { background: color-mix(in srgb, var(--warn) 20%, transparent); color: var(--warn); }
.sub { color: var(--tx1); font-size: 13px; margin: 16px 0 6px; }
.cmt { border-bottom: 1px solid var(--bd2); }
.chead { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; text-align: left; padding: 6px 4px; cursor: pointer; color: var(--tx); }
.chead:hover { background: var(--bg3); }
.cx { color: var(--tx4); width: 12px; flex: none; }
.ch { color: var(--ac2); font-family: ui-monospace, Consolas, monospace; flex: none; }
.cs { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ca { color: var(--tx4); font-size: 11px; flex: none; }
.cn { color: var(--tx4); font-size: 11px; flex: none; min-width: 18px; text-align: right; }
.cbody { padding: 2px 4px 10px 24px; display: flex; flex-direction: column; gap: 3px; }
.cf { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.cp { font-family: ui-monospace, Consolas, monospace; color: var(--tx3); word-break: break-all; }
</style>
