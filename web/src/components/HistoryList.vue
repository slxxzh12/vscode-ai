<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { HistoryMessage } from '../useMessageHistory';
import { t } from '../i18n';
import { buildSessionTree, type SessionNode } from '../sessionTree';

export interface HistoryEntry { projectId: string; path: string; name: string; projName: string; ts: number; }
const props = withDefaults(defineProps<{
  items: HistoryEntry[]; tab: 'files' | 'messages'; messages: HistoryMessage[];
  filter?: boolean; liveSessionIds?: string[];
}>(), {
  filter: true,
  liveSessionIds: () => [],
});
const emit = defineEmits<{
  (e: 'update:tab', tab: 'files' | 'messages'): void;
  (e: 'update:filter', v: boolean): void;
  (e: 'open', it: HistoryEntry): void;
  (e: 'remove', projectId: string, path: string): void;
  (e: 'clear'): void;
  (e: 'open-message', text: string): void;
  (e: 'remove-message', msg: HistoryMessage): void;
  (e: 'open-session', sessionId: string): void;
}>();

// 页签交给 Element Plus 的 el-tabs 渲染，切页签仍由父组件持有的 tab 决定
const activeTab = computed({
  get: () => props.tab,
  set: (v: string | number) => emit('update:tab', v as 'files' | 'messages'),
});

// 每次最多展示 50 条，滚动到底部再加载下一批
const PAGE = 50;
const fileLimit = ref(PAGE);
const msgLimit = ref(PAGE);
const query = ref('');
watch(() => props.tab, () => { fileLimit.value = PAGE; msgLimit.value = PAGE; });
watch(query, () => { fileLimit.value = PAGE; msgLimit.value = PAGE; });

function match(text: string, q: string) { return text.toLowerCase().includes(q); }

const sortedItems = computed(() => [...props.items].sort((a, b) => b.ts - a.ts));
const filteredItems = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return sortedItems.value;
  return sortedItems.value.filter((it) => match(it.name, q) || match(it.path, q) || match(it.projName, q));
});
const filteredMessages = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.messages;
  return props.messages.filter((m) => match(m.text, q));
});

const shownItems = computed(() => filteredItems.value.slice(0, fileLimit.value));
const shownMessages = computed(() => filteredMessages.value.slice(0, msgLimit.value));
const hasMore = computed(() => props.tab === 'files'
  ? fileLimit.value < filteredItems.value.length
  : msgLimit.value < (props.filter ? filteredMessages.value.length : treeTotal.value));
const searching = computed(() => query.value.trim().length > 0);
const noMatch = computed(() => {
  if (!searching.value) return false;
  if (props.tab === 'files') return props.items.length > 0 && filteredItems.value.length === 0;
  return props.filter
    ? (props.messages.length > 0 && filteredMessages.value.length === 0)
    : (props.messages.length > 0 && treeTotal.value === 0);
});

const grouped = computed(() => {
  const list = [...shownItems.value];
  const out: { proj: string; recs: HistoryEntry[] }[] = [];
  for (const it of list) {
    let g = out.find((x) => x.proj === it.projName);
    if (!g) { g = { proj: it.projName, recs: [] }; out.push(g); }
    g.recs.push(it);
  }
  return out;
});

function onScroll(e: Event) {
  const el = e.target as HTMLElement;
  if (el.scrollTop + el.clientHeight < el.scrollHeight - 40) return;
  if (props.tab === 'files') {
    if (fileLimit.value < filteredItems.value.length) fileLimit.value += PAGE;
  } else if (msgLimit.value < filteredMessages.value.length) {
    msgLimit.value += PAGE;
  }
}

