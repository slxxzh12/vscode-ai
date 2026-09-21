<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { TreeSource, SearchResult, SearchHit } from '../tree/treeSource';

// 项目文件搜索弹窗：一个输入框同时搜文件名与内容；内容命中按文件分组。
const props = defineProps<{ source: TreeSource }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const open = ref(true);                 // 组件被挂载即打开
const query = ref('');
const caseSensitive = ref(false);
const loading = ref(false);
const error = ref('');
const result = ref<SearchResult | null>(null);
const collapsed = ref<Set<string>>(new Set());
let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

const keyword = computed(() => query.value.trim());
const searched = computed(() => keyword.value.length > 0);
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
  if (!q || !props.source.search) { result.value = null; loading.value = false; error.value = ''; return; }
  loading.value = true;
  error.value = '';
  try {
    const r = await props.source.search(q, { caseSensitive: caseSensitive.value });
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
watch(caseSensitive, () => { if (searched.value) void run(); });

function toggle(path: string) {
  const s = new Set(collapsed.value);
  if (s.has(path)) s.delete(path); else s.add(path);
  collapsed.value = s;
}
function pick(hit: SearchHit) {
  props.source.openHit?.(hit);
  open.value = false;
}
// 命中关键词分段，供模板高亮
function segments(text: string): { text: string; hit: boolean }[] {
  const kw = keyword.value;
  if (!kw) return [{ text, hit: false }];
  const hay = caseSensitive.value ? text : text.toLowerCase();
  const needle = caseSensitive.value ? kw : kw.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    if (i > from) out.push({ text: text.slice(from, i), hit: false });
    out.push({ text: text.slice(i, i + needle.length), hit: true });
    from = i + needle.length;
    if (!needle.length) break;
  }
  if (from < text.length) out.push({ text: text.slice(from), hit: false });
  return out;
}
</script>

<template>
  <el-dialog v-model="open" :title="$t('search.title')" width="720px" append-to-body class="fsdlg" @closed="emit('close')">
    <div class="sbar">
      <input v-model="query" class="sinput" type="search" :placeholder="$t('search.placeholder')" spellcheck="false" @keydown.enter="run" />
      <label class="scase" :title="$t('search.case')"><input v-model="caseSensitive" type="checkbox" /><span>{{ $t('search.case') }}</span></label>
    </div>
    <div class="sbody">
      <div v-if="!searched" class="shint">{{ $t('search.hint') }}</div>
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
  </el-dialog>
</template>

<style scoped>
.fsdlg :deep(.el-dialog__body) { padding-top: 8px; }
.sbar { display: flex; align-items: center; gap: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--bd2); }
.sinput { flex: 1; min-width: 0; box-sizing: border-box; background: var(--bg3); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 10px; font-size: 13px; font-family: inherit; }
.sinput:focus { outline: none; border-color: var(--ac2); }
.scase { display: inline-flex; align-items: center; gap: 4px; color: var(--tx3); font-size: 12px; white-space: nowrap; cursor: pointer; }
.sbody { max-height: 60vh; overflow-y: auto; padding-top: 6px; }
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
