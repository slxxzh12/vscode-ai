<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { fetchCodeStats, sumCodeTotals, ratioText, type CodeStatsResult, type CodeFileRow } from '../codeStats';
import { parseExts, parseDirs } from '@devflow/shared/git-filter';
import GroupPie from './GroupPie.vue';
import { useCodeGroups, groupSlices } from '../codeGroups';
import { toCsv, zipStamp, downloadZip } from '../csv';
import { t } from '../i18n';

const props = defineProps<{
  dirs: string[];
  extsText: string;
  excludeDirsText: string;
  excludeTestFiles: boolean;
}>();
const emit = defineEmits<{ (e: 'ran', dir: string): void }>();

const { groups, members, groupOf, assign, load: loadGroups } = useCodeGroups();
onMounted(() => void loadGroups());

interface DirEntry { dir: string; result: CodeStatsResult | null; error: string; }

const loading = ref(false);
const error = ref('');
const entries = ref<DirEntry[]>([]);
const collapsed = ref<Set<string>>(new Set());
const sortKey = ref<'real' | 'total' | 'rel'>('real');

function toggleEntry(dir: string) {
  const s = new Set(collapsed.value);
  if (s.has(dir)) s.delete(dir); else s.add(dir);
  collapsed.value = s;
}

async function run() {
  const list = [...new Set(props.dirs.map((d) => d.trim()).filter(Boolean))];
  if (!list.length) { error.value = t('codestat.need_dir'); return; }
  loading.value = true;
  error.value = '';
  entries.value = [];
  collapsed.value = new Set();
  try {
    const settled = await Promise.all(list.map(async (dir): Promise<DirEntry> => {
      try {
        const result = await fetchCodeStats({
          dir,
          filter: {
            codeOnly: true,
            excludeTestFiles: props.excludeTestFiles,
            exts: parseExts(props.extsText),
            excludeDirs: parseDirs(props.excludeDirsText),
          },
        });
        return { dir, result, error: '' };
      } catch (e: any) {
        return { dir, result: null, error: String(e?.message || e) };
      }
    }));
    entries.value = settled;
    for (const e of settled) if (e.result) emit('ran', e.dir);
  } finally {
    loading.value = false;
  }
}

function sortedFiles(rows: CodeFileRow[]): CodeFileRow[] {
  const key = sortKey.value;
  return [...rows].sort((a, b) => {
    if (key === 'rel') return a.rel.localeCompare(b.rel);
    return b[key] - a[key] || a.rel.localeCompare(b.rel);
  });
}

const okResults = computed<CodeStatsResult[]>(() => entries.value.map((e) => e.result).filter((r): r is CodeStatsResult => !!r));
const total = computed(() => sumCodeTotals(okResults.value.map((r) => r.totals)));
const failedCount = computed(() => entries.value.filter((e) => e.error).length);
const SORTS = ['real', 'total', 'rel'] as const;
function sortLabel(k: 'real' | 'total' | 'rel'): string {
  return k === 'rel' ? t('codestat.col.file') : t(`codestat.col.${k}`);
}

const totalReal = computed(() => okResults.value.reduce((s, r) => s + r.totals.real, 0));

// 按首次提交人聚合实代码行（无首次作者 → 空 key 行，界面显示「未知作者」）
const authorRows = computed(() => {
  const acc = new Map<string, number>();
  for (const e of okResults.value) {
    for (const f of e.files) {
      const who = f.firstAuthor || '';
      acc.set(who, (acc.get(who) || 0) + f.real);
    }
  }
  return [...acc.entries()]
    .map(([author, real]) => ({ author, real, pct: totalReal.value ? (real / totalReal.value) * 100 : 0 }))
    .sort((a, b) => b.real - a.real);
});

const pieSlices = computed(() => groupSlices(authorRows.value.map((r) => ({ key: r.author, value: r.real })), members.value));

