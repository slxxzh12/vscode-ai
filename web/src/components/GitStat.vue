<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { nodeFp } from '../nodeKey';
import {
  fetchGitChanges, defaultRange, sumStats, aggregateByAuthor,
  type GitChangesResult, type GitFilter,
} from '../gitStat';
import GitStatRepo from './GitStatRepo.vue';
import GitAuthorTable from './GitAuthorTable.vue';
import { useProjects } from '../useProjects';
import { DEFAULT_CODE_EXTS, DEFAULT_EXCLUDE_DIRS, parseExts, parseDirs } from '@devflow/shared/git-filter';
import { t } from '../i18n';

const props = defineProps<{ projectRoot?: string }>();
const projectsApi = useProjects();

interface DirEntry { dir: string; result: GitChangesResult | null; error: string; }

const dirs = ref<string[]>(['']);
const init = defaultRange();
const since = ref(init.since);
const until = ref(init.until);
const loading = ref(false);
const error = ref('');
const flt = reactive<GitFilter>({ codeOnly: true, exts: [], excludeDirs: [], excludeTestFiles: true });
const codeExtsText = ref(DEFAULT_CODE_EXTS.join(', '));
const excludeDirsText = ref(DEFAULT_EXCLUDE_DIRS.join(', '));
const entries = ref<DirEntry[]>([]);
const collapsed = ref<Set<string>>(new Set());
const recents = ref<string[]>([]);
const pickIndex = ref(-1);
const pickOpen = ref(false);
const pickPath = ref('');
let recentKey = 'devflow-gitstat-recent';
let dirsKey = 'devflow-gitstat-dirs';
let extsKey = 'devflow-gitstat-exts';
let exclKey = 'devflow-gitstat-exclude-dirs';
let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(async () => {
  const fp = await nodeFp();
  recentKey = `devflow-gitstat-recent-${fp}`;
  dirsKey = `devflow-gitstat-dirs-${fp}`;
  extsKey = `devflow-gitstat-exts-${fp}`;
  exclKey = `devflow-gitstat-exclude-dirs-${fp}`;
  try {
    const a = JSON.parse(localStorage.getItem(recentKey) || '[]');
    recents.value = Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, 20) : [];
  } catch { recents.value = []; }
  let saved: string[] = [];
  try {
    const a = JSON.parse(localStorage.getItem(dirsKey) || '[]');
    saved = Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()) : [];
  } catch { saved = []; }
  if (saved.length) dirs.value = saved;
  else if (props.projectRoot) dirs.value = [props.projectRoot];
  else if (recents.value.length) dirs.value = [recents.value[0]];
  try {
    const t = localStorage.getItem(extsKey);
    if (t !== null) codeExtsText.value = t;
  } catch { /* ignore */ }
  try {
    const d = localStorage.getItem(exclKey);
    if (d !== null) excludeDirsText.value = d;
  } catch { /* ignore */ }
});

function persistDirs() {
  const list = [...new Set(dirs.value.map((d) => d.trim()).filter(Boolean))];
  try { localStorage.setItem(dirsKey, JSON.stringify(list)); } catch { /* ignore */ }
}

watch(dirs, () => {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(persistDirs, 400);
}, { deep: true });

watch(codeExtsText, (v) => {
  try { localStorage.setItem(extsKey, v); } catch { /* ignore */ }
});

watch(excludeDirsText, (v) => {
  try { localStorage.setItem(exclKey, v); } catch { /* ignore */ }
});

onBeforeUnmount(() => { clearTimeout(autoSaveTimer); });

function addDir() { pickIndex.value = -1; pickPath.value = ''; pickOpen.value = true; }
function removeDir(i: number) {
  const next = dirs.value.filter((_, j) => j !== i);
  dirs.value = next.length ? next : [''];
}

function chooseDir(i: number) {
  pickIndex.value = i;
  pickPath.value = dirs.value[i] || '';
  pickOpen.value = true;
}

function closePick() { pickOpen.value = false; }
function confirmPick() {
  const p = pickPath.value.trim();
  const i = pickIndex.value;
  if (i < 0) {
    if (p) dirs.value = [...new Set([...dirs.value.map((d) => d.trim()).filter(Boolean), p])];
  } else {
    const next = [...dirs.value];
    next[i] = p;
    dirs.value = next;
  }
  pickOpen.value = false;
}

