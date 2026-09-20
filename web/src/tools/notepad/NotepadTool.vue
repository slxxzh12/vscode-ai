<script setup lang="ts">
import { sortText, dedupText, type SortMode } from '../../textTools';
import { useFileWorkbench } from '../files/useFileWorkbench';
import FileSidebar from '../../components/FileSidebar.vue';
import type { FileItem } from '../../fileTree';

const {
  folders, items, activeId, activeFolder, content, saving, msg, title,
  actions, openFile, newFile, flushSave,
} = useFileWorkbench({ tool: 'notepad', defaultExt: '.txt' });

const SORT_BTNS: Array<{ mode: SortMode; key: string }> = [
  { mode: 'asc', key: 'fp.sort.short.asc' },
  { mode: 'desc', key: 'fp.sort.short.desc' },
  { mode: 'num-asc', key: 'fp.sort.short.num_asc' },
  { mode: 'num-desc', key: 'fp.sort.short.num_desc' },
];

function selectFolder(path: string) { activeFolder.value = path; }
function openItem(item: FileItem) { void openFile(item); }

function applySort(mode: SortMode) {
  if (!activeId.value) return;
  content.value = sortText(content.value, mode);
}
function applyDedup() {
  if (!activeId.value) return;
  content.value = dedupText(content.value);
}
</script>

<template>
  <div class="npbody">
    <FileSidebar
      :folders="folders"
      :items="items"
      :active-folder="activeFolder"
      :active-id="activeId"
      :actions="actions"
      storage-key="devflow-notepad-collapsed"
      :title="$t('tools.notepad')"
      @select-folder="selectFolder"
      @select-item="openItem"
      @new-file="newFile"
    />

    <section class="npmain">
      <div class="npbar">
        <span class="npname">{{ title || $t('files.no_file') }}</span>
        <button class="npbtn primary" :disabled="!activeId || saving" @click="flushSave">{{ $t('files.save') }}</button>
        <button v-for="b in SORT_BTNS" :key="b.mode" class="npbtn" :disabled="!activeId" @click="applySort(b.mode)">{{ $t(b.key) }}</button>
        <button class="npbtn" :disabled="!activeId" @click="applyDedup">{{ $t('np.dedup') }}</button>
      </div>
      <div v-if="msg" class="npmsg">{{ msg }}</div>
      <textarea v-model="content" class="nparea" :placeholder="$t('files.no_file')" spellcheck="false" :disabled="!activeId" />
    </section>
  </div>
</template>

<style scoped>
.npbody { display: flex; flex-direction: row; gap: 12px; height: calc(100vh - 150px); }
.npmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.npbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.npname { flex: 1; min-width: 0; color: var(--tx2); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.npbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.npbtn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.npbtn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.npbtn:disabled { opacity: .55; cursor: default; }
.npmsg { color: var(--tx3); font-size: 12px; }
.nparea { flex: 1; min-height: 200px; resize: none; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 6px; padding: 10px 12px; font-size: 13px; line-height: 1.6; font-family: ui-monospace, Consolas, monospace; box-sizing: border-box; }
.nparea:focus { outline: none; border-color: var(--ac2); }
</style>
