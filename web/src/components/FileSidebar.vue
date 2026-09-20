<script setup lang="ts">
import ItemTree from './ItemTree.vue';
import type { FileItem, FileTreeActions } from '../fileTree';

defineProps<{
  folders: string[];
  items: FileItem[];
  activeFolder: string;
  activeId: string;
  actions: FileTreeActions;
  storageKey: string;
  title: string;
}>();

defineEmits<{
  (e: 'select-folder', path: string): void;
  (e: 'select-item', item: FileItem): void;
  (e: 'new-file'): void;
}>();
</script>

<template>
  <aside class="fs-side">
    <div class="fs-head">
      <span class="fs-title">{{ title }}</span>
      <button class="fs-new" @click="$emit('new-file')">{{ $t('files.new') }}</button>
    </div>
    <ItemTree
      :folders="folders"
      :items="items"
      :active-folder="activeFolder"
      :active-id="activeId"
      :actions="actions"
      :storage-key="storageKey"
      @select-folder="(p) => $emit('select-folder', p)"
      @select-item="(i) => $emit('select-item', i)"
    />
  </aside>
</template>

<style scoped>
.fs-side { width: 280px; flex: none; display: flex; flex-direction: column; border: 1px solid var(--bd); border-radius: 8px; background: var(--bg2); overflow: hidden; padding: 6px; box-sizing: border-box; }
.fs-head { display: flex; align-items: center; justify-content: space-between; padding: 2px 4px 6px; }
.fs-title { font-size: 12px; color: var(--tx3); }
.fs-new { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
.fs-new:hover { border-color: var(--ac2); color: var(--ac2); }
</style>
