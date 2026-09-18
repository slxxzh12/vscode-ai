<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import { filterMentions, parseComposer, splitAtCommand, highlightMentions } from './chat-parser';
import { distCardOf, showAccept, type DistCard } from './distTasks';
import type { CollabChatMessage } from './types';
import SkillDistributor from './SkillDistributor.vue';
import { t } from '../i18n';

const props = defineProps<{ collab: CollabApi; groupId: string }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const group = computed(() => (snap.value.groups || []).find((g) => g.id === props.groupId) || null);
const chat = computed(() => props.collab.chatState.value[props.groupId] || { messages: [] });
// 分发通知：预先算好每条的卡片模型，模板里索引取用（避免重复调用与空值断言）
const distCards = computed<Record<string, DistCard>>(() => {
  const out: Record<string, DistCard> = {};
  for (const m of chat.value.messages) { const c = distCardOf(m); if (c) out[m.id] = c; }
  return out;
});
function cardTypeKey(type: string): string {
  return type === 'workflow' ? 'collab.task.workflow' : type === 'mixed' ? 'collab.dist.msg.mixed_short' : 'collab.task.skills';
}
function openTasks() { window.location.hash = '#contacts/tasks'; }
const me = computed(() => snap.value.identity.machineId);
const hubId = computed(() => group.value?.hubId || '');
const myPending = computed(() => props.collab.pendingCmdState.value.filter((p) => p.groupId === props.groupId));
const skillOpen = ref(false);
const skillFocus = ref<'skills' | 'workflow'>('skills');
function openDist(kind: 'skills' | 'workflow') {
  if (skillOpen.value && skillFocus.value === kind) { skillOpen.value = false; return; }
  skillFocus.value = kind;
  skillOpen.value = true;
}
const nameById = computed(() => {
  const map: Record<string, string> = {};
  for (const m of group.value?.members ?? []) map[m.machineId] = m.username;
  return map;
});

const composer = ref('');
const showMentions = ref(false);
const mentionKeyword = ref('');
const mentionMembers = computed(() => filterMentions(group.value?.members ?? [], mentionKeyword.value).filter((m) => m.machineId !== me.value));
const msgListEl = ref<HTMLElement | null>(null);

async function scrollBottom() { await nextTick(); msgListEl.value?.scrollTo({ top: msgListEl.value.scrollHeight }); }
function onComposerInput() {
  const atIdx = composer.value.lastIndexOf('@');
  mentionKeyword.value = atIdx >= 0 ? composer.value.slice(atIdx + 1) : '';
  showMentions.value = atIdx >= 0;
}
function pickMention(m: { machineId: string; username: string }) {
  const atIdx = composer.value.lastIndexOf('@');
  composer.value = composer.value.slice(0, atIdx) + `@${m.username} `;
  showMentions.value = false;
}
async function submit() {
  if (!composer.value.trim()) composer.value = 'ok';
  const raw = composer.value.trim();
  const atMatch = raw.match(/^\s*@([^\s]+)\s/);
  const atMember = group.value?.members.find((m) => m.username === (atMatch?.[1] ?? '')) ?? null;
  const parsed = parseComposer(raw, atMember);
  if (parsed.isCommand) {
    if (parsed.missingTarget) { alert(t('collab.chat.need_mention')); return; }
    const seg = splitAtCommand(raw, atMember!.username, atMember!.machineId);
    await props.collab.sendCmd(props.groupId, seg.text, seg.toId!);
  }
  await props.collab.sendChat(props.groupId, raw, atMember?.machineId ?? null);
  composer.value = '';
  await scrollBottom();
}

async function decide(p: { id: string }, approve: boolean) {
  await props.collab.approveCmd(p.id, approve);
  await props.collab.loadPendingCmds().catch(() => {});
}
function fmtTime(ts: number) { return new Date(ts).toLocaleTimeString(); }
function isMine(m: CollabChatMessage) { return m.fromId === me.value; }
function nameOf(machineId: string) { return nameById.value[machineId] || machineId.slice(0, 6); }
function resultText(m: CollabChatMessage) {
  if (!m.meta) return m.text;
  const parts = [m.text];
  if (m.meta.stderr) parts.push(`\n[stderr]\n${m.meta.stderr}`);
  return parts.join('');
}

