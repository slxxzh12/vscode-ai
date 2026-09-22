<script setup lang="ts">
import { computed } from 'vue';
import TreeView from './TreeView.vue';
import { useToolWorkbench } from '../tools/useToolWorkbench';
import { usePostmanWorkbench } from '../tools/postman/usePostmanWorkbench';
import PostmanSidebarBar from '../tools/postman/PostmanSidebarBar.vue';
import type { FileTool } from '../tools/files/useToolFiles';
import type { ToolId } from '../tools/catalog';

const props = defineProps<{ tool: ToolId }>();

// 各工具的 workbench 都暴露 treeSource/activeId/activeFolder，统一取用。
const wb = computed(() => {
  if (props.tool === 'postman') return usePostmanWorkbench();
  return useToolWorkbench(props.tool as FileTool);
});

function onFolder(k: string) {
  const w: any = wb.value;
  w.activeFolder.value = k;
  w.onFolder?.(k);
}
</script>

<template>
  <div class="tside">
    <PostmanSidebarBar v-if="tool === 'postman'" />
    <TreeView
      :source="wb.treeSource"
      :title="$t('tools.' + tool)"
      :active-key="wb.activeId.value"
      :active-folder="wb.activeFolder.value"
      :storage-key="'devflow-' + tool + '-collapsed'"
      @update:active-folder="onFolder"
    />
  </div>
</template>

<style scoped>
.tside { height: 100%; padding: 6px; box-sizing: border-box; display: flex; flex-direction: column; }
</style>
