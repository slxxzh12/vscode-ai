<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import GroupChatView from './GroupChatView.vue';
import MemberUsageTable from './MemberUsageTable.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import SyncSeedDialog from './SyncSeedDialog.vue';
import { t } from '../i18n';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const groups = computed(() => snap.value.groups || []);
const activeId = ref<string | null>(null);
const mine = computed(() => groups.value.find((g) => g.hubId === snap.value.identity.machineId) || null);
const group = computed(() => groups.value.find((g) => g.id === activeId.value) || mine.value || groups.value[0] || null);
watch(groups, (gs) => {
  if (!gs.find((g) => g.id === activeId.value)) activeId.value = (mine.value || gs[0] || null)?.id ?? null;
}, { immediate: true });
const me = computed(() => snap.value.identity?.machineId);

// —— 我的工号（身份展示 = 工号@IP:端口）；默认填入当前机器登录用户名 ——
const myEmployeeId = ref(snap.value.identity.employeeId || snap.value.identity.username || '');
watch(() => snap.value.identity.employeeId, (v) => { myEmployeeId.value = v || snap.value.identity.username || ''; });
const idMsg = ref('');
async function saveEmployeeId() {
  idMsg.value = '';
  try {
    await props.collab.updateIdentity(snap.value.identity.host, snap.value.identity.port, myEmployeeId.value.trim());
    idMsg.value = t('common.save');
    setTimeout(() => { idMsg.value = ''; }, 1500);
  } catch (e) { idMsg.value = String((e as Error).message || e); }
}
// 首次拿到身份且工号为空时，自动填入登录用户名并保存一次
watch(() => snap.value.identity.machineId, async (mid) => {
  const id = snap.value.identity;
  if (mid && !id.employeeId && id.username) {
    myEmployeeId.value = id.username;
    await saveEmployeeId();
  }
}, { immediate: true });

// —— 远程访问（自设置迁入）——
const remoteLink = ref('');
const remotePassword = ref('');
const remoteMsg = ref('');
const remoteState = ref<{ enabled: boolean; expiresAt: number | null; address?: string | null; needRestart?: boolean; host?: string; locked?: boolean }>({ enabled: false, expiresAt: null });

