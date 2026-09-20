<script setup lang="ts">
import { computed } from 'vue';
import ItemTree from '../../components/ItemTree.vue';
import type { FileItem, FileTreeActions } from '../../fileTree';
import type { PostmanActions, PostmanRecord } from './usePostmanHistory';

const props = defineProps<{
  folders: string[];
  records: PostmanRecord[];
  activeFolder: string;
  activeId: string;
  actions: PostmanActions;
  statuses?: Record<string, 'pass' | 'fail'>;
}>();
const emit = defineEmits<{
  (e: 'select-folder', path: string): void;
  (e: 'select-record', record: PostmanRecord): void;
  (e: 'run-folder', path: string): void;
  (e: 'run-record', record: PostmanRecord): void;
}>();

const items = computed<FileItem[]>(() => props.records
  .map((r) => ({
    id: r.id,
    folder: r.folder || '',
    name: r.name || r.id,
    label: (r.title && r.title.trim()) || r.command,
    updatedAt: r.updatedAt,
  }))
  .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))));

const fileTreeActions: FileTreeActions = {
  createFolder: (parent, name) => props.actions.createFolder(parent, name),
  renameFolder: (path, name) => props.actions.renameFolder(path, name),
  removeFolder: (path) => props.actions.removeFolder(path),
  renameItem: (id, name) => props.actions.renameRecord(id, name),
  removeItem: (id) => props.actions.removeRecord(id),
  moveItem: (id, folder) => props.actions.moveRecord(id, folder),
};

function onSelectItem(item: FileItem) {
  const rec = props.records.find((r) => r.id === item.id);
  if (rec) emit('select-record', rec);
}
function onRunItem(item: FileItem) {
  const rec = props.records.find((r) => r.id === item.id);
  if (rec) emit('run-record', rec);
}
</script>

<template>
  <ItemTree
    :folders="folders"
    :items="items"
    :active-folder="activeFolder"
    :active-id="activeId"
    :actions="fileTreeActions"
    :statuses="statuses"
    storage-key="devflow-postman-collapsed"
    show-run
    @select-folder="emit('select-folder', $event)"
    @select-item="onSelectItem"
    @run-folder="emit('run-folder', $event)"
    @run-item="onRunItem"
  />
</template>
