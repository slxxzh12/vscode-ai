<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { useTerminal } from './useTerminal';
import { useProjects } from './useProjects';
import { useCenter } from './useCenter';
import { useMessageHistory } from './useMessageHistory';
import CollaborationView from './collaboration/CollaborationView.vue';
import SchedulerView from './scheduler/SchedulerView.vue';
import JoinInviteCard from './collaboration/JoinInviteCard.vue';
import { useCollab } from './collaboration/useCollab';
import type { CollabGroup } from './collaboration/types';
import TerminalView from './components/TerminalView.vue';
import HistoryList from './components/HistoryList.vue';
import FileTree from './components/FileTree.vue';
import GitStat from './components/GitStat.vue';
import type { ProjectInfo } from '@devflow/shared';
import { useTheme } from './theme';
import { useI18n } from './i18n';

const terminal = useTerminal({});
const center = useCenter();
const projectsApi = useProjects();
const { theme, toggle } = useTheme();
const { locale, setLocale, t } = useI18n();
function toggleLang() { setLocale(locale.value === 'en' ? 'zh-CN' : 'en'); }
const projects = ref<ProjectInfo[]>([]);
const currentProject = ref<string | null>(null);
const rail = ref<'explorer' | 'history' | 'contacts' | 'stat' | 'scheduler'>('explorer');
const inviteCollab = useCollab();
const inviteToken = ref('');
const historyTab = ref<'files' | 'messages'>('files');
const msgHistory = useMessageHistory();
function onOpenHistory(e: Event) {
  const d = (e as CustomEvent).detail || {};
  rail.value = 'history';
  historyTab.value = d.tab === 'messages' ? 'messages' : 'files';
}
function onOpenMessage(text: string) {
  rail.value = 'history';
  window.dispatchEvent(new CustomEvent('df-fill-composer', { detail: { text } }));
}
const detailToken = ref(0);
const detailPath = ref('');
function onDetailFile(projectId: string, path: string) {
  const q = path.replace(/\\/g, '/');
  const i = q.lastIndexOf('/');
  const name = i >= 0 ? q.slice(i + 1) : q;
  pushFileHistory(projectId, q);
  center.openFile(projectId, path, name);
  detailPath.value = q;
  detailToken.value++;
}

// —— 打开文件历史（按节点公钥指纹隔离存储，同机多实例不串）——
interface FileRec { projectId: string; path: string; ts: number; }
function loadHistoryArr(raw: string | null): FileRec[] {
  try {
    const a = JSON.parse(raw || '[]');
    return Array.isArray(a) ? a.filter((x) => x && typeof x.projectId === 'string' && typeof x.path === 'string' && typeof x.ts === 'number') : [];
  } catch { return []; }
}
let fileHistKey = 'devflow-file-history';
const fileHistory = ref<FileRec[]>([]);
function persistFileHistory() {
  try { localStorage.setItem(fileHistKey, JSON.stringify(fileHistory.value.slice(0, 200))); } catch { /* ignore */ }
}
async function initFileHistory() {
  try {
    const snap = await fetch('/api/collab/snapshot').then((r) => r.json()).catch(() => null);
    const pem: string = snap?.identity?.publicKey || '';
    let fp = 'none';
    if (pem) {
      try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pem));
        fp = Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
      } catch { fp = 'none'; }
    }
    fileHistKey = `devflow-file-history-${fp}`;
    fileHistory.value = loadHistoryArr(localStorage.getItem(fileHistKey));
  } catch { /* keep empty */ }
}
function pushFileHistory(projectId: string, path: string) {
  const q = path.replace(/\\/g, '/');
  const arr = fileHistory.value.filter((r) => !(r.projectId === projectId && r.path === q));
  arr.unshift({ projectId, path: q, ts: Date.now() });
  fileHistory.value = arr.slice(0, 200);
  persistFileHistory();
}
function removeFileHistory(projectId: string, path: string) {
  fileHistory.value = fileHistory.value.filter((r) => !(r.projectId === projectId && r.path === path));
  persistFileHistory();
}
function clearFileHistory() { fileHistory.value = []; persistFileHistory(); }
const historyItems = computed(() => fileHistory.value.map((r) => {
  const i = r.path.lastIndexOf('/');
  const name = i >= 0 ? r.path.slice(i + 1) : r.path;
  const projName = projects.value.find((p) => p.id === r.projectId)?.name || r.projectId;
  return { ...r, name, projName };
}));
function openFromHistory(it: FileRec & { name: string; projName: string }) {
  if (it.projectId) { currentProject.value = it.projectId; touchRecent(it.projectId); }
  pushFileHistory(it.projectId, it.path);
  center.openFile(it.projectId, it.path, it.name);
}

