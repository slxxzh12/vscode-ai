<script setup lang="ts">
import { computed, ref, watch } from 'vue';

export interface HistoryEntry { projectId: string; path: string; name: string; projName: string; ts: number; }
const props = defineProps<{ items: HistoryEntry[]; tab: 'files' | 'messages'; messages: string[] }>();
const emit = defineEmits<{
  (e: 'update:tab', tab: 'files' | 'messages'): void;
  (e: 'open', it: HistoryEntry): void;
  (e: 'remove', projectId: string, path: string): void;
  (e: 'clear'): void;
  (e: 'open-message', text: string): void;
  (e: 'clear-messages'): void;
}>();

// 每次最多展示 50 条，滚动到底部再加载下一批
const PAGE = 50;
const fileLimit = ref(PAGE);
const msgLimit = ref(PAGE);
watch(() => props.tab, () => { fileLimit.value = PAGE; msgLimit.value = PAGE; });

const sortedItems = computed(() => [...props.items].sort((a, b) => b.ts - a.ts));
const shownItems = computed(() => sortedItems.value.slice(0, fileLimit.value));
const shownMessages = computed(() => props.messages.slice(0, msgLimit.value));
const hasMore = computed(() => props.tab === 'files'
  ? fileLimit.value < sortedItems.value.length
  : msgLimit.value < props.messages.length);

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
    if (fileLimit.value < sortedItems.value.length) fileLimit.value += PAGE;
  } else if (msgLimit.value < props.messages.length) {
    msgLimit.value += PAGE;
  }
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
</script>

<template>
  <div class="hl">
    <header class="hh">
      <div class="tabs">
        <button class="tabbtn" :class="{ on: tab === 'files' }" @click="emit('update:tab', 'files')">{{ $t('hist.tab.files') }}</button>
        <button class="tabbtn" :class="{ on: tab === 'messages' }" @click="emit('update:tab', 'messages')">{{ $t('hist.tab.messages') }}</button>
      </div>
      <button v-if="tab === 'files' && items.length" class="clear" :title="$t('hist.clear_files')" @click="emit('clear')">{{ $t('hist.clear') }}</button>
      <button v-else-if="tab === 'messages' && messages.length" class="clear" :title="$t('hist.clear_messages')" @click="emit('clear-messages')">{{ $t('hist.clear') }}</button>
    </header>

    <div class="list" @scroll.passive="onScroll">
      <template v-if="tab === 'files'">
        <div v-if="items.length === 0" class="empty">{{ $t('hist.empty_files') }}</div>
        <div v-for="g in grouped" :key="g.proj" class="grp">
          <div class="gname">{{ g.proj }}</div>
          <button v-for="r in g.recs" :key="r.projectId + '|' + r.path" class="row" @click="emit('open', r)">
            <span class="ic">📄</span>
            <span class="tx">
              <span class="nm">{{ r.name }}</span>
              <span class="sub">{{ r.path }}</span>
            </span>
            <span class="ts">{{ fmtTime(r.ts) }}</span>
            <span class="x" :title="$t('hist.remove')" @click.stop="emit('remove', r.projectId, r.path)">×</span>
          </button>
        </div>
      </template>

      <template v-else>
        <div v-if="messages.length === 0" class="empty">{{ $t('hist.empty_messages') }}</div>
        <button v-for="(m, i) in shownMessages" :key="i" class="mrow" :title="m" @click="emit('open-message', m)">
          <span class="ic">💬</span>
          <span class="mtext">{{ m }}</span>
        </button>
      </template>

      <div v-if="hasMore" class="more">{{ $t('hist.more') }}</div>
      <div v-else-if="(tab === 'files' ? items.length : messages.length) > 0" class="foot">{{ $t('hist.foot') }}</div>
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
.list { flex: 1; min-height: 0; overflow-y: auto; }
.grp { flex: none; }
.gname { color: var(--ac2); font-size: 11px; text-transform: uppercase; padding: 10px 10px 2px; }
.row { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; text-align: left; padding: 6px 8px; cursor: pointer; }
.row:hover { background: var(--bg3); }
.ic { flex: none; font-size: 15px; }
.tx { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.nm { color: var(--tx1); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { color: var(--tx6); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: Consolas, monospace; }
.ts { color: var(--tx6); font-size: 10px; flex: none; }
.x { color: var(--tx6); font-size: 14px; flex: none; padding: 0 2px; }
.x:hover { color: var(--err); }
.empty { color: var(--tx6); padding: 16px 12px; font-size: 12px; }
.mrow { display: flex; align-items: flex-start; gap: 8px; width: 100%; background: none; border: none; border-bottom: 1px solid var(--bd2); text-align: left; padding: 8px 10px; cursor: pointer; }
.mrow:hover { background: var(--bg3); }
.mtext { flex: 1; min-width: 0; color: var(--tx1); font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.more { color: var(--tx5); font-size: 11px; text-align: center; padding: 10px; }
.foot { color: var(--tx6); font-size: 11px; text-align: center; padding: 10px; }
</style>