const exporting = ref(false);
async function exportCsv() {
  if (!okResults.value.length) return;
  exporting.value = true;
  try {
    const dirRows = entries.value.flatMap((e) => (e.result
      ? e.result.groups.map((g) => [e.dir, g.key, g.files, g.real, g.total, ratioText(g.real, g.total)])
      : []));
    const fileRows = entries.value.flatMap((e) => (e.result
      ? sortedFiles(e.result.files).map((f) => [e.dir, f.rel, f.real, f.total, ratioText(f.real, f.total), f.firstAuthor || ''])
      : []));
    const files = [
      { name: 'real-dirs.csv', content: toCsv([t('codestat.col.repo'), t('codestat.col.dir'), t('codestat.col.files'), t('codestat.col.real'), t('codestat.col.total'), t('codestat.col.ratio')], dirRows) },
      { name: 'real-files.csv', content: toCsv([t('codestat.col.repo'), t('codestat.col.file'), t('codestat.col.real'), t('codestat.col.total'), t('codestat.col.ratio'), t('codestat.col.first_author')], fileRows) },
    ];
    await downloadZip(`codestat-real-${zipStamp()}.zip`, files);
  } catch (e: any) {
    alert(t('codestat.export_failed', { msg: e?.message || String(e) }));
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="rc">
    <div class="toolbar">
      <button class="go" :disabled="loading" @click="run">{{ loading ? $t('codestat.running') : $t('codestat.run') }}</button>
      <button class="ghost" :disabled="exporting || !okResults.length" @click="exportCsv">{{ $t('codestat.export') }}</button>
    </div>
    <div v-if="loading" class="slow">{{ $t('codestat.slow_hint') }}</div>
    <div v-if="error" class="err">{{ error }}</div>

    <div v-if="entries.length" class="res">
      <section class="total">
        <div class="cards">
          <div class="card"><b>{{ total.files }}</b><span>{{ $t('codestat.total_files') }}</span></div>
          <div class="card"><b>{{ total.real }}</b><span>{{ $t('codestat.total_real') }}</span></div>
          <div class="card"><b>{{ total.total }}</b><span>{{ $t('codestat.total_all') }}</span></div>
          <div class="card"><b>{{ ratioText(total.real, total.total) }}</b><span>{{ $t('codestat.col.ratio') }}</span></div>
        </div>
        <div v-if="failedCount" class="warn">{{ $t('codestat.some_failed', { count: failedCount }) }}</div>

        <template v-if="authorRows.length">
          <h3 class="sub">{{ $t('codestat.author_title') }}</h3>
          <table class="tbl">
            <thead><tr>
              <th>{{ $t('gitstat.col.author') }}</th>
              <th class="num">{{ $t('codestat.col.real') }}</th>
              <th class="num">{{ $t('codestat.col.ratio') }}</th>
              <th>{{ $t('codestat.groups.col') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="r in authorRows" :key="r.author || '__unknown__'">
                <td class="auth">{{ r.author || $t('codestat.groups.unknown_author') }}</td>
                <td class="num add">{{ r.real }}</td>
                <td class="num">{{ r.pct.toFixed(1) }}%</td>
                <td class="group">
                  <select v-if="r.author" class="gsel" :value="groupOf(r.author)" @change="(e) => assign(r.author, (e.target as HTMLSelectElement).value)">
                    <option value="">{{ $t('codestat.groups.ungrouped') }}</option>
                    <option v-for="g in groups" :key="g" :value="g">{{ g }}</option>
                  </select>
                  <span v-else>—</span>
                </td>
              </tr>
            </tbody>
          </table>
          <GroupPie :slices="pieSlices" :title="$t('codestat.groups.by_group')" />
        </template>
      </section>

      <section v-for="(e, i) in entries" :key="e.dir" class="entry">
        <button class="ehead" @click="toggleEntry(e.dir)">
          <span class="ecaret">{{ collapsed.has(e.dir) ? '▸' : '▾' }}</span>
          <span class="eidx">#{{ i + 1 }}</span>
          <span class="edir">{{ e.dir }}</span>
          <span v-if="e.result" class="ecount">{{ e.result.totals.files }} {{ $t('codestat.total_files') }} · {{ e.result.totals.real }} {{ $t('codestat.total_real') }}</span>
        </button>
        <template v-if="!collapsed.has(e.dir)">
          <div v-if="e.error" class="err">{{ e.error }}</div>
          <template v-else-if="e.result">
            <div v-if="e.result.truncated" class="warn">{{ $t('codestat.truncated') }}</div>

            <h3 class="sub">{{ $t('codestat.groups_title') }}</h3>
            <table class="tbl">
              <thead><tr>
                <th>{{ $t('codestat.col.dir') }}</th>
                <th class="num">{{ $t('codestat.col.files') }}</th>
                <th class="num">{{ $t('codestat.col.real') }}</th>
                <th class="num">{{ $t('codestat.col.total') }}</th>
                <th class="num">{{ $t('codestat.col.ratio') }}</th>
              </tr></thead>
              <tbody>
                <tr v-for="g in e.result.groups" :key="g.key">
                  <td class="pth">{{ g.key }}</td>
                  <td class="num">{{ g.files }}</td>
                  <td class="num add">{{ g.real }}</td>
                  <td class="num">{{ g.total }}</td>
                  <td class="num">{{ ratioText(g.real, g.total) }}</td>
                </tr>
              </tbody>
            </table>

            <div v-if="e.result.files.length" class="head">
              <h3 class="sub">{{ $t('codestat.files_title', { count: e.result.files.length }) }}</h3>
              <div class="sorts">
                <button v-for="k in SORTS" :key="k" :class="{ on: sortKey === k }" @click="sortKey = k">{{ sortLabel(k) }}</button>
              </div>
            </div>
            <table v-if="e.result.files.length" class="tbl">
              <thead><tr>
                <th>{{ $t('codestat.col.file') }}</th>
                <th class="num">{{ $t('codestat.col.real') }}</th>
                <th class="num">{{ $t('codestat.col.total') }}</th>
                <th class="num">{{ $t('codestat.col.ratio') }}</th>
                <th>{{ $t('codestat.col.first_author') }}</th>
              </tr></thead>
              <tbody>
                <tr v-for="f in sortedFiles(e.result.files)" :key="f.rel">
                  <td class="pth">{{ f.rel }}</td>
                  <td class="num add">{{ f.real }}</td>
                  <td class="num">{{ f.total }}</td>
                  <td class="num">{{ ratioText(f.real, f.total) }}</td>
                  <td class="auth">{{ f.firstAuthor || '—' }}</td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty">{{ $t('codestat.empty') }}</div>
          </template>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.rc { display: flex; flex-direction: column; height: 100%; min-width: 0; overflow: hidden; }
.toolbar { flex: none; padding: 0 0 10px; display: flex; gap: 8px; }
.go { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 9px 40px; font-size: 14px; font-weight: 600; cursor: pointer; }
.go:disabled { opacity: .6; cursor: default; }
.ghost { background: var(--bg4); color: var(--tx3); border: 1px solid var(--bd); border-radius: 4px; padding: 9px 18px; font-size: 13px; cursor: pointer; }
.ghost:hover { color: var(--tx1); border-color: var(--ac); }
.ghost:disabled { opacity: .5; cursor: default; }
.err { flex: none; margin: 0 0 8px; padding: 6px 10px; border-radius: 4px; background: color-mix(in srgb, var(--err) 15%, transparent); color: var(--err); font-size: 12px; }
.slow { flex: none; margin: 0 0 8px; padding: 6px 10px; border-radius: 4px; background: color-mix(in srgb, var(--ac) 15%, transparent); color: var(--tx); font-size: 12px; }
.res { flex: 1; min-height: 0; overflow: auto; padding: 0 0 24px; }
.total { padding: 8px 0 12px; border-bottom: 1px solid var(--bd2); }
.cards { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 10px; }
.card { display: flex; flex-direction: column; align-items: center; min-width: 64px; padding: 6px 12px; border: 1px solid var(--bd); border-radius: 6px; background: var(--bg2); }
.card b { font-size: 18px; color: var(--tx1); }
.card span { font-size: 11px; color: var(--tx3); }
.entry { padding: 10px 0 16px; border-bottom: 1px solid var(--bd2); }
.entry:last-child { border-bottom: none; }
.ehead { display: flex; align-items: center; gap: 8px; width: 100%; margin-bottom: 6px; padding: 4px 4px; background: none; border: none; border-radius: 4px; text-align: left; cursor: pointer; color: var(--tx); }
.ehead:hover { background: var(--bg3); }
.ecaret { flex: none; width: 12px; color: var(--tx4); }
.eidx { flex: none; color: var(--tx4); font-size: 11px; }
.edir { color: var(--tx1); font-weight: 600; font-size: 12px; font-family: ui-monospace, Consolas, monospace; word-break: break-all; }
.ecount { flex: none; margin-left: auto; color: var(--tx4); font-size: 11px; }
.sub { color: var(--tx1); font-size: 13px; margin: 4px 0 6px; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sorts { display: flex; gap: 6px; }
.sorts button { background: var(--bg4); color: var(--tx3); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
.sorts button.on { border-color: var(--ac); color: var(--tx1); }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 8px; }
.tbl th { text-align: left; color: var(--tx4); font-weight: 500; padding: 4px 8px; border-bottom: 1px solid var(--bd2); }
.tbl td { padding: 4px 8px; border-bottom: 1px solid var(--bd2); vertical-align: top; }
.tbl .num { text-align: right; color: var(--tx4); white-space: nowrap; }
.tbl .num.add { color: var(--ok, #3fb950); font-variant-numeric: tabular-nums; }
.pth { font-family: ui-monospace, Consolas, monospace; color: var(--tx); word-break: break-all; }
.auth { color: var(--tx3); white-space: nowrap; }
.group { white-space: nowrap; }
.gsel { background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 2px 6px; font-size: 12px; }
.empty { color: var(--tx4); font-size: 12px; padding: 12px 0; }
.warn { margin: 4px 0; padding: 6px 10px; border-radius: 4px; background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); font-size: 12px; }
</style>
