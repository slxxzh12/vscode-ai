<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '../../i18n';
import type { ActionResult, PostmanActions, PostmanRecord } from './usePostmanHistory';

const props = defineProps<{
  folders: string[];
  records: PostmanRecord[];
  activeFolder: string;
  activeId: string;
  actions: PostmanActions;
  statuses?: Record<string, 'pass' | 'fail'>;
}>();
const emit = defineEmits<{
  (e: 'select-folder', path: string): void;
  (e: 'select-record', record: PostmanRecord): void;
  (e: 'run-folder', path: string): void;
  (e: 'run-record', record: PostmanRecord): void;
}>();

type EditingMeta =
  | { kind: 'new'; parent: string }
  | { kind: 'folder'; path: string }
  | { kind: 'record'; id: string };

type Row =
  | { kind: 'folder'; key: string; path: string; name: string; depth: number; expanded: boolean }
  | { kind: 'record'; key: string; record: PostmanRecord; depth: number }
  | { kind: 'editor'; key: string; depth: number };

type Menu =
  | { kind: 'folder'; path: string; x: number; y: number }
  | { kind: 'record'; record: PostmanRecord; x: number; y: number };

const STORE = 'devflow-postman-collapsed';

// 存「折叠」集合：缺省/为空 = 全展开
function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORE);
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
  try { localStorage.setItem(STORE, JSON.stringify([...collapsed.value])); } catch { /* ignore */ }
}
function toggle(path: string) {
  const next = new Set(collapsed.value);
  if (next.has(path)) next.delete(path); else next.add(path);
  collapsed.value = next;
  persistCollapsed();
}

watch(() => props.folders, (list) => {
  const valid = new Set(list);
  let changed = false;
  const next = new Set<string>();
  for (const p of collapsed.value) { if (valid.has(p)) next.add(p); else changed = true; }
  if (changed) { collapsed.value = next; persistCollapsed(); }
});

const rows = computed<Row[]>(() => {
  const byFolder = new Map<string, PostmanRecord[]>();
  for (const r of props.records) {
    const f = r.folder || '';
    const arr = byFolder.get(f);
    if (arr) arr.push(r); else byFolder.set(f, [r]);
  }
  for (const arr of byFolder.values()) arr.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
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
    for (const r of byFolder.get(parent) || []) out.push({ kind: 'record', key: `r:${r.id}`, record: r, depth });
  };
  walk('', 0);
  return out;
});

function isFolderEditing(path: string) { const ed = editing.value; return !!ed && ed.kind === 'folder' && ed.path === path; }
function isRecordEditing(id: string) { const ed = editing.value; return !!ed && ed.kind === 'record' && ed.id === id; }
function recordLabel(rec: PostmanRecord) { return (rec.title && rec.title.trim()) || rec.command; }
function recordStatus(id: string) { return props.statuses?.[id] || ''; }
function fmtTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function selectFolder(path: string) { emit('select-folder', path); }
function selectRecord(rec: PostmanRecord) { emit('select-record', rec); }
function runFolder(path: string) { menu.value = null; emit('run-folder', path); }
function runRecord(rec: PostmanRecord) { menu.value = null; emit('run-record', rec); }

function startNew(parent: string) { menu.value = null; editing.value = { kind: 'new', parent }; draft.value = ''; editError.value = ''; }
function startRenameFolder(path: string) { menu.value = null; editing.value = { kind: 'folder', path }; draft.value = path.slice(path.lastIndexOf('/') + 1); editError.value = ''; }
function startRenameRecord(rec: PostmanRecord) { menu.value = null; editing.value = { kind: 'record', id: rec.id }; draft.value = rec.title || rec.command; editError.value = ''; }
function cancelEdit() { editing.value = null; draft.value = ''; editError.value = ''; }

async function commitEdit() {
  const ed = editing.value;
  if (!ed) return;
  const name = draft.value.trim();
  let res: ActionResult;
  if (ed.kind === 'new') {
    if (!name) { cancelEdit(); return; }
    res = await props.actions.createFolder(ed.parent, name);
  } else if (ed.kind === 'folder') {
    if (!name) { cancelEdit(); return; }
    res = await props.actions.renameFolder(ed.path, name);
  } else {
    res = await props.actions.renameRecord(ed.id, name);
  }
  if (res.ok) cancelEdit();
  else editError.value = res.error === 'exists' ? t('tools.pm_exists') : t('tools.pm_rename_failed');
}

async function removeFolder(path: string) { menu.value = null; await props.actions.removeFolder(path); }
async function removeRecord(id: string) { menu.value = null; await props.actions.removeRecord(id); }

