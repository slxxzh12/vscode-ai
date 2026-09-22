<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { TreeSource, SearchResult, SearchHit } from '../tree/treeSource';

// 左侧内嵌搜索面板：替换目录树显示，右上角关闭后恢复目录；可勾选按内容/文件名搜索。
const props = defineProps<{ source: TreeSource }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const query = ref('');
const caseSensitive = ref(false);
const byContent = ref(true);   // 默认搜文件内容
const byName = ref(true);      // 默认也搜文件名
const loading = ref(false);
const error = ref('');
const result = ref<SearchResult | null>(null);
const collapsed = ref<Set<string>>(new Set());
let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

const keyword = computed(() => query.value.trim());
const searched = computed(() => keyword.value.length > 0);
const terms = computed(() => keyword.value.split(/\s+/).filter((t) => t.length >= 2));   // 空格分词；单个字母/单字忽略
const anyMode = computed(() => byContent.value || byName.value);
const nameHits = computed(() => result.value?.nameHits ?? []);
const contentHits = computed(() => result.value?.contentHits ?? []);
const contentGroups = computed(() => {
  const map = new Map<string, { path: string; name: string; lines: { line: number; text: string }[] }>();
  for (const h of contentHits.value) {
    let g = map.get(h.path);
    if (!g) { g = { path: h.path, name: h.name, lines: [] }; map.set(h.path, g); }
    g.lines.push({ line: h.line, text: h.text });
  }
  return [...map.values()];
});

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void run(); }, 300);
}
async function run() {
  if (timer) { clearTimeout(timer); timer = null; }
  const q = keyword.value;
  const my = ++seq;
  if (!q || !terms.value.length || !anyMode.value || !props.source.search) { result.value = null; loading.value = false; error.value = ''; return; }
  loading.value = true;
  error.value = '';
  try {
    const r = await props.source.search(q, { caseSensitive: caseSensitive.value, name: byName.value, content: byContent.value });
    if (my !== seq) return;
    result.value = r;
  } catch (e: unknown) {
    if (my !== seq) return;
    error.value = String((e as Error)?.message || e);
    result.value = null;
  } finally {
    if (my === seq) loading.value = false;
  }
}
watch(query, schedule);
watch([caseSensitive, byContent, byName], () => { if (searched.value) void run(); });

function toggle(path: string) {
  const s = new Set(collapsed.value);
  if (s.has(path)) s.delete(path); else s.add(path);
  collapsed.value = s;
}
function pick(hit: SearchHit) {
  props.source.openHit?.(hit);
}
// 命中分词分段（任一分词命中即高亮），供模板高亮
function segments(text: string): { text: string; hit: boolean }[] {
  const ts = terms.value;
  if (!text || !ts.length) return [{ text, hit: false }];
  const hay = caseSensitive.value ? text : text.toLowerCase();
  const mask = new Array<boolean>(text.length).fill(false);
  for (const t of ts) {
    const needle = caseSensitive.value ? t : t.toLowerCase();
    let from = 0;
    for (;;) {
      const i = hay.indexOf(needle, from);
      if (i < 0) break;
      for (let k = i; k < i + needle.length; k++) mask[k] = true;
      from = i + needle.length;
    }
  }
  const out: { text: string; hit: boolean }[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || mask[i] !== mask[start]) { out.push({ text: text.slice(start, i), hit: mask[start] }); start = i; }
  }
  return out;
}
</script>

