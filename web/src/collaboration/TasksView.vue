<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import type { CollabInboxItem, CollabOutItem } from './types';
import { t, locale } from '../i18n';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);

const inbound = computed(() => [...snap.value.skillsInbox].sort((a, b) => b.receivedAt - a.receivedAt));
const outbound = computed(() => [...snap.value.outbox].sort((a, b) => b.createdAt - a.createdAt));
const groupName = (gid: string | null) => (snap.value.groups || []).find((g) => g.id === gid)?.name || '';

const dirs = ref<{ upload: string | null; download: string | null }>({ upload: null, download: null });
const toolOpen = ref(false);
const toolKind = ref<'opencode' | 'claudecode' | 'custom'>('opencode');
const customRoot = ref('');
const activeRoot = ref('');
const toolMsg = ref('');
const toolErr = ref('');

onMounted(async () => {
  await Promise.all([
    props.collab.getTool().then((info) => { toolKind.value = info.tool.kind; customRoot.value = info.tool.customRoot || ''; activeRoot.value = info.root; }).catch(() => {}),
    props.collab.getDirs().then((d) => { dirs.value = d; }).catch(() => {}),
  ]);
});

async function saveTool() {
  toolMsg.value = ''; toolErr.value = '';
  try {
    const r = await props.collab.setTool(toolKind.value, toolKind.value === 'custom' ? customRoot.value.trim() : null);
    activeRoot.value = r.root;
    toolMsg.value = t('collab.tool.switched', { tool: toolKind.value === 'custom' ? t('collab.tool.custom') : toolKind.value, root: r.root });
    toolOpen.value = false;
    await props.collab.refresh().catch(() => {});
  } catch (e: any) { toolErr.value = String(e?.message || e); }
}

