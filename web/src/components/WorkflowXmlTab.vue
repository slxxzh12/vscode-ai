<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { EditorView, basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { xml } from '@codemirror/lang-xml';
import { serializeWorkflowsFragment, parseWorkflowsXml } from '@devflow/shared/workflow-xml';
import { useTheme } from '../theme';
import type { Workflow } from '../workflowModel';

const props = defineProps<{ model: Workflow[] }>();
const emit = defineEmits<{ (e: 'update:model', m: Workflow[]): void }>();

const { isDark } = useTheme();
const host = ref<HTMLDivElement | null>(null);
const text = ref(serializeWorkflowsFragment(props.model));
const xmlError = ref('');
let view: EditorView | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let handEdited = false;
let applying = false;
let justEmitted = false;

function wellFormed(s: string): string {
  if (!s.trim()) return '';
  try {
    const doc = new DOMParser().parseFromString(s, 'application/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    return err ? (err.textContent || 'parse error') : '';
  } catch (e: any) {
    return String(e?.message || e);
  }
}

function parseNow() {
  const bad = wellFormed(text.value);
  if (bad) { xmlError.value = bad; return; }
  xmlError.value = '';
  const next = parseWorkflowsXml(text.value);
  if (JSON.stringify(next) !== JSON.stringify(props.model)) {
    justEmitted = true;
    emit('update:model', next);
  }
  handEdited = false;
}

function onDocChanged() {
  if (applying || !view) return;
  text.value = view.state.doc.toString();
  handEdited = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(parseNow, 300);
}

function setText(s: string) {
  text.value = s;
  if (!view) return;
  applying = true;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s } });
  applying = false;
}

function mount() {
  if (!host.value || view) return;
  view = new EditorView({
    doc: text.value,
    extensions: [
      basicSetup,
      ...(isDark.value ? [oneDark] : []),
      EditorView.lineWrapping,
      xml(),
      EditorView.updateListener.of((u) => { if (u.docChanged) onDocChanged(); }),
    ],
    parent: host.value,
  });
}

function refreshFromForm() {
  xmlError.value = '';
  handEdited = false;
  setText(serializeWorkflowsFragment(props.model));
}

watch(() => props.model, (m) => {
  if (justEmitted) { justEmitted = false; return; }
  if (!handEdited) setText(serializeWorkflowsFragment(m));
}, { deep: true });

watch(isDark, () => {
  if (!view) return;
  const doc = view.state.doc.toString();
  view.destroy();
  view = null;
  mount();
  setText(doc);
});

onMounted(mount);
onBeforeUnmount(() => { if (timer) clearTimeout(timer); view?.destroy(); view = null; });
</script>

<template>
  <div class="xmlwrap">
    <div class="bar">
      <button class="btn" @click="refreshFromForm">{{ $t('wfe.refresh_from_form') }}</button>
    </div>
    <div v-if="xmlError" class="err">{{ $t('wfe.xml_error', { msg: xmlError }) }}</div>
    <div ref="host" class="editor" />
  </div>
</template>

<style scoped>
.xmlwrap { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
.bar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.err { background: color-mix(in srgb, var(--err) 14%, transparent); color: var(--err); border: 1px solid var(--err); border-radius: 4px; padding: 4px 8px; font-size: 12px; white-space: pre-wrap; }
.editor { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--bd); border-radius: 6px; }
.editor :deep(.cm-editor) { height: 100%; }
.btn { background: var(--bg5); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; font-size: 12px; cursor: pointer; font-family: inherit; }
.btn:hover { border-color: var(--ac2); color: var(--tx1); }
</style>
