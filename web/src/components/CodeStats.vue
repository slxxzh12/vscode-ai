<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue';
import { CollabS2C } from '@devflow/shared/collab';
import { nodeFp } from '../nodeKey';
import { useProjects } from '../useProjects';
import { useCodePrefs } from '../codePrefs';
import { useCodeGroups } from '../codeGroups';
import { t } from '../i18n';
import GitStat from './GitStat.vue';
import RealCodeStat from './RealCodeStat.vue';
import GroupManager from './GroupManager.vue';
import MemberUsageTable from '../collaboration/MemberUsageTable.vue';
import UsageTrendChart from '../collaboration/UsageTrendChart.vue';
import GroupView from '../collaboration/GroupView.vue';
import TokenStatsView from '../collaboration/TokenStatsView.vue';
import { useCollab } from '../collaboration/useCollab';
import type { CollabUsage } from '../collaboration/types';
import type { useTerminal } from '../useTerminal';

type StatTab = 'code' | 'group' | 'token';
type CodeTab = 'git' | 'real' | 'usage';
const props = defineProps<{ projectRoot?: string; tab?: StatTab; terminal?: ReturnType<typeof useTerminal> }>();
const emit = defineEmits<{ (e: 'update:tab', v: StatTab): void }>();
const projectsApi = useProjects();

const { prefs, load: loadPrefs } = useCodePrefs();
const { load: loadGroups } = useCodeGroups();
const collab = useCollab();
const usagePeers = ref<Record<string, CollabUsage>>({});
const usageStale = ref(false);

const innerTab = ref<StatTab>(props.tab || 'code');
const tab = computed<StatTab>({
  get: () => props.tab ?? innerTab.value,
  set: (v) => { innerTab.value = v; emit('update:tab', v); },
});
watch(() => props.tab, (v) => { if (v) innerTab.value = v; });
const codeTab = ref<CodeTab>('git');
const topTabs: StatTab[] = ['group', 'token', 'code'];
const dirs = ref<string[]>(['']);
const recents = ref<string[]>([]);
const pickIndex = ref(-1);
const pickOpen = ref(false);
const pickPath = ref('');
const pickError = ref('');
const groupOpen = ref(false);
let recentKey = 'devflow-codestat-recent';
let dirsKey = 'devflow-codestat-dirs';
let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;
const unsubs: Array<() => void> = [];

onMounted(async () => {
  const fp = await nodeFp();
  recentKey = `devflow-codestat-recent-${fp}`;
  dirsKey = `devflow-codestat-dirs-${fp}`;
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
  void loadPrefs();
  void loadGroups();
  void collab.refresh().catch(() => {});
  if (props.terminal) {
    unsubs.push(
      props.terminal.on(CollabS2C.COLLAB_SYNCED, () => { collab.refresh().catch(() => {}); }),
      props.terminal.on(CollabS2C.COLLAB_INBOX, () => { collab.refresh().catch(() => {}); }),
      props.terminal.on(CollabS2C.COLLAB_CHAT, (payload: any) => collab.handleS2C(CollabS2C.COLLAB_CHAT, payload)),
      props.terminal.on(CollabS2C.COLLAB_CMD_PENDING, (payload: any) => collab.handleS2C(CollabS2C.COLLAB_CMD_PENDING, payload)),
      props.terminal.on(CollabS2C.COLLAB_HEARTBEAT, () => { collab.refresh().catch(() => {}); }),
    );
  }
});

async function loadUsage() {
  try {
    const r = await fetch('/api/usage/peers?fresh=1').then((x) => x.json());
    usagePeers.value = r.peers || {};
    usageStale.value = !!r.stale;
  } catch { /* ignore */ }
}
watch(codeTab, (v) => { if (v === 'usage') void loadUsage(); });
watch(tab, (v) => {
  if (v === 'code' && codeTab.value === 'usage') void loadUsage();
  if (v === 'group') void collab.refresh().catch(() => {});
});

function persistDirs() {
  const list = [...new Set(dirs.value.map((d) => d.trim()).filter(Boolean))];
  try { localStorage.setItem(dirsKey, JSON.stringify(list)); } catch { /* ignore */ }
}

