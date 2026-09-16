<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import { groupTasksByStatus, kindKeyOf, taskItemCount, type DistTask } from './distTasks';
import { t } from '../i18n';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const me = computed(() => snap.value.identity.machineId);

// 我作为成员加入、且 hub 不是本机的群（即各 master）
const hubs = computed(() => (snap.value.groups || []).filter((g) => g.hubId !== me.value && g.members.some((m) => m.machineId === me.value)));

interface SeedFile { name: string; kind?: string; size?: number; sha256?: string }
interface SeedState { version: string; current: SeedFile[]; prev: SeedFile[]; selected: Record<string, boolean>; msg: string }
const seeds = ref<Record<string, SeedState>>({});
function stateOf(id: string): SeedState {
  if (!seeds.value[id]) seeds.value[id] = { version: '', current: [], prev: [], selected: {}, msg: '' };
  return seeds.value[id];
}
const localFiles = ref<Set<string>>(new Set());
const installMsg = ref('');

// ---- 分发任务（本机任务表：群主发布的分发通知落成的待办）----
const distGroups = ref(groupTasksByStatus([]));
const taskMsg = ref('');
const busyTask = ref('');
const allDist = computed(() => [...distGroups.value.pending, ...distGroups.value.failed, ...distGroups.value.done, ...distGroups.value.ignored]);
async function loadTasks() {
  try {
    const r = await props.collab.listTasks();
    distGroups.value = groupTasksByStatus(r.tasks || []);
  } catch { /* 离线时保持空 */ }
}
async function acceptTask(task: DistTask) {
  busyTask.value = task.id; taskMsg.value = '';
  try {
    const r = await props.collab.acceptTask(task.id);
    taskMsg.value = r.code === 'ok' ? t('collab.task.accepted') : t('collab.task.accept_failed', { msg: r.code });
  } catch (e: any) { taskMsg.value = t('collab.task.accept_failed', { msg: String(e?.message || e) }); }
  finally { busyTask.value = ''; await loadTasks(); }
}
async function ignoreTask(task: DistTask) {
  busyTask.value = task.id; taskMsg.value = '';
  try { await props.collab.ignoreTask(task.id); } finally { busyTask.value = ''; await loadTasks(); }
}
function groupNameOf(id: string) {
  return (snap.value.groups || []).find((g) => g.id === id)?.name || id;
}

async function loadLocal() {
  try { const r = await props.collab.listDownloads(); localFiles.value = new Set((r.manifest.files || []).map((f) => f.name)); } catch { /* ignore */ }
}
// 检测 master 种子：与上次确认记录（本地 sync/<masterId>.json 里的 update）比对
async function loadSeed(id: string) {
  const s = stateOf(id); s.msg = '';
  try {
    const r = await props.collab.checkUpdate(id);
    if (r.code !== 'ok') { s.msg = t('collab.update.no_remote'); return; }
    s.version = r.update?.version || '';
    s.current = (r.update?.files || []) as SeedFile[];
    s.prev = (((r as unknown as { local?: { update?: { files?: SeedFile[] } } }).local?.update?.files) || []) as SeedFile[];
  } catch (e: any) { s.msg = String(e?.message || e); }
}
// 变化项 = 当前种子里新增/内容变更（sha256 不同）的文件
function tasksOf(id: string): SeedFile[] {
  const s = stateOf(id);
  return s.current.filter((f) => !s.prev.some((p) => p.name === f.name && p.sha256 === f.sha256));
}
async function loadAll() {
  await loadLocal();
  for (const h of hubs.value) await loadSeed(h.hubId);
}
onMounted(() => { loadTasks(); loadAll(); });

