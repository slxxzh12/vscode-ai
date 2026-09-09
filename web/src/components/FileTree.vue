<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue';
import { useProjects } from '../useProjects';
import TreeNode from './TreeNode.vue';

export interface TreeNode {
  name: string;
  type: 'file' | 'dir';
  path: string;
  expanded: boolean;
  loading: boolean;
  children: TreeNode[];
}

interface MenuState { x: number; y: number; path: string; name: string; type: 'file' | 'dir'; }
type CreateKind = 'file' | 'dir';

const props = defineProps<{ projectId: string | null; activePath?: string | null }>();
const emit = defineEmits<{
  (e: 'open-file', projectId: string, path: string, name: string): void;
  (e: 'detail-file', projectId: string, path: string, name: string): void;
}>();
const { tree, text, createFile, createDir, reveal } = useProjects();
const nodes = ref<TreeNode[]>([]);
const menu = ref<MenuState | null>(null);
const currentDir = ref('');
const selectionPath = computed(() => props.activePath);

async function fetchDir(rel: string) {
  if (!props.projectId) return [];
  const items = await tree(props.projectId, rel);
  return items.map((i) => ({ name: i.name, type: i.type, path: i.name, expanded: false, loading: false, children: [] }));
}
async function reloadDir(n: TreeNode): Promise<TreeNode[]> {
  if (!props.projectId) return [];
  const items = await tree(props.projectId, n.path);
  const cur = new Map(n.children.map((c) => [c.name, c]));
  const out = items.map((i) => {
    const ex = cur.get(i.name);
    return { name: i.name, type: i.type, path: `${n.path}/${i.name}`, expanded: ex?.expanded ?? false, loading: false, children: ex ? ex.children : [] };
  });
  for (const c of out) if (c.type === 'dir' && c.expanded) c.children = await reloadDir(c);
  return out;
}
async function refresh() {
  if (!props.projectId) { nodes.value = []; return; }
  const items = await tree(props.projectId, '');
  const cur = new Map(nodes.value.map((n) => [n.name, n]));
  nodes.value = items.map((i) => {
    const ex = cur.get(i.name);
    return { name: i.name, type: i.type, path: i.name, expanded: ex?.expanded ?? false, loading: false, children: ex ? ex.children : [] };
  });
  for (const n of nodes.value) if (n.type === 'dir' && n.expanded) n.children = await reloadDir(n);
}
async function expandTo(rel: string) {
  if (!props.projectId || !rel) return;
  const segs = rel.split('/').filter(Boolean);
  let cur = nodes.value;
  let prefix = '';
  for (const s of segs) {
    const n = cur.find((x) => x.type === 'dir' && x.name === s);
    if (!n) return;
    prefix = prefix ? `${prefix}/${s}` : s;
    n.expanded = true;
    if (n.children.length === 0) {
      try {
        const items = await tree(props.projectId, prefix);
        n.children = items.map((i) => ({ name: i.name, type: i.type, path: `${prefix}/${i.name}`, expanded: false, loading: false, children: [] }));
      } catch { return; }
    }
    cur = n.children;
  }
}

