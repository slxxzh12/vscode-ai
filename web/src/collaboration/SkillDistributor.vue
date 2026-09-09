<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';

const props = defineProps<{ collab: CollabApi; groupId: string }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const group = computed(() => snap.value.groups.find((g) => g.id === props.groupId) || null);

const assets = ref<{ skills: { name: string }[]; command: { name: string }[]; agent: { name: string }[] }>({ skills: [], command: [], agent: [] });
const checked = ref<Record<string, boolean>>({});
const msg = ref('');
const msgErr = ref('');
const working = ref(false);
const toolRoot = ref('');
type Kind = 'skills' | 'command' | 'agent';
const keyOf = (k: Kind, n: string) => `${k}:${n}`;

const selected = computed(() => {
  const s: { skills: string[]; command: string[]; agent: string[] } = { skills: [], command: [], agent: [] };
  for (const k of ['skills', 'command', 'agent'] as Kind[]) {
    for (const it of assets.value[k]) if (checked.value[keyOf(k, it.name)]) s[k].push(it.name);
  }
  return s;
});
const selectedCount = computed(() => selected.value.skills.length + selected.value.command.length + selected.value.agent.length);
const totalCount = computed(() => assets.value.skills.length + assets.value.command.length + assets.value.agent.length);
const pkg = ref<{ id: string; fileName: string; size: number } | null>(null);
const sent = ref(false);

onMounted(async () => {
  props.collab.getTool().then((t) => { toolRoot.value = t.root; }).catch(() => {});
  loadAssets();
});
async function loadAssets() {
  try { assets.value = await props.collab.getAssets(); }
  catch (e) { msgErr.value = String((e as Error).message || e); }
}
function toggleAll(on: boolean) {
  const map: Record<string, boolean> = {};
  if (on) for (const k of ['skills', 'command', 'agent'] as Kind[]) for (const it of assets.value[k]) map[keyOf(k, it.name)] = true;
  checked.value = map;
}
function reset() { pkg.value = null; sent.value = false; msg.value = ''; }
async function doPack() {
  if (!selectedCount.value) { msg.value = '请先勾选 skills/command/agents'; return; }
  msg.value = ''; msgErr.value = ''; working.value = true;
  try {
    const r = await props.collab.buildPackage(selected.value);
    pkg.value = r.package;
    msg.value = '打包完成';
  } catch (e: any) { msgErr.value = String(e?.message || e); }
  finally { working.value = false; }
}
async function doSend() {
  if (!pkg.value) return;
  msg.value = ''; msgErr.value = ''; working.value = true;
  try {
    const r = await props.collab.sendPackage(pkg.value.id, props.groupId);
    if (r.code !== 'ok') { msgErr.value = `发送失败：${r.code}`; return; }
    sent.value = true;
    msg.value = `已发送到 ${r.pushed} 个成员${r.failures?.length ? `，失败 ${r.failures.length}` : ''}`;
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
  } catch (e: any) { msgErr.value = `下载失败：${e?.message || e}`; }
}
function fmtSize(n: number) { return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`; }
</script>

<template>
  <div class="sd">
    <div class="head">
      <span class="htitle">🛠 分发配置 <span class="gn">{{ group?.name || '' }}</span></span>
      <button class="mini" @click="toggleAll(selectedCount !== totalCount)">{{ selectedCount === totalCount ? '全不选' : '全选' }}</button>
    </div>
    <div v-if="toolRoot" class="root" :title="toolRoot">技能根：<code>{{ toolRoot }}</code>（command/agent 取同配置根；「任务」页可切工具）</div>

    <div class="skilllist">
      <div v-if="totalCount === 0" class="empty">所选工具目录下暂无 skills/command/agent 可分发</div>
      <template v-if="assets.skills.length">
        <div class="sec">技能 skills/（{{ assets.skills.length }}）</div>
        <label v-for="s in assets.skills" :key="'skills:' + s.name" class="skill">
          <input type="checkbox" v-model="checked[keyOf('skills', s.name)]" />
          <span class="snm">🛠 {{ s.name }}</span>
        </label>
      </template>
      <template v-if="assets.command.length">
        <div class="sec">命令 command/（{{ assets.command.length }}）</div>
        <label v-for="c in assets.command" :key="'command:' + c.name" class="skill">
          <input type="checkbox" v-model="checked[keyOf('command', c.name)]" />
          <span class="snm">⌨ {{ c.name }}</span>
        </label>
      </template>
      <template v-if="assets.agent.length">
        <div class="sec">代理 agent/（{{ assets.agent.length }}）</div>
        <label v-for="a in assets.agent" :key="'agent:' + a.name" class="skill">
          <input type="checkbox" v-model="checked[keyOf('agent', a.name)]" />
          <span class="snm">🤖 {{ a.name }}</span>
        </label>
      </template>
    </div>

    <div class="acts">
      <template v-if="!pkg">
        <button class="go" :disabled="working || !selectedCount" @click="doPack">{{ working ? '打包中…' : `① 打包（${selectedCount}）` }}</button>
      </template>
      <template v-else>
        <button class="go" :disabled="working || sent" @click="doSend">{{ working ? '发送中…' : sent ? '✓ 已发送' : '② 发送到本群' }}</button>
        <button class="ghostgo" :disabled="working" @click="downloadPkg">下载包</button>
        <button class="ghostgo" :disabled="working" @click="reset">重新打包</button>
      </template>
      <div class="msgs">
        <span v-if="pkg" class="pkgname">包：{{ pkg.fileName }}（{{ fmtSize(pkg.size) }}）</span>
        <span v-if="msg" class="ok">{{ msg }}</span>
        <span v-if="msgErr" class="err">{{ msgErr }}</span>
      </div>
    </div>
  </div>
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
