<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);

const items = computed(() => [...snap.value.skillsInbox].sort((a, b) => b.receivedAt - a.receivedAt));
const skillsOnly = computed(() => items.value.filter((it) => (it.kind ?? 'skill') === 'skill'));
const filesOnly = computed(() => items.value.filter((it) => it.kind === 'file'));
const dirs = ref<{ upload: string | null; download: string | null }>({ upload: null, download: null });

const toolOpen = ref(false);
const toolKind = ref<'opencode' | 'claudecode' | 'custom'>('opencode');
const customRoot = ref('');
const activeRoot = ref('');
const toolMsg = ref('');
const toolErr = ref('');

onMounted(async () => {
  await Promise.all([
    props.collab.getTool().then((t) => { toolKind.value = t.tool.kind; customRoot.value = t.tool.customRoot || ''; activeRoot.value = t.root; }).catch(() => {}),
    props.collab.getDirs().then((d) => { dirs.value = d; }).catch(() => {}),
  ]);
});

async function saveTool() {
  toolMsg.value = ''; toolErr.value = '';
  try {
    const r = await props.collab.setTool(toolKind.value, toolKind.value === 'custom' ? customRoot.value.trim() : null);
    activeRoot.value = r.root;
    toolMsg.value = `已切换到 ${toolKind.value === 'claudecode' ? 'claudecode' : toolKind.value === 'custom' ? '自定义' : 'opencode'}（${r.root}）`;
    toolOpen.value = false;
    await props.collab.refresh().catch(() => {});
  } catch (e: any) { toolErr.value = String(e?.message || e); }
}

async function install(id: string) {
  if (!confirm('skill 含未知脚本，将安装到所选开发工具的 skills 目录。确认？')) return;
  toolMsg.value = ''; toolErr.value = '';
  try {
    await props.collab.installInbox(id);
    await props.collab.refresh();
  } catch (e: any) { toolErr.value = String(e?.message || e); }
}
async function ignore(id: string) { await props.collab.ignoreInbox(id); await props.collab.refresh(); }
async function remove(id: string) { if (confirm('删除该条目？')) await props.collab.removeInbox(id); }
async function downloadFile(id: string, name: string) {
  try {
    const res = await fetch(`/api/collab/download/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (e: any) { alert(`下载失败：${e?.message || e}`); }
}
function fmtSize(n: number) { return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`; }
function fromName(mid: string) { return mid.slice(0, 6); }
function fmtTime(ts: number) { return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }); }
</script>

<template>
  <div class="ib">
    <div class="toolbar">
      <div class="toolsel">
        <span class="tl">我的开发工具</span>
        <button class="toolbtn" @click="toolOpen = !toolOpen">
          {{ toolKind === 'claudecode' ? 'claudecode' : toolKind === 'custom' ? '自定义' : 'opencode' }}
          <span class="root" v-if="activeRoot" :title="activeRoot">{{ activeRoot }}</span> ▾
        </button>
        <div v-if="toolOpen" class="toolpop">
          <select v-model="toolKind" class="tkind">
            <option value="opencode">opencode</option>
            <option value="claudecode">claudecode</option>
            <option value="custom">自定义路径</option>
          </select>
          <input v-if="toolKind === 'custom'" v-model="customRoot" placeholder="skills 目录绝对路径" class="tcus" @keyup.enter="saveTool" />
          <div class="tacts">
            <button class="tgo" @click="saveTool">保存</button>
            <span class="tclose" @click="toolOpen = false">取消</span>
          </div>
          <div v-if="toolMsg" class="tmsg ok">{{ toolMsg }}</div>
          <div v-if="toolErr" class="tmsg err">{{ toolErr }}</div>
        </div>
      </div>
      <div class="dirinfo" v-if="dirs.download">
        <span title="接收目录">↓ {{ dirs.download }}</span>
        <span v-if="dirs.upload" title="发出目录" class="up">↑ {{ dirs.upload }}</span>
      </div>
      <div v-if="activeRoot" class="inst-hint">技能将安装到：<code>{{ activeRoot }}</code>，重启对应 CLI 后生效</div>
    </div>

    <div v-if="snap.skillsInbox.length === 0 && filesOnly.length === 0" class="empty">
      暂无收到的内容（技能包/文件都会出现在这里）
    </div>

    <div class="warn">⚠️ 收到的内容可能来自不可信来源，安装/打开前请确认。</div>

    <template v-if="filesOnly.length">
      <h4>文件</h4>
      <div v-for="it in filesOnly" :key="it.id" class="item">
        <div class="info">
          <span class="nm">📄 {{ it.fileName || it.skillName }}</span>
          <span class="meta">来自 {{ fromName(it.fromId) }} · {{ fmtSize(it.size) }}</span>
        </div>
        <div class="acts">
          <button v-if="it.status === 'received' || it.status === 'installed' || it.status === 'ignored'" @click="downloadFile(it.id, it.fileName || it.skillName || 'download')">下载</button>
          <button class="ghost del" @click="remove(it.id)">删除</button>
        </div>
      </div>
    </template>

    <template v-if="skillsOnly.length">
      <h4>技能包</h4>
      <div v-for="it in skillsOnly" :key="it.id" class="item">
        <div class="info">
          <span class="nm">🛠 {{ it.skillName }}</span>
          <span class="meta">{{ fmtTime(it.receivedAt) }} · 来自 {{ fromName(it.fromId) }} · {{ fmtSize(it.size) }} · {{ it.hash.slice(0, 8) }}</span>
        </div>
        <div class="acts">
          <template v-if="it.status === 'received'">
            <button @click="install(it.id)">安装</button>
            <button class="ghost" @click="ignore(it.id)">忽略</button>
          </template>
          <span v-else-if="it.status === 'installed'" class="state ok" :title="'已装到 ' + activeRoot">已安装·重启生效</span>
          <span v-else-if="it.status === 'ignored'" class="state">已忽略</span>
          <span v-else-if="it.status === 'invalid'" class="state bad">无效包</span>
          <button class="ghost del" @click="remove(it.id)">删除</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ib { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px; }
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
.warn { background: var(--warnbg); color: var(--warn); border: 1px solid var(--bd); border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; font-size: 12px; }
h4 { color: var(--tx2); text-transform: uppercase; font-size: 11px; margin: 14px 0 6px; }
.item { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--bd2); padding: 8px 4px; }
.info { flex: 1; min-width: 0; }
.nm { color: var(--tx1); font-weight: 600; }
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
