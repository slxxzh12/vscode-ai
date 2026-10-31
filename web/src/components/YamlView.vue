<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  parseYamlDoc, serializeYamlDoc, yamlTree, setScalar, addKey, deleteAt, addSeqItem, moveAt,
  type YamlNode,
} from '../yaml';
import { t } from '../i18n';

const props = defineProps<{ text: string }>();
const emit = defineEmits<{ (e: 'update:text', text: string): void }>();

const localText = ref(props.text);
const parsed = computed(() => parseYamlDoc(localText.value));
const error = computed(() => parsed.value.error);
const collapsed = ref<Set<string>>(new Set());

watch(() => props.text, (tx) => { if (tx !== localText.value) localText.value = tx; });

interface FlatNode extends YamlNode { depth: number; }
function pathKey(p: Array<string | number>): string { return p.join('\u0000'); }
function isCollapsed(n: YamlNode): boolean { return collapsed.value.has(pathKey(n.path)); }
function toggle(n: YamlNode) {
  const s = new Set(collapsed.value);
  const k = pathKey(n.path);
  if (s.has(k)) s.delete(k); else s.add(k);
  collapsed.value = s;
}
const flat = computed<FlatNode[]>(() => {
  const out: FlatNode[] = [];
  const walk = (nodes: YamlNode[], depth: number) => {
    for (const n of nodes) {
      out.push({ ...n, depth });
      if (n.children.length && !isCollapsed(n)) walk(n.children, depth + 1);
    }
  };
  const doc = parsed.value.doc;
  if (doc) walk(yamlTree(doc), 0);
  return out;
});

function commit(next: string) {
  localText.value = next;
  emit('update:text', next);
}
function withDoc(fn: (doc: NonNullable<ReturnType<typeof parseYamlDoc>['doc']>) => void) {
  const d = parsed.value.doc;
  if (!d) return;
  fn(d);
  commit(serializeYamlDoc(d));
}
function onScalar(n: YamlNode, val: string) { withDoc((d) => setScalar(d, n.path, val, n.valueType)); }
function onAddChild(n: YamlNode) {
  if (n.kind === 'seq') { withDoc((d) => addSeqItem(d, n.path, '')); return; }
  const key = window.prompt(t('fp.yaml.new_key')) || '';
  if (key) withDoc((d) => addKey(d, n.path, key, ''));
}
function onAddRoot() {
  const key = window.prompt(t('fp.yaml.new_key')) || '';
  if (key) withDoc((d) => addKey(d, [], key, ''));
}
function onDelete(n: YamlNode) { withDoc((d) => deleteAt(d, n.path)); }
function onMove(n: YamlNode, dir: number) {
  const parent = n.path.slice(0, -1);
  const idx = Number(n.path[n.path.length - 1]);
  withDoc((d) => moveAt(d, parent, idx, dir));
}
</script>

<template>
  <div class="yamlview">
    <div v-if="error" class="yverr">{{ $t('fp.yaml.parse_error', { msg: error }) }}</div>
    <template v-else>
      <div class="yvbar"><button class="yvmini" @click="onAddRoot">＋ {{ $t('fp.yaml.add_root') }}</button></div>
      <div class="yvtree">
        <div v-for="n in flat" :key="pathKey(n.path)" class="yvrow" :style="{ paddingLeft: (n.depth * 16 + 6) + 'px' }">
          <span class="yvtog" @click="n.children.length && toggle(n)">{{ n.children.length ? (isCollapsed(n) ? '▸' : '▾') : '' }}</span>
          <span class="yvkey">{{ n.key }}</span>
          <template v-if="n.kind === 'scalar'">
            <input class="yvval" :value="n.value" @change="onScalar(n, ($event.target as HTMLInputElement).value)" />
          </template>
          <template v-else>
            <span class="yvtype">{{ n.kind === 'seq' ? '[ ]' : '{ }' }}</span>
          </template>
          <span class="yvacts">
            <button class="yvmini" @click="onAddChild(n)">＋</button>
            <button v-if="n.kind === 'seq'" class="yvmini" @click="onMove(n, -1)">↑</button>
            <button v-if="n.kind === 'seq'" class="yvmini" @click="onMove(n, 1)">↓</button>
            <button class="yvmini danger" @click="onDelete(n)">×</button>
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.yamlview { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: auto; }
.yvbar { padding: 6px 10px; border-bottom: 1px solid var(--bd); }
.yvtree { padding: 6px 4px; }
.yvrow { display: flex; align-items: center; gap: 6px; padding: 2px 4px; border-radius: 3px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.yvrow:hover { background: var(--bg5); }
.yvtog { width: 12px; flex: none; color: var(--tx3); cursor: pointer; }
.yvkey { color: var(--tx2); }
.yvtype { color: var(--tx3); }
.yvval { background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 3px; padding: 2px 6px; font-size: 12px; font-family: inherit; min-width: 120px; }
.yvacts { margin-left: auto; display: flex; gap: 3px; opacity: 0; }
.yvrow:hover .yvacts { opacity: 1; }
.yvmini { background: var(--bg5); color: var(--tx2); border: 1px solid var(--bd); border-radius: 3px; padding: 1px 6px; font-size: 11px; cursor: pointer; font-family: inherit; }
.yvmini.danger:hover { border-color: var(--err); color: var(--err); }
.yverr { color: var(--err); padding: 12px; font-size: 13px; }
</style>
