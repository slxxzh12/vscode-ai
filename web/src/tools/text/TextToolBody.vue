<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { t } from '../../i18n';
import { parseYamlDoc, serializeYamlDoc } from '../../yaml';
import { useFileWorkbench } from '../files/useFileWorkbench';
import FileSidebar from '../../components/FileSidebar.vue';
import CodeEditor from '../../components/CodeEditor.vue';
import { DIALOG_ACTIONS_TARGET } from '../dialogActions';
import type { FileItem } from '../../fileTree';

type TextTool = 'yaml' | 'translate';

const props = defineProps<{ tool: TextTool }>();

const EXT: Record<TextTool, string> = { yaml: '.yaml', translate: '.txt' };
const LABEL: Record<TextTool, string> = { yaml: 'tools.yaml', translate: 'tools.translate' };
const LANG: Record<TextTool, string> = { yaml: 'doc.yaml', translate: '' };

const {
  folders, items, activeId, activeFolder, content, saving, msg, title, actions,
  openFile, newFile, flushSave,
} = useFileWorkbench({ tool: props.tool, defaultExt: EXT[props.tool] });

const actionsTarget = inject(DIALOG_ACTIONS_TARGET, '');

const output = ref('');
const busy = ref(false);
const runMsg = ref('');
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const message = computed(() => runMsg.value || msg.value);
const sidebarKey = `devflow-${props.tool}-collapsed`;

function fail(e: unknown) {
  runMsg.value = t('tools.failed', { msg: (e as Error)?.message || String(e) });
}

async function runTranslate() {
  if (busy.value) return;
  if (!content.value.trim()) { runMsg.value = t('et.empty'); return; }
  busy.value = true; runMsg.value = '';
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: content.value }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) { runMsg.value = t('et.failed', { msg: j.message || j.error || `HTTP ${res.status}` }); return; }
    output.value = j.text || '';
  } catch (e) { fail(e); } finally { busy.value = false; }
}

function runYaml(format: boolean) {
  const { doc, error } = parseYamlDoc(content.value);
  if (error || !doc) { runMsg.value = t('tools.yaml_fail', { msg: error || 'invalid' }); return; }
  runMsg.value = t('tools.yaml_ok');
  if (format) output.value = serializeYamlDoc(doc);
}

function useOutputAsInput() {
  if (!output.value) return;
  content.value = output.value;
  output.value = '';
  runMsg.value = '';
}
async function copyOut() {
  if (!output.value) return;
  try { await navigator.clipboard.writeText(output.value); }
  catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = output.value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch { /* ignore */ }
  }
  copied.value = true;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copied.value = false; copyTimer = null; }, 2000);
}

function selectFolder(path: string) { activeFolder.value = path; }
function openItem(item: FileItem) { output.value = ''; runMsg.value = ''; void openFile(item); }
function clearAll() { content.value = ''; output.value = ''; runMsg.value = ''; }
</script>

<template>
  <div class="ttbody">
    <FileSidebar
      :folders="folders"
      :items="items"
      :active-folder="activeFolder"
      :active-id="activeId"
      :actions="actions"
      :storage-key="sidebarKey"
      :title="$t(LABEL[tool])"
      @select-folder="selectFolder"
      @select-item="openItem"
      @new-file="newFile"
    />

    <div class="ttmain">
      <Teleport :to="actionsTarget || 'body'" :disabled="!actionsTarget" defer>
        <div class="mtacts">
          <span class="mtname">{{ title || $t('files.no_file') }}</span>
          <button class="mtbtn" :disabled="!activeId || saving" @click="flushSave">{{ $t('files.save') }}</button>
          <template v-if="tool === 'translate'">
            <button class="mtbtn primary" :disabled="busy" @click="runTranslate">{{ busy ? $t('term.translating') : $t('tools.run') }}</button>
          </template>
          <template v-else-if="tool === 'yaml'">
            <button class="mtbtn" @click="runYaml(false)">{{ $t('tools.yaml_check') }}</button>
            <button class="mtbtn primary" @click="runYaml(true)">{{ $t('tools.yaml_format') }}</button>
          </template>
        </div>
      </Teleport>

      <div class="mtmsgrow"><div v-if="message" class="mtmsg">{{ message }}</div></div>

      <CodeEditor v-model="content" class="mtarea" :language="LANG[tool]" :placeholder="$t('tools.input')" />
      <div class="mtout">
        <CodeEditor v-model="output" class="mtarea" :language="LANG[tool]" readonly :placeholder="$t('tools.output')" />
        <div class="mtoutacts">
          <button class="mtmini" :disabled="!output" @click="copyOut">{{ copied ? $t('tools.copied') : $t('tools.copy') }}</button>
          <button class="mtmini" :disabled="!output" @click="useOutputAsInput">{{ $t('tools.to_input') }}</button>
          <button class="mtmini" @click="clearAll">{{ $t('tools.clear') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ttbody { display: flex; flex-direction: row; gap: 12px; height: calc(100vh - 150px); }
.ttmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.mtacts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.mtname { flex: 1; min-width: 0; color: var(--tx2); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mtbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.mtbtn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.mtbtn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.mtbtn:disabled { opacity: .55; cursor: default; }
/* 提示信息固定占一行，避免出现/消失时内容上下跳动 */
.mtmsgrow { min-height: 16px; }
.mtmsg { color: var(--tx3); font-size: 12px; line-height: 16px; }
.mtarea { flex: 1; --cm-min: 140px; }
.mtout { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
.mtout .mtarea { --cm-min: 120px; }
.mtoutacts { display: flex; gap: 8px; justify-content: flex-end; }
.mtmini { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
.mtmini:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.mtmini:disabled { opacity: .5; cursor: default; }
</style>
