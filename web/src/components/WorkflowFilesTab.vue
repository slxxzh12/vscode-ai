<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '../i18n';
import { renderRemoteMarkdown } from '../markdown';
import { useMarkdownEnhance } from '../markdown-enhance/useEnhance';

interface TreeNode {
  name: string;
  type: 'dir' | 'file';
  path: string;
  abs?: string;
  children?: TreeNode[];
}

const props = defineProps<{ workflowId: string }>();
const emit = defineEmits<{ (e: 'deleted'): void }>();
const tree = ref<TreeNode[]>([]);
const selected = ref<TreeNode | null>(null);
const content = ref('');
const error = ref('');
const revealMsg = ref('');
const dragging = ref<TreeNode | null>(null);
const dragOverPath = ref('');
const workflowNode = computed<TreeNode | null>(() => tree.value[0] || null);

const rows = computed(() => {
  const out: Array<{ node: TreeNode; depth: number }> = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes || []) {
      out.push({ node, depth });
      if (node.children?.length) walk(node.children, depth + 1);
    }
  };
  walk(tree.value, 0);
  return out;
});
const html = computed(() => (content.value ? renderRemoteMarkdown(content.value) : ''));
const mdBody = ref<HTMLElement | null>(null);
useMarkdownEnhance(html, mdBody);

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes || []) {
    if (node.path === path) return node;
    const hit = node.children ? findNode(node.children, path) : null;
    if (hit) return hit;
  }
  return null;
}

