<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '../../i18n';
import { sortText, dedupText, type SortMode } from '../../textTools';
import { useNotepadFiles } from './useNotepadFiles';
import ItemTree from '../../components/ItemTree.vue';
import type { FileItem, FileTreeActions } from '../../fileTree';

const np = useNotepadFiles();
const activeId = ref('');
const activeFolder = ref('');
const content = ref('');
const dirty = ref(false);
const msg = ref('');
const saving = ref(false);
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const SORT_BTNS: Array<{ mode: SortMode; key: string }> = [
  { mode: 'asc', key: 'fp.sort.short.asc' },
  { mode: 'desc', key: 'fp.sort.short.desc' },
  { mode: 'num-asc', key: 'fp.sort.short.num_asc' },
  { mode: 'num-desc', key: 'fp.sort.short.num_desc' },
];

const actions: FileTreeActions = {
  createFolder: (parent, name) => np.createFolder(parent, name),
  renameFolder: (path, name) => np.renameFolder(path, name),
  removeFolder: (path) => np.removeFolder(path),
  renameItem: async (id, name) => {
    const r = await np.renameItem(id, name);
    if (r.ok && activeId.value === id) activeId.value = id.includes('/') ? `${id.slice(0, id.lastIndexOf('/'))}/${name}` : name;
    return r;
  },
  removeItem: async (id) => {
    const r = await np.removeItem(id);
    if (r.ok && activeId.value === id) { activeId.value = ''; content.value = ''; dirty.value = false; }
    return r;
  },
  moveItem: (id, folder) => np.moveItem(id, folder),
};

const title = computed(() => {
  if (!activeId.value) return '';
  const leaf = activeId.value.slice(activeId.value.lastIndexOf('/') + 1);
  return dirty.value ? `${leaf} *` : leaf;
});

async function openFile(item: FileItem) {
  if (dirty.value && activeId.value) await flushSave();
  try {
    const text = await np.read(item.id);
    content.value = text;
    activeId.value = item.id;
    dirty.value = false;
    msg.value = '';
  } catch (e) { msg.value = t('np.open_failed', { msg: (e as Error)?.message || String(e) }); }
}

async function newFile() {
  const name = window.prompt(t('np.file_name'), t('np.file_ph'));
  if (!name || !name.trim()) return;
  try {
    const id = await np.createFile(activeFolder.value, name.trim());
    activeId.value = id;
    content.value = '';
    dirty.value = false;
    msg.value = '';
  } catch (e) { msg.value = t('np.save_failed', { msg: (e as Error)?.message || String(e) }); }
}

async function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!activeId.value || !dirty.value) return;
  saving.value = true;
  try {
    await np.save(activeId.value, content.value);
    dirty.value = false;
    msg.value = t('np.saved');
  } catch (e) { msg.value = t('np.save_failed', { msg: (e as Error)?.message || String(e) }); }
  finally { saving.value = false; }
}
function scheduleSave() {
  dirty.value = true;
  msg.value = '';
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; void flushSave(); }, 1000);
}
function onInput() { if (activeId.value) scheduleSave(); }

function applySort(mode: SortMode) {
  if (!activeId.value) return;
  content.value = sortText(content.value, mode);
  scheduleSave();
}
function applyDedup() {
  if (!activeId.value) return;
  content.value = dedupText(content.value);
  scheduleSave();
}
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void flushSave(); }
}
onMounted(() => { void np.load(); document.addEventListener('keydown', onKeydown); });
onBeforeUnmount(() => { document.removeEventListener('keydown', onKeydown); if (saveTimer) clearTimeout(saveTimer); });
</script>

<template>
  <div class="npbody">
    <aside class="npside">
      <div class="npsidehead">
        <span class="npsidetitle">{{ $t('tools.notepad') }}</span>
        <button class="npmini" @click="newFile">{{ $t('np.new_file') }}</button>
      </div>
      <ItemTree
        :folders="np.folders.value"
        :items="np.items.value"
        :active-folder="activeFolder"
        :active-id="activeId"
        :actions="actions"
        storage-key="devflow-notepad-collapsed"
        @select-folder="(p) => (activeFolder = p)"
        @select-item="openFile"
      />
    </aside>

    <section class="npmain">
      <div class="npbar">
        <span class="npname">{{ title || $t('np.no_file') }}</span>
        <button class="npbtn primary" :disabled="!activeId || saving" @click="flushSave">{{ $t('np.save') }}</button>
        <button v-for="b in SORT_BTNS" :key="b.mode" class="npbtn" :disabled="!activeId" @click="applySort(b.mode)">{{ $t(b.key) }}</button>
        <button class="npbtn" :disabled="!activeId" @click="applyDedup">{{ $t('np.dedup') }}</button>
      </div>
      <div v-if="msg" class="npmsg">{{ msg }}</div>
      <textarea v-model="content" class="nparea" :placeholder="$t('np.no_file')" spellcheck="false" :disabled="!activeId" @input="onInput" />
    </section>
  </div>
</template>

<style scoped>
.npbody { display: flex; flex-direction: row; gap: 12px; height: calc(100vh - 150px); }
.npside { width: 280px; flex: none; display: flex; flex-direction: column; border: 1px solid var(--bd); border-radius: 8px; background: var(--bg2); overflow: hidden; padding: 6px; box-sizing: border-box; }
.npsidehead { display: flex; align-items: center; justify-content: space-between; padding: 2px 4px 6px; }
.npsidetitle { font-size: 12px; color: var(--tx3); }
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
.npmini { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
.npmini:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
</style>