watch(dirs, () => {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(persistDirs, 400);
}, { deep: true });

onBeforeUnmount(() => { clearTimeout(autoSaveTimer); unsubs.forEach((u) => u()); });

function addDir() { pickIndex.value = -1; pickPath.value = ''; pickError.value = ''; pickOpen.value = true; }
function removeDir(i: number) {
  const next = dirs.value.filter((_, j) => j !== i);
  dirs.value = next.length ? next : [''];
}

function chooseDir(i: number) {
  pickIndex.value = i;
  pickPath.value = dirs.value[i] || '';
  pickError.value = '';
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
      pickError.value = r.error === 'unsupported' ? t('top.pick_unsupported') : t('top.add_failed', { msg: r.message || r.error });
      return;
    }
    if (r.path) pickPath.value = r.path;
  } catch (e: any) {
    pickError.value = t('top.add_failed', { msg: e?.message || String(e) });
  }
}

function remember(p: string) {
  const a = recents.value.filter((x) => x !== p);
  a.unshift(p);
  recents.value = a.slice(0, 20);
  try { localStorage.setItem(recentKey, JSON.stringify(recents.value)); } catch { /* ignore */ }
}
</script>

<template>
  <div class="cs">
    <header class="bar">
      <span class="ttl">{{ $t('codestat.title') }}</span>
      <nav class="topnav">
        <button v-for="k in topTabs" :key="k" class="topbtn" :class="{ on: tab === k }" @click="tab = k">{{ $t('codestat.tab.' + k) }}</button>
      </nav>
    </header>

    <div v-if="tab === 'code'" class="code-pane">
    <div v-if="codeTab === 'git' || codeTab === 'real'" class="form">
      <div class="dirs">
        <span class="flabel">{{ $t('gitstat.repo_label') }}</span>
        <div v-for="(d, i) in dirs" :key="i" class="dirrow">
          <input class="dinput" v-model="dirs[i]" list="codestat-recents" :placeholder="$t('gitstat.repo_placeholder')" />
          <button class="pick" :title="$t('top.choose')" @click="chooseDir(i)">{{ $t('top.choose') }}</button>
          <button class="rm" :title="$t('gitstat.remove_dir')" @click="removeDir(i)">✕</button>
        </div>
        <div class="dirbtns">
          <button class="add" @click="addDir">{{ $t('gitstat.add_dir') }}</button>
        </div>
        <datalist id="codestat-recents"><option v-for="p in recents" :key="p" :value="p" /></datalist>
      </div>
      <div class="fltrow">
        <span class="fltlabel">{{ $t('gitstat.f.title') }}</span>
        <label class="chk"><input type="checkbox" v-model="prefs.excludeTestFiles" /><span>{{ $t('codestat.f.exclude_test_files') }}</span></label>
        <button class="add" @click="groupOpen = true">{{ $t('codestat.groups.manage') }}</button>
      </div>
      <div class="extbox">
        <label class="fld grow">
          <span>{{ $t('codestat.f.exts_label') }}</span>
          <input v-model="prefs.exts" :placeholder="$t('codestat.f.exts_placeholder')" />
        </label>
        <label class="fld grow">
          <span>{{ $t('codestat.f.exclude_dirs_label') }}</span>
          <input v-model="prefs.excludeDirs" :placeholder="$t('codestat.f.exclude_dirs_placeholder')" />
        </label>
      </div>
    </div>

    <el-tabs v-model="codeTab" class="tabs">
      <el-tab-pane :label="$t('codestat.tab.git')" name="git">
        <GitStat :dirs="dirs" :exts-text="prefs.exts" :exclude-dirs-text="prefs.excludeDirs"
          :exclude-test-files="prefs.excludeTestFiles" @ran="remember" />
      </el-tab-pane>
      <el-tab-pane :label="$t('codestat.tab.real')" name="real">
        <RealCodeStat :dirs="dirs" :exts-text="prefs.exts" :exclude-dirs-text="prefs.excludeDirs"
          :exclude-test-files="prefs.excludeTestFiles" @ran="remember" />
      </el-tab-pane>
      <el-tab-pane :label="$t('codestat.tab.usage')" name="usage">
        <div class="usage-pane">
          <div v-if="usageStale" class="cfghint">{{ $t('usage.pull_failed') }}</div>
          <MemberUsageTable class="usage-table" :collab="collab" :peers="usagePeers" />
          <UsageTrendChart class="usage-trend" :collab="collab" :peers="usagePeers" />
        </div>
      </el-tab-pane>
    </el-tabs>
    </div>

    <section v-else-if="tab === 'group'" class="pane"><GroupView :collab="collab" /></section>
    <section v-else class="pane scroll"><TokenStatsView /></section>

    <GroupManager :open="groupOpen" @close="groupOpen = false" />

    <div v-if="pickOpen" class="mask" @click.self="closePick">
      <div class="dlg">
        <div class="dlgttl">{{ pickIndex < 0 ? $t('top.add_folder') : $t('gitstat.pick_title') }}</div>
        <div class="dlgrow">
          <input v-model="pickPath" :placeholder="$t('gitstat.repo_placeholder')" @keyup.enter="confirmPick" />
          <button class="browse" @click="browsePick">{{ $t('gitstat.browse') }}</button>
        </div>
        <div v-if="pickError" class="dlgerr">{{ pickError }}</div>
        <div class="dlgacts">
          <button class="ghost" @click="closePick">{{ $t('common.cancel') }}</button>
          <button class="ok" @click="confirmPick">{{ $t('common.ok') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cs { display: flex; flex-direction: column; height: 100%; min-width: 0; overflow: hidden; }
.bar { flex: none; display: flex; align-items: center; gap: 14px; padding: 8px 12px; border-bottom: 1px solid var(--bd2); }
.ttl { color: var(--tx1); font-weight: 700; font-size: 13px; }
.topnav { display: flex; gap: 4px; }
.topbtn { background: none; border: 1px solid transparent; color: var(--tx3); border-radius: 4px; padding: 3px 12px; font-size: 12px; cursor: pointer; font-family: inherit; }
.topbtn:hover { color: var(--tx1); }
.topbtn.on { background: var(--bg1); border-color: var(--bd); color: var(--ac2); }
.code-pane { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.pane { flex: 1; min-height: 0; display: flex; overflow: hidden; }
.pane.scroll { overflow: auto; }
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
.fltrow { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: 12px; color: var(--tx3); }
.fltlabel { color: var(--tx4); }
.chk { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.chk input { cursor: pointer; }
.extbox { display: flex; flex-direction: column; gap: 8px; }
.extbox .fld { width: 100%; }
.extbox input { width: 100%; background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 12px; font-family: ui-monospace, Consolas, monospace; }
.fld { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--tx3); }
.tabs { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0 12px; }
.tabs :deep(.el-tabs__header) { flex: none; margin-bottom: 8px; }
.tabs :deep(.el-tabs__content) { flex: 1; min-height: 0; overflow: hidden; }
.tabs :deep(.el-tab-pane) { height: 100%; }
.usage-pane { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
.usage-table { flex: 0 0 auto; }
.usage-trend { flex: 1; min-height: 280px; }
.mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); display: flex; align-items: center; justify-content: center; z-index: 50; }
.dlg { width: min(520px, 92vw); background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; padding: 16px; box-shadow: 0 8px 30px rgba(0, 0, 0, .4); }
.dlgttl { color: var(--tx1); font-size: 14px; font-weight: 700; margin-bottom: 12px; }
.dlgrow { display: flex; gap: 8px; }
.dlgrow input { flex: 1; min-width: 0; background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 7px 10px; font-size: 13px; }
.browse { flex: none; background: var(--bg4); color: var(--tx3); border: 1px solid var(--bd); border-radius: 4px; padding: 0 14px; cursor: pointer; font-size: 13px; }
.browse:hover { color: var(--tx1); border-color: var(--ac); }
.dlgerr { margin-top: 8px; color: var(--err); font-size: 12px; }
.dlgacts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.ghost { background: none; color: var(--tx3); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 16px; cursor: pointer; }
.ghost:hover { color: var(--tx1); }
.ok { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 6px 20px; font-weight: 600; cursor: pointer; }
</style>
