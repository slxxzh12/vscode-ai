<script setup lang="ts">
import { useProjects } from '../useProjects';
import type { TreeNode as TNode } from './FileTree.vue';

const props = defineProps<{ projectId: string | null; node: TNode }>();
const emit = defineEmits<{ (e: 'open-file', path: string, name: string): void }>();
const { tree } = useProjects();
const n = props.node;

async function toggle() {
  if (n.type !== 'dir') { emit('open-file', n.path, n.name); return; }
  n.expanded = !n.expanded;
  if (n.expanded && n.children.length === 0) {
    n.loading = true;
    try {
      if (props.projectId) {
        const items = await tree(props.projectId, n.path);
        n.children = items.map((i) => ({ name: i.name, type: i.type, path: `${n.path}/${i.name}`, expanded: false, loading: false, children: [] }));
      }
    } finally {
      n.loading = false;
    }
  }
}
</script>

<template>
  <div>
    <div class="row" @click="toggle">
      <span class="tw">{{ n.type === 'dir' ? (n.expanded ? '▾' : '▸') : '' }}</span>
      <span class="nm">{{ n.name }}</span>
      <span v-if="n.loading" class="loading">…</span>
    </div>
    <div v-if="n.expanded" class="indent">
      <TreeNode v-for="c in n.children" :key="c.path" :project-id="projectId" :node="c" @open-file="emit('open-file', $event, c.name)" />
    </div>
  </div>
</template>

<style scoped>
.row { display: flex; gap: 4px; padding: 2px 6px; cursor: default; color: var(--tx4); white-space: nowrap; overflow: hidden; }
.row:hover { background: var(--bg5); }
.tw { color: var(--tx3); width: 12px; flex: none; }
.nm { overflow: hidden; text-overflow: ellipsis; }
.indent { padding-left: 14px; }
.loading { color: var(--tx5); }
</style>