const projectName = computed(() => projects.value.find((p) => p.id === currentProject.value)?.name || t('app.no_project'));
const currentProjectInfo = computed(() => projects.value.find((p) => p.id === currentProject.value) || null);
// 顶栏展示：优先「选中文件的绝对路径」，无选中文件则显示项目根绝对路径
const displayPath = computed(() => {
  const root = currentProjectInfo.value?.root || '';
  if (!root) return '';
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const af = center.active.value && center.active.value.kind === 'file' ? center.active.value.path : null;
  if (!af) return base;
  return base + '/' + af.replace(/\\/g, '/').replace(/^\/+/, '');
});

const RECENT_KEY = 'devflow-recent-projects';
const RECENT_MAX = 100;
interface RecentRec { id: string; ts: number; }
function loadRecents(): RecentRec[] {
  try {
    const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(a) ? a.filter((x) => x && typeof x.id === 'string' && typeof x.ts === 'number') : [];
  } catch { return []; }
}
function saveRecents(a: RecentRec[]) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(a.slice(0, RECENT_MAX))); } catch { /* ignore */ } }
const recents = ref<RecentRec[]>(loadRecents());
function touchRecent(id: string) {
  const a = recents.value.filter((x) => x.id !== id);
  a.unshift({ id, ts: Date.now() });
  recents.value = a.slice(0, RECENT_MAX);
  saveRecents(a);
}
function fmtRecent(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.toDateString() === now.toDateString();
  const thisYear = d.getFullYear() === now.getFullYear();
  if (sameDay) return t('time.today', { hm });
  if (thisYear) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
interface OrderedItem { project: ProjectInfo; ts: number | null; }
const orderedProjects = computed<OrderedItem[]>(() => {
  const byId = new Map(projects.value.map((p) => [p.id, p]));
  const recent = recents.value
    .filter((r) => byId.has(r.id))
    .sort((a, b) => b.ts - a.ts)
    .map((r): OrderedItem => ({ project: byId.get(r.id)!, ts: r.ts }));
  const rest = projects.value.filter((p) => !recents.value.some((r) => r.id === p.id)).map((p): OrderedItem => ({ project: p, ts: null }));
  return recent.concat(rest).slice(0, RECENT_MAX);
});
const activeFilePath = computed(() => {
  const a = center.active.value;
  return a && a.kind === 'file' && a.projectId === currentProject.value ? (a.path ?? null) : null;
});

const SIDE_KEY = 'devflow-side-width';
function initialSideW(): number {
  try { const v = Number(localStorage.getItem(SIDE_KEY)); if (v >= 140 && v <= 700) return v; } catch { /* ignore */ }
  return 240;
}
const sideW = ref<number>(initialSideW());
const dragging = ref(false);
let dragStartX = 0;
let dragStartW = 0;
function onDividerDown(e: MouseEvent) {
  dragStartX = e.clientX;
  dragStartW = sideW.value;
  dragging.value = true;
  document.body.classList.add('dragging-side');
  document.addEventListener('mousemove', onDividerMove);
  document.addEventListener('mouseup', onDividerUp);
}
function onDividerMove(e: MouseEvent) {
  const w = clamp(dragStartW + (e.clientX - dragStartX), 140, 700);
  sideW.value = Math.round(w);
}
function onDividerUp() {
  dragging.value = false;
  document.body.classList.remove('dragging-side');
  document.removeEventListener('mousemove', onDividerMove);
  document.removeEventListener('mouseup', onDividerUp);
  try { localStorage.setItem(SIDE_KEY, String(sideW.value)); } catch { /* ignore */ }
}
function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }

async function loadProjects() {
  try { projects.value = await projectsApi.list(); } catch { projects.value = []; }
  if (!currentProject.value && projects.value.length) {
    currentProject.value = projects.value[0].id;
    touchRecent(currentProject.value);
  }
}
function selectProject(id: string) {
  currentProject.value = id;
  if (id) touchRecent(id);
}
function openFile(projectId: string, path: string) {
  const q = path.replace(/\\/g, '/');
  const i = q.lastIndexOf('/');
  const name = i >= 0 ? q.slice(i + 1) : q;   // 文件名一律由 path 推导，避免上游传错标签
  pushFileHistory(projectId, q);
  center.openFile(projectId, path, name);
}
function openAgentSettings() {
  // 设置弹窗在 TerminalView 内，仅在「目录/历史」视图挂载；通讯录/统计页需先切回目录
  if (rail.value === 'contacts' || rail.value === 'stat') { rail.value = 'explorer'; }
  setTimeout(() => window.dispatchEvent(new Event('df-open-agent-settings')), 120);
}
onMounted(() => {
  const sp = new URLSearchParams(window.location.search);
  const it = sp.get('invite');
  if (it) inviteToken.value = it;
  initFileHistory();
  loadProjects();
  msgHistory.load();
  window.addEventListener('df-open-history', onOpenHistory);
  terminal.connect();
});
onBeforeUnmount(() => {
  window.removeEventListener('df-open-history', onOpenHistory);
});
function clearInvite() {
  inviteToken.value = '';
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete('invite');
    window.history.replaceState({}, '', u.pathname + (u.search ? u.search : ''));
  } catch { /* ignore */ }
}
function onInviteJoined(_g?: CollabGroup) {
  clearInvite();
  rail.value = 'contacts';
}
</script>

