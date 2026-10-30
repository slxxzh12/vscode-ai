<script setup lang="ts">
import { onMounted } from 'vue';
import DocViewer from '../../components/DocViewer.vue';
import { useToolWorkbench } from '../useToolWorkbench';
import type { FileTool } from '../files/useToolFiles';

// 主区内容：文档型工具（notepad/yaml/markdown/js）用 DocViewer 展示当前活动文件。
const AUTO_NEW: FileTool[] = ['markdown', 'js'];
const props = defineProps<{ tool: FileTool }>();
const wb = useToolWorkbench(props.tool);

// Markdown / JS 工具打开时若没有活动文件，直接按默认后缀新建并打开
onMounted(() => {
  if (!wb.activeId.value && AUTO_NEW.includes(props.tool)) void wb.newFile();
});
</script>

<template>
  <div class="tdp">
    <DocViewer
      v-if="wb.activeId.value"
      :key="wb.activeId.value"
      :source="wb.docSource"
      :path="wb.activeId.value"
      :name="wb.leafName.value"
    />
    <div v-else class="tdp-empty" @dblclick="wb.newFile()">
      <div class="tdp-empty-main">{{ $t('files.no_file') }}</div>
      <div class="tdp-empty-hint">{{ $t('files.dblclick_new') }}</div>
    </div>
  </div>
</template>

<style scoped>
.tdp { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.tdp-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--tx4); font-size: 13px; cursor: pointer; }
.tdp-empty-hint { font-size: 12px; opacity: .8; }
</style>