async function browsePick() {
  try {
    const r = await projectsApi.pickFolder();
    if (r.error) {
      error.value = r.error === 'unsupported' ? t('top.pick_unsupported') : t('top.add_failed', { msg: r.message || r.error });
      return;
    }
    if (r.path) pickPath.value = r.path;
  } catch (e: any) {
    error.value = t('top.add_failed', { msg: e?.message || String(e) });
  }
}

function toggleEntry(dir: string) {
  const s = new Set(collapsed.value);
  if (s.has(dir)) s.delete(dir); else s.add(dir);
  collapsed.value = s;
}

function remember(p: string) {
  const a = recents.value.filter((x) => x !== p);
  a.unshift(p);
  recents.value = a.slice(0, 20);
  try { localStorage.setItem(recentKey, JSON.stringify(recents.value)); } catch { /* ignore */ }
}

async function run() {
  const list = [...new Set(dirs.value.map((d) => d.trim()).filter(Boolean))];
  if (!list.length) { error.value = t('gitstat.need_repo'); return; }
  if (since.value > until.value) { error.value = t('gitstat.bad_range'); return; }
  loading.value = true;
  error.value = '';
  entries.value = [];
  collapsed.value = new Set();
  try {
    const settled = await Promise.all(list.map(async (dir): Promise<DirEntry> => {
      try {
        const result = await fetchGitChanges({ repo: dir, since: since.value, until: until.value, filter: { ...flt, exts: parseExts(codeExtsText.value), excludeDirs: parseDirs(excludeDirsText.value) } });
        return { dir, result, error: '' };
      } catch (e: any) {
        return { dir, result: null, error: String(e?.message || e) };
      }
    }));
    entries.value = settled;
    for (const e of settled) if (e.result) remember(e.dir);
  } finally {
    loading.value = false;
  }
}

const okResults = computed<GitChangesResult[]>(() => entries.value.map((e) => e.result).filter((r): r is GitChangesResult => !!r));
const total = computed(() => sumStats(okResults.value.map((r) => r.stats)));
const failedCount = computed(() => entries.value.filter((e) => e.error).length);
const authorRows = computed(() => aggregateByAuthor(okResults.value.flatMap((r) => r.commits)));
</script>

