<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  fetchGitChanges, defaultRange, sumStats, aggregateByAuthor, statusLabel,
  type GitChangesResult,
} from '../gitStat';
import GitStatRepo from './GitStatRepo.vue';
import GitAuthorTable from './GitAuthorTable.vue';
import GroupPie from './GroupPie.vue';
import { parseExts, parseDirs, parseHugeCommitLimit, DEFAULT_HUGE_COMMIT_ADDED_LIMIT } from '@devflow/shared/git-filter';
import { useCodePrefs } from '../codePrefs';
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

interface DirEntry { dir: string; result: GitChangesResult | null; error: string; }

const { prefs, load: loadPrefs } = useCodePrefs();
const { members, load: loadGroups } = useCodeGroups();

const init = defaultRange();
const since = ref(init.since);
const until = ref(init.until);
const loading = ref(false);
const error = ref('');
const entries = ref<DirEntry[]>([]);
const collapsed = ref<Set<string>>(new Set());

onMounted(() => {
  void loadPrefs();
  void loadGroups();
});

function toggleEntry(dir: string) {
  const s = new Set(collapsed.value);
  if (s.has(dir)) s.delete(dir); else s.add(dir);
  collapsed.value = s;
}

async function run() {
  const list = [...new Set(props.dirs.map((d) => d.trim()).filter(Boolean))];
  if (!list.length) { error.value = t('gitstat.need_repo'); return; }
  if (since.value > until.value) { error.value = t('gitstat.bad_range'); return; }
  loading.value = true;
  error.value = '';
  entries.value = [];
  collapsed.value = new Set();
  try {
    const settled = await Promise.all(list.map(async (dir): Promise<DirEntry> => {
      try {
        const result = await fetchGitChanges({
          repo: dir,
          since: since.value,
          until: until.value,
          filter: {
            codeOnly: prefs.value.codeOnly,
            excludeTestFiles: props.excludeTestFiles,
            exts: parseExts(props.extsText),
            excludeDirs: parseDirs(props.excludeDirsText),
            hugeCommitLimit: parseHugeCommitLimit(prefs.value.hugeCommitLimit),
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

const okResults = computed<GitChangesResult[]>(() => entries.value.map((e) => e.result).filter((r): r is GitChangesResult => !!r));
const total = computed(() => sumStats(okResults.value.map((r) => r.stats)));
const failedCount = computed(() => entries.value.filter((e) => e.error).length);
const authorRows = computed(() => aggregateByAuthor(okResults.value.flatMap((r) => r.commits)));
const hugeFiltered = computed(() => okResults.value.reduce((s, r) => s + (r.hugeCommits || 0), 0));
const pieSlices = computed(() => groupSlices(authorRows.value.map((r) => ({ key: r.author, value: r.linesAdded })), members.value));

const exporting = ref(false);
async function exportCsv() {
  if (!okResults.value.length) return;
  exporting.value = true;
  try {
    const fileRows = entries.value.flatMap((e) => (e.result
      ? e.result.summary.map((r) => [e.dir, statusLabel(r.status), r.path, r.lastAuthor, r.touches, r.added, r.deleted, r.lastDate])
      : []));
    const commitRows = entries.value.flatMap((e) => (e.result
      ? e.result.commits.map((c) => {
        const added = c.files.reduce((s, f) => s + (f.added || 0), 0);
        const deleted = c.files.reduce((s, f) => s + (f.deleted || 0), 0);
        const count = (st: string) => c.files.filter((f) => f.status === st).length;
        return [e.dir, c.short, c.author, c.date, c.subject, c.files.length, added, deleted, count('added'), count('modified'), count('deleted')];
      })
      : []));
    const files = [
      { name: 'git-files.csv', content: toCsv([t('codestat.col.repo'), t('gitstat.col.status'), t('gitstat.col.file'), t('gitstat.col.author'), t('gitstat.col.touches'), t('codestat.col.added_lines'), t('codestat.col.deleted_lines'), t('gitstat.col.last')], fileRows) },
      { name: 'git-commits.csv', content: toCsv([t('codestat.col.repo'), t('codestat.col.hash'), t('gitstat.col.author'), t('gitstat.col.last'), t('codestat.col.subject'), t('codestat.col.files'), t('codestat.col.added_lines'), t('codestat.col.deleted_lines'), t('codestat.col.added_files'), t('codestat.col.modified_files'), t('codestat.col.deleted_files')], commitRows) },
    ];
    await downloadZip(`codestat-git-${zipStamp()}.zip`, files);
  } catch (e: any) {
    alert(t('codestat.export_failed', { msg: e?.message || String(e) }));
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="gs">
    <div class="form">
      <div class="daterow">
        <label class="fld"><span>{{ $t('gitstat.since') }}</span><input v-model="since" type="date" /></label>
        <label class="fld"><span>{{ $t('gitstat.until') }}</span><input v-model="until" type="date" /></label>
        <button class="go" :disabled="loading" @click="run">{{ loading ? $t('gitstat.querying') : $t('gitstat.query') }}</button>
        <button class="ghost" :disabled="exporting || !okResults.length" @click="exportCsv">{{ $t('codestat.export') }}</button>
      </div>
      <div class="fltrow">
        <span class="fltlabel">{{ $t('gitstat.f.title') }}</span>
        <label class="chk"><input type="checkbox" v-model="prefs.codeOnly" /><span>{{ $t('gitstat.f.code_only') }}</span></label>
        <label class="numfld"><span>{{ $t('gitstat.f.huge_limit_label') }}</span><input v-model="prefs.hugeCommitLimit" inputmode="numeric" :placeholder="String(DEFAULT_HUGE_COMMIT_ADDED_LIMIT)" /></label>
      </div>
    </div>
    <div v-if="loading" class="slow">{{ $t('gitstat.slow_hint') }}</div>
    <div v-if="error" class="err">{{ error }}</div>

    <div v-if="entries.length" class="res">
      <section class="total">
        <h3 class="sub">{{ $t('gitstat.total_title', { count: entries.length }) }}</h3>
        <div class="cards">
          <div class="card"><b>{{ total.commits }}</b><span>{{ $t('gitstat.stat.commits') }}</span></div>
          <div class="card"><b>{{ total.files }}</b><span>{{ $t('gitstat.stat.files') }}</span></div>
          <div class="card st-added"><b>{{ total.added }}</b><span>{{ $t('gitstat.stat.added') }}</span></div>
          <div class="card st-modified"><b>{{ total.modified }}</b><span>{{ $t('gitstat.stat.modified') }}</span></div>
          <div class="card st-deleted"><b>{{ total.deleted }}</b><span>{{ $t('gitstat.stat.deleted') }}</span></div>
          <div class="card st-renamed"><b>{{ total.renamed }}</b><span>{{ $t('gitstat.stat.renamed') }}</span></div>
        </div>
        <div v-if="failedCount" class="warn">{{ $t('gitstat.some_failed', { count: failedCount }) }}</div>
        <div v-if="hugeFiltered" class="warn">{{ $t('gitstat.filtered_huge', { count: hugeFiltered, limit: parseHugeCommitLimit(prefs.hugeCommitLimit) }) }}</div>
        <GitAuthorTable :rows="authorRows" />
        <GroupPie :slices="pieSlices" :title="$t('codestat.groups.by_group')" />
      </section>

      <section v-for="(e, i) in entries" :key="e.dir" class="entry">
        <button class="ehead" @click="toggleEntry(e.dir)">
          <span class="ecaret">{{ collapsed.has(e.dir) ? '▸' : '▾' }}</span>
          <span class="eidx">#{{ i + 1 }}</span>
          <span class="edir">{{ e.dir }}</span>
          <span v-if="e.result" class="ecount">{{ e.result.stats.commits }} {{ $t('gitstat.stat.commits') }} · {{ e.result.stats.files }} {{ $t('gitstat.stat.files') }}</span>
        </button>
        <template v-if="!collapsed.has(e.dir)">
          <div v-if="e.error" class="err">{{ e.error }}</div>
          <GitStatRepo v-else-if="e.result" :result="e.result" />
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.gs { display: flex; flex-direction: column; height: 100%; min-width: 0; overflow: hidden; }
.form { flex: none; display: flex; flex-direction: column; gap: 10px; padding: 0 0 12px; }
.daterow { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
.fltrow { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: 12px; color: var(--tx3); }
.fltlabel { color: var(--tx4); }
.chk { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.chk input { cursor: pointer; }
.numfld { display: inline-flex; align-items: center; gap: 6px; }
.numfld input { width: 90px; background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 6px; font-size: 12px; }
.fld { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--tx3); }
.fld input { background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 13px; }
.go { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 9px 40px; font-size: 14px; font-weight: 600; cursor: pointer; margin-left: auto; }
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
.card.st-added b { color: var(--ok, #3fb950); }
.card.st-modified b { color: var(--ac2); }
.card.st-deleted b { color: var(--err); }
.card.st-renamed b { color: var(--warn); }
.entry { padding: 10px 0 16px; border-bottom: 1px solid var(--bd2); }
.entry:last-child { border-bottom: none; }
.ehead { display: flex; align-items: center; gap: 8px; width: 100%; margin-bottom: 6px; padding: 4px 4px; background: none; border: none; border-radius: 4px; text-align: left; cursor: pointer; color: var(--tx); }
.ehead:hover { background: var(--bg3); }
.ecaret { flex: none; width: 12px; color: var(--tx4); }
.eidx { flex: none; color: var(--tx4); font-size: 11px; }
.edir { color: var(--tx1); font-weight: 600; font-size: 12px; font-family: ui-monospace, Consolas, monospace; word-break: break-all; }
.ecount { flex: none; margin-left: auto; color: var(--tx4); font-size: 11px; }
.sub { color: var(--tx1); font-size: 13px; margin: 4px 0 6px; }
.warn { margin: 4px 0; padding: 6px 10px; border-radius: 4px; background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); font-size: 12px; }
</style>
