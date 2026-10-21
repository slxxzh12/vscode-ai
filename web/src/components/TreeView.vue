<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '../i18n';
import { copyText } from '../clipboard';
import { flattenVisible, type TreeRow, type TreeRowNode } from '../tree/treeRows';
import { fileIcon } from '../tree/fileIcon';
import type { TreeSource, TreeSourceNode } from '../tree/treeSource';
import FileSearchPanel from '../search/FileSearchPanel.vue';

type Internal = TreeRowNode;

const props = withDefaults(defineProps<{
  source: TreeSource;
  title?: string;
  showRoot?: boolean;
  activeKey?: string;
  activeFolder?: string;
  storageKey?: string;
}>(), {
  title: '',
  showRoot: false,
  activeKey: '',
  activeFolder: '',
  storageKey: '',
});
const emit = defineEmits<{ (e: 'update:activeFolder', key: string): void }>();

const nodes = ref<Internal[]>([]);
const collapsed = ref<Set<string>>(readCollapsed());
const searchOpen = ref(false);

function readCollapsed(): Set<string> {
  if (!props.storageKey) return new Set();
  try {
    const raw = localStorage.getItem(props.storageKey);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set(); }
}
function persistCollapsed() {
  if (!props.storageKey) return;
  try { localStorage.setItem(props.storageKey, JSON.stringify([...collapsed.value])); } catch { /* ignore */ }
}

const rows = computed<TreeRow[]>(() => flattenVisible(nodes.value, collapsed.value));

function toInternal(n: TreeSourceNode): Internal {
  return { ...n, children: [], loaded: n.kind !== 'dir', loading: false };
}

async function loadRoot() {
  try {
    nodes.value = (await props.source.loadChildren('')).map(toInternal);
  } catch { nodes.value = []; }
}

async function loadChildren(node: Internal) {
  if (node.loaded || node.loading) return;
  node.loading = true;
  try {
    node.children = (await props.source.loadChildren(node.key)).map(toInternal);
    node.loaded = true;
  } catch { /* 保持空 */ } finally { node.loading = false; }
}

async function refresh() {
  const keep = new Set<string>();
  const walk = (list: Internal[]) => {
    for (const n of list) if (n.kind === 'dir' && n.loaded && !collapsed.value.has(n.key)) { keep.add(n.key); walk(n.children); }
  };
  walk(nodes.value);
  await loadRoot();
  const expand = async (list: Internal[]) => {
    for (const n of list) if (n.kind === 'dir' && keep.has(n.key)) { await loadChildren(n); await expand(n.children); }
  };
  await expand(nodes.value);
}

async function toggle(node: Internal) {
  if (node.kind !== 'dir') return;
  if (!node.loaded) { await loadChildren(node); return; }
  const next = new Set(collapsed.value);
  if (next.has(node.key)) next.delete(node.key); else next.add(node.key);
  collapsed.value = next;
  persistCollapsed();
  if (!next.has(node.key)) await loadChildren(node);
}

function iconOf(node: Internal): string {
  if (node.icon) return node.icon;
  return node.kind === 'dir' ? '📁' : fileIcon(node.name);
}
function isActive(row: TreeRow): boolean {
  return row.node.kind === 'dir' ? row.node.key === props.activeFolder : row.node.key === props.activeKey;
}

function selectRoot() {
  emit('update:activeFolder', '');
}
function onDirName(node: Internal) {
  emit('update:activeFolder', node.key);
  void toggle(node);
}
function onItemName(node: Internal) {
  props.source.open(node);
}
function onRowClick(node: Internal) {
  if (node.kind === 'dir') onDirName(node);
  else onItemName(node);
}

