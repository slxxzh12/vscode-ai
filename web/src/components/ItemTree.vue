<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '../i18n';
import type { FileTreeActionResult, FileItem, FileTreeActions } from '../fileTree';

const props = defineProps<{
  folders: string[];
  items: FileItem[];
  activeFolder: string;
  activeId: string;
  actions: FileTreeActions;
  storageKey: string;
  statuses?: Record<string, 'pass' | 'fail'>;
  showRun?: boolean;
}>();
const emit = defineEmits<{
  (e: 'select-folder', path: string): void;
  (e: 'select-item', item: FileItem): void;
  (e: 'run-folder', path: string): void;
  (e: 'run-item', item: FileItem): void;
}>();

type EditingMeta =
  | { kind: 'new'; parent: string }
  | { kind: 'folder'; path: string }
  | { kind: 'item'; id: string };

type Row =
  | { kind: 'folder'; key: string; path: string; name: string; depth: number; expanded: boolean }
  | { kind: 'item'; key: string; item: FileItem; depth: number }
  | { kind: 'editor'; key: string; depth: number };

type Menu =
  | { kind: 'folder'; path: string; x: number; y: number }
  | { kind: 'item'; item: FileItem; x: number; y: number };

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(props.storageKey);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set(); }
}

const collapsed = ref<Set<string>>(readCollapsed());
const editing = ref<EditingMeta | null>(null);
const draft = ref('');
const editError = ref('');
const menu = ref<Menu | null>(null);
const dragId = ref('');

function persistCollapsed() {
  try { localStorage.setItem(props.storageKey, JSON.stringify([...collapsed.value])); } catch { /* ignore */ }
}
function toggle(path: string) {
  const next = new Set(collapsed.value);
  if (next.has(path)) next.delete(path); else next.add(path);
  collapsed.value = next;
  persistCollapsed();
}
watch(() => props.storageKey, () => { collapsed.value = readCollapsed(); });
watch(() => props.folders, (list) => {
  const valid = new Set(list);
  let changed = false;
  const next = new Set<string>();
  for (const p of collapsed.value) { if (valid.has(p)) next.add(p); else changed = true; }
  if (changed) { collapsed.value = next; persistCollapsed(); }
});

const rows = computed<Row[]>(() => {
  const byFolder = new Map<string, FileItem[]>();
  for (const r of props.items) {
    const f = r.folder || '';
    const arr = byFolder.get(f);
    if (arr) arr.push(r); else byFolder.set(f, [r]);
  }
  const children = new Map<string, string[]>();
  for (const f of props.folders) {
    const parent = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    const arr = children.get(parent);
    if (arr) arr.push(f); else children.set(parent, [f]);
  }
  for (const arr of children.values()) arr.sort();
  const out: Row[] = [];
  const ed = editing.value;
  const walk = (parent: string, depth: number) => {
    if (ed && ed.kind === 'new' && ed.parent === parent) out.push({ kind: 'editor', key: 'editor', depth });
    for (const f of children.get(parent) || []) {
      const expanded = !collapsed.value.has(f) || (!!ed && ed.kind === 'new' && ed.parent === f);
      out.push({ kind: 'folder', key: `d:${f}`, path: f, name: f.slice(f.lastIndexOf('/') + 1), depth, expanded });
      if (expanded) walk(f, depth + 1);
    }
    for (const r of byFolder.get(parent) || []) out.push({ kind: 'item', key: `i:${r.id}`, item: r, depth });
  };
  walk('', 0);
  return out;
});

function isFolderEditing(path: string) { const ed = editing.value; return !!ed && ed.kind === 'folder' && ed.path === path; }
function isItemEditing(id: string) { const ed = editing.value; return !!ed && ed.kind === 'item' && ed.id === id; }
function itemLabel(item: FileItem) { return (item.label && item.label.trim()) || item.name; }
function itemStatus(id: string) { return props.statuses?.[id] || ''; }
function fmtTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function selectFolder(path: string) { emit('select-folder', path); }
function selectItem(item: FileItem) { emit('select-item', item); }
function runFolder(path: string) { menu.value = null; emit('run-folder', path); }
function runItem(item: FileItem) { menu.value = null; emit('run-item', item); }

function startNew(parent: string) { menu.value = null; editing.value = { kind: 'new', parent }; draft.value = ''; editError.value = ''; }
function startRenameFolder(path: string) { menu.value = null; editing.value = { kind: 'folder', path }; draft.value = path.slice(path.lastIndexOf('/') + 1); editError.value = ''; }
function startRenameItem(item: FileItem) { menu.value = null; editing.value = { kind: 'item', id: item.id }; draft.value = item.label || item.name; editError.value = ''; }
function cancelEdit() { editing.value = null; draft.value = ''; editError.value = ''; }