function openMenuFolder(e: MouseEvent, path: string) { menu.value = { kind: 'folder', path, x: e.clientX, y: e.clientY }; }
function openMenuRecord(e: MouseEvent, rec: PostmanRecord) { menu.value = { kind: 'record', record: rec, x: e.clientX, y: e.clientY }; }
function onContextMenu(e: MouseEvent, row: Row) {
  if (row.kind === 'folder') openMenuFolder(e, row.path);
  else if (row.kind === 'record') openMenuRecord(e, row.record);
}
function closeMenu() { menu.value = null; }
function menuNew() { const m = menu.value; if (m && m.kind === 'folder') startNew(m.path); }
function menuRename() {
  const m = menu.value;
  if (!m) return;
  if (m.kind === 'folder' && m.path) startRenameFolder(m.path);
  else if (m.kind === 'record') startRenameRecord(m.record);
}
function menuDelete() {
  const m = menu.value;
  if (!m) return;
  if (m.kind === 'folder' && m.path) void removeFolder(m.path);
  else if (m.kind === 'record') void removeRecord(m.record.id);
}

function onDragStart(row: Row) { if (row.kind === 'record') dragId.value = row.record.id; }
function onDrop(folder: string) {
  const id = dragId.value;
  dragId.value = '';
  if (!id) return;
  const rec = props.records.find((r) => r.id === id);
  if (!rec || (rec.folder || '') === folder) return;
  void props.actions.moveRecord(id, folder);
}
function onDropRow(row: Row) {
  if (row.kind === 'folder') onDrop(row.path);
  else if (row.kind === 'record') onDrop(row.record.folder || '');
}