// —— 右键菜单 ——
function onCtx(ev: MouseEvent, path: string, name: string, type: 'file' | 'dir') {
  menu.value = { x: ev.clientX, y: ev.clientY, path, name, type };
}
function closeMenu() { menu.value = null; }
async function copyText(s: string) {
  try { await navigator.clipboard.writeText(s); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = s; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  closeMenu();
}
function parentDir(p: string) { const i = p.lastIndexOf('/'); return i >= 0 ? p.slice(0, i) : ''; }
function copyName() { if (menu.value) copyText(menu.value.name); }
function copyPath() { if (menu.value) copyText(menu.value.path); }
async function copyContent() {
  const m = menu.value;
  if (!m || !props.projectId || m.type !== 'file') return;
  try { const f = await text(props.projectId, m.path); await copyText(f.content); }
  catch (e: any) { console.error('copy failed', e); closeMenu(); }
}
function detailFile() {
  const m = menu.value;
  if (!m || !props.projectId || m.type !== 'file') return;
  const name = m.name;
  closeMenu();
  emit('detail-file', props.projectId, m.path, name);
}
function ctxCreateDir(kind: CreateKind) {
  const m = menu.value;
  if (!m) return;
  const base = m.type === 'dir' ? m.path : parentDir(m.path);
  currentDir.value = base;
  closeMenu();
  promptCreate(kind, base);
}

// —— Reveal in system explorer：调用后端在宿主机系统文件管理器中展示并选中 ——
async function revealOs() {
  const m = menu.value;
  if (!m || !props.projectId) return;
  const target = m.path;
  closeMenu();
  try { await reveal(props.projectId, target); }
  catch (e: any) { alert(`无法在系统资源管理器中打开：${e?.message || e}`); }
}

// —— 新建文件 / 文件夹 ——
function promptCreate(kind: CreateKind, dir = currentDir.value) {
  const label = kind === 'file' ? '文件名' : '文件夹名';
  const where = dir ? `（目录：${dir}）` : '（项目根目录）';
  const name = window.prompt(`新建${label}${where}，留空取消`);
  if (!name) return;
  if (/[\\/:*?"<>|]/.test(name)) { alert('名称不能包含 \\ / : * ? " < > |'); return; }
  const rel = dir ? `${dir}/${name}` : name;
  doCreate(kind, rel, name);
}
async function doCreate(kind: CreateKind, rel: string, name: string) {
  if (!props.projectId) return;
  try {
    if (kind === 'file') {
      await createFile(props.projectId, rel);
      await refresh();
      await expandTo(currentDir.value);
      emit('open-file', props.projectId, rel, name);
    } else {
      await createDir(props.projectId, rel);
      currentDir.value = rel;
      await refresh();
      await expandTo(rel);
    }
  } catch (e: any) {
    alert(`新建失败：${e?.message || e}`);
  }
}
function newAtRoot(kind: CreateKind) {
  currentDir.value = '';
  promptCreate(kind, '');
}

watch(() => props.projectId, refresh, { immediate: true });
onMounted(() => { document.addEventListener('click', closeMenu); window.addEventListener('blur', closeMenu); window.addEventListener('scroll', closeMenu, true); });
onBeforeUnmount(() => { document.removeEventListener('click', closeMenu); window.removeEventListener('blur', closeMenu); window.removeEventListener('scroll', closeMenu, true); });
defineExpose({ refresh });
</script>

<template>
  <div class="ft" @contextmenu.prevent>
    <div class="head">
      <span class="title">资源管理器</span>
      <div class="acts">
        <button class="ic" title="刷新目录" @click="refresh">⟳</button>
        <button class="ic" title="新建文件（当前目录）" @click.stop="promptCreate('file')">📄＋</button>
        <button class="ic" title="新建文件夹（当前目录）" @click.stop="promptCreate('dir')">📁＋</button>
      </div>
    </div>

    <TreeNode v-for="n in nodes" :key="n.path" :project-id="projectId" :node="n" :active-path="selectionPath"
      @open-file="(p, name) => projectId && emit('open-file', projectId, p, name)"
      @dir-open="(p) => currentDir = p"
      @ctx="onCtx" />
    <div v-if="projectId && nodes.length === 0" class="empty">空目录</div>
    <div v-if="!projectId" class="empty">未选择项目</div>

    <div v-if="menu" class="ctx" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
      <button @click="revealOs">在系统资源管理器中显示</button>
      <div class="sep" />
      <button @click="ctxCreateDir('file')">新建文件</button>
      <button @click="ctxCreateDir('dir')">新建文件夹</button>
      <div class="sep" />
      <button v-if="menu.type === 'file'" @click="copyContent">复制文件内容</button>
      <button v-if="menu.type === 'file'" @click="detailFile">ⓘ 详细信息</button>
      <button @click="copyName">{{ menu.type === 'dir' ? '复制文件夹名' : '复制文件名' }}</button>
      <button @click="copyPath">复制路径</button>
    </div>
  </div>
</template>

<style scoped>
.ft { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; padding: 6px 2px; user-select: none; }
.head { display: flex; align-items: center; justify-content: space-between; padding: 0 6px 6px; }
.title { color: var(--tx3); text-transform: uppercase; font-size: 11px; }
.acts { display: flex; gap: 4px; }
.ic { background: none; border: 1px solid transparent; color: var(--tx3); font-size: 12px; cursor: pointer; padding: 1px 5px; border-radius: 4px; }
.ic:hover { background: var(--bg5); color: var(--tx1); border-color: var(--bd); }
.empty { color: var(--tx5); padding: 8px; }
.ctx { position: fixed; z-index: 100; min-width: 150px; background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; box-shadow: 0 8px 28px rgba(0,0,0,.35); padding: 4px; display: flex; flex-direction: column; gap: 2px; }
.ctx button { display: block; width: 100%; text-align: left; background: none; border: none; color: var(--tx); padding: 6px 10px; font-size: 12px; cursor: pointer; border-radius: 4px; font-family: inherit; }
.ctx button:hover { background: var(--ac); color: var(--onac); }
.ctx .sep { height: 1px; background: var(--bd); margin: 3px 4px; }
</style>