function fmtDay(ts: number) {
  const d = new Date(ts); const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// 下面显示的访问时间（精确到秒）
function fmtBelow(ts: number) {
  if (!ts) return '';
  const d = new Date(ts); const p = (x: number) => String(x).padStart(2, '0');
  return `${fmtDay(ts)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
// 同一天同一背景色（按日期散列到 4 个淡色）
function dayClass(ts: number) {
  if (!ts) return '';
  const key = fmtDay(ts);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `d-${h % 4}`;
}

// 按天插入明显隔断：返回 [{sep:日期} | {item}]
type DayRow<T> = { sep: string } | { item: T };
function withDaySeps<T>(items: T[], getTs: (x: T) => number): DayRow<T>[] {
  const out: DayRow<T>[] = [];
  let last = '';
  for (const it of items) {
    const ts = getTs(it);
    const key = ts ? fmtDay(ts) : '';
    if (key && key !== last) { out.push({ sep: key }); last = key; }
    out.push({ item: it });
  }
  return out;
}
const msgRows = computed(() => withDaySeps(shownMessages.value, (m) => m.ts));
const fileGroups = computed(() => grouped.value.map((g) => ({ proj: g.proj, rows: withDaySeps(g.recs, (r) => r.ts) })));

// —— 全部会话：会话两级目录 ——
const liveSet = computed(() => new Set(props.liveSessionIds || []));
const expanded = ref<Set<string>>(new Set());
function toggleNode(key: string) {
  const next = new Set(expanded.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  expanded.value = next;
}
const treeNodes = computed<SessionNode[]>(() => {
  const q = query.value.trim().toLowerCase();
  const all = buildSessionTree(props.messages, t('hist.tree.unknown'));
  if (!q) return all;
  const out: SessionNode[] = [];
  for (const n of all) {
    if (match(n.label, q)) { out.push(n); continue; }
    const msgs = n.messages.filter((m) => match(m.text, q));
    if (msgs.length) out.push({ ...n, messages: msgs });
  }
  return out;
});
const treeTotal = computed(() => treeNodes.value.reduce((sum, n) => sum + n.messages.length, 0));
const treeShown = computed<SessionNode[]>(() => {
  const out: SessionNode[] = [];
  let budget = msgLimit.value;
  for (const n of treeNodes.value) {
    if (budget <= 0) break;
    const take = n.messages.slice(0, budget);
    out.push({ ...n, messages: take });
    budget -= take.length;
  }
  return out;
});
function nodeRows(n: SessionNode) { return withDaySeps(n.messages, (m) => m.ts); }
function openNode(sid: string | null) { if (sid) emit('open-session', sid); }
</script>

<template>
  <div class="hl">
    <header class="hh">
      <el-tabs v-model="activeTab" class="hltabs">
        <el-tab-pane :label="$t('hist.tab.messages')" name="messages" />
        <el-tab-pane :label="$t('hist.tab.files')" name="files" />
      </el-tabs>
      <button v-if="tab === 'files' && items.length" class="clear" :title="$t('hist.clear_files')" @click="emit('clear')">{{ $t('hist.clear') }}</button>
    </header>
    <div v-if="tab === 'messages'" class="filterbar" :title="$t('hist.filter.title')">
      <button class="filterbtn" :class="{ on: filter }" @click="emit('update:filter', true)">{{ $t('hist.filter.on') }}</button>
      <button class="filterbtn" :class="{ on: !filter }" @click="emit('update:filter', false)">{{ $t('hist.filter.off') }}</button>
    </div>
    <div class="searchbar">
      <input v-model="query" class="searchinput" type="search" :placeholder="$t('hist.search')" spellcheck="false" />
    </div>

    <div class="list" @scroll.passive="onScroll">
      <template v-if="tab === 'files'">
        <div v-if="items.length === 0" class="empty">{{ $t('hist.empty_files') }}</div>
        <div v-else-if="noMatch" class="empty">{{ $t('hist.no_match') }}</div>
        <div v-for="g in fileGroups" :key="g.proj" class="grp">
          <div class="gname">{{ g.proj }}</div>
          <template v-for="(row, i) in g.rows" :key="i">
            <div v-if="'sep' in row" class="daysep">{{ row.sep }}</div>
            <button v-else class="row" :class="dayClass(row.item.ts)" @click="emit('open', row.item)">
              <span class="ic">📄</span>
              <span class="tx">
                <span class="nm">{{ row.item.name }}</span>
                <span class="sub">{{ row.item.path }}</span>
                <span v-if="row.item.ts" class="mdate">{{ fmtBelow(row.item.ts) }}</span>
              </span>
              <span class="x" :title="$t('hist.remove')" @click.stop="emit('remove', row.item.projectId, row.item.path)">×</span>
            </button>
          </template>
        </div>
      </template>

      <template v-else>
        <div v-if="messages.length === 0" class="empty">{{ $t('hist.empty_messages') }}</div>
        <div v-else-if="noMatch" class="empty">{{ $t('hist.no_match') }}</div>
        <template v-else-if="!filter">
          <div v-for="n in treeShown" :key="n.key" class="tgroup">
            <button class="tnode" @click="toggleNode(n.key)">
              <span class="tcaret">{{ expanded.has(n.key) ? '▾' : '▸' }}</span>
              <span class="tdot" :class="{ live: !!n.sessionId && liveSet.has(n.sessionId) }" />
              <span class="tname">{{ n.label }}</span>
              <span class="tcount">{{ $t('hist.tree.count', { n: n.messages.length }) }}</span>
              <span v-if="n.sessionId" class="topen" :title="$t('hist.tree.open_title')" @click.stop="openNode(n.sessionId)">{{ $t('hist.tree.open') }}</span>
            </button>
            <template v-if="expanded.has(n.key)">
              <template v-for="(row, i) in nodeRows(n)" :key="i">
                <div v-if="'sep' in row" class="daysep">{{ row.sep }}</div>
                <button v-else class="mrow" :class="dayClass(row.item.ts)" :title="row.item.text" @click="emit('open-message', row.item.text)">
                  <span class="ic">💬</span>
                  <span class="mbody">
                    <span class="mtext">{{ row.item.text }}</span>
                    <span class="mmeta"><span v-if="row.item.ts" class="mdate">{{ fmtBelow(row.item.ts) }}</span></span>
                  </span>
                  <span class="x" :title="$t('hist.remove_message')" @click.stop="emit('remove-message', row.item)">×</span>
                </button>
              </template>
            </template>
          </div>
        </template>
        <template v-else>
          <template v-for="(row, i) in msgRows" :key="i">
            <div v-if="'sep' in row" class="daysep">{{ row.sep }}</div>
            <button v-else class="mrow" :class="dayClass(row.item.ts)" :title="row.item.text" @click="emit('open-message', row.item.text)">
              <span class="ic">💬</span>
              <span class="mbody">
                <span class="mtext">{{ row.item.text }}</span>
                <span class="mmeta">
                  <span v-if="row.item.tabName" class="mtab">{{ row.item.tabName }}</span>
                  <span v-if="row.item.ts" class="mdate">{{ fmtBelow(row.item.ts) }}</span>
                </span>
              </span>
              <span class="x" :title="$t('hist.remove_message')" @click.stop="emit('remove-message', row.item)">×</span>
            </button>
          </template>
        </template>
      </template>

      <div v-if="hasMore" class="more">{{ $t('hist.more') }}</div>
      <div v-else-if="(tab === 'files' ? filteredItems.length : filteredMessages.length) > 0" class="foot">{{ $t('hist.foot') }}</div>
    </div>
  </div>
</template>

<style scoped>
.hl { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.hh { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid var(--bd2); flex: none; gap: 6px; }
.hltabs { flex: 1 1 auto; min-width: 0; }
.hltabs :deep(.el-tabs__header) { margin: 0; }
.hltabs :deep(.el-tabs__nav-wrap::after) { height: 1px; background: var(--bd2); }
.hltabs :deep(.el-tabs__item) { height: 26px; line-height: 26px; padding: 0 8px; font-size: 12px; color: var(--tx3); }
.hltabs :deep(.el-tabs__item.is-active) { color: var(--ac2); font-weight: 700; }
.hltabs :deep(.el-tabs__active-bar) { height: 2px; background-color: var(--ac2); }
.hltabs :deep(.el-tabs__content) { display: none; }
.clear { background: none; border: 1px solid var(--bd); color: var(--tx3); border-radius: 4px; padding: 1px 8px; font-size: 11px; cursor: pointer; }
.filterbar { display: flex; gap: 6px; padding: 6px 10px 0; flex: none; }
.filterbtn { background: none; border: 1px solid var(--bd); color: var(--tx5); border-radius: 4px; padding: 1px 8px; font-size: 11px; cursor: pointer; white-space: nowrap; }
.filterbtn:hover { border-color: var(--ac2); color: var(--ac2); }
.filterbtn.on { color: var(--ac2); border-color: var(--ac2); }
.searchbar { flex: none; padding: 6px 10px; border-bottom: 1px solid var(--bd2); }
.searchinput { width: 100%; box-sizing: border-box; background: var(--bg3); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 8px; font-size: 12px; font-family: inherit; }
.searchinput:focus { outline: none; border-color: var(--ac2); }
.list { flex: 1; min-height: 0; overflow-y: auto; }
.grp { flex: none; }
.gname { color: var(--ac2); font-size: 11px; text-transform: uppercase; padding: 10px 10px 2px; }
.daysep { display: flex; align-items: center; gap: 8px; padding: 8px 10px 4px; color: var(--tx5); font-size: 11px; font-family: Consolas, monospace; user-select: none; }
.daysep::before, .daysep::after { content: ''; flex: 1; height: 1px; background: var(--bd); }
.row { display: flex; align-items: flex-start; gap: 8px; width: 100%; background: none; border: none; text-align: left; padding: 6px 8px; cursor: pointer; }
.tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.nm { color: var(--tx1); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { color: var(--tx6); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: Consolas, monospace; }
.mdate { color: var(--tx6); font-size: 10px; font-family: Consolas, monospace; }
.ic { flex: none; font-size: 15px; }
.x { color: var(--tx6); font-size: 14px; flex: none; padding: 0 2px; line-height: 1; opacity: 0; pointer-events: none; transition: opacity .12s; }
.row:hover .x, .mrow:hover .x { opacity: 1; pointer-events: auto; }
.x:hover { color: var(--err); }
.empty { color: var(--tx6); padding: 16px 12px; font-size: 12px; }
.mrow { display: flex; align-items: flex-start; gap: 8px; width: 100%; background: none; border: none; border-bottom: 1px solid var(--bd2); text-align: left; padding: 8px 10px; cursor: pointer; }
.mbody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.mtext { color: var(--tx1); font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.mmeta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mtab { display: inline-block; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ac2); background: color-mix(in srgb, var(--ac2) 14%, transparent); border-radius: 8px; padding: 0 8px; font-size: 10px; line-height: 16px; }
.more { color: var(--tx5); font-size: 11px; text-align: center; padding: 10px; }
.foot { color: var(--tx6); font-size: 11px; text-align: center; padding: 10px; }
.row:hover, .mrow:hover { background: var(--bg3); }
.d-0 { background: transparent; }
.d-1 { background: color-mix(in srgb, var(--ac) 6%, transparent); }
.d-2 { background: color-mix(in srgb, var(--bg4) 70%, transparent); }
.d-3 { background: color-mix(in srgb, var(--ac2) 6%, transparent); }
.tgroup { border-bottom: 1px solid var(--bd2); }
.tnode { display: flex; align-items: center; gap: 6px; width: 100%; background: none; border: none; text-align: left; padding: 6px 10px; cursor: pointer; }
.tnode:hover { background: var(--bg3); }
.tcaret { color: var(--tx5); font-size: 10px; width: 10px; flex: none; }
.tdot { width: 7px; height: 7px; border-radius: 50%; background: var(--tx6); flex: none; }
.tdot.live { background: var(--ac2); }
.tname { flex: 1; min-width: 0; color: var(--tx1); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tcount { color: var(--tx6); font-size: 10px; flex: none; }
.topen { flex: none; color: var(--tx5); border: 1px solid var(--bd); border-radius: 4px; padding: 0 8px; font-size: 11px; line-height: 16px; }
.topen:hover { color: var(--ac2); border-color: var(--ac2); }
</style>