<template>
  <div class="gs">
    <header class="bar"><span class="ttl">{{ $t('gitstat.title') }}</span></header>

    <div class="form">
      <div class="dirs">
        <span class="flabel">{{ $t('gitstat.repo_label') }}</span>
        <div v-for="(d, i) in dirs" :key="i" class="dirrow">
          <input class="dinput" v-model="dirs[i]" list="gitstat-recents" :placeholder="$t('gitstat.repo_placeholder')" @keyup.enter="run" />
          <button class="pick" :title="$t('top.choose')" @click="chooseDir(i)">{{ $t('top.choose') }}</button>
          <button class="rm" :title="$t('gitstat.remove_dir')" @click="removeDir(i)">✕</button>
        </div>
        <div class="dirbtns">
          <button class="add" @click="addDir">{{ $t('gitstat.add_dir') }}</button>
        </div>
        <datalist id="gitstat-recents"><option v-for="p in recents" :key="p" :value="p" /></datalist>
      </div>
      <div class="daterow">
        <label class="fld"><span>{{ $t('gitstat.since') }}</span><input v-model="since" type="date" /></label>
        <label class="fld"><span>{{ $t('gitstat.until') }}</span><input v-model="until" type="date" /></label>
        <button class="go" :disabled="loading" @click="run">{{ loading ? $t('gitstat.querying') : $t('gitstat.query') }}</button>
      </div>
      <div class="fltrow">
        <span class="fltlabel">{{ $t('gitstat.f.title') }}</span>
        <label class="chk"><input type="checkbox" v-model="flt.codeOnly" /><span>{{ $t('gitstat.f.code_only') }}</span></label>
        <label class="chk"><input type="checkbox" v-model="flt.excludeTestFiles" /><span>{{ $t('gitstat.f.exclude_test_files') }}</span></label>
      </div>
      <div class="extbox">
        <label class="fld grow">
          <span>{{ $t('gitstat.f.exts_label') }}</span>
          <input v-model="codeExtsText" :placeholder="$t('gitstat.f.exts_placeholder')" />
        </label>
        <label class="fld grow">
          <span>{{ $t('gitstat.f.exclude_dirs_label') }}</span>
          <input v-model="excludeDirsText" :placeholder="$t('gitstat.f.exclude_dirs_placeholder')" />
        </label>
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
        <GitAuthorTable :rows="authorRows" />
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

    <div v-if="pickOpen" class="mask" @click.self="closePick">
      <div class="dlg">
        <div class="dlgttl">{{ pickIndex < 0 ? $t('top.add_folder') : $t('gitstat.pick_title') }}</div>
        <div class="dlgrow">
          <input v-model="pickPath" :placeholder="$t('gitstat.repo_placeholder')" @keyup.enter="confirmPick" />
          <button class="browse" @click="browsePick">{{ $t('gitstat.browse') }}</button>
        </div>
        <div class="dlgacts">
          <button class="ghost" @click="closePick">{{ $t('common.cancel') }}</button>
          <button class="ok" @click="confirmPick">{{ $t('common.ok') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gs { display: flex; flex-direction: column; height: 100%; min-width: 0; overflow: hidden; }
.bar { flex: none; display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--bd2); }
.ttl { color: var(--tx1); font-weight: 700; font-size: 13px; }
.form { flex: none; display: flex; flex-direction: column; gap: 10px; padding: 12px; }
.dirs { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.flabel { font-size: 11px; color: var(--tx3); }
.dirrow { display: flex; gap: 6px; align-items: center; }
.dinput { flex: 1; min-width: 0; background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 13px; }
.rm { flex: none; width: 28px; height: 28px; background: var(--bg4); color: var(--tx3); border: 1px solid var(--bd); border-radius: 4px; cursor: pointer; }
.rm:hover { color: var(--err); border-color: var(--err); }
.pick { flex: none; height: 28px; padding: 0 10px; background: var(--bg4); color: var(--tx3); border: 1px solid var(--bd); border-radius: 4px; cursor: pointer; font-size: 12px; }
.pick:hover { color: var(--tx1); border-color: var(--ac); }
.dirbtns { display: flex; align-items: center; gap: 8px; }
.add { background: none; border: 1px dashed var(--bd); color: var(--tx3); border-radius: 4px; padding: 4px 12px; font-size: 12px; cursor: pointer; }
.add:hover { color: var(--tx1); border-color: var(--ac); }
.daterow { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
.fltrow { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: 12px; color: var(--tx3); }
.fltlabel { color: var(--tx4); }
.chk { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.chk input { cursor: pointer; }
.extbox { display: flex; flex-direction: column; gap: 8px; }
.extbox .fld { width: 100%; }
.extbox input { width: 100%; background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 12px; font-family: ui-monospace, Consolas, monospace; }
.fld { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--tx3); }
.fld input { background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 13px; }
.go { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 9px 40px; font-size: 14px; font-weight: 600; cursor: pointer; margin-left: auto; }
.go:disabled { opacity: .6; cursor: default; }
.err { flex: none; margin: 0 12px; padding: 6px 10px; border-radius: 4px; background: color-mix(in srgb, var(--err) 15%, transparent); color: var(--err); font-size: 12px; }
.slow { flex: none; margin: 0 12px; padding: 6px 10px; border-radius: 4px; background: color-mix(in srgb, var(--ac) 15%, transparent); color: var(--tx); font-size: 12px; }
.res { flex: 1; min-height: 0; overflow: auto; padding: 0 12px 24px; }
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
.mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); display: flex; align-items: center; justify-content: center; z-index: 50; }
.dlg { width: min(520px, 92vw); background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; padding: 16px; box-shadow: 0 8px 30px rgba(0, 0, 0, .4); }
.dlgttl { color: var(--tx1); font-size: 14px; font-weight: 700; margin-bottom: 12px; }
.dlgrow { display: flex; gap: 8px; }
.dlgrow input { flex: 1; min-width: 0; background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 7px 10px; font-size: 13px; }
.browse { flex: none; background: var(--bg4); color: var(--tx3); border: 1px solid var(--bd); border-radius: 4px; padding: 0 14px; cursor: pointer; font-size: 13px; }
.browse:hover { color: var(--tx1); border-color: var(--ac); }
.dlgacts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.ghost { background: none; color: var(--tx3); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 16px; cursor: pointer; }
.ghost:hover { color: var(--tx1); }
.ok { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 6px 20px; font-weight: 600; cursor: pointer; }
</style>
