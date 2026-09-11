<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import GroupChatView from './GroupChatView.vue';
import { t } from '../i18n';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const group = computed(() => snap.value.group);
const me = computed(() => snap.value.identity?.machineId);

// —— 远程访问（自设置迁入）——
const remoteTtlDays = ref(1);
const remoteLink = ref('');
const remotePassword = ref('');
const remoteMsg = ref('');
const remoteState = ref<{ enabled: boolean; expiresAt: number | null; address?: string | null; needRestart?: boolean; host?: string; locked?: boolean }>({ enabled: false, expiresAt: null });

async function loadRemote() {
  try { remoteState.value = await fetch('/api/remote/state').then((r) => r.json()); } catch { /* ignore */ }
}
// 修改有效天数：>100 收敛到 100；>7 弹安全告警，取消则回退到 7
function onTtlChange() {
  remoteMsg.value = '';
  const v = Number(remoteTtlDays.value);
  if (!Number.isFinite(v) || v < 1) { remoteTtlDays.value = 1; remoteMsg.value = t('remote.ttl_invalid'); return; }
  const days = Math.floor(v);
  if (days > 100) { remoteTtlDays.value = 100; remoteMsg.value = t('remote.ttl_max'); return; }
  if (days > 7 && !confirm(t('remote.ttl_warn', { days }))) { remoteTtlDays.value = 7; return; }
  remoteTtlDays.value = days;
}
async function genRemote() {
  remoteMsg.value = '';
  const days = Math.floor(Number(remoteTtlDays.value));
  if (!Number.isFinite(days) || days < 1 || days > 100) { remoteMsg.value = t('remote.ttl_invalid'); return; }
  if (days > 7 && !confirm(t('remote.ttl_warn', { days }))) return;
  try {
    const r = await fetch('/api/remote/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days }) }).then((x) => x.json());
    remoteLink.value = r.link || '';
    remotePassword.value = r.password || '';
    remoteState.value = { ...remoteState.value, enabled: !!r.enabled, expiresAt: r.expiresAt || null, address: r.address, needRestart: !!r.needRestart };
    await loadDir();
  } catch (e) { remoteMsg.value = t('remote.failed', { msg: (e as Error)?.message || String(e) }); }
}
async function revokeRemote() {
  try {
    await fetch('/api/remote/revoke', { method: 'POST' });
    remoteLink.value = ''; remotePassword.value = '';
    remoteState.value = { ...remoteState.value, enabled: false, expiresAt: null };
  } catch { /* ignore */ }
}
async function copy(v: string) {
  try { await navigator.clipboard.writeText(v); remoteMsg.value = t('remote.copied'); setTimeout(() => { remoteMsg.value = ''; }, 1500); } catch { /* ignore */ }
}
function fmtExpire(ts: number | null) { return ts ? new Date(ts).toLocaleString() : ''; }

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

// —— 命令白名单 ——
const newPrefix = ref('');
const myAllow = computed(() => props.collab.allowlistState.value);
async function addAllowPrefix() { if (newPrefix.value.trim()) { await props.collab.addAllow(newPrefix.value.trim()); newPrefix.value = ''; } }
async function delAllowPrefix(p: string) { await props.collab.removeAllow(p); }

const online = (receivedAt?: number) => !!receivedAt && Date.now() - receivedAt < 20 * 60 * 1000;
function fmtNum(n?: number) { return n == null ? '?' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n); }
function usageText(machineId: string) {
  const u = snap.value.heartbeats[machineId];
  if (!u || u.error) return '';
  return t('collab.heartbeat.usage', { input: fmtNum(u.input), output: fmtNum(u.output), days: u.days ?? '?', messages: u.messages ?? '?' });
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

// —— master downloads（点击才拉取）——
const downloads = ref<{ manifest: { files: { name: string; kind: string; size: number; updatedAt: number }[] } }>({ manifest: { files: [] } });
const dlMsg = ref('');
async function loadDownloads() {
  try { downloads.value = await props.collab.listDownloads() as typeof downloads.value; } catch { /* ignore */ }
}
async function syncMaster() {
  dlMsg.value = '';
  try { await props.collab.syncDownloads(); await loadDownloads(); }
  catch (e) { dlMsg.value = String((e as Error).message || e); }
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
  await props.collab.loadAllowlist().catch(() => {});
  await loadDownloads();
  await loadDir();
});
</script>