async function commitEdit() {
  const ed = editing.value;
  if (!ed) return;
  const name = draft.value.trim();
  let res: FileTreeActionResult;
  if (ed.kind === 'new') {
    if (!name) { cancelEdit(); return; }
    res = await props.actions.createFolder(ed.parent, name);
  } else if (ed.kind === 'folder') {
    if (!name) { cancelEdit(); return; }
    res = await props.actions.renameFolder(ed.path, name);
  } else {
    res = await props.actions.renameItem(ed.id, name);
  }
  if (res.ok) cancelEdit();
  else editError.value = res.error === 'exists' ? t('tree.exists') : t('tree.rename_failed');
}

async function removeFolder(path: string) { menu.value = null; await props.actions.removeFolder(path); }
async function removeItem(id: string) { menu.value = null; await props.actions.removeItem(id); }

function openMenuFolder(e: MouseEvent, path: string) { menu.value = { kind: 'folder', path, x: e.clientX, y: e.clientY }; }
function openMenuItem(e: MouseEvent, item: FileItem) { menu.value = { kind: 'item', item, x: e.clientX, y: e.clientY }; }
function onContextMenu(e: MouseEvent, row: Row) {
  if (row.kind === 'folder') openMenuFolder(e, row.path);
  else if (row.kind === 'item') openMenuItem(e, row.item);
}
function closeMenu() { menu.value = null; }
function menuNew() { const m = menu.value; if (m && m.kind === 'folder') startNew(m.path); }
function menuRename() {
  const m = menu.value;
  if (!m) return;
  if (m.kind === 'folder' && m.path) startRenameFolder(m.path);
  else if (m.kind === 'item') startRenameItem(m.item);
}
function menuDelete() {
  const m = menu.value;
  if (!m) return;
  if (m.kind === 'folder' && m.path) void removeFolder(m.path);
  else if (m.kind === 'item') void removeItem(m.item.id);
}

function onDragStart(row: Row) { if (row.kind === 'item') dragId.value = row.item.id; }
function onDrop(folder: string) {
  const id = dragId.value;
  dragId.value = '';
  if (!id) return;
  const item = props.items.find((r) => r.id === id);
  if (!item || (item.folder || '') === folder) return;
  void props.actions.moveItem(id, folder);
}
function onDropRow(row: Row) {
  if (row.kind === 'folder') onDrop(row.path);
  else if (row.kind === 'item') onDrop(row.item.folder || '');
}