function synced(name: string) { return localFiles.value.has(name); }
function setAll(id: string, v: boolean) { const s = stateOf(id); for (const f of tasksOf(id)) s.selected[f.name] = v; }
async function sync(id: string) {
  const s = stateOf(id); s.msg = '';
  const names = Object.keys(s.selected).filter((k) => s.selected[k]);
  if (!names.length) return;
  try {
    const r = await props.collab.pullDownloads(names, id);
    s.msg = t('collab.update.synced', { count: (r.files || names).length });
    await loadLocal();
  } catch (e: any) { s.msg = String(e?.message || e); }
}
async function installFile(name: string) {
  installMsg.value = '';
  try {
    const r = await props.collab.installDownload(name);
    installMsg.value = r.code === 'ok' ? t('collab.downloads.installed') : t('common.send_failed', { msg: r.code });
  } catch (e: any) { installMsg.value = String(e?.message || e); }
}
function kindLabel(kind: string) {
  if (kind === 'skill') return t('collab.task.kind.skill');
  if (kind === 'workflow') return t('collab.task.kind.workflow');
  if (kind === 'group') return t('collab.task.kind.group');
  if (kind === 'usage') return t('collab.task.kind.usage');
  return t('collab.task.kind.file');
}
function fmtSize(n?: number) { if (n == null) return ''; return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`; }
</script>

<template>
  <div class="tk">
    <div class="disttitle">{{ $t('collab.task.dist_title') }}</div>
    <div v-if="!allDist.length" class="empty">{{ $t('collab.task.dist_empty') }}</div>
    <div v-for="dt in allDist" :key="dt.id" class="dtask">
      <span class="tic">{{ dt.kind === 'workflow' ? '🧩' : '🛠' }}</span>
      <div class="info">
        <span class="nm">{{ $t(kindKeyOf(dt.kind)) }} · {{ dt.name }}</span>
        <span class="meta">{{ $t('collab.task.items', { count: taskItemCount(dt) }) }} · {{ $t('collab.task.from_group', { group: groupNameOf(dt.groupId), hub: dt.hubId || '-' }) }}</span>
        <a v-if="dt.url" class="addr" :href="dt.url" target="_blank" rel="noopener">{{ $t('collab.task.download_addr') }}: {{ dt.url }}</a>
        <span v-if="dt.payload?.lastError" class="derr">{{ $t('collab.task.accept_failed', { msg: dt.payload.lastError }) }}</span>
      </div>
      <span class="state" :class="{ ok: dt.status === 'done' }">{{ $t(`collab.task.status.${dt.status}`) }}</span>
      <div class="acts">
        <button v-if="dt.status === 'pending' || dt.status === 'failed'" :disabled="busyTask === dt.id" @click="acceptTask(dt)">{{ $t('collab.task.accept') }}</button>
        <button v-if="dt.status === 'pending'" class="ghost" :disabled="busyTask === dt.id" @click="ignoreTask(dt)">{{ $t('collab.task.ignore') }}</button>
      </div>
    </div>
    <div v-if="taskMsg" class="tmsg ok">{{ taskMsg }}</div>

    <div class="seedtitle">{{ $t('collab.task.seed_title') }}</div>
    <div v-if="!hubs.length" class="empty">{{ $t('collab.task.no_master') }}</div>

    <div v-for="h in hubs" :key="h.hubId" class="seedbox">
      <div class="seedhead">
        <b>{{ h.name }}</b>
        <span class="ver">{{ $t('collab.update.version', { version: stateOf(h.hubId).version || '—' }) }}</span>
        <span class="rowbtns">
          <button class="ghost" @click="loadSeed(h.hubId)">{{ $t('collab.update.check') }}</button>
          <button v-if="tasksOf(h.hubId).length" class="ghost" @click="setAll(h.hubId, true)">{{ $t('collab.update.select_all') }}</button>
          <button v-if="tasksOf(h.hubId).length" @click="sync(h.hubId)">{{ $t('collab.update.pull_selected') }}</button>
        </span>
      </div>
      <div v-if="stateOf(h.hubId).msg" class="tmsg ok">{{ stateOf(h.hubId).msg }}</div>
      <div v-if="!tasksOf(h.hubId).length" class="empty">{{ $t('collab.update.latest') }}</div>
      <div v-for="f in tasksOf(h.hubId)" :key="f.name" class="task">
        <input type="checkbox" v-model="stateOf(h.hubId).selected[f.name]" />
        <span class="tic">{{ f.kind === 'skill' ? '🛠' : (f.kind === 'group' ? '📦' : (f.kind === 'usage' ? '📊' : '📄')) }}</span>
        <div class="info">
          <span class="nm">{{ f.name }}</span>
          <span class="meta">{{ kindLabel(f.kind || 'file') }} · {{ fmtSize(f.size) }}</span>
        </div>
        <span class="state" :class="{ ok: synced(f.name) }">{{ synced(f.name) ? $t('collab.task.synced_state') : $t('collab.task.pending_state') }}</span>
        <div class="acts">
          <button v-if="f.kind === 'skill'" class="ghost" @click="installFile(f.name)">{{ $t('collab.downloads.install') }}</button>
        </div>
      </div>
    </div>

    <div v-if="installMsg" class="tmsg ok">{{ installMsg }}</div>
  </div>
</template>

<style scoped>
.tk { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px; }
.tmsg { font-size: 12px; }
.tmsg.ok { color: var(--ok); }
.seedtitle { color: var(--tx2); text-transform: uppercase; font-size: 11px; margin: 6px 0 8px; }
.disttitle { color: var(--tx2); text-transform: uppercase; font-size: 11px; margin: 6px 0 8px; }
.dtask { display: flex; align-items: center; gap: 10px; border: 1px solid var(--bd); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; background: var(--bg1); }
.dtask .addr { color: var(--ac2); font-size: 11px; word-break: break-all; text-decoration: none; }
.dtask .derr { color: var(--err); font-size: 11px; }
.seedbox { border: 1px solid var(--bd); border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; background: var(--bg1); }
.seedhead { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.seedhead b { color: var(--tx1); }
.ver { color: var(--tx6); font-size: 11px; font-family: Consolas, monospace; }
.rowbtns { margin-left: auto; display: flex; gap: 6px; }
.task { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--bd2); padding: 8px 4px; }
.tic { font-size: 18px; flex: none; }
.info { flex: 1; min-width: 0; }
.nm { color: var(--tx1); font-weight: 600; word-break: break-all; }
.meta { color: var(--tx6); font-size: 11px; margin-left: 8px; font-family: Consolas, monospace; }
.acts { display: flex; gap: 6px; align-items: center; }
button { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
button.ghost { background: none; border: 1px solid var(--bd); color: var(--tx2); }
.state { font-size: 11px; color: var(--tx3); flex: none; }
.state.ok { color: var(--ok); }
.empty { color: var(--tx6); padding: 12px 8px; }
</style>