<template>
  <div class="app">
    <header class="top">
      <span class="logo">◈ devflow</span>
      <span class="proj">{{ projectName }}</span>
      <span v-if="displayPath" class="projpath" :title="displayPath">{{ displayPath }}</span>
      <select v-if="orderedProjects.length" :value="currentProject || ''" class="proj-sel" @change="(e: any) => selectProject(e.target.value)">
        <option v-for="it in orderedProjects" :key="it.project.id" :value="it.project.id">
          {{ it.project.name }}{{ it.ts ? ' · ' + fmtRecent(it.ts) : '' }}
        </option>
      </select>
      <div class="spacer" />
      <span v-if="terminal.state.status === 'reconnecting'" class="net">{{ $t('app.reconnecting') }}</span>
      <button class="lang-btn" :title="$t('lang.switch')" @click="toggleLang">{{ locale === 'en' ? $t('lang.zh_short') : $t('lang.en_short') }}</button>
      <button class="theme-btn" :title="theme === 'dark' ? $t('app.theme.to_light') : $t('app.theme.to_dark')" @click="toggle">{{ theme === 'dark' ? '☀' : '🌙' }}</button>
    </header>

    <div class="main">
      <aside class="activity">
        <button class="a-btn" :class="{ on: rail === 'explorer' }" :title="$t('nav.explorer')" @click="rail = 'explorer'">▤</button>
        <button class="a-btn" :class="{ on: rail === 'history' }" :title="$t('nav.history')" @click="rail = 'history'">🕘</button>
        <button class="a-btn" :class="{ on: rail === 'contacts' }" :title="$t('nav.contacts')" @click="rail = 'contacts'">👥</button>
        <button class="a-btn" :class="{ on: rail === 'stat' }" :title="$t('nav.stat')" @click="rail = 'stat'">📊</button>
        <button class="a-btn" :class="{ on: rail === 'scheduler' }" :title="$t('nav.scheduler')" @click="rail = 'scheduler'">⏰</button>
        <button class="a-btn gearbot" :title="$t('nav.settings')" @click="openAgentSettings">⚙</button>
      </aside>
      <template v-if="rail === 'contacts'">
        <section class="center">
          <CollaborationView :terminal="terminal" />
        </section>
      </template>
      <template v-else-if="rail === 'stat'">
        <section class="center">
          <GitStat />
        </section>
      </template>
      <template v-else-if="rail === 'scheduler'">
        <section class="center">
          <SchedulerView :terminal="terminal" />
        </section>
      </template>
      <template v-else>
        <aside class="side" :style="{ width: sideW + 'px' }">
          <HistoryList v-if="rail === 'history'" :items="historyItems" :tab="historyTab" :messages="msgHistory.messages.value"
            @update:tab="historyTab = $event" @open="openFromHistory" @remove="(pid, p) => removeFileHistory(pid, p)"
            @clear="clearFileHistory" @open-message="onOpenMessage" @clear-messages="msgHistory.clear()" />
          <FileTree v-else :project-id="currentProject" :active-path="activeFilePath" @open-file="openFile" @detail-file="onDetailFile" />
        </aside>
        <div class="divider" :class="{ on: dragging }" @mousedown.prevent="onDividerDown" />
        <section class="center">
          <TerminalView :terminal="terminal" :center="center" :project-id="currentProject" :detail-token="detailToken" :detail-path="detailPath" />
        </section>
      </template>
    </div>

    <div v-if="inviteToken" class="joinmask" @click.self="clearInvite()">
      <JoinInviteCard :collab="inviteCollab" :token="inviteToken" @joined="onInviteJoined" @cancel="clearInvite" />
    </div>
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; position: relative; }
.top { display: flex; align-items: center; gap: 12px; height: 42px; padding: 0 12px; background: var(--bg1); border-bottom: 1px solid var(--bd); flex: none; }
.logo { color: var(--ac3); font-weight: 700; }
.proj { color: var(--tx2); font-size: 12px; white-space: nowrap; }
.projpath { color: var(--tx5); font-size: 11px; font-family: ui-monospace, Consolas, monospace; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.proj-sel { background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 2px 6px; max-width: 320px; }
.spacer { flex: 1; }
.theme-btn { background: var(--bg5); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 9px; cursor: pointer; font-size: 14px; line-height: 1; }
.theme-btn:hover { border-color: var(--ac2); }
.lang-btn { background: var(--bg5); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 12px; line-height: 1; }
.lang-btn:hover { border-color: var(--ac2); }
.net { color: var(--warn); font-size: 12px; }
.main { flex: 1; display: flex; min-height: 0; }
.activity { width: 40px; background: var(--bg6); border-right: 1px solid var(--bd); display: flex; flex-direction: column; align-items: center; padding-top: 6px; gap: 2px; flex: none; }
.a-btn { background: none; border: none; color: var(--tx6); font-size: 17px; width: 34px; height: 30px; cursor: pointer; border-left: 2px solid transparent; }
.a-btn.on { color: var(--tx1); border-left-color: var(--ac); }
.a-btn.gearbot { margin-top: auto; margin-bottom: 8px; }
.side { width: 240px; background: var(--bg1); border-right: 1px solid var(--bd); overflow: auto; flex: none; }
.divider { width: 5px; flex: none; cursor: col-resize; background: transparent; margin: 0 -2px; z-index: 5; }
.divider:hover, .divider.on { background: var(--ac); opacity: .55; }
.center { flex: 1; min-width: 0; }
body.dragging-side { cursor: col-resize; user-select: none; }
.joinmask { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
</style>