// —— 头部新建 ——
function promptCreate(kind: 'file' | 'folder', dir = props.activeFolder) {
  const fn = kind === 'file' ? props.source.createFile : props.source.createFolder;
  if (!fn) return;
  const label = kind === 'file' ? t('tree.file_name') : t('tree.dir_name');
  const where = dir ? t('tree.in_dir', { dir }) : t('tree.in_root');
  const def = kind === 'file' ? (props.source.defaultName?.() ?? '') : '';
  const name = window.prompt(t('tree.prompt_create', { label, where }), def);
  if (name === null) return;
  const final = name.trim() || def;
  if (!final) return;
  if (/[\\/:*?"<>|]/.test(final)) { alert(t('tree.bad_name')); return; }
  fn.call(props.source, dir, final)
    .then(() => refresh())
    .catch((e: unknown) => alert(t('tree.create_failed', { msg: (e as Error)?.message || String(e) })));
}

// —— 右键菜单 ——
const menu = ref<{ x: number; y: number; node: Internal } | null>(null);
const editing = ref<{ key: string; name: string; error: string } | null>(null);
const draft = ref('');
const dragKey = ref('');

interface MenuItem { key: string; cls: string; label: string; run: () => void; }

function itemsFor(node: Internal): MenuItem[] {
  const src = props.source;
  const out: MenuItem[] = [];
  if (node.kind === 'dir') {
    if (src.createFile) out.push({ key: 'new-file', cls: 'ftmenu-new', label: t('tree.ctx.new_file'), run: () => promptCreate('file', node.key) });
    if (src.createFolder) out.push({ key: 'new-dir', cls: 'ftmenu-new', label: t('tree.ctx.new_dir'), run: () => promptCreate('folder', node.key) });
    if (src.runFolder) out.push({ key: 'run', cls: 'ftmenu-run', label: t('tree.run_folder'), run: () => void src.runFolder!(node.key) });
  } else {
    if (src.run) out.push({ key: 'run', cls: 'ftmenu-run', label: t('tree.run_item'), run: () => void src.run!(node) });
    if (src.detail) out.push({ key: 'detail', cls: 'ftmenu-detail', label: t('tree.detail'), run: () => void src.detail!(node) });
    if (src.copyContent) out.push({ key: 'copy-content', cls: 'ftmenu-copy-content', label: t('tree.copy_content'), run: () => void src.copyContent!(node) });
  }
  if (src.rename) out.push({ key: 'rename', cls: 'ftmenu-rename', label: t('tree.rename'), run: () => startRename(node) });
  if (src.remove) out.push({ key: 'del', cls: 'ftmenu-del', label: t('tree.delete'), run: () => void src.remove!(node) });
  if (src.reveal) out.push({ key: 'reveal', cls: 'ftmenu-reveal', label: t('tree.reveal_os'), run: () => runReveal(node) });
  if (src.copyName) out.push({ key: 'copy-name', cls: 'ftmenu-copy-name', label: node.kind === 'dir' ? t('tree.copy_dir_name') : t('tree.copy_file_name'), run: () => src.copyName!(node) });
  if (src.copyPath) out.push({ key: 'copy-path', cls: 'ftmenu-copy-path', label: t('tree.copy_path'), run: () => src.copyPath!(node) });
  return out;
}
const menuItems = computed<MenuItem[]>(() => (menu.value ? itemsFor(menu.value.node) : []));

function openMenu(e: MouseEvent, node: Internal) {
  e.preventDefault();
  menu.value = itemsFor(node).length ? { x: e.clientX, y: e.clientY, node } : null;
}
function runMenuItem(it: MenuItem) { menu.value = null; it.run(); }
function runReveal(node: Internal) {
  Promise.resolve(props.source.reveal!(node))
    .catch((e: unknown) => alert(t('tree.reveal_failed', { msg: (e as Error)?.message || String(e) })));
}
function startRename(node: Internal) {
  menu.value = null;
  editing.value = { key: node.key, name: node.name, error: '' };
  draft.value = node.name;
}
function cancelEdit() { editing.value = null; draft.value = ''; }
async function commitEdit(node: Internal) {
  const name = draft.value.trim();
  if (!name || !props.source.rename) { cancelEdit(); return; }
  try {
    await props.source.rename(node, name);
    cancelEdit();
    await refresh();
  } catch (e) {
    const msg = (e as Error)?.message || '';
    editing.value = { key: node.key, name: node.name, error: msg.includes('exists') ? t('tree.exists') : t('tree.rename_failed') };
  }
}

function onDragStart(row: TreeRow) {
  if (row.node.kind === 'item' && props.source.move) dragKey.value = row.node.key;
}
function onDrop(dirKey: string) {
  const key = dragKey.value;
  dragKey.value = '';
  if (!key || !props.source.move) return;
  const node = findNode(key);
  if (!node || node.key === dirKey) return;
  void props.source.move(node, dirKey);
}
function onDropRow(row: TreeRow) {
  if (row.node.kind === 'dir') onDrop(row.node.key);
  else onDrop('');   // 落到文件上 = 移回根
}
function findNode(key: string): Internal | null {
  let hit: Internal | null = null;
  const walk = (list: Internal[]) => { for (const n of list) { if (n.key === key) hit = n; else if (n.children.length) walk(n.children); } };
  walk(nodes.value);
  return hit;
}

function onDocClick(e: MouseEvent) {
  menu.value = null;
  if (!editing.value) return;
  const target = e.target as HTMLElement | null;
  if (target && target.closest('.ftedit')) return;
  const node = findNode(editing.value.key);
  if (node) void commitEdit(node);
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { menu.value = null; if (editing.value) cancelEdit(); }
}

watch(() => props.source, () => { void loadRoot(); }, { immediate: true });
function onRefreshTree() { void refresh(); }
onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('df-refresh-tree', onRefreshTree);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('df-refresh-tree', onRefreshTree);
});

defineExpose({ refresh });
</script>

