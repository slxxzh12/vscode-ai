<script setup lang="ts">
import TreeView from './TreeView.vue';
import { useToolWorkbench } from '../tools/useToolWorkbench';
import type { FileTool } from '../tools/files/useToolFiles';

// 主页面左侧面板：活动页签是工具时，显示该工具的固定目录树。
const props = defineProps<{ tool: FileTool }>();
const wb = useToolWorkbench(props.tool);
</script>

<template>
  <div class="tside">
    <TreeView
      :source="wb.treeSource"
      :title="$t('tools.' + tool)"
      :active-key="wb.activeId.value"
      :active-folder="wb.activeFolder.value"
      :storage-key="'devflow-' + tool + '-collapsed'"
      @update:active-folder="(k: string) => (wb.activeFolder.value = k)"
    />
  </div>
</template>

<style scoped>
.tside { height: 100%; padding: 6px; box-sizing: border-box; }
</style>
