<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { t } from '../i18n';
import { renderRemoteMarkdown } from '../markdown';

interface TreeNode {
  name: string;
  type: 'dir' | 'file';
  path: string;
  abs?: string;
  children?: TreeNode[];
}

const props = defineProps<{ workflowId: string }>();
const tree = ref<TreeNode[]>([]);
const selected = ref<TreeNode | null>(null);
const content = ref('');
const error = ref('');
const revealMsg = ref('');
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

async function loadTree() {
  selected.value = null;
  content.value = '';
  error.value = '';
  revealMsg.value = '';
  if (!props.workflowId) { tree.value = []; return; }
  try {
    const res = await fetch(`/api/workflows-tree?workflowId=${encodeURIComponent(props.workflowId)}`);
    const data = await res.json();
    tree.value = Array.isArray(data?.tree) ? data.tree : [];
  } catch (e: any) {
    tree.value = [];
    error.value = t('wfe.files.load_failed', { msg: String(e?.message || e) });
  }
}

async function reveal(node: TreeNode | null) {
  if (!node) return;
  revealMsg.value = '';
  try {
    const res = await fetch('/api/workflows-reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: node.path }),
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
    const res = await fetch(`/api/workflows-file?path=${encodeURIComponent(node.path)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    content.value = await res.text();
  } catch (e: any) {
    error.value = t('wfe.files.load_failed', { msg: String(e?.message || e) });
  }
}

watch(() => props.workflowId, loadTree, { immediate: true });
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
          :class="row.node.type"
          :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
          @click="row.node.type === 'file' && openFile(row.node)"
        >
          <span class="ico">{{ row.node.type === 'dir' ? '📁' : '📄' }}</span>
          <span class="nm">{{ row.node.name }}</span>
        </div>
        <div v-if="!rows.length" class="wf-empty">{{ $t('wfe.files.empty') }}</div>
      </div>
      <div class="wf-view">
        <template v-if="selected">
          <div class="wf-name">{{ selected.name }}</div>
          <div v-if="error" class="wf-empty">{{ error }}</div>
          <div v-else class="md-body" v-html="html" />
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
.wf-row .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf-view { flex: 1; min-width: 0; overflow: auto; border: 1px solid var(--bd); border-radius: 6px; }
.wf-name { padding: 8px 12px; border-bottom: 1px solid var(--bd); color: var(--tx1); font-weight: 600; font-size: 12px; }
.md-body { padding: 12px 16px; color: var(--tx); }
.wf-empty { color: var(--tx5); padding: 24px; text-align: center; font-size: 12px; }
</style>