async function loadInvite() {
  remoteMsg.value = '';
  try {
    const r = await fetch('/api/remote/reveal').then((x) => x.json());
    if (!r.enabled) return;
    remoteLink.value = r.link || '';
    remotePassword.value = r.password || '';
  } catch (e) { remoteMsg.value = t('remote.failed', { msg: (e as Error)?.message || String(e) }); }
}
async function loadRemote() {
  try { remoteState.value = await fetch('/api/remote/state').then((r) => r.json()); } catch { /* ignore */ }
  if (remoteState.value.enabled) await loadInvite();
}
async function genRemote() {
  remoteMsg.value = '';
  try {
    const r = await fetch('/api/remote/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).then((x) => x.json());
    remoteLink.value = r.link || '';
    remotePassword.value = r.password || '';
    remoteState.value = { ...remoteState.value, enabled: !!r.enabled, expiresAt: r.expiresAt || null, address: r.address, needRestart: !!r.needRestart };
    await loadDir();
    try { await props.collab.refresh(); } catch { /* ignore */ }
  } catch (e) { remoteMsg.value = t('remote.failed', { msg: (e as Error)?.message || String(e) }); }
}
const closeConfirmOpen = ref(false);
function revokeRemote() { closeConfirmOpen.value = true; }
async function doRevokeRemote() {
  closeConfirmOpen.value = false;
  try {
    await fetch('/api/remote/revoke', { method: 'POST' });
    remoteLink.value = ''; remotePassword.value = '';
    remoteState.value = { ...remoteState.value, enabled: false, expiresAt: null };
  } catch { /* ignore */ }
}
async function copy(v: string) {
  try { await navigator.clipboard.writeText(v); remoteMsg.value = t('remote.copied'); setTimeout(() => { remoteMsg.value = ''; }, 1500); } catch { /* ignore */ }
}

// —— 加入（粘贴开启方链接）——
const joinInput = ref('');
const joinErr = ref('');
async function join() {
  joinErr.value = '';
  try {
    const u = new URL(joinInput.value.trim());
    const token = u.searchParams.get('access') || '';
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    if (!token || !u.hostname || !port) throw new Error(t('collab.join_link.invalid'));
    const r = await props.collab.join(u.hostname, port, token);
    if (r.code !== 'joined') throw new Error(t('collab.join_link.failed', { code: r.code }));
    await props.collab.refresh();
    joinInput.value = '';
  } catch (e) { joinErr.value = (e as Error).message || String(e); }
}

// —— downloads 目录（默认开放的共享目录，实时列出）——
const dirFiles = ref<{ name: string; size: number; updatedAt: number }[]>([]);
async function loadDir() {
  try { const r = await fetch('/api/collab/downloads/dir').then((x) => x.json()); dirFiles.value = r.files || []; } catch { /* ignore */ }
}
function fmtSize(n: number) {
  if (n == null) return '';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

// —— master 同步种子 / slave 主动同步 ——
const isMaster = computed(() => !!group.value && group.value.hubId === me.value);
// —— 群公告：仅群主可编辑，改后随 member-sync 下发给成员 ——
const editAnnounce = ref(false);
const announceText = ref('');
const announceMsg = ref('');
// —— 切换 master 后需要重启服务才能换绑定地址（127.0.0.1 ↔ 0.0.0.0）——
const restarting = ref(false);
async function restartBackend() {
  restarting.value = true;
  remoteMsg.value = '';
  try {
    const res = await fetch('/api/server/restart', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
    remoteMsg.value = t('term.port_restarting');
    const deadline = Date.now() + 30000;
    for (;;) {
      if (Date.now() > deadline) throw new Error(t('term.port_restarting'));
      await new Promise((r) => setTimeout(r, 500));
      try {
        if ((await fetch('/api/version', { cache: 'no-store' })).ok) { location.reload(); return; }
      } catch { /* 重启中，继续等 */ }
    }
  } catch (e) { remoteMsg.value = t('term.port_restart_failed', { msg: (e as Error).message || String(e) }); }
  finally { restarting.value = false; }
}
watch(() => group.value?.announcement, (v) => { announceText.value = v || ''; }, { immediate: true });
async function saveAnnounce() {
  announceMsg.value = '';
  try {
    await props.collab.setAnnouncement(announceText.value.trim());
    announceMsg.value = t('usage.saved');
    editAnnounce.value = false;
    setTimeout(() => { announceMsg.value = ''; }, 1500);
  } catch (e) { announceMsg.value = String((e as Error).message || e); }
}
const downloads = ref<{ manifest: { files: { name: string; kind: string; size: number; updatedAt: number }[] } }>({ manifest: { files: [] } });
const seed = ref<{ version: string; files: { name: string }[] }>({ version: '', files: [] });
const seedOpen = ref(false);
const seedMsg = ref('');
async function loadDownloads() {
  try { downloads.value = await props.collab.listDownloads() as typeof downloads.value; } catch { /* ignore */ }
}
async function loadSeed() {
  try { const r = await props.collab.getUpdate(); seed.value = r.update; } catch { /* ignore */ }
}
async function onSaveSeed(names: string[]) {
  seedOpen.value = false;
  seedMsg.value = '';
  try { const r = await props.collab.publishUpdate(names); seed.value = r.update; seedMsg.value = t('collab.update.saved', { version: r.update.version }); }
  catch (e) { seedMsg.value = String((e as Error).message || e); }
}
// slave：从 master 列文件并拉取
const remote = ref<{ manifest: { files: { name: string; kind: string; size: number; updatedAt: number }[] }; update: { version: string; files: { name: string }[] } | null } | null>(null);
const remoteSel = ref<Record<string, boolean>>({});
const pullMsg = ref('');
const remoteVer = computed(() => remote.value?.update?.version || '');
function isSeedFile(name: string) { return !!remote.value?.update?.files?.some((f) => f.name === name); }
async function loadRemoteFiles() {
  pullMsg.value = '';
  const mid = group.value?.hubId;
  try { const r = await props.collab.listRemoteFiles(mid); remote.value = { manifest: r.manifest, update: r.update }; }
  catch (e) { pullMsg.value = String((e as Error).message || e); }
}
function setAllRemote(v: boolean) { for (const f of remote.value?.manifest.files || []) remoteSel.value[f.name] = v; }
async function pullSelected() {
  pullMsg.value = '';
  const names = Object.keys(remoteSel.value).filter((k) => remoteSel.value[k]);
  if (!names.length) return;
  try {
    const r = await props.collab.pullDownloads(names, group.value?.hubId);
    pullMsg.value = t('collab.update.pulled', { count: (r.files || names).length });
    await loadDir();
  } catch (e) { pullMsg.value = String((e as Error).message || e); }
}
const installMsg = ref('');
async function install(name: string) {
  installMsg.value = '';
  try {
    const r = await props.collab.installDownload(name);
    installMsg.value = r.code === 'ok' ? t('collab.downloads.installed') : t('common.send_failed', { msg: r.code });
  } catch (e) { installMsg.value = String((e as Error).message || e); }
}

onMounted(async () => {
  await loadRemote();
  await loadDownloads();
  await loadSeed();
  await loadDir();
  if (!isMaster.value) { try { await loadRemoteFiles(); } catch { /* ignore */ } }
});
</script>

<template>
  <div class="cw">
    <aside class="cw-left">
      <div class="sec">
        <h4>{{ $t('collab.identity.title') }}</h4>
        <div class="addrow">
          <span class="idlbl">{{ $t('collab.identity.employee') }}</span>
          <input v-model="myEmployeeId" :placeholder="$t('collab.identity.employee')" @keyup.enter="saveEmployeeId" />
          <button @click="saveEmployeeId">{{ $t('common.save') }}</button>
        </div>
        <div class="cfghint">{{ $t('collab.identity.hint') }}</div>
        <div v-if="idMsg" class="cfghint">{{ idMsg }}</div>
      </div>

      <details class="sec fold">
        <summary>{{ $t('collab.downloads.dir_title') }} <span class="tag">{{ $t('collab.downloads.dir_open') }}</span></summary>
        <div class="cfghint">{{ $t('collab.downloads.dir_hint') }}</div>
        <div v-if="dirFiles.length === 0" class="empty">{{ $t('collab.downloads.dir_empty') }}</div>
        <div v-for="f in dirFiles" :key="f.name" class="rowline">
          <a class="txt fname" :href="`/api/collab/downloads/file/${encodeURIComponent(f.name)}`" download>{{ f.name }}<span class="sub">{{ fmtSize(f.size) }}</span></a>
        </div>
      </details>

      <div class="sec boxed">
        <h4>{{ $t('collab.remote.title') }}</h4>
        <div class="addrow">
          <button class="gen" :class="remoteState.enabled ? 'stop' : 'start'" @click="remoteState.enabled ? revokeRemote() : genRemote()">
            {{ remoteState.enabled ? '⏹ ' + $t('collab.remote.disable') : '▶ ' + $t('collab.remote.enable') }}
          </button>
        </div>
        <div v-if="remoteState.enabled" class="sec">
          <h4>{{ $t('collab.groups.title') }}</h4>
          <div v-if="!groups.length" class="empty">{{ $t('collab.groups.empty') }}</div>
          <button v-for="g in groups" :key="g.id" class="gitem" :class="{ on: group?.id === g.id }" @click="activeId = g.id">
            {{ g.name }}
          </button>
        </div>

        <template v-if="remoteState.enabled && (remotePassword || remoteLink)">
          <div class="cfghint">{{ $t('remote.invite_hint') }}</div>
          <div v-if="remoteLink" class="linkrow">
            <input :value="remoteLink" readonly @focus="($event.target as HTMLInputElement).select()" />
            <button @click="copy(remoteLink)">{{ $t('remote.copy_invite') }}</button>
          </div>
          <div v-if="remotePassword" class="cfghint">{{ $t('remote.password_hint') }}</div>
          <div v-if="remotePassword" class="linkrow">
            <input :value="remotePassword" readonly />
            <button @click="copy(remotePassword)">{{ $t('remote.copy_password') }}</button>
          </div>
        </template>
        <div v-if="remoteState.needRestart" class="err">
          {{ $t('remote.need_restart') }}
          <button class="mini" :disabled="restarting" @click="restartBackend">{{ restarting ? $t('term.port_restarting') : $t('term.port_restart') }}</button>
        </div>
        <div v-if="remoteMsg" class="cfghint">{{ remoteMsg }}</div>

        <div v-if="isMaster && remoteState.enabled" class="sec">
          <h4>{{ $t('collab.downloads.title') }}</h4>
          <div class="cfghint">{{ $t('collab.update.version', { version: seed.version || '—' }) }}</div>
          <div class="addrow">
            <button @click="seedOpen = true">{{ $t('collab.downloads.title') }}</button>
          </div>
          <div v-if="seedMsg" class="cfghint">{{ seedMsg }}</div>
          <div v-if="installMsg" class="cfghint">{{ installMsg }}</div>
        </div>
        <div v-else-if="group && !isMaster" class="sec">
          <h4>{{ $t('collab.update.pull_title') }}</h4>
          <div class="cfghint">{{ $t('collab.update.version', { version: remoteVer || '—' }) }}</div>
          <div class="addrow">
            <button class="ghost" @click="loadRemoteFiles">{{ $t('collab.update.check') }}</button>
            <button class="ghost" @click="setAllRemote(true)">{{ $t('collab.update.select_all') }}</button>
            <button @click="pullSelected">{{ $t('collab.update.pull_selected') }}</button>
          </div>
          <div v-if="pullMsg" class="cfghint">{{ pullMsg }}</div>
          <div v-if="!remote || remote.manifest.files.length === 0" class="empty">{{ $t('collab.update.no_remote') }}</div>
          <div v-for="f in (remote?.manifest.files || [])" :key="f.name" class="rowline">
            <input type="checkbox" v-model="remoteSel[f.name]" />
            <a class="txt fname" :href="`/api/collab/downloads/file/${encodeURIComponent(f.name)}`" download>{{ f.name }}</a>
            <span v-if="isSeedFile(f.name)" class="tag">{{ $t('collab.update.seed_badge') }}</span>
          </div>
        </div>
      </div>

      <div class="sec">
        <h4>{{ $t('collab.join_link.title') }}</h4>
        <div class="addrow">
          <input v-model="joinInput" :placeholder="$t('collab.join_link.placeholder')" @keyup.enter="join" />
          <button :title="$t('collab.join_link.join')" @click="join">{{ $t('collab.join_link.join') }}</button>
        </div>
        <div v-if="joinErr" class="err">{{ joinErr }}</div>
      </div>

      <div class="sec">
        <h4>{{ $t('collab.groups.all') }}</h4>
        <div v-if="!groups.length" class="empty">{{ $t('collab.groups.empty') }}</div>
        <button v-for="g in groups" :key="g.id" class="gitem" :class="{ on: group?.id === g.id }" @click="activeId = g.id">
          {{ g.name }}
        </button>
      </div>

    </aside>

    <section class="cw-right">
      <div class="chat-col">
        <header class="gtop">
          <span class="tname">💬 {{ group ? group.name : $t('collab.placeholder_short') }}</span>
        </header>
        <GroupChatView v-if="group" :collab="collab" :group-id="group.id" />
        <div v-else class="placeholder"><div class="ph">{{ $t('collab.placeholder') }}</div></div>
      </div>

      <aside class="cw-members">
        <section class="mpanel">
          <h4 class="mtitle">{{ $t('collab.member.title', { count: (group?.members || []).length }) }}</h4>
          <MemberUsageTable class="mtable" :collab="collab" />
        </section>
        <section class="mpanel announce">
          <h4 class="mtitle">
            {{ $t('collab.announce.title') }}
            <button v-if="isMaster" class="mini" @click="editAnnounce = !editAnnounce">
              {{ editAnnounce ? $t('common.cancel') : $t('collab.announce.edit') }}
            </button>
          </h4>
          <textarea v-if="isMaster && editAnnounce" v-model="announceText" class="ata" rows="4" :placeholder="$t('collab.announce.placeholder')" />
          <div v-if="isMaster && editAnnounce" class="abox">
            <button class="mini primary" @click="saveAnnounce">{{ $t('collab.announce.save') }}</button>
            <span v-if="announceMsg" class="ahint">{{ announceMsg }}</span>
          </div>
          <div v-else class="abody">{{ (group?.announcement || '').trim() || $t('collab.announce.empty') }}</div>
        </section>
      </aside>
    </section>
  </div>

  <SyncSeedDialog
    :open="seedOpen"
    :files="downloads.manifest.files"
    :version="seed.version"
    @confirm="onSaveSeed"
    @cancel="seedOpen = false"
    @install="install"
  />

  <ConfirmDialog
    :open="closeConfirmOpen"
    :title="$t('collab.remote.disable')"
    :message="$t('collab.remote.close_warn')"
    :confirm-text="$t('common.ok')"
    :cancel-text="$t('common.cancel')"
    type="warning"
    @confirm="doRevokeRemote"
    @cancel="closeConfirmOpen = false"
  />
</template>

<style scoped>
.cw { flex: 1; min-height: 0; display: flex; }
.cw-left { width: 300px; flex: none; overflow-y: auto; padding: 12px; border-right: 1px solid var(--bd); background: var(--bg1); box-sizing: border-box; }
.cw-right { flex: 1; min-width: 0; display: flex; background: var(--bg0); }
.chat-col { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.gtop { flex: none; display: flex; align-items: center; gap: 10px; padding: 0 16px; height: 52px; border-bottom: 1px solid var(--bd); }
.tname { font-size: 16px; font-weight: 700; color: var(--tx1); }
.tcnt { color: var(--tx6); font-size: 13px; font-weight: 400; }
h4 { color: var(--tx2); text-transform: uppercase; font-size: 11px; margin: 14px 0 6px; }
.sec h4:first-child { margin-top: 0; }
.sec { margin-bottom: 6px; }
.sec.boxed { border: 1px solid var(--bd); border-radius: 8px; padding: 10px 12px; margin: 8px 0 10px; background: var(--bg2); }
.err { color: var(--err); font-size: 12px; margin: 4px 0; }
.empty { color: var(--tx6); padding: 6px 2px; font-size: 12px; }
.addrow { display: flex; gap: 6px; margin: 6px 0; }
.addrow input { background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 5px 8px; box-sizing: border-box; flex: 1; min-width: 0; }
.cfgrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--tx2); margin: 6px 0; }
.cfghint { color: var(--tx6); font-size: 11px; margin: 2px 0; }
.rowline { display: flex; align-items: center; gap: 6px; padding: 4px 2px; border-bottom: 1px solid var(--bd2); font-size: 13px; color: var(--tx); }
.rowline .txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rowline .sub { color: var(--tx6); font-size: 11px; margin-left: 6px; font-family: Consolas, monospace; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--tx6); flex: none; }
.dot.on { background: var(--ok, #22c55e); }
.allow { margin-top: 6px; border-top: 1px solid var(--bd2); padding-top: 4px; }
button { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; }
button.ghost { background: none; border: 1px solid var(--bd); color: var(--tx2); }
button.gen { flex: 1; background: var(--err); color: #fff; font-weight: 700; padding: 8px 10px; }
button.gen:hover { filter: brightness(1.08); }
button.gen.start { background: #2e7d32; }
button.gen.stop { background: #d32f2f; }
.idlbl { color: var(--tx2); font-size: 12px; white-space: nowrap; }
.rowline .fname { color: var(--ac2); text-decoration: none; cursor: pointer; }
.rowline .fname:hover { text-decoration: underline; }
.tag { font-size: 10px; font-weight: 400; text-transform: none; color: var(--ok, #22c55e); margin-left: 4px; }
button.del { color: var(--err); border-color: var(--bd); }
input, select { background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 5px 8px; }
.linkrow { display: flex; gap: 6px; margin: 4px 0; }
.linkrow input { flex: 1; min-width: 0; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 4px 6px; font-size: 11px; box-sizing: border-box; }
.linkrow button { background: var(--bg5); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; }
.dl { background: var(--bg5); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; text-decoration: none; }
.placeholder { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--tx6); }
.gitem { text-align: left; background: none; border: 1px solid var(--bd); border-radius: 4px; color: var(--tx2); padding: 5px 8px; font-size: 12px; cursor: pointer; font-family: inherit; margin-bottom: 4px; width: 100%; }
.gitem.on { background: none; color: var(--tx1); border-color: var(--ac); }
.gitem .sub { color: var(--tx6); margin-left: 6px; }
.cw-members { width: 46%; min-width: 460px; flex: none; display: flex; flex-direction: column; border-left: 1px solid var(--bd); background: var(--bg1); }
.mpanel { display: flex; flex-direction: column; min-height: 0; border-bottom: 1px solid var(--bd); }
.mpanel:first-child { flex: 1; }
.mtitle { display: flex; align-items: center; gap: 8px; margin: 0; padding: 8px 12px; font-size: 12px; font-weight: 600; color: var(--tx2); }
.mtable { flex: 1; min-height: 0; }
.announce { flex: none; }
.abody { padding: 0 12px 12px; color: var(--tx); font-size: 12px; line-height: 1.7; white-space: pre-wrap; max-height: 160px; overflow: auto; }
.ata { margin: 0 12px; background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 8px; font-family: inherit; font-size: 12px; resize: vertical; }
.abox { display: flex; align-items: center; gap: 8px; padding: 8px 12px 12px; }
.ahint { color: var(--tx6); font-size: 11px; }
.mini { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 11px; font-family: inherit; }
.mini.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); }
details.fold > summary { cursor: pointer; color: var(--tx2); text-transform: uppercase; font-size: 11px; margin: 14px 0 6px; list-style: none; }
details.fold > summary::-webkit-details-marker { display: none; }
details.fold > summary::before { content: '▸ '; }
details.fold[open] > summary::before { content: '▾ '; }
</style>