function onDocClick(e: MouseEvent) {
  closeMenu();
  if (!editing.value) return;
  const target = e.target as HTMLElement | null;
  if (target && target.closest('.pmedit')) return;
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
  <div class="pmtree">
    <div class="pmroot" :class="{ on: activeFolder === '' }"
         @click="selectFolder('')" @contextmenu.prevent="openMenuFolder($event, '')"
         @dragover.prevent @drop.prevent="onDrop('')">
      <span class="pmchev invisible">▸</span>
      <span class="pmicon">🏠</span>
      <span class="pmname">{{ $t('tools.pm_root') }}</span>
      <span class="pmacts">
        <button class="pmact pmexec" :title="$t('tools.pm_run_folder')" @click.stop="runFolder('')">▶</button>
        <button class="pmact pmnew" :title="$t('tools.pm_new_folder')" @click.stop="startNew('')">＋</button>
      </span>
    </div>

    <div v-if="!rows.length" class="pmempty">{{ $t('tools.pm_empty') }}</div>
    <ul v-else class="pmlist" @dragover.prevent @drop.prevent="onDrop('')">
      <li v-for="row in rows" :key="row.key" class="pmrow"
          :class="[row.kind, { on: row.kind === 'folder' ? activeFolder === row.path : (row.kind === 'record' && activeId === row.record.id) }]"
          :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
          :draggable="row.kind === 'record' ? 'true' : 'false'"
          @dragstart="onDragStart(row)"
          @contextmenu.prevent="onContextMenu($event, row)"
          @drop.stop.prevent="onDropRow(row)">
        <template v-if="row.kind === 'editor'">
          <span class="pmchev invisible">▸</span>
          <span class="pmicon">📁</span>
          <input class="pmedit" v-model="draft" :placeholder="$t('tools.pm_rename_ph')"
                 @click.stop @keydown.enter.stop.prevent="commitEdit" @keydown.esc.stop.prevent="cancelEdit" />
          <button class="pmact" :title="$t('tools.pm_cancel')" @click.stop="cancelEdit">×</button>
          <span v-if="editError" class="pmerr">{{ editError }}</span>
        </template>

        <template v-else-if="row.kind === 'folder'">
          <span class="pmchev" :class="{ collapsed: !row.expanded }" @click.stop="toggle(row.path)">▸</span>
          <span class="pmicon">📁</span>
          <template v-if="isFolderEditing(row.path)">
            <input class="pmedit" v-model="draft"
                   @click.stop @keydown.enter.stop.prevent="commitEdit" @keydown.esc.stop.prevent="cancelEdit" />
            <button class="pmact" :title="$t('tools.pm_cancel')" @click.stop="cancelEdit">×</button>
          </template>
          <template v-else>
            <span class="pmname" @click="selectFolder(row.path)" @dblclick="toggle(row.path)">{{ row.name }}</span>
            <span class="pmacts">
              <button class="pmact pmexec" :title="$t('tools.pm_run_folder')" @click.stop="runFolder(row.path)">▶</button>
              <button class="pmact pmnew" :title="$t('tools.pm_new_subfolder')" @click.stop="startNew(row.path)">＋</button>
              <button class="pmact pmrename" :title="$t('tools.pm_rename')" @click.stop="startRenameFolder(row.path)">✎</button>
              <button class="pmact pmdel" :title="$t('tools.pm_delete')" @click.stop="removeFolder(row.path)">×</button>
            </span>
          </template>
          <span v-if="isFolderEditing(row.path) && editError" class="pmerr">{{ editError }}</span>
        </template>

        <template v-else>
          <span class="pmstatus" :class="recordStatus(row.record.id)" />
          <span class="pmchev invisible">▸</span>
          <span class="pmicon">📄</span>
          <template v-if="isRecordEditing(row.record.id)">
            <input class="pmedit" v-model="draft"
                   @click.stop @keydown.enter.stop.prevent="commitEdit" @keydown.esc.stop.prevent="cancelEdit" />
            <button class="pmact" :title="$t('tools.pm_cancel')" @click.stop="cancelEdit">×</button>
          </template>
          <template v-else>
            <span class="pmname" @click="selectRecord(row.record)">{{ recordLabel(row.record) }}</span>
            <span class="pmtime">{{ fmtTime(row.record.updatedAt) }}</span>
            <span class="pmacts">
              <button class="pmact pmexec" :title="$t('tools.pm_run_record')" @click.stop="runRecord(row.record)">▶</button>
              <button class="pmact pmrename" :title="$t('tools.pm_rename')" @click.stop="startRenameRecord(row.record)">✎</button>
              <button class="pmact pmdel" :title="$t('tools.pm_delete')" @click.stop="removeRecord(row.record.id)">×</button>
            </span>
          </template>
          <span v-if="isRecordEditing(row.record.id) && editError" class="pmerr">{{ editError }}</span>
        </template>
      </li>
    </ul>

    <div v-if="menu" class="pmmenu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop>
      <button v-if="menu.kind === 'folder'" class="pmmenuitem pmmenu-new" @click="menuNew">
        {{ $t(menu.path ? 'tools.pm_new_subfolder' : 'tools.pm_new_folder') }}
      </button>
      <button v-if="menu.kind === 'folder' && menu.path" class="pmmenuitem pmmenu-rename" @click="menuRename">{{ $t('tools.pm_rename') }}</button>
      <button v-if="menu.kind === 'record'" class="pmmenuitem pmmenu-rename" @click="menuRename">{{ $t('tools.pm_rename') }}</button>
      <button v-if="menu.kind === 'record' || (menu.kind === 'folder' && menu.path)" class="pmmenuitem pmmenu-del" @click="menuDelete">{{ $t('tools.pm_delete') }}</button>
    </div>
  </div>
</template>

<style scoped>
.pmtree { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.pmroot, .pmrow { display: flex; align-items: center; gap: 4px; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 12px; color: var(--tx2); }
.pmroot { flex: none; margin-bottom: 4px; }
.pmroot:hover, .pmrow:hover { background: var(--bg4); }
.pmroot.on, .pmrow.on { background: var(--bg4); color: var(--ac2); }
.pmlist { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.pmchev { flex: none; width: 12px; text-align: center; color: var(--tx4); transition: transform .12s; }
.pmchev.invisible { visibility: hidden; }
.pmchev.collapsed { transform: rotate(-90deg); }
.pmicon { flex: none; }
.pmstatus { flex: none; width: 8px; height: 8px; border-radius: 50%; }
.pmstatus.pass { background: #2e7d32; }
.pmstatus.fail { background: #c62828; }
.pmexec { font-size: 10px; }
.pmname { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pmtime { flex: none; color: var(--tx4); font-size: 11px; }
.pmacts { display: none; flex: none; gap: 2px; }
.pmroot:hover .pmacts, .pmrow:hover .pmacts { display: inline-flex; }
.pmact { border: none; background: none; color: var(--tx4); cursor: pointer; font-size: 12px; line-height: 1; padding: 2px 3px; }
.pmact:hover { color: var(--ac2); }
.pmedit { flex: 1; min-width: 0; background: var(--bg1); color: var(--tx); border: 1px solid var(--ac2); border-radius: 4px; padding: 2px 6px; font-size: 12px; box-sizing: border-box; }
.pmedit:focus { outline: none; }
.pmerr { color: #e06c75; font-size: 11px; }
.pmempty { padding: 12px; font-size: 12px; color: var(--tx4); }
.pmmenu { position: fixed; z-index: 4000; background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; padding: 4px; display: flex; flex-direction: column; min-width: 120px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
.pmmenuitem { text-align: left; border: none; background: none; color: var(--tx2); cursor: pointer; font-size: 12px; padding: 6px 10px; border-radius: 4px; }
.pmmenuitem:hover { background: var(--bg4); color: var(--ac2); }
</style>
