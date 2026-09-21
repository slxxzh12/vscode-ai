<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '../../i18n';
import CodeEditor from '../../components/CodeEditor.vue';
import { useToolWorkbench } from '../useToolWorkbench';

// 翻译工具（主区内容）：左侧目录树由 ToolSidebar 提供，这里只放「输入 → 输出」。
const wb = useToolWorkbench('translate');

const content = ref('');
const output = ref('');
const dirty = ref(false);
const saving = ref(false);
const busy = ref(false);
const copied = ref(false);
const msg = ref('');
const runMsg = ref('');
let loading = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const title = computed(() => wb.leafName.value || t('files.no_file'));
const message = computed(() => runMsg.value || msg.value);

function fail(e: unknown) {
  runMsg.value = t('tools.failed', { msg: (e as Error)?.message || String(e) });
}

async function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!wb.activeId.value || !dirty.value) return;
  saving.value = true;
  try {
    await wb.files.save(wb.activeId.value, content.value);
    dirty.value = false;
    msg.value = t('files.saved');
  } catch (e) {
    msg.value = t('files.save_failed', { msg: (e as Error)?.message || String(e) });
  } finally { saving.value = false; }
}
function scheduleSave() {
  dirty.value = true;
  msg.value = '';
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; void flush(); }, 1000);
}

// 活动文件变化：先落盘旧文件，再载入新文件
watch(() => wb.activeId.value, async (id) => {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (dirty.value) await flush();
  output.value = '';
  runMsg.value = '';
  if (!id) { loading = true; content.value = ''; loading = false; msg.value = ''; return; }
  try {
    const text = await wb.files.read(id);
    loading = true;
    content.value = text;
    loading = false;
    dirty.value = false;
    msg.value = '';
  } catch (e) {
    msg.value = t('files.open_failed', { msg: (e as Error)?.message || String(e) });
  }
}, { immediate: true });

watch(content, () => {
  if (loading || !wb.activeId.value) return;
  scheduleSave();
});

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
function clearAll() { content.value = ''; output.value = ''; runMsg.value = ''; }

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void flush(); }
}
onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  if (saveTimer) clearTimeout(saveTimer);
  if (copyTimer) clearTimeout(copyTimer);
});
</script>

<template>
  <div class="ttbody">
    <div class="ttmain">
      <div class="mtacts">
        <span class="mtname">{{ title }}</span>
        <button class="mtbtn" :disabled="!wb.activeId.value || saving" @click="flush">{{ $t('files.save') }}</button>
        <button class="mtbtn primary" :disabled="busy" @click="runTranslate">{{ busy ? $t('term.translating') : $t('tools.run') }}</button>
      </div>

      <div class="mtmsgrow"><div v-if="message" class="mtmsg">{{ message }}</div></div>

      <CodeEditor v-model="content" class="mtarea" :placeholder="$t('tools.input')" />
      <div class="mtout">
        <CodeEditor v-model="output" class="mtarea" readonly :placeholder="$t('tools.output')" />
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
.ttbody { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 0 2px; box-sizing: border-box; }
.ttmain { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
.mtacts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; flex: none; }
.mtname { flex: 1; min-width: 0; color: var(--tx2); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mtbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.mtbtn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.mtbtn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.mtbtn:disabled { opacity: .55; cursor: default; }
.mtmsgrow { min-height: 16px; flex: none; }
.mtmsg { color: var(--tx3); font-size: 12px; line-height: 16px; }
.mtarea { flex: 1; --cm-min: 140px; }
.mtout { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
.mtout .mtarea { --cm-min: 120px; }
.mtoutacts { display: flex; gap: 8px; justify-content: flex-end; flex: none; }
.mtmini { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
.mtmini:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.mtmini:disabled { opacity: .5; cursor: default; }
</style>