<template>
  <div class="fsp">
    <div class="fsbar">
      <input v-model="query" class="sinput" type="search" :placeholder="$t('search.placeholder')" spellcheck="false" @keydown.enter="run" />
      <button class="fsclose" :title="$t('search.close')" @click="emit('close')">×</button>
    </div>
    <div class="fsmodes">
      <label class="scase" :title="$t('search.mode.content')"><input data-mode="content" v-model="byContent" type="checkbox" /><span>{{ $t('search.mode.content') }}</span></label>
      <label class="scase" :title="$t('search.mode.name')"><input data-mode="name" v-model="byName" type="checkbox" /><span>{{ $t('search.mode.name') }}</span></label>
      <label class="scase" :title="$t('search.case')"><input data-mode="case" v-model="caseSensitive" type="checkbox" /><span>{{ $t('search.case') }}</span></label>
    </div>
    <div class="sbody">
      <div v-if="!searched" class="shint">{{ $t('search.hint') }}</div>
      <div v-else-if="!terms.length" class="shint">{{ $t('search.too_short') }}</div>
      <div v-else-if="!anyMode" class="shint">{{ $t('search.need_mode') }}</div>
      <div v-else-if="loading" class="shint">{{ $t('search.loading') }}</div>
      <div v-else-if="error" class="serr">{{ $t('search.error', { msg: error }) }}</div>
      <div v-else-if="result && !nameHits.length && !contentHits.length" class="shint">{{ $t('search.empty') }}</div>
      <template v-else-if="result">
        <section v-if="nameHits.length" class="sgroup">
          <div class="sghead">{{ $t('search.name_group') }} <span class="scount">{{ nameHits.length }}</span></div>
          <button v-for="h in nameHits" :key="'n:' + h.path" class="sname-row" :title="$t('search.open_file')" @click="pick({ path: h.path, name: h.name })">
            <span class="sic">📄</span><span class="spath">{{ h.path }}</span>
          </button>
        </section>
        <section v-if="contentHits.length" class="sgroup">
          <div class="sghead">{{ $t('search.content_group') }} <span class="scount">{{ contentHits.length }}</span></div>
          <div v-for="g in contentGroups" :key="'g:' + g.path" class="scgroup">
            <button class="sfilehead" :title="$t('search.open_file')" @click="pick({ path: g.path, name: g.name })">
              <span class="scaret" @click.stop="toggle(g.path)">{{ collapsed.has(g.path) ? '▸' : '▾' }}</span>
              <span class="sic">📄</span>
              <span class="spath">{{ g.path }}</span>
              <span class="scount">{{ $t('search.hits', { n: g.lines.length }) }}</span>
            </button>
            <template v-if="!collapsed.has(g.path)">
              <button v-for="(l, i) in g.lines" :key="i" class="sline" @click="pick({ path: g.path, name: g.name, line: l.line })">
                <span class="sln">{{ l.line }}</span>
                <span class="stext"><span v-for="(s, si) in segments(l.text)" :key="si" :class="{ hit: s.hit }">{{ s.text }}</span></span>
              </button>
            </template>
          </div>
        </section>
        <div class="sfoot">{{ $t('search.scanned', { n: result.scanned }) }}</div>
      </template>
      <div v-if="result && result.truncated" class="strunc">{{ $t('search.truncated') }}</div>
    </div>
  </div>
</template>

<style scoped>
.fsp { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.fsbar { flex: none; display: flex; align-items: center; gap: 8px; padding: 0 6px 6px; }
.sinput { flex: 1; min-width: 0; box-sizing: border-box; background: var(--bg3); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 12px; font-family: inherit; }
.sinput:focus { outline: none; border-color: var(--ac2); }
.fsclose { flex: none; background: none; border: 1px solid transparent; color: var(--tx3); font-size: 14px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
.fsclose:hover { background: var(--bg5); color: var(--tx1); border-color: var(--bd); }
.fsmodes { flex: none; display: flex; align-items: center; gap: 10px; padding: 0 6px 6px; border-bottom: 1px solid var(--bd2); }
.scase { display: inline-flex; align-items: center; gap: 4px; color: var(--tx3); font-size: 12px; white-space: nowrap; cursor: pointer; }
.sbody { flex: 1; min-height: 0; overflow-y: auto; padding-top: 6px; }
.shint, .strunc, .sfoot { color: var(--tx5); font-size: 12px; padding: 10px 2px; }
.serr { color: var(--err); font-size: 12px; padding: 10px 2px; }
.sgroup { margin-bottom: 10px; }
.sghead { color: var(--ac2); font-size: 11px; text-transform: uppercase; padding: 8px 2px 4px; }
.scount { color: var(--tx5); font-size: 11px; margin-left: 6px; }
.sname-row, .sfilehead, .sline { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; text-align: left; padding: 4px 8px; cursor: pointer; border-radius: 4px; color: var(--tx1); font-size: 12px; font-family: ui-monospace, Consolas, monospace; }
.sname-row:hover, .sfilehead:hover, .sline:hover { background: var(--bg3); }
.sic { flex: none; }
.spath { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scaret { flex: none; width: 12px; text-align: center; color: var(--tx4); }
.sline { padding-left: 28px; align-items: flex-start; }
.sln { flex: none; width: 44px; text-align: right; color: var(--tx5); user-select: none; }
.stext { flex: 1; min-width: 0; white-space: pre-wrap; word-break: break-word; }
.stext .hit { background: color-mix(in srgb, var(--ac) 40%, transparent); border-radius: 2px; }
</style>
