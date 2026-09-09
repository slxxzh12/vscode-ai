<script setup lang="ts">
import { computed } from 'vue';

export interface HistoryEntry { projectId: string; path: string; name: string; projName: string; ts: number; }
const props = defineProps<{ items: HistoryEntry[] }>();
const emit = defineEmits<{
  (e: 'open', it: HistoryEntry): void;
  (e: 'remove', projectId: string, path: string): void;
  (e: 'clear'): void;
}>();
const grouped = computed(() => {
  const list = [...props.items];
  list.sort((a, b) => b.ts - a.ts);
  const out: { proj: string; recs: HistoryEntry[] }[] = [];
  for (const it of list) {
    let g = out.find((x) => x.proj === it.projName);
    if (!g) { g = { proj: it.projName, recs: [] }; out.push(g); }
    g.recs.push(it);
  }
  return out;
});
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
      <span>🕘 打开历史</span>
      <button v-if="items.length" class="clear" title="清空历史" @click="emit('clear')">清空</button>
    </header>
    <div v-if="items.length === 0" class="empty">还没有打开过文件，从「目录」点开文件会记录在这里</div>
    <div v-for="g in grouped" :key="g.proj" class="grp">
      <div class="gname">{{ g.proj }}</div>
      <button v-for="r in g.recs" :key="r.projectId + '|' + r.path" class="row" @click="emit('open', r)">
        <span class="ic">📄</span>
        <span class="tx">
          <span class="nm">{{ r.name }}</span>
          <span class="sub">{{ r.path }}</span>
        </span>
        <span class="ts">{{ fmtTime(r.ts) }}</span>
        <span class="x" title="移出历史" @click.stop="emit('remove', r.projectId, r.path)">×</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.hl { display: flex; flex-direction: column; height: 100%; }
.hh { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; color: var(--tx1); font-weight: 700; font-size: 13px; border-bottom: 1px solid var(--bd2); flex: none; }
.clear { background: none; border: 1px solid var(--bd); color: var(--tx3); border-radius: 4px; padding: 1px 8px; font-size: 11px; cursor: pointer; }
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
</style>
