<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import type { CollabInboxItem, CollabOutItem } from './types';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);

const inbound = computed(() => [...snap.value.skillsInbox].sort((a, b) => b.receivedAt - a.receivedAt));
const outbound = computed(() => [...snap.value.outbox].sort((a, b) => b.createdAt - a.createdAt));
const groupName = (gid: string | null) => snap.value.groups.find((g) => g.id === gid)?.name || '';

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

async function installSkill(it: CollabInboxItem) {
  if (!confirm('skill 含未知脚本，将安装到所选开发工具的 skills 目录。确认？')) return;
  toolMsg.value = ''; toolErr.value = '';
  try { await props.collab.installInbox(it.id); await props.collab.refresh(); }
  catch (e: any) { toolErr.value = String(e?.message || e); }
}
async function ignoreIn(it: CollabInboxItem) { await props.collab.ignoreInbox(it.id); await props.collab.refresh(); }
async function removeIn(it: CollabInboxItem) { if (confirm('删除该任务？')) await props.collab.removeInbox(it.id); }
async function removeOut(it: CollabOutItem) { if (confirm('删除该任务并清掉 upload 留档？')) await props.collab.removeOutTask(it.id); }
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
  } catch (e: any) { alert(`下载失败：${e?.message || e}`); }
}
function fmtSize(n: number) { return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`; }
function fmtTime(ts: number) { return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }); }
</script>

<template>
  <div class="tk">
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
      <div v-if="activeRoot" class="inst-hint">技能安装到：<code>{{ activeRoot }}</code>，重启对应 CLI 生效</div>
      <div class="dirinfo" v-if="dirs.download">
        <span title="接收目录">↓ {{ dirs.download }}</span>
        <span v-if="dirs.upload" title="发出目录" class="up">↑ {{ dirs.upload }}</span>
      </div>
    </div>

    <div v-if="inbound.length === 0 && outbound.length === 0" class="empty">暂无任务（群内「📎 发文件 / 🛠 分发技能」会生成这里与对方）</div>

    <template v-if="inbound.length">
      <h4>收到（{{ inbound.length }}）</h4>
      <div v-for="it in inbound" :key="'in-' + it.id" class="task" :class="{ skill: (it.kind ?? 'skill') === 'skill' }">
        <span class="tic">{{ (it.kind ?? 'skill') === 'skill' ? '🛠' : '📄' }}</span>
        <div class="info">
          <span class="nm">{{ (it.kind ?? 'skill') === 'skill' ? it.skillName : it.fileName }}</span>
          <span class="meta">
            {{ fmtTime(it.receivedAt) }} · {{ it.kind === 'file' ? '文件' : '技能' }} · {{ groupName(it.groupId) || '未知群' }} · {{ fmtSize(it.size) }}
          </span>
        </div>
        <div class="acts">
          <template v-if="it.status === 'received'">
            <button v-if="(it.kind ?? 'skill') === 'skill'" @click="installSkill(it)">安装</button>
            <button v-if="(it.kind ?? 'skill') === 'skill'" class="ghost" @click="ignoreIn(it)">忽略</button>
            <button v-if="it.kind === 'file'" @click="saveFile(it)">下载</button>
          </template>
          <span v-else-if="it.status === 'installed'" class="state ok" :title="'已装到 ' + activeRoot">已安装·重启生效</span>
          <span v-else-if="it.status === 'ignored'" class="state">已忽略</span>
          <span v-else-if="it.status === 'invalid'" class="state bad">无效包</span>
          <button class="ghost del" @click="removeIn(it)">删除</button>
        </div>
      </div>
    </template>

    <template v-if="outbound.length">
      <h4>发出（{{ outbound.length }}）</h4>
      <div v-for="it in outbound" :key="'out-' + it.id" class="task out">
        <span class="tic">{{ it.kind === 'skill' ? '🛠' : '📄' }}</span>
        <div class="info">
          <span class="nm">{{ it.kind === 'skill' ? it.skillName : it.fileName }}</span>
          <span class="meta">{{ fmtTime(it.createdAt) }} · {{ it.kind === 'file' ? '文件' : '技能' }} → {{ groupName(it.groupId) || '未知群' }} · {{ fmtSize(it.size) }}</span>
        </div>
        <div class="acts">
          <button class="ghost del" @click="removeOut(it)">删除</button>
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