watch(() => chat.value.messages.length, () => scrollBottom());
// 聊天数据以群主（master）为准：不是群主时，打开/刷新都从群主拉一份
async function pullFromHub() {
  const g = group.value;
  if (!g || !me.value || g.hubId === me.value) return;
  try {
    // pullChat 会把群主那份合并进本地视图（不覆盖），本地只做缓存
    await props.collab.pullChat(props.groupId, g.hubId);
  } catch { /* 群主离线时用本地缓存 */ }
}
onMounted(async () => {
  await props.collab.chat(props.groupId).catch(() => {});
  await pullFromHub();
  await props.collab.loadPendingCmds().catch(() => {});
  await scrollBottom();
});
watch(() => props.groupId, () => { pullFromHub().then(() => scrollBottom()); });
watch(() => snap.value.heartbeats, () => { pullFromHub(); });
</script>

<template>
  <div class="gcv">
    <!-- 群聊工具条 -->
    <div class="tools">
      <button class="tool" :class="{ on: skillOpen && skillFocus === 'skills' }" :title="$t('collab.chat.distribute_title')" @click="openDist('skills')">{{ $t('collab.chat.distribute') }}</button>
      <button class="tool" :class="{ on: skillOpen && skillFocus === 'workflow' }" :title="$t('collab.dist.workflow_title')" @click="openDist('workflow')">{{ $t('collab.chat.distribute_workflow') }}</button>
    </div>
    <SkillDistributor v-if="skillOpen" :open="skillOpen" :collab="collab" :group-id="props.groupId" :focus="skillFocus" @close="skillOpen = false" />

    <!-- 本机待确认执行卡片（按当前群过滤） -->
    <div v-for="p in myPending" :key="p.id" class="pend">
      <div class="pend-txt">{{ $t('collab.chat.cmd_request', { name: nameOf(p.fromId) }) }}<code>{{ p.text }}</code></div>
      <button @click="decide(p, true)">{{ $t('common.allow') }}</button>
      <button class="ghost" @click="decide(p, false)">{{ $t('common.reject') }}</button>
    </div>

    <div class="msgs" ref="msgListEl">
      <div v-for="m in chat.messages" :key="m.id" class="msg" :class="{ mine: isMine(m) }">
        <div class="meta">
          <span class="who">{{ nameOf(m.fromId) }}</span>
          <span v-if="m.fromId === hubId" class="tag master">{{ $t('collab.member.master') }}</span>
          <span v-if="isMine(m)" class="tag me">{{ $t('collab.chat.me') }}</span>
          <span class="time">{{ fmtTime(m.ts) }}</span>
          <span v-if="m.kind === 'system'" class="tag sys">{{ $t('collab.chat.system') }}</span>
        </div>
        <template v-if="m.kind === 'cmd-result'">
          <div class="res-head">{{ $t('collab.chat.result') }}<template v-if="m.meta"> · {{ $t('collab.chat.exit_code', { code: m.meta.exitCode ?? '-' }) }}</template></div>
          <pre class="res-body">{{ resultText(m) }}</pre>
        </template>
        <div v-else-if="distCards[m.id]" class="dcard">
          <div class="dhead">📦 {{ $t(cardTypeKey(distCards[m.id].type)) }}</div>
          <div class="dname">{{ distCards[m.id].name }}</div>
          <div class="dmeta">{{ $t('collab.task.items', { count: distCards[m.id].count }) }}</div>
          <a v-if="distCards[m.id].url" class="dlink" :href="distCards[m.id].url" target="_blank" rel="noopener">{{ $t('collab.task.download_addr') }}: {{ distCards[m.id].url }}</a>
          <button v-if="showAccept(m, me)" class="dtasks" @click="openTasks">{{ $t('collab.task.goto_tasks') }}</button>
        </div>
        <div v-else class="bubble">
          <span v-for="(seg, i) in highlightMentions(m.text, nameById)" :key="i" :class="{ at: seg.mention }">{{ seg.text }}</span>
        </div>
      </div>
      <div v-if="chat.messages.length === 0" class="empty">{{ $t('collab.chat.empty') }}</div>
    </div>

    <div class="compose">
      <div v-if="showMentions" class="mentions">
        <button v-for="mm in mentionMembers" :key="mm.machineId" @click="pickMention(mm)">@{{ mm.username }}</button>
        <div v-if="mentionMembers.length === 0" class="empty">{{ $t('collab.chat.no_match') }}</div>
      </div>
      <div class="row">
        <div class="cinputwrap">
          <textarea
            v-model="composer"
            class="cinput"
            :placeholder="$t('collab.chat.input_placeholder')"
            @input="onComposerInput"
            @keydown.enter.exact.prevent="submit"
          />
        </div>
        <button class="csend" @click="submit">{{ $t('common.send') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gcv { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.tools { flex: none; display: flex; gap: 6px; padding: 6px 8px 0; }
.tool { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 12px; }
.tool:hover { border-color: var(--ac); color: var(--ac); }
.tool.on { background: var(--ac); border-color: var(--ac); color: var(--onac); }
.tool:disabled { opacity: .55; cursor: default; }
.pend { background: color-mix(in srgb, var(--ac) 18%, transparent); border: 1px solid var(--ac); border-radius: 6px; margin: 8px; padding: 8px 10px; display: flex; gap: 8px; align-items: center; }
.pend-txt { flex: 1; color: var(--tx1); }
.pend code { color: var(--warn2); }
.msgs { flex: 1; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }
.msg { max-width: 100%; display: flex; flex-direction: column; gap: 2px; }
.meta { display: flex; gap: 6px; color: var(--tx6); font-size: 11px; align-items: center; }
.who { color: var(--tx2); font-weight: 600; }
.tag { padding: 0 6px; border-radius: 8px; font-size: 10px; }
.tag.sys { background: var(--bg5); color: var(--tx2); }
.tag.master { background: var(--warn); color: #fff; font-weight: 700; }
.tag.me { background: var(--ac); color: var(--onac); font-weight: 700; }
.bubble { background: var(--bg4); border: 1px solid var(--bd); border-radius: 8px; padding: 6px 10px; color: var(--tx); white-space: pre-wrap; word-break: break-word; align-self: flex-start; }
.msg.mine .bubble { background: color-mix(in srgb, var(--ac) 22%, transparent); border-color: var(--ac); align-self: flex-end; }
.at { color: var(--ac2); font-weight: 600; }
.res-head { color: var(--tx2); font-size: 11px; }
.res-body { background: var(--bg3); color: var(--oktx); border: 1px solid var(--bd2); border-radius: 6px; padding: 8px; font-family: Consolas, monospace; font-size: 12px; white-space: pre-wrap; max-height: 260px; overflow: auto; }
.compose { border-top: 1px solid var(--bd); padding: 8px; position: relative; flex: none; }
.mentions { position: absolute; bottom: 100%; left: 8px; background: var(--bg2); border: 1px solid var(--bd); border-radius: 6px; padding: 4px; display: flex; flex-direction: column; max-height: 180px; overflow: auto; }
.mentions button { background: none; border: none; color: var(--tx1); text-align: left; padding: 4px 8px; cursor: pointer; }
.mentions button:hover { background: var(--ac); color: var(--onac); border-radius: 4px; }
.row { display: flex; align-items: stretch; gap: 8px; }
.cinputwrap { position: relative; flex: 1; min-width: 0; display: flex; }
.cinput { flex: 1; min-width: 0; min-height: 62px; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 10px; padding: 10px 14px; font-size: 13px; line-height: 1.6; outline: none; resize: none; font-family: inherit; }
.cinput:focus { border-color: var(--ac2); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ac2) 22%, transparent); }
.cinput::placeholder { color: var(--tx3); }
.csend { background: var(--window-ac, var(--ac)); color: var(--onac); border: none; border-radius: 10px; padding: 0 28px; cursor: pointer; font-size: 15px; font-weight: 700; flex: none; min-width: 100px; }
button.ghost { background: none; border: 1px solid var(--bd); color: var(--tx2); }
.empty { color: var(--tx6); padding: 8px; }
.dcard { border: 1px solid var(--ac); border-radius: 8px; padding: 8px 10px; background: color-mix(in srgb, var(--ac) 12%, transparent); display: flex; flex-direction: column; gap: 4px; align-self: flex-start; max-width: 100%; }
.dhead { color: var(--tx1); font-weight: 700; font-size: 12px; }
.dname { color: var(--tx2); font-size: 12px; word-break: break-all; }
.dmeta { color: var(--tx6); font-size: 11px; }
.dlink { color: var(--ac2); font-size: 11px; word-break: break-all; text-decoration: none; }
.dtasks { align-self: flex-start; background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
</style>
