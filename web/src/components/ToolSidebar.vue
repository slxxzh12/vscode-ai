<script setup lang="ts">
import { computed } from 'vue';
import TreeView from './TreeView.vue';
import { useToolWorkbench } from '../tools/useToolWorkbench';
import { usePostmanWorkbench } from '../tools/postman/usePostmanWorkbench';
import PostmanSidebarBar from '../tools/postman/PostmanSidebarBar.vue';
import { useNavicatWorkbench } from '../tools/navicat/useNavicatWorkbench';
import NavicatSidebarBar from '../tools/navicat/NavicatSidebarBar.vue';
import type { FileTool } from '../tools/files/useToolFiles';
import type { ToolId } from '../tools/catalog';

const props = defineProps<{ tool: ToolId }>();

// 各工具的 workbench 都暴露 treeSource/activeId/activeFolder，统一取用。
const wb = computed(() => {
  if (props.tool === 'base64') return null;
  if (props.tool === 'postman') return usePostmanWorkbench();
  if (props.tool === 'navicat') return useNavicatWorkbench();
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
    <template v-if="!wb">
      <!-- base64 等无文件树工具：留空侧栏 -->
    </template>
    <template v-else>
      <PostmanSidebarBar v-if="tool === 'postman'" />
      <NavicatSidebarBar v-else-if="tool === 'navicat'" />
      <TreeView
        :source="wb.treeSource"
        :title="$t('tools.' + tool)"
        :active-key="wb.activeId.value"
        :active-folder="wb.activeFolder.value"
        :storage-key="'devflow-' + tool + '-collapsed'"
        @update:active-folder="onFolder"
      />
    </template>
  </div>
</template>

<style scoped>
.tside { height: 100%; padding: 6px; box-sizing: border-box; display: flex; flex-direction: column; }
</style>
