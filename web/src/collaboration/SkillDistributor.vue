<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import { t } from '../i18n';

const props = defineProps<{ collab: CollabApi; groupId: string; focus?: 'all' | 'skills' | 'workflow'; open?: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const focus = computed(() => props.focus ?? 'all');
const dialogTitle = computed(() => (focus.value === 'workflow' ? t('collab.chat.distribute_workflow') : t('collab.chat.distribute')));
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const group = computed(() => (snap.value.groups || []).find((g) => g.id === props.groupId) || null);
const isMaster = computed(() => !!snap.value.groups?.find((g) => g.id === props.groupId && g.hubId === snap.value.identity.machineId));

const assets = ref<{ skills: { name: string }[]; command: { name: string }[]; agent: { name: string }[]; workflow: { id: string; name: string }[] }>({ skills: [], command: [], agent: [], workflow: [] });
const checked = ref<Record<string, boolean>>({});
const msg = ref('');
const msgErr = ref('');
const working = ref(false);
const toolRoot = ref('');
const seedVersion = ref(0);
type Kind = 'skills' | 'command' | 'agent' | 'workflow';
const keyOf = (k: Kind, n: string) => `${k}:${n}`;

const selected = computed(() => {
  const s: { skills: string[]; command: string[]; agent: string[]; workflow: string[] } = { skills: [], command: [], agent: [], workflow: [] };
  for (const k of ['skills', 'command', 'agent'] as Kind[]) {
    for (const it of assets.value[k]) if (checked.value[keyOf(k, it.name)]) s[k].push(it.name);
  }
  for (const w of assets.value.workflow) if (checked.value[keyOf('workflow', w.id)]) s.workflow.push(w.id);
  return s;
});
const selectedCount = computed(() => selected.value.skills.length + selected.value.command.length + selected.value.agent.length + selected.value.workflow.length);
const totalCount = computed(() => visible.value.skills.length + visible.value.command.length + visible.value.agent.length + visible.value.workflow.length);
// 按入口聚焦：分发技能（技能/命令/Agent）或分发工作流
const visible = computed(() => (focus.value === 'workflow'
  ? { skills: [], command: [], agent: [], workflow: assets.value.workflow }
  : focus.value === 'skills'
    ? { skills: assets.value.skills, command: assets.value.command, agent: assets.value.agent, workflow: [] }
    : assets.value));
const pkg = ref<{ id: string; fileName: string; size: number } | null>(null);
const sent = ref(false);

onMounted(async () => {
  props.collab.getTool().then((info) => { toolRoot.value = info.root; }).catch(() => {});
  props.collab.getWorkflowSeed().then((s) => { seedVersion.value = s.version || 0; }).catch(() => {});
  loadAssets();
});
// 记住上一次勾选：每次弹出默认带出（按群 + 入口分别存）
const storeKey = computed(() => `collab-dist-${props.groupId}-${focus.value}`);
function loadChecked() {
  try {
    const raw = localStorage.getItem(storeKey.value);
    if (raw) checked.value = { ...checked.value, ...JSON.parse(raw) };
  } catch { /* ignore */ }
}
watch(checked, (v) => { try { localStorage.setItem(storeKey.value, JSON.stringify(v)); } catch { /* ignore */ } }, { deep: true });
watch(() => storeKey.value, loadChecked, { immediate: true });
async function loadAssets() {
  try { assets.value = await props.collab.getAssets(); }
  catch (e) { msgErr.value = String((e as Error).message || e); }
}
function toggleAll(on: boolean) {
  const map: Record<string, boolean> = {};
  if (on) {
    for (const k of ['skills', 'command', 'agent'] as Kind[]) for (const it of assets.value[k]) map[keyOf(k, it.name)] = true;
    for (const w of assets.value.workflow) map[keyOf('workflow', w.id)] = true;
  }
  checked.value = map;
}
function reset() { pkg.value = null; sent.value = false; msg.value = ''; }
async function doPack() {
  if (!selectedCount.value) { msg.value = t('collab.dist.select_first'); return; }
  msg.value = ''; msgErr.value = ''; working.value = true;
  try {
    const r = await props.collab.buildPackage(selected.value);
    pkg.value = r.package;
    msg.value = t('collab.dist.packed');
  } catch (e: any) { msgErr.value = String(e?.message || e); }
  finally { working.value = false; }
}
async function doPublish() {
  if (!pkg.value) return;
  msg.value = ''; msgErr.value = ''; working.value = true;
  try {
    const r = await props.collab.publishPackage(pkg.value.id);
    if (r.code !== 'ok') { msgErr.value = t('common.send_failed', { msg: r.code }); return; }
    sent.value = true;
    msg.value = t('collab.dist.published');
  } catch (e: any) { msgErr.value = String(e?.message || e); }
  finally { working.value = false; }
}
async function downloadPkg() {
  if (!pkg.value) return;
  try {
    const res = await fetch(`/api/collab/outfile/${pkg.value.id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = pkg.value.fileName || 'assets.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (e: any) { msgErr.value = t('common.download_failed', { msg: e?.message || e }); }
}
function fmtSize(n: number) { return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`; }
</script>

<template>
  <el-dialog :model-value="!!open" :title="dialogTitle" width="640px" append-to-body class="sddlg" @update:model-value="emit('close')">
  <div class="sd">
    <div class="head">
      <span class="htitle">{{ $t('collab.dist.title') }} <span class="gn">{{ group?.name || '' }}</span></span>
      <button class="mini" @click="toggleAll(selectedCount !== totalCount)">{{ selectedCount === totalCount ? $t('collab.dist.none') : $t('collab.dist.all') }}</button>
    </div>
    <div v-if="toolRoot" class="root" :title="toolRoot">{{ $t('collab.dist.skill_root') }}<code>{{ toolRoot }}</code>{{ $t('collab.dist.skill_root_hint') }}</div>
    <div class="root">{{ $t('collab.seed.version', { version: seedVersion }) }}</div>

    <div class="skilllist">
      <div v-if="totalCount === 0" class="empty">{{ $t('collab.dist.empty') }}</div>
      <template v-if="visible.skills.length">
        <div class="sec">{{ $t('collab.dist.skills', { count: visible.skills.length }) }}</div>
        <label v-for="s in visible.skills" :key="'skills:' + s.name" class="skill">
          <el-checkbox v-model="checked[keyOf('skills', s.name)]" />
          <span class="snm">🛠 {{ s.name }}</span>
        </label>
      </template>
      <template v-if="visible.command.length">
        <div class="sec">{{ $t('collab.dist.command', { count: visible.command.length }) }}</div>
        <label v-for="c in visible.command" :key="'command:' + c.name" class="skill">
          <el-checkbox v-model="checked[keyOf('command', c.name)]" />
          <span class="snm">⌨ {{ c.name }}</span>
        </label>
      </template>
      <template v-if="visible.agent.length">
        <div class="sec">{{ $t('collab.dist.agent', { count: visible.agent.length }) }}</div>
        <label v-for="a in visible.agent" :key="'agent:' + a.name" class="skill">
          <el-checkbox v-model="checked[keyOf('agent', a.name)]" />
          <span class="snm">🤖 {{ a.name }}</span>
        </label>
      </template>
      <template v-if="visible.workflow.length">
        <div class="sec">{{ $t('collab.dist.workflow', { count: visible.workflow.length }) }}</div>
        <label v-for="w in visible.workflow" :key="'workflow:' + w.id" class="skill">
          <el-checkbox v-model="checked[keyOf('workflow', w.id)]" />
          <span class="snm">🧩 {{ w.name }}</span>
        </label>
      </template>
    </div>

    <div class="acts">
      <template v-if="!pkg">
        <button class="go" :disabled="working || !selectedCount" @click="doPack">{{ working ? $t('common.packing') : $t('collab.dist.pack', { count: selectedCount }) }}</button>
      </template>
      <template v-else>
        <button v-if="isMaster" class="go" :disabled="working || sent" @click="doPublish">{{ working ? $t('common.sending') : sent ? $t('collab.dist.published') : $t('collab.dist.publish') }}</button>
        <span v-else class="pkgname">{{ $t('collab.dist.master_only') }}</span>
        <button class="ghostgo" :disabled="working" @click="downloadPkg">{{ $t('collab.dist.download') }}</button>
        <button class="ghostgo" :disabled="working" @click="reset">{{ $t('collab.dist.repack') }}</button>
      </template>
      <div class="msgs">
        <span v-if="pkg" class="pkgname">{{ $t('collab.dist.package') }}{{ pkg.fileName }}（{{ fmtSize(pkg.size) }}）</span>
        <span v-if="msg" class="ok">{{ msg }}</span>
        <span v-if="msgErr" class="err">{{ msgErr }}</span>
      </div>
    </div>
  </div>
  </el-dialog>
</template>

<style scoped>
.sd { display: flex; flex-direction: column; background: var(--bg1); border-bottom: 1px solid var(--bd2); max-height: 45vh; box-sizing: border-box; }
.head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px 4px; }
.htitle { font-size: 12px; font-weight: 600; color: var(--tx2); }
.gn { color: var(--ac2); font-weight: 700; }
.mini { background: none; border: 1px solid var(--bd); color: var(--tx3); border-radius: 4px; padding: 1px 8px; font-size: 11px; cursor: pointer; }
.root { flex: none; font-size: 11px; color: var(--tx6); padding: 0 12px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.root code { color: var(--tx3); }
.skilllist { flex: 1 1 auto; min-height: 60px; max-height: 24vh; overflow-y: auto; padding: 4px 12px; border-top: 1px solid var(--bd2); }
.sec { color: var(--tx2); text-transform: uppercase; font-size: 11px; margin: 8px 0 2px; font-weight: 600; }
.skill { display: flex; align-items: center; gap: 8px; padding: 3px 0; color: var(--tx); font-size: 13px; cursor: pointer; }
.skill input { flex: none; }
.snm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { color: var(--tx6); padding: 8px 0; font-size: 12px; }
.acts { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 8px 12px; border-top: 1px solid var(--bd2); background: var(--bg2); }
.go { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 5px 16px; cursor: pointer; font-weight: 600; }
.go:disabled, .ghostgo:disabled { opacity: .55; cursor: default; }
.ghostgo { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 4px 12px; cursor: pointer; }
.msgs { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pkgname { color: var(--tx2); font-family: Consolas, monospace; font-size: 11px; }
.ok { color: var(--ok); font-size: 12px; }
.err { color: var(--err); font-size: 12px; }
</style>
