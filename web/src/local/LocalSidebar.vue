<script setup lang="ts">
import { computed } from 'vue';
import TreeView from '../components/TreeView.vue';
import { useLocalSources } from './useLocalSources';
import { localTreeSource } from './localTreeSource';
import { useCenter } from '../useCenter';

// 左侧面板：活动页签是本地根时显示该目录树；点文件在根页签内就地切换。
const local = useLocalSources();
const center = useCenter();
const source = computed(() => localTreeSource((node) => {
  local.activePath.value = node.key;
  center.openLocalRoot(local.root.value?.name || '');
}));
</script>

<template>
  <div class="lside">
    <TreeView
      :source="source"
      :title="local.root.value?.name || ''"
      :active-key="local.activePath.value"
      storage-key="devflow-local-collapsed"
    />
  </div>
</template>

<style scoped>
.lside { height: 100%; padding: 6px; box-sizing: border-box; }
</style>