<template>
  <div class="cw">
    <aside class="cw-left">
      <div class="sec">
        <h4>{{ $t('collab.remote.title') }}</h4>
        <div class="cfgrow">
          <span>{{ $t('remote.ttl_days') }}</span>
          <input type="number" min="1" max="100" step="1" v-model.number="remoteTtlDays" class="ttlinput" @change="onTtlChange" />
        </div>
        <div class="addrow">
          <button class="gen" @click="genRemote">{{ $t('remote.generate') }}</button>
          <button v-if="remoteState.enabled" class="ghost" @click="revokeRemote">{{ $t('remote.revoke') }}</button>
        </div>
        <div v-if="remoteState.enabled" class="cfghint">{{ $t('remote.enabled_until', { time: fmtExpire(remoteState.expiresAt) }) }}</div>
        <div v-if="remotePassword" class="linkrow">
          <input :value="remotePassword" readonly />
          <button @click="copy(remotePassword)">{{ $t('remote.copy_password') }}</button>
        </div>
        <div v-if="remoteLink" class="linkrow">
          <input :value="remoteLink" readonly @focus="($event.target as HTMLInputElement).select()" />
          <button @click="copy(remoteLink)">{{ $t('remote.copy') }}</button>
        </div>
        <div v-if="remoteState.needRestart" class="err">{{ $t('remote.need_restart') }}</div>
        <div v-if="remoteMsg" class="cfghint">{{ remoteMsg }}</div>
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
        <h4>{{ $t('collab.downloads.title') }}</h4>
        <div class="addrow">
          <button @click="syncMaster">{{ $t('collab.downloads.sync') }}</button>
        </div>
        <div v-if="dlMsg" class="err">{{ dlMsg }}</div>
        <div v-if="installMsg" class="cfghint">{{ installMsg }}</div>
        <div v-if="downloads.manifest.files.length === 0" class="empty">{{ $t('collab.downloads.empty') }}</div>
        <div v-for="f in downloads.manifest.files" :key="f.name" class="rowline">
          <span class="txt">{{ f.name }}</span>
          <template v-if="f.kind === 'skill'">
            <a class="dl" :href="`/api/collab/downloads/file/${encodeURIComponent(f.name)}`" download>{{ $t('collab.downloads.download') }}</a>
            <button class="ghost" @click="install(f.name)">{{ $t('collab.downloads.install') }}</button>
          </template>
        </div>
      </div>

      <div class="sec">
        <h4>{{ $t('collab.downloads.dir_title') }} <span class="tag">{{ $t('collab.downloads.dir_open') }}</span></h4>
        <div class="cfghint">{{ $t('collab.downloads.dir_hint') }}</div>
        <div v-if="dirFiles.length === 0" class="empty">{{ $t('collab.downloads.dir_empty') }}</div>
        <div v-for="f in dirFiles" :key="f.name" class="rowline">
          <span class="txt">{{ f.name }}<span class="sub">{{ fmtSize(f.size) }}</span></span>
          <a class="dl" :href="`/api/collab/downloads/file/${encodeURIComponent(f.name)}`" download>{{ $t('collab.downloads.download') }}</a>
        </div>
      </div>

      <div class="sec">
        <h4>{{ $t('collab.member.title', { count: group?.members.length || 0 }) }}</h4>
        <div v-if="!group" class="empty">{{ $t('collab.member.empty') }}</div>
        <div v-for="m in group?.members || []" :key="m.machineId" class="rowline">
          <span class="dot" :class="{ on: online(snap.heartbeats[m.machineId]?.receivedAt) }" />
          <span class="txt">
            {{ m.username }}<span v-if="m.machineId === me" class="sub">{{ $t('collab.group.me_suffix') }}</span>
            <span class="sub">{{ m.host }}:{{ m.port }}</span>
            <span v-if="usageText(m.machineId)" class="sub">{{ usageText(m.machineId) }}</span>
          </span>
        </div>
      </div>

      <div class="sec allow">
        <h4>{{ $t('collab.allow.title') }}</h4>
        <div class="addrow">
          <input v-model="newPrefix" :placeholder="$t('collab.allow.placeholder')" @keyup.enter="addAllowPrefix" />
          <button @click="addAllowPrefix">＋</button>
        </div>
        <div v-if="myAllow.length === 0" class="empty">{{ $t('collab.allow.empty') }}</div>
        <div v-for="p in myAllow" :key="p" class="rowline">
          <span class="txt"><code>{{ p }}</code></span>
          <button class="ghost del" @click="delAllowPrefix(p)">{{ $t('common.delete') }}</button>
        </div>
      </div>
    </aside>

    <section class="cw-right">
      <template v-if="group">
        <div class="chat-col">
          <header class="gtop">
            <span class="tname">💬 {{ group.name }} <span class="tcnt">({{ group.members.length }})</span></span>
          </header>
          <GroupChatView :collab="collab" :group-id="group.id" />
        </div>
      </template>
      <div v-else class="placeholder"><div class="ph">{{ $t('collab.placeholder') }}</div></div>
    </section>
  </div>
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
.ttlinput { width: 72px; box-sizing: border-box; }
.tag { font-size: 10px; font-weight: 400; text-transform: none; color: var(--ok, #22c55e); margin-left: 4px; }
button.del { color: var(--err); border-color: var(--bd); }
input, select { background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 5px 8px; }
.linkrow { display: flex; gap: 6px; margin: 4px 0; }
.linkrow input { flex: 1; min-width: 0; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 4px 6px; font-size: 11px; box-sizing: border-box; }
.linkrow button { background: var(--bg5); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; }
.dl { background: var(--bg5); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; text-decoration: none; }
.placeholder { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--tx6); }
</style>
