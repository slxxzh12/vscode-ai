<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { EditorView } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import { t } from '../../i18n';
import { sortText, dedupText, type SortMode } from '../../textTools';
import { canFormatExt, formatText } from '../../formatText';
import { useProjects } from '../../useProjects';
import { useFileWorkbench } from '../files/useFileWorkbench';
import FileSidebar from '../../components/FileSidebar.vue';
import CodeEditor from '../../components/CodeEditor.vue';
import Base64Panel from '../../components/Base64Panel.vue';
import { DIALOG_ACTIONS_TARGET } from '../dialogActions';
import type { FileItem } from '../../fileTree';

const {
  folders, items, activeId, activeFolder, content, saving, msg, title,
  actions, openFile, newFile, flushSave,
} = useFileWorkbench({ tool: 'notepad', defaultExt: '.txt' });

const { format: formatApi } = useProjects();

const actionsTarget = inject(DIALOG_ACTIONS_TARGET, '');

const SORT_BTNS: Array<{ mode: SortMode; key: string }> = [
  { mode: 'asc', key: 'fp.sort.short.asc' },
  { mode: 'desc', key: 'fp.sort.short.desc' },
  { mode: 'num-asc', key: 'fp.sort.short.num_asc' },
  { mode: 'num-desc', key: 'fp.sort.short.num_desc' },
];

const MINIFY_EXT = ['js', 'mjs', 'cjs', 'jsx', 'json'];

const view = ref<EditorView | null>(null);
const b64Open = ref(false);
const b64Panel = ref<InstanceType<typeof Base64Panel> | null>(null);
const minifying = ref(false);
const formatting = ref(false);
const toolMsg = ref('');
const busy = computed(() => minifying.value || formatting.value);

const leafName = computed(() => activeId.value.slice(activeId.value.lastIndexOf('/') + 1));
const ext = computed(() => {
  const id = activeId.value;
  const i = id.lastIndexOf('.');
  return i >= 0 ? id.slice(i + 1).toLowerCase() : '';
});
const canMinify = computed(() => !!activeId.value && MINIFY_EXT.includes(ext.value));
const canFormat = computed(() => !!activeId.value && canFormatExt(ext.value));
const message = computed(() => toolMsg.value || msg.value);

function onEditorReady(v: EditorView) {
  view.value = v;
  v.dispatch({
    effects: StateEffect.appendConfig.of(EditorView.updateListener.of((u) => {
      if ((u.docChanged || u.selectionSet) && b64Open.value) b64Panel.value?.refresh();
    })),
  });
}

function currentText(): string {
  const v = view.value;
  if (!v) return content.value;
  const s = v.state.selection.main;
  return s.empty ? v.state.doc.toString() : v.state.sliceDoc(s.from, s.to);
}

function selectFolder(path: string) { activeFolder.value = path; }
function openItem(item: FileItem) { toolMsg.value = ''; void openFile(item); }

function applySort(mode: SortMode) {
  if (!activeId.value) return;
  content.value = sortText(content.value, mode);
}
function applyDedup() {
  if (!activeId.value) return;
  content.value = dedupText(content.value);
}

async function applyMinify() {
  if (!canMinify.value || busy.value) return;
  minifying.value = true;
  toolMsg.value = '';
  try {
    const r = await formatApi(leafName.value, content.value);
    content.value = r.content;
    toolMsg.value = t('np.minified');
  } catch (e) {
    toolMsg.value = t('np.minify_failed', { msg: (e as Error)?.message || String(e) });
  } finally {
    minifying.value = false;
  }
}

async function applyFormat() {
  if (!canFormat.value || busy.value) return;
  formatting.value = true;
  toolMsg.value = '';
  try {
    const out = await formatText(content.value, ext.value);
    if (out !== content.value) { content.value = out; toolMsg.value = t('np.formatted'); }
    else toolMsg.value = t('np.format_optimal');
  } catch (e) {
    toolMsg.value = t('np.format_failed', { msg: (e as Error)?.message || String(e) });
  } finally {
    formatting.value = false;
  }
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
      <Teleport :to="actionsTarget || 'body'" :disabled="!actionsTarget" defer>
        <div class="npbar">
          <span class="npname">{{ title || $t('files.no_file') }}</span>
          <button class="npbtn primary" :disabled="!activeId || saving" @click="flushSave">{{ $t('files.save') }}</button>
          <button v-for="b in SORT_BTNS" :key="b.mode" class="npbtn" :disabled="!activeId" @click="applySort(b.mode)">{{ $t(b.key) }}</button>
          <button class="npbtn" :disabled="!activeId" @click="applyDedup">{{ $t('np.dedup') }}</button>
          <button class="npbtn" :class="{ on: b64Open }" :disabled="!activeId" @click="b64Open = !b64Open">{{ $t('np.b64') }}</button>
          <button class="npbtn" :disabled="!canMinify || busy" @click="applyMinify">{{ minifying ? $t('np.minifying') : $t('np.minify') }}</button>
          <button class="npbtn" :disabled="!canFormat || busy" @click="applyFormat">{{ $t('np.format') }}</button>
        </div>
      </Teleport>
      <div class="npmsgrow"><div v-if="message" class="npmsg">{{ message }}</div></div>
      <CodeEditor v-model="content" class="nparea" :language="activeId" :disabled="!activeId" :placeholder="$t('files.no_file')" @ready="onEditorReady" />
      <Base64Panel v-if="b64Open && activeId" ref="b64Panel" :get-text="currentText" />
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
.npbtn.on { border-color: var(--ac); color: var(--ac2); }
.npbtn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.npbtn:disabled { opacity: .55; cursor: default; }
/* 提示信息固定占一行，避免出现/消失时内容上下跳动 */
.npmsgrow { min-height: 16px; }
.npmsg { color: var(--tx3); font-size: 12px; line-height: 16px; }
.nparea { flex: 1; --cm-min: 220px; }
</style>