async function loadTree(keep = false) {
  if (!keep) {
    selected.value = null;
    content.value = '';
    error.value = '';
    revealMsg.value = '';
  }
  if (!props.workflowId) { tree.value = []; return; }
  try {
    const res = await fetch(`/api/workflows-tree?workflowId=${encodeURIComponent(props.workflowId)}&local=1`);
    const data = await res.json();
    const next = Array.isArray(data?.tree) ? data.tree : [];
    tree.value = next;
    if (keep && selected.value) {
      const found = findNode(next, selected.value.path);
      if (found) selected.value = found;
      else { selected.value = null; content.value = ''; }
    }
  } catch (e: any) {
    if (keep) return;
    tree.value = [];
    error.value = t('wfe.files.load_failed', { msg: String(e?.message || e) });
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
async function refresh() {
  if (ticking) return;
  ticking = true;
  try {
    await loadTree(true);
    const node = selected.value;
    if (!node || node.type !== 'file') return;
    const res = await fetch(`/api/workflows-file?path=${encodeURIComponent(node.path)}&local=1`);
    if (!res.ok) return;
    const text = await res.text();
    if (text !== content.value) content.value = text;
  } catch { /* ignore poll errors */ }
  finally { ticking = false; }
}
onMounted(() => { timer = setInterval(() => { void refresh(); }, 2000); });
onBeforeUnmount(() => { if (timer) clearInterval(timer); timer = null; });

async function reveal(node: TreeNode | null) {
  if (!node) return;
  revealMsg.value = '';
  try {
    const res = await fetch('/api/workflows-reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: node.path, local: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
  } catch (e: any) {
    revealMsg.value = t('wfe.files.reveal_failed', { msg: String(e?.message || e) });
  }
}

async function openFile(node: TreeNode) {
  selected.value = node;
  content.value = '';
  error.value = '';
  try {
    const res = await fetch(`/api/workflows-file?path=${encodeURIComponent(node.path)}&local=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    content.value = await res.text();
  } catch (e: any) {
    error.value = t('wfe.files.load_failed', { msg: String(e?.message || e) });
  }
}

async function removeFile(node: TreeNode) {
  if (node.type !== 'file') return;
  if (!window.confirm(t('wfe.files.delete_confirm', { name: node.name }))) return;
  revealMsg.value = '';
  try {
    const res = await fetch('/api/workflows-file-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: node.path, local: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    if (selected.value?.path === node.path) { selected.value = null; content.value = ''; }
    await loadTree();
    emit('deleted');
  } catch (e: any) {
    revealMsg.value = t('wfe.files.delete_failed', { msg: String(e?.message || e) });
  }
}

function onDragStart(e: DragEvent, node: TreeNode) {
  dragging.value = node;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.path);
  }
}
function onDragEnd() {
  dragging.value = null;
  dragOverPath.value = '';
}
function onDragOver(e: DragEvent, node: TreeNode) {
  if (dragging.value?.type !== 'file' || node.type !== 'dir') return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  dragOverPath.value = node.path;
}
function onDragLeave(node: TreeNode) {
  if (dragOverPath.value === node.path) dragOverPath.value = '';
}
async function onDrop(e: DragEvent, node: TreeNode) {
  e.preventDefault();
  const src = dragging.value;
  dragging.value = null;
  dragOverPath.value = '';
  if (!src || src.type !== 'file' || node.type !== 'dir') return;
  const fromDir = src.path.slice(0, src.path.lastIndexOf('/'));
  if (fromDir === node.path) return;
  const to = `${node.path}/${src.name}`;
  const wasSelected = selected.value?.path === src.path;
  revealMsg.value = '';
  try {
    const res = await fetch('/api/workflows-file-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: src.path, to, local: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    await loadTree(true);
    if (wasSelected) {
      const moved = findNode(tree.value, to);
      if (moved) { selected.value = moved; await openFile(moved); }
    }
  } catch (e: any) {
    revealMsg.value = t('wfe.files.move_failed', { msg: String(e?.message || e) });
  }
}

async function reload() {
  error.value = '';
  revealMsg.value = '';
  await loadTree(true);
  const node = selected.value;
  if (node && node.type === 'file') await openFile(node);
}
defineExpose({ reload });

watch(() => props.workflowId, () => { void loadTree(); }, { immediate: true });
</script>

<template>
  <div class="wfiles-wrap">
    <div class="wf-paths">
      <div v-if="workflowNode" class="wf-path">
        <span class="wf-path-label">{{ $t('wfe.files.workflow_dir') }}</span>
        <button class="wf-path-link" :title="workflowNode.abs || workflowNode.path" @click="reveal(workflowNode)">{{ workflowNode.abs || workflowNode.path }}</button>
      </div>
      <div v-if="selected && selected.type === 'file'" class="wf-path">
        <span class="wf-path-label">{{ $t('wfe.files.prompt_file') }}</span>
        <button class="wf-path-link" :title="selected.abs || selected.path" @click="reveal(selected)">{{ selected.abs || selected.path }}</button>
      </div>
      <div v-if="revealMsg" class="wf-path-error">{{ revealMsg }}</div>
    </div>
    <div class="wfiles">
      <div class="wf-tree">
        <div class="wf-head">{{ $t('wfe.files.title') }}</div>
        <div
          v-for="row in rows"
          :key="row.node.path"
          class="wf-row"
          :class="[row.node.type, { dragover: dragOverPath === row.node.path }]"
          :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
          :draggable="row.node.type === 'file'"
          :title="row.node.type === 'file' ? $t('wfe.files.drag_hint') : undefined"
          @click="row.node.type === 'file' && openFile(row.node)"
          @dragstart="row.node.type === 'file' && onDragStart($event, row.node)"
          @dragend="onDragEnd"
          @dragover="onDragOver($event, row.node)"
          @dragleave="onDragLeave(row.node)"
          @drop="onDrop($event, row.node)"
        >
          <span class="ico">{{ row.node.type === 'dir' ? '📁' : '📄' }}</span>
          <span class="nm">{{ row.node.name }}</span>
          <button v-if="row.node.type === 'file'" class="wf-del" :title="$t('wfe.files.delete')" @click.stop="removeFile(row.node)">×</button>
        </div>
        <div v-if="!rows.length" class="wf-empty">{{ $t('wfe.files.empty') }}</div>
      </div>
      <div class="wf-view">
        <template v-if="selected">
          <div class="wf-name">{{ selected.name }}</div>
          <div v-if="error" class="wf-empty">{{ error }}</div>
          <div v-else ref="mdBody" class="md-body" v-html="html" />
        </template>
        <div v-else class="wf-empty">{{ $t('wfe.files.select') }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wfiles-wrap { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.wf-paths { display: flex; flex-direction: column; gap: 4px; border: 1px solid var(--bd); border-radius: 6px; padding: 6px 10px; background: var(--bg2); }
.wf-path { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; }
.wf-path-label { flex: none; color: var(--tx5); }
.wf-path-link { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: none; border: none; padding: 0; color: var(--ac2); font-family: inherit; font-size: 12px; cursor: pointer; text-align: left; }
.wf-path-link:hover { text-decoration: underline; }
.wf-path-error { color: var(--err); font-size: 12px; }
.wfiles { flex: 1; min-height: 0; display: flex; gap: 12px; }
.wf-tree { width: 300px; flex: none; overflow: auto; border: 1px solid var(--bd); border-radius: 6px; padding: 6px; }
.wf-head { color: var(--tx5); font-size: 11px; padding: 3px 6px 6px; }
.wf-row { display: flex; align-items: center; gap: 5px; padding: 4px 6px; border-radius: 4px; color: var(--tx2); font-size: 12px; cursor: default; }
.wf-row.dir { color: var(--tx3); }
.wf-row.file { cursor: pointer; }
.wf-row.file:hover { background: var(--bg5, var(--bg4)); color: var(--tx1); }
.wf-row.dir.dragover { outline: 1px dashed var(--ac2); background: var(--bg4); color: var(--tx1); }
.wf-row .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf-del { flex: none; margin-left: auto; background: none; border: none; color: var(--tx5); cursor: pointer; font-size: 14px; line-height: 1; opacity: 0; padding: 0 2px; }
.wf-row:hover .wf-del { opacity: 1; }
.wf-del:hover { color: var(--err); }
.wf-view { flex: 1; min-width: 0; overflow: auto; border: 1px solid var(--bd); border-radius: 6px; }
.wf-name { padding: 8px 12px; border-bottom: 1px solid var(--bd); color: var(--tx1); font-weight: 600; font-size: 12px; }
.md-body { padding: 12px 16px; color: var(--tx); }
.wf-empty { color: var(--tx5); padding: 24px; text-align: center; font-size: 12px; }
</style>
