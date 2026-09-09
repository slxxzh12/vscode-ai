<script setup lang="ts">
import { ref, watch } from 'vue';
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

const props = defineProps<{ projectId: string | null }>();
const emit = defineEmits<{ (e: 'open-file', projectId: string, path: string, name: string): void }>();
const { tree } = useProjects();
const nodes = ref<TreeNode[]>([]);

async function refresh() {
  if (!props.projectId) { nodes.value = []; return; }
  const items = await tree(props.projectId, '');
  nodes.value = items.map((i) => ({ name: i.name, type: i.type, path: i.name, expanded: false, loading: false, children: [] }));
}

watch(() => props.projectId, refresh, { immediate: true });
defineExpose({ refresh });
</script>

<template>
  <div class="ft">
    <TreeNode v-for="n in nodes" :key="n.path" :project-id="projectId" :node="n"
      @open-file="(p, name) => projectId && emit('open-file', projectId, p, name)" />
    <div v-if="projectId && nodes.length === 0" class="empty">空目录</div>
    <div v-if="!projectId" class="empty">未选择项目</div>
  </div>
</template>

<style scoped>
.ft { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; padding: 6px 2px; user-select: none; }
.empty { color: #5b6472; padding: 8px; }
</style>