<template>
  <div class="ftv" @click.self="selectRoot">
    <FileSearchPanel v-if="searchOpen" :source="source" @close="searchOpen = false" />
    <template v-else>
    <div v-if="title" class="fthead">
      <span class="fttitle">{{ title }}</span>
      <div class="ftacts">
        <button class="ftic" :title="$t('tree.refresh')" @click="refresh">⟳</button>
        <button v-if="source.createFile" class="ftic" :title="$t('tree.new_file')" @click.stop="promptCreate('file')">📄＋</button>
        <button v-if="source.createFolder" class="ftic" :title="$t('tree.new_dir')" @click.stop="promptCreate('folder')">📁＋</button>
        <button v-if="source.search" class="ftic ftsearch" :title="$t('search.title')" @click.stop="searchOpen = true">🔍</button>
      </div>
    </div>

    <div v-if="showRoot" class="ftroot" :class="{ on: activeFolder === '' }"
         @click="selectRoot" @dragover.prevent @drop.prevent="onDrop('')">
      <span class="ftchev invisible">▸</span>
      <span class="fticon">🏠</span>
      <span class="ftname">{{ $t('tree.root') }}</span>
    </div>

    <div v-if="!rows.length" class="ftempty">{{ $t('tree.empty') }}</div>
    <ul v-else class="ftlist" @dragover.prevent @drop.prevent="onDrop(activeFolder)">
      <li v-for="row in rows" :key="row.node.key" class="ftrow"
          :class="[row.node.kind, { on: isActive(row) }]"
          :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
          :draggable="row.node.kind === 'item' && !!source.move ? 'true' : 'false'"
          @click="onRowClick(row.node)"
          @dragstart="onDragStart(row)"
          @contextmenu.prevent="openMenu($event, row.node)"
          @drop.stop.prevent="onDropRow(row)">
        <span class="ftchev" :class="{ collapsed: !row.expanded, invisible: row.node.kind !== 'dir' }"
              @click.stop="row.node.kind === 'dir' && toggle(row.node)">▸</span>
        <span class="ftstatus" :class="row.node.status" />
        <span class="fticon">{{ iconOf(row.node) }}</span>
        <template v-if="editing && editing.key === row.node.key">
          <input class="ftedit" v-model="draft"
                 @click.stop @keydown.enter.stop.prevent="commitEdit(row.node)" @keydown.esc.stop.prevent="cancelEdit" />
          <button class="ftact" :title="$t('tree.cancel')" @click.stop="cancelEdit">×</button>
        </template>
        <template v-else>
          <span class="ftname">{{ row.node.name }}</span>
          <span v-if="row.node.time" class="fttime">{{ row.node.time }}</span>
        </template>
        <span v-if="editing && editing.key === row.node.key && editing.error" class="fterr">{{ editing.error }}</span>
      </li>
    </ul>

    <div v-if="menu" class="ftmenu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop>
      <button v-for="it in menuItems" :key="it.key" class="ftmenuitem" :class="it.cls" @click="runMenuItem(it)">{{ it.label }}</button>
    </div>
    </template>
  </div>
</template>

<style scoped>
.ftv { display: flex; flex-direction: column; height: 100%; overflow: hidden; font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; user-select: none; }
.fthead { display: flex; align-items: center; justify-content: space-between; padding: 0 6px 6px; flex: none; }
.fttitle { color: var(--tx3); text-transform: uppercase; font-size: 11px; }
.ftacts { display: flex; gap: 4px; }
.ftic { background: none; border: 1px solid transparent; color: var(--tx3); font-size: 12px; cursor: pointer; padding: 1px 5px; border-radius: 4px; }
.ftic:hover { background: var(--bg5); color: var(--tx1); border-color: var(--bd); }
.ftroot, .ftrow { display: flex; align-items: center; gap: 4px; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 12px; color: var(--tx2); }
.ftroot { flex: none; margin-bottom: 4px; }
.ftroot:hover, .ftrow:hover { background: var(--bg4); }
.ftroot.on, .ftrow.on { background: var(--bg4); color: var(--ac2); }
.ftlist { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.ftchev { flex: none; width: 12px; text-align: center; color: var(--tx4); transition: transform .12s; }
.ftchev.invisible { visibility: hidden; }
.ftchev.collapsed { transform: rotate(-90deg); }
.fticon { flex: none; }
.ftstatus { flex: none; width: 8px; height: 8px; border-radius: 50%; }
.ftstatus.pass { background: #2e7d32; }
.ftstatus.fail { background: #c62828; }
.ftname { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fttime { flex: none; color: var(--tx4); font-size: 11px; }
.ftedit { flex: 1; min-width: 0; background: var(--bg1); color: var(--tx); border: 1px solid var(--ac2); border-radius: 4px; padding: 2px 6px; font-size: 12px; box-sizing: border-box; }
.ftedit:focus { outline: none; }
.ftact { border: none; background: none; color: var(--tx4); cursor: pointer; font-size: 12px; line-height: 1; padding: 2px 3px; }
.ftact:hover { color: var(--ac2); }
.fterr { color: #e06c75; font-size: 11px; }
.ftempty { padding: 12px; font-size: 12px; color: var(--tx4); }
.ftmenu { position: fixed; z-index: 4000; background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; padding: 4px; display: flex; flex-direction: column; min-width: 140px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
.ftmenuitem { text-align: left; border: none; background: none; color: var(--tx2); cursor: pointer; font-size: 12px; padding: 6px 10px; border-radius: 4px; white-space: nowrap; }
.ftmenuitem:hover { background: var(--bg4); color: var(--ac2); }
</style>
