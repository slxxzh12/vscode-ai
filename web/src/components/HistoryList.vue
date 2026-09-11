<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { HistoryMessage } from '../useMessageHistory';

export interface HistoryEntry { projectId: string; path: string; name: string; projName: string; ts: number; }
const props = defineProps<{ items: HistoryEntry[]; tab: 'files' | 'messages'; messages: HistoryMessage[] }>();
const emit = defineEmits<{
  (e: 'update:tab', tab: 'files' | 'messages'): void;
  (e: 'open', it: HistoryEntry): void;
  (e: 'remove', projectId: string, path: string): void;
  (e: 'clear'): void;
  (e: 'open-message', text: string): void;
  (e: 'remove-message', msg: HistoryMessage): void;
  (e: 'clear-messages'): void;
}>();

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
  : msgLimit.value < filteredMessages.value.length);
const searching = computed(() => query.value.trim().length > 0);
const noMatch = computed(() => {
  const total = props.tab === 'files' ? props.items.length : props.messages.length;
  const shown = props.tab === 'files' ? filteredItems.value.length : filteredMessages.value.length;
  return searching.value && total > 0 && shown === 0;
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
function fmtTime(ts: number) {
  const d = new Date(ts); const now = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// 下面显示的访问时间（日期 + 时分）
function fmtBelow(ts: number) {
  if (!ts) return '';
  const d = new Date(ts); const p = (x: number) => String(x).padStart(2, '0');
  return `${fmtDay(ts)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// 同一天同一背景色（按日期散列到 4 个淡色）
function dayClass(ts: number) {
  if (!ts) return '';
  const key = fmtDay(ts);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `d-${h % 4}`;
}
</script>

<template>
  <div class="hl">
    <header class="hh">
      <div class="tabs">
        <button class="tabbtn" :class="{ on: tab === 'messages' }" @click="emit('update:tab', 'messages')">{{ $t('hist.tab.messages') }}</button>
        <button class="tabbtn" :class="{ on: tab === 'files' }" @click="emit('update:tab', 'files')">{{ $t('hist.tab.files') }}</button>
      </div>
      <button v-if="tab === 'files' && items.length" class="clear" :title="$t('hist.clear_files')" @click="emit('clear')">{{ $t('hist.clear') }}</button>
      <button v-else-if="tab === 'messages' && messages.length" class="clear" :title="$t('hist.clear_messages')" @click="emit('clear-messages')">{{ $t('hist.clear') }}</button>
    </header>
    <div class="searchbar">
      <input v-model="query" class="searchinput" type="search" :placeholder="$t('hist.search')" spellcheck="false" />
    </div>

    <div class="list" @scroll.passive="onScroll">
      <template v-if="tab === 'files'">
        <div v-if="items.length === 0" class="empty">{{ $t('hist.empty_files') }}</div>
        <div v-else-if="noMatch" class="empty">{{ $t('hist.no_match') }}</div>
        <div v-for="g in grouped" :key="g.proj" class="grp">
          <div class="gname">{{ g.proj }}</div>
          <button v-for="r in g.recs" :key="r.projectId + '|' + r.path" class="row" :class="dayClass(r.ts)" @click="emit('open', r)">
            <span class="ic">📄</span>
            <span class="tx">
              <span class="nm">{{ r.name }}</span>
              <span class="sub">{{ r.path }}</span>
              <span v-if="r.ts" class="mdate">{{ fmtBelow(r.ts) }}</span>
            </span>
            <span class="x" :title="$t('hist.remove')" @click.stop="emit('remove', r.projectId, r.path)">×</span>
          </button>
        </div>
      </template>

      <template v-else>
        <div v-if="messages.length === 0" class="empty">{{ $t('hist.empty_messages') }}</div>
        <div v-else-if="noMatch" class="empty">{{ $t('hist.no_match') }}</div>
        <button v-for="(m, i) in shownMessages" :key="i" class="mrow" :class="dayClass(m.ts)" :title="m.text" @click="emit('open-message', m.text)">
          <span class="ic">💬</span>
          <span class="mbody">
            <span class="mtext">{{ m.text }}</span>
            <span v-if="m.ts" class="mdate">{{ fmtBelow(m.ts) }}</span>
          </span>
          <span class="x" :title="$t('hist.remove_message')" @click.stop="emit('remove-message', m)">×</span>
        </button>
      </template>

      <div v-if="hasMore" class="more">{{ $t('hist.more') }}</div>
      <div v-else-if="(tab === 'files' ? filteredItems.length : filteredMessages.length) > 0" class="foot">{{ $t('hist.foot') }}</div>
    </div>
  </div>
</template>

<style scoped>
.hl { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.hh { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid var(--bd2); flex: none; gap: 6px; }
.tabs { display: flex; gap: 4px; }
.tabbtn { background: none; border: none; border-bottom: 2px solid transparent; color: var(--tx3); padding: 3px 8px; cursor: pointer; font-size: 12px; }
.tabbtn:hover { color: var(--tx1); }
.tabbtn.on { color: var(--ac2); border-bottom-color: var(--ac2); font-weight: 700; }
.clear { background: none; border: 1px solid var(--bd); color: var(--tx3); border-radius: 4px; padding: 1px 8px; font-size: 11px; cursor: pointer; }
.searchbar { flex: none; padding: 6px 10px; border-bottom: 1px solid var(--bd2); }
.searchinput { width: 100%; box-sizing: border-box; background: var(--bg3); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 8px; font-size: 12px; font-family: inherit; }
.searchinput:focus { outline: none; border-color: var(--ac2); }
.list { flex: 1; min-height: 0; overflow-y: auto; }
.grp { flex: none; }
.gname { color: var(--ac2); font-size: 11px; text-transform: uppercase; padding: 10px 10px 2px; }
.row { display: flex; align-items: flex-start; gap: 8px; width: 100%; background: none; border: none; text-align: left; padding: 6px 8px; cursor: pointer; }
.tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.nm { color: var(--tx1); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { color: var(--tx6); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: Consolas, monospace; }
.mdate { color: var(--tx6); font-size: 10px; font-family: Consolas, monospace; }
.ic { flex: none; font-size: 15px; }
.x { color: var(--tx6); font-size: 14px; flex: none; padding: 0 2px; line-height: 1; }
.x:hover { color: var(--err); }
.empty { color: var(--tx6); padding: 16px 12px; font-size: 12px; }
.mrow { display: flex; align-items: flex-start; gap: 8px; width: 100%; background: none; border: none; border-bottom: 1px solid var(--bd2); text-align: left; padding: 8px 10px; cursor: pointer; }
.mbody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.mtext { color: var(--tx1); font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.more { color: var(--tx5); font-size: 11px; text-align: center; padding: 10px; }
.foot { color: var(--tx6); font-size: 11px; text-align: center; padding: 10px; }
.row:hover, .mrow:hover { background: var(--bg3); }
.d-0 { background: transparent; }
.d-1 { background: color-mix(in srgb, var(--ac) 6%, transparent); }
.d-2 { background: color-mix(in srgb, var(--bg4) 70%, transparent); }
.d-3 { background: color-mix(in srgb, var(--ac2) 6%, transparent); }
</style>