function onDocClick(e: MouseEvent) {
  closeMenu();
  if (!editing.value) return;
  const target = e.target as HTMLElement | null;
  if (target && target.closest('.ftedit')) return;
  if (editError.value) { cancelEdit(); return; }
  void commitEdit();
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { closeMenu(); if (editing.value) cancelEdit(); }
}
onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="fttree">
    <div class="ftroot" :class="{ on: activeFolder === '' }"
         @click="selectFolder('')" @contextmenu.prevent="openMenuFolder($event, '')"
         @dragover.prevent @drop.prevent="onDrop('')">
      <span class="ftchev invisible">▸</span>
      <span class="fticon">🏠</span>
      <span class="ftname">{{ $t('tree.root') }}</span>
      <span class="ftacts">
        <button v-if="showRun" class="ftact ftexec" :title="$t('tree.run_folder')" @click.stop="runFolder('')">▶</button>
        <button class="ftact ftnew" :title="$t('tree.new_folder')" @click.stop="startNew('')">＋</button>
      </span>
    </div>

    <div v-if="!rows.length" class="ftempty">{{ $t('tree.empty') }}</div>
    <ul v-else class="ftlist" @dragover.prevent @drop.prevent="onDrop('')">
      <li v-for="row in rows" :key="row.key" class="ftrow"
          :class="[row.kind, { on: row.kind === 'folder' ? activeFolder === row.path : (row.kind === 'item' && activeId === row.item.id) }]"
          :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
          :draggable="row.kind === 'item' ? 'true' : 'false'"
          @dragstart="onDragStart(row)"
          @contextmenu.prevent="onContextMenu($event, row)"
          @drop.stop.prevent="onDropRow(row)">
        <template v-if="row.kind === 'editor'">
          <span class="ftchev invisible">▸</span>
          <span class="fticon">📁</span>
          <input class="ftedit" v-model="draft" :placeholder="$t('tree.rename_ph')"
                 @click.stop @keydown.enter.stop.prevent="commitEdit" @keydown.esc.stop.prevent="cancelEdit" />
          <button class="ftact" :title="$t('tree.cancel')" @click.stop="cancelEdit">×</button>
          <span v-if="editError" class="fterr">{{ editError }}</span>
        </template>

        <template v-else-if="row.kind === 'folder'">
          <span class="ftchev" :class="{ collapsed: !row.expanded }" @click.stop="toggle(row.path)">▸</span>
          <span class="fticon">📁</span>
          <template v-if="isFolderEditing(row.path)">
            <input class="ftedit" v-model="draft"
                   @click.stop @keydown.enter.stop.prevent="commitEdit" @keydown.esc.stop.prevent="cancelEdit" />
            <button class="ftact" :title="$t('tree.cancel')" @click.stop="cancelEdit">×</button>
          </template>
          <template v-else>
            <span class="ftname" @click="selectFolder(row.path)" @dblclick="toggle(row.path)">{{ row.name }}</span>
            <span class="ftacts">
              <button v-if="showRun" class="ftact ftexec" :title="$t('tree.run_folder')" @click.stop="runFolder(row.path)">▶</button>
              <button class="ftact ftnew" :title="$t('tree.new_subfolder')" @click.stop="startNew(row.path)">＋</button>
              <button class="ftact ftrename" :title="$t('tree.rename')" @click.stop="startRenameFolder(row.path)">✎</button>
              <button class="ftact ftdel" :title="$t('tree.delete')" @click.stop="removeFolder(row.path)">×</button>
            </span>
          </template>
          <span v-if="isFolderEditing(row.path) && editError" class="fterr">{{ editError }}</span>
        </template>

        <template v-else>
          <span class="ftstatus" :class="itemStatus(row.item.id)" />
          <span class="ftchev invisible">▸</span>
          <span class="fticon">📄</span>
          <template v-if="isItemEditing(row.item.id)">
            <input class="ftedit" v-model="draft"
                   @click.stop @keydown.enter.stop.prevent="commitEdit" @keydown.esc.stop.prevent="cancelEdit" />
            <button class="ftact" :title="$t('tree.cancel')" @click.stop="cancelEdit">×</button>
          </template>
          <template v-else>
            <span class="ftname" @click="selectItem(row.item)">{{ itemLabel(row.item) }}</span>
            <span class="fttime">{{ fmtTime(row.item.updatedAt) }}</span>
            <span class="ftacts">
              <button v-if="showRun" class="ftact ftexec" :title="$t('tree.run_item')" @click.stop="runItem(row.item)">▶</button>
              <button class="ftact ftrename" :title="$t('tree.rename')" @click.stop="startRenameItem(row.item)">✎</button>
              <button class="ftact ftdel" :title="$t('tree.delete')" @click.stop="removeItem(row.item.id)">×</button>
            </span>
          </template>
          <span v-if="isItemEditing(row.item.id) && editError" class="fterr">{{ editError }}</span>
        </template>
      </li>
    </ul>

    <div v-if="menu" class="ftmenu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop>
      <button v-if="menu.kind === 'folder'" class="ftmenuitem ftmenu-new" @click="menuNew">
        {{ $t(menu.path ? 'tree.new_subfolder' : 'tree.new_folder') }}
      </button>
      <button v-if="menu.kind === 'folder' && menu.path" class="ftmenuitem ftmenu-rename" @click="menuRename">{{ $t('tree.rename') }}</button>
      <button v-if="menu.kind === 'item'" class="ftmenuitem ftmenu-rename" @click="menuRename">{{ $t('tree.rename') }}</button>
      <button v-if="menu.kind === 'item' || (menu.kind === 'folder' && menu.path)" class="ftmenuitem ftmenu-del" @click="menuDelete">{{ $t('tree.delete') }}</button>
    </div>
  </div>
</template>

<style scoped>
.fttree { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
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
.ftexec { font-size: 10px; }
.ftname { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fttime { flex: none; color: var(--tx4); font-size: 11px; }
.ftacts { display: none; flex: none; gap: 2px; }
.ftroot:hover .ftacts, .ftrow:hover .ftacts { display: inline-flex; }
.ftact { border: none; background: none; color: var(--tx4); cursor: pointer; font-size: 12px; line-height: 1; padding: 2px 3px; }
.ftact:hover { color: var(--ac2); }
.ftedit { flex: 1; min-width: 0; background: var(--bg1); color: var(--tx); border: 1px solid var(--ac2); border-radius: 4px; padding: 2px 6px; font-size: 12px; box-sizing: border-box; }
.ftedit:focus { outline: none; }
.fterr { color: #e06c75; font-size: 11px; }
.ftempty { padding: 12px; font-size: 12px; color: var(--tx4); }
.ftmenu { position: fixed; z-index: 4000; background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; padding: 4px; display: flex; flex-direction: column; min-width: 120px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
.ftmenuitem { text-align: left; border: none; background: none; color: var(--tx2); cursor: pointer; font-size: 12px; padding: 6px 10px; border-radius: 4px; }
.ftmenuitem:hover { background: var(--bg4); color: var(--ac2); }
</style>
