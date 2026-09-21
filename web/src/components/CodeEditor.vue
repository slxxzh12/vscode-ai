<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { placeholder as cmPlaceholder } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { useTheme } from '../theme';
import { cmLangFor } from '../cmLang';

const props = withDefaults(defineProps<{
  modelValue: string;
  language?: string;
  readonly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  wrap?: boolean;
  autofocus?: boolean;
}>(), {
  language: '',
  readonly: false,
  disabled: false,
  placeholder: '',
  wrap: true,
  autofocus: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'change', value: string): void;
  (e: 'ready', view: EditorView): void;
  (e: 'blur'): void;
}>();

const host = ref<HTMLDivElement | null>(null);
const view = shallowRef<EditorView | null>(null);
const { isDark } = useTheme();

const themeC = new Compartment();
const langC = new Compartment();
const roC = new Compartment();
const phC = new Compartment();
let applying = false;

function langExt(name: string): Extension {
  return (name && cmLangFor(name)) || [];
}
function roExt(): Extension {
  const out: Extension[] = [];
  if (props.readonly || props.disabled) out.push(EditorState.readOnly.of(true));
  if (props.disabled) out.push(EditorView.editable.of(false));
  return out;
}
function phExt(p: string): Extension {
  return p ? cmPlaceholder(p) : [];
}
function themeExt(): Extension {
  return isDark.value ? oneDark : [];
}

onMounted(() => {
  if (!host.value) return;
  view.value = new EditorView({
    doc: props.modelValue,
    parent: host.value,
    extensions: [
      basicSetup,
      themeC.of(themeExt()),
      langC.of(langExt(props.language)),
      roC.of(roExt()),
      phC.of(phExt(props.placeholder)),
      ...(props.wrap ? [EditorView.lineWrapping] : []),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !applying) {
          const v = u.state.doc.toString();
          emit('update:modelValue', v);
          emit('change', v);
        }
        if (u.focusChanged && !u.view.hasFocus) emit('blur');
      }),
    ],
  });
  if (props.autofocus) view.value.focus();
  emit('ready', view.value);
});

onBeforeUnmount(() => { view.value?.destroy(); view.value = null; });

watch(() => props.modelValue, (val) => {
  const v = view.value;
  if (!v || val === v.state.doc.toString()) return;
  applying = true;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: val } });
  applying = false;
});
watch(isDark, () => view.value?.dispatch({ effects: themeC.reconfigure(themeExt()) }));
watch(() => props.language, (l) => view.value?.dispatch({ effects: langC.reconfigure(langExt(l)) }));
watch(() => [props.readonly, props.disabled], () => view.value?.dispatch({ effects: roC.reconfigure(roExt()) }));
watch(() => props.placeholder, (p) => view.value?.dispatch({ effects: phC.reconfigure(phExt(p)) }));

defineExpose({ view, focus: () => view.value?.focus() });
</script>

<template>
  <div ref="host" class="cmedit" :class="{ 'cmedit-off': disabled }" />
</template>

<style scoped>
.cmedit { display: flex; flex-direction: column; min-height: var(--cm-min, 64px); border: var(--cm-border, 1px solid var(--bd)); border-radius: var(--cm-radius, 6px); overflow: hidden; box-sizing: border-box; }
.cmedit:focus-within { border-color: var(--ac2); }
.cmedit :deep(.cm-editor) { flex: 1; min-height: 0; font-size: 12.5px; }
.cmedit :deep(.cm-editor.cm-focused) { outline: none; }
.cmedit :deep(.cm-scroller) { font-family: ui-monospace, Consolas, monospace; line-height: 1.6; overflow: auto; }
.cmedit :deep(.cm-content) { padding: 6px 0; }
.cmedit :deep(.cm-gutters) { border-right: 1px solid var(--bd); }
.cmedit-off { opacity: .55; }
</style>
