<script setup lang="ts">
import { useProjects } from '../useProjects';
import type { TreeNode as TNode } from './FileTree.vue';

const props = defineProps<{ projectId: string | null; node: TNode; activePath?: string | null }>();
const emit = defineEmits<{
  (e: 'open-file', path: string, name: string): void;
  (e: 'dir-open', path: string): void;
  (e: 'ctx', ev: MouseEvent, path: string, name: string, type: 'file' | 'dir'): void;
}>();
const { tree } = useProjects();
const n = props.node;
const isSelected = (node: TNode) => node.type === 'file' && !!props.activePath && node.path === props.activePath;

async function toggle() {
  if (n.type !== 'dir') { emit('open-file', n.path, n.name); return; }
  if (!n.expanded) emit('dir-open', n.path);
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
function onCtx(ev: MouseEvent) { emit('ctx', ev, n.path, n.name, n.type); }
</script>

<template>
  <div>
    <div class="row" :class="{ sel: isSelected(n), dir: n.type === 'dir' }" :data-path="n.path" @click="toggle" @contextmenu.prevent="onCtx">
      <span class="tw">{{ n.type === 'dir' ? (n.expanded ? '▾' : '▸') : '' }}</span>
      <span class="nm">{{ n.name }}</span>
      <span v-if="n.loading" class="loading">…</span>
    </div>
    <div v-if="n.expanded" class="indent">
      <TreeNode v-for="c in n.children" :key="c.path" :project-id="projectId" :node="c" :active-path="activePath"
        @open-file="emit('open-file', $event, c.name)"
        @dir-open="emit('dir-open', $event)"
        @ctx="(ev, p, name, type) => emit('ctx', ev, p, name, type)" />
    </div>
  </div>
</template>

<style scoped>
.row { display: flex; gap: 4px; padding: 2px 6px; cursor: default; color: var(--tx4); white-space: nowrap; overflow: hidden; border-radius: 3px; }
.row:hover { background: var(--bg5); }
.row.sel { background: var(--ac); color: var(--onac); }
.row.sel .tw { color: inherit; }
.tw { color: var(--tx3); width: 12px; flex: none; }
.nm { overflow: hidden; text-overflow: ellipsis; }
.indent { padding-left: 14px; }
.loading { color: var(--tx5); }
</style>