async function installSkill(it: CollabInboxItem) {
  if (!confirm(t('collab.task.install_confirm'))) return;
  toolMsg.value = ''; toolErr.value = '';
  try { await props.collab.installInbox(it.id); await props.collab.refresh(); }
  catch (e: any) { toolErr.value = String(e?.message || e); }
}
async function ignoreIn(it: CollabInboxItem) { await props.collab.ignoreInbox(it.id); await props.collab.refresh(); }
async function removeIn(it: CollabInboxItem) { if (confirm(t('collab.task.remove_confirm'))) await props.collab.removeInbox(it.id); }
async function removeOut(it: CollabOutItem) { if (confirm(t('collab.task.remove_out_confirm'))) await props.collab.removeOutTask(it.id); }
async function saveFile(it: CollabInboxItem) {
  try {
    const res = await fetch(`/api/collab/download/${it.id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = it.fileName || it.skillName || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (e: any) { alert(t('common.download_failed', { msg: e?.message || e })); }
}
function fmtSize(n: number) { return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`; }
function fmtTime(ts: number) { return new Date(ts).toLocaleTimeString(locale.value, { hour12: false }); }
</script>

<template>
  <div class="tk">
    <div class="toolbar">
      <div class="toolsel">
        <span class="tl">{{ $t('collab.tool.mine') }}</span>
        <button class="toolbtn" @click="toolOpen = !toolOpen">
          {{ toolKind === 'custom' ? $t('collab.tool.custom') : toolKind }}
          <span class="root" v-if="activeRoot" :title="activeRoot">{{ activeRoot }}</span> ▾
        </button>
        <div v-if="toolOpen" class="toolpop">
          <select v-model="toolKind" class="tkind">
            <option value="opencode">opencode</option>
            <option value="claudecode">claudecode</option>
            <option value="custom">{{ $t('collab.tool.custom_path') }}</option>
          </select>
          <input v-if="toolKind === 'custom'" v-model="customRoot" :placeholder="$t('collab.tool.custom_placeholder')" class="tcus" @keyup.enter="saveTool" />
          <div class="tacts">
            <button class="tgo" @click="saveTool">{{ $t('common.save') }}</button>
            <span class="tclose" @click="toolOpen = false">{{ $t('common.cancel') }}</span>
          </div>
          <div v-if="toolMsg" class="tmsg ok">{{ toolMsg }}</div>
          <div v-if="toolErr" class="tmsg err">{{ toolErr }}</div>
        </div>
      </div>
      <div v-if="activeRoot" class="inst-hint">{{ $t('collab.task.install_hint', { root: activeRoot }) }}</div>
      <div class="dirinfo" v-if="dirs.download">
        <span :title="$t('collab.task.download_dir')">↓ {{ dirs.download }}</span>
        <span v-if="dirs.upload" :title="$t('collab.task.upload_dir')" class="up">↑ {{ dirs.upload }}</span>
      </div>
    </div>

    <div v-if="inbound.length === 0 && outbound.length === 0" class="empty">{{ $t('collab.task.empty') }}</div>

    <template v-if="inbound.length">
      <h4>{{ $t('collab.task.inbound', { count: inbound.length }) }}</h4>
      <div v-for="it in inbound" :key="'in-' + it.id" class="task" :class="{ skill: (it.kind ?? 'skill') === 'skill' }">
        <span class="tic">{{ (it.kind ?? 'skill') === 'skill' ? '🛠' : '📄' }}</span>
        <div class="info">
          <span class="nm">{{ (it.kind ?? 'skill') === 'skill' ? it.skillName : it.fileName }}</span>
          <span class="meta">
            {{ fmtTime(it.receivedAt) }} · {{ it.kind === 'file' ? $t('collab.task.kind.file') : $t('collab.task.kind.skill') }} · {{ groupName(it.groupId) || $t('collab.task.unknown_group') }} · {{ fmtSize(it.size) }}
          </span>
        </div>
        <div class="acts">
          <template v-if="it.status === 'received'">
            <button v-if="(it.kind ?? 'skill') === 'skill'" @click="installSkill(it)">{{ $t('collab.task.install') }}</button>
            <button v-if="(it.kind ?? 'skill') === 'skill'" class="ghost" @click="ignoreIn(it)">{{ $t('collab.task.ignore') }}</button>
            <button v-if="it.kind === 'file'" @click="saveFile(it)">{{ $t('collab.task.download') }}</button>
          </template>
          <span v-else-if="it.status === 'installed'" class="state ok" :title="$t('collab.task.installed_at', { root: activeRoot })">{{ $t('collab.task.installed') }}</span>
          <span v-else-if="it.status === 'ignored'" class="state">{{ $t('collab.task.ignored') }}</span>
          <span v-else-if="it.status === 'invalid'" class="state bad">{{ $t('collab.task.invalid') }}</span>
          <button class="ghost del" @click="removeIn(it)">{{ $t('common.delete') }}</button>
        </div>
      </div>
    </template>

    <template v-if="outbound.length">
      <h4>{{ $t('collab.task.outbound', { count: outbound.length }) }}</h4>
      <div v-for="it in outbound" :key="'out-' + it.id" class="task out">
        <span class="tic">{{ it.kind === 'skill' ? '🛠' : '📄' }}</span>
        <div class="info">
          <span class="nm">{{ it.kind === 'skill' ? it.skillName : it.fileName }}</span>
          <span class="meta">{{ fmtTime(it.createdAt) }} · {{ it.kind === 'file' ? $t('collab.task.kind.file') : $t('collab.task.kind.skill') }} → {{ groupName(it.groupId) || $t('collab.task.unknown_group') }} · {{ fmtSize(it.size) }}</span>
        </div>
        <div class="acts">
          <button class="ghost del" @click="removeOut(it)">{{ $t('common.delete') }}</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tk { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px; }
.toolbar { position: relative; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
.toolsel { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tl { color: var(--tx3); font-size: 12px; }
.toolbtn { display: inline-flex; align-items: center; gap: 6px; background: none; border: 1px solid var(--ac); color: var(--ac); border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; max-width: 60%; }
.toolbtn .root { color: var(--tx6); font-family: Consolas, monospace; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toolpop { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; border-top: 1px dashed var(--bd2); padding-top: 8px; }
.tkind, .tcus { background: var(--bg3); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; }
.tacts { display: flex; align-items: center; gap: 10px; }
.tgo { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 4px 14px; cursor: pointer; }
.tclose { color: var(--tx3); font-size: 12px; cursor: pointer; }
.tmsg { font-size: 12px; }
.tmsg.ok { color: var(--ok); }
.tmsg.err { color: var(--err); }
.dirinfo { margin-top: 6px; font-family: Consolas, monospace; font-size: 11px; color: var(--tx6); display: flex; gap: 14px; }
.inst-hint { margin-top: 6px; font-size: 11px; color: var(--warn); }
.inst-hint code { background: var(--bg3); padding: 1px 6px; border-radius: 4px; }
h4 { color: var(--tx2); text-transform: uppercase; font-size: 11px; margin: 16px 0 6px; }
.task { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--bd2); padding: 8px 4px; }
.task.skill { }
.task.out { opacity: .82; }
.tic { font-size: 18px; flex: none; }
.info { flex: 1; min-width: 0; }
.nm { color: var(--tx1); font-weight: 600; word-break: break-all; }
.meta { color: var(--tx6); font-size: 11px; margin-left: 8px; font-family: Consolas, monospace; }
.acts { display: flex; gap: 6px; align-items: center; }
button { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
button.ghost { background: none; border: 1px solid var(--bd); color: var(--tx2); }
button.del { color: var(--err); }
.state { font-size: 11px; color: var(--tx3); }
.state.ok { color: var(--ok); }
.state.bad { color: var(--err); }
.empty { color: var(--tx6); padding: 12px 8px; }
</style>
