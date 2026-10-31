import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '../../i18n';
import { useToolFiles, type FileTool } from './useToolFiles';
import type { FileItem, FileTreeActions } from '../../fileTree';

const SAVE_DELAY = 1000;

// 左侧文件树的通用「打开 / 新建 / 自动保存」逻辑：notepad 与 yaml/js/translate 共用。
// 数据按 tool 分开（各自目录），前端保存逻辑完全一致。
export function useFileWorkbench(opts: { tool: FileTool; defaultExt: string }) {
  const files = useToolFiles(opts.tool);
  const activeId = ref('');
  const activeFolder = ref('');
  const content = ref('');
  const dirty = ref(false);
  const msg = ref('');
  const saving = ref(false);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let loading = false;

  const title = computed(() => {
    if (!activeId.value) return '';
    const leaf = activeId.value.slice(activeId.value.lastIndexOf('/') + 1);
    return dirty.value ? `${leaf} *` : leaf;
  });

  const actions: FileTreeActions = {
    createFolder: (parent, name) => files.createFolder(parent, name),
    renameFolder: (path, name) => files.renameFolder(path, name),
    removeFolder: (path) => files.removeFolder(path),
    renameItem: async (id, name) => {
      const r = await files.renameItem(id, name);
      if (r.ok && activeId.value === id) activeId.value = id.includes('/') ? `${id.slice(0, id.lastIndexOf('/'))}/${name}` : name;
      return r;
    },
    removeItem: async (id) => {
      const r = await files.removeItem(id);
      if (r.ok && activeId.value === id) { activeId.value = ''; content.value = ''; dirty.value = false; }
      return r;
    },
    moveItem: (id, folder) => files.moveItem(id, folder),
  };

  async function openFile(item: FileItem) {
    if (dirty.value && activeId.value) await flushSave();
    try {
      const text = await files.read(item.id);
      loading = true;
      content.value = text;
      loading = false;
      activeId.value = item.id;
      dirty.value = false;
      msg.value = '';
    } catch (e) { msg.value = t('files.open_failed', { msg: (e as Error)?.message || String(e) }); }
  }

  // 未命名时的默认文件名：当前日期+时间（如 20260920-153012.txt）
  function stamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  async function newFile() {
    const def = `${stamp()}${opts.defaultExt}`;
    const ans = window.prompt(t('files.name'), def);
    if (ans === null) return;
    const name = ans.trim() || def;
    try {
      const id = await files.createFile(activeFolder.value, name);
      activeId.value = id;
      loading = true;
      content.value = '';
      loading = false;
      dirty.value = false;
      msg.value = '';
    } catch (e) { msg.value = t('files.save_failed', { msg: (e as Error)?.message || String(e) }); }
  }

  async function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!activeId.value || !dirty.value) return;
    saving.value = true;
    try {
      await files.save(activeId.value, content.value);
      dirty.value = false;
      msg.value = t('files.saved');
    } catch (e) { msg.value = t('files.save_failed', { msg: (e as Error)?.message || String(e) }); }
    finally { saving.value = false; }
  }

  function scheduleSave() {
    dirty.value = true;
    msg.value = '';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; void flushSave(); }, SAVE_DELAY);
  }

  watch(content, () => {
    if (loading || !activeId.value) return;
    scheduleSave();
  });

  function onKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void flushSave(); }
  }
  onMounted(() => { void files.load(); document.addEventListener('keydown', onKeydown); });
  onBeforeUnmount(() => { document.removeEventListener('keydown', onKeydown); if (saveTimer) clearTimeout(saveTimer); });

  return { folders: files.folders, items: files.items, activeId, activeFolder, content, dirty, msg, saving, title, actions, openFile, newFile, flushSave, scheduleSave };
}
