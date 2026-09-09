<script setup lang="ts">
import { ref, watch, computed, nextTick, onBeforeUnmount } from 'vue';
import { EditorView, basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import 'highlight.js/styles/github-dark.css';
import '../styles/markdown.css';
import { useProjects } from '../useProjects';
import { isMarkdownFile, renderMarkdown, renderMermaid } from '../markdown';

const props = defineProps<{ projectId: string; path: string; name: string }>();
const { text, write, rawUrl } = useProjects();

const IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']);
const ext = computed(() => {
  const i = props.name.lastIndexOf('.');
  return i >= 0 ? props.name.slice(i + 1).toLowerCase() : '';
});
const kind = computed<'image' | 'pdf' | 'text'>(() => {
  if (IMG.has(ext.value)) return 'image';
  if (ext.value === 'pdf') return 'pdf';
  return 'text';
});
const isMd = computed(() => isMarkdownFile(props.name));
const viewMode = ref<'preview' | 'code'>(isMarkdownFile(props.name) ? 'preview' : 'code');
const showEditor = computed(() => kind.value === 'text' && (!isMd.value || viewMode.value === 'code'));

function cmLangFor(extension: string) {
  switch (extension) {
    case 'js': case 'mjs': case 'cjs': case 'jsx': return javascript();
    case 'ts': case 'tsx': case 'mts': return javascript({ typescript: true });
    case 'json': return json();
    case 'css': return css();
    case 'html': case 'xml': case 'svg': case 'vue': return html();
    case 'md': case 'markdown': return markdown();
    case 'py': return python();
    default: return null;
  }
}

const status = ref<'loading' | 'ok' | 'error'>('loading');
const errMsg = ref('');
const raw = ref('');
const size = ref(0);
const mdHtml = ref('');
const mdErr = ref('');
const mdBodyRef = ref<HTMLDivElement | null>(null);
let previewSeq = 0;

// —— 编辑 / 自动保存 ——
const editorHost = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveChain: Promise<void> = Promise.resolve();
const dirty = ref(false);
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
const saveMsg = ref('');
let disposed = false;

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}
function setSaveError(e: any) {
  saveState.value = 'error';
  saveMsg.value = String(e?.message || e);
}
async function doWrite(content: string) {
  saveState.value = 'saving';
  try {
    await write(props.projectId, props.path, content);
    if (disposed) return;
    saveState.value = 'saved';
    saveMsg.value = nowTime();
    dirty.value = false;
  } catch (e: unknown) {
    dirty.value = true;
    setSaveError(e);
  }
}
function scheduleSave() {
  dirty.value = true;
  saveState.value = 'idle';
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flush(), 800);
}
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!view || !dirty.value) return;
  const snapshot = view.state.doc.toString();
  saveChain = saveChain.then(() => doWrite(snapshot)).catch(() => { /* doWrite 已处理 */ });
}
function docChanged() {
  if (!view) return;
  raw.value = view.state.doc.toString();   // 供 md 预览实时使用
  scheduleSave();
}
function mountEditor(doc: string) {
  if (!editorHost.value || view) return;
  const lang = cmLangFor(ext.value);
  view = new EditorView({
    doc,
    extensions: [
      basicSetup,
      oneDark,
      EditorView.lineWrapping,
      ...(lang ? [lang] : []),
      EditorView.updateListener.of((u) => { if (u.docChanged) docChanged(); }),
    ],
    parent: editorHost.value,
  });
}
function requestMeasure() {
  requestAnimationFrame(() => { view?.requestMeasure(); });
}

async function load() {
  status.value = 'loading';
  errMsg.value = '';
  try {
    const f = await text(props.projectId, props.path);
    size.value = f.size;
    raw.value = f.content;
    status.value = 'ok';
    if (kind.value === 'text' && showEditor.value) {
      await nextTick();
      mountEditor(f.content);
      requestMeasure();
    }
  } catch (e: any) {
    status.value = 'error';
    errMsg.value = String(e?.message || e);
  }
}

function fileDirOf(p: string) {
  const q = p.replace(/\\/g, '/');
  const i = q.lastIndexOf('/');
  return i >= 0 ? q.slice(0, i) : '';
}
async function applyPreview() {
  const seq = ++previewSeq;
  mdErr.value = '';
  if (viewMode.value !== 'preview' || status.value !== 'ok') return;
  try {
    mdHtml.value = renderMarkdown(raw.value, { projectId: props.projectId, fileDir: fileDirOf(props.path) });
  } catch (e: any) {
    mdErr.value = String(e?.message || e);
    return;
  }
  await nextTick();
  if (seq !== previewSeq) return;
  const body = mdBodyRef.value;
  if (!body) return;
  try {
    await renderMermaid(body);
  } catch (e: any) {
    mdErr.value = String(e?.message || e);
  }
}

function onRetrySave() { dirty.value = true; flush(); }

watch(() => [props.projectId, props.path], load, { immediate: true });
watch(viewMode, (m) => {
  applyPreview();
  if (m === 'code') { nextTick(() => { mountEditor(raw.value); requestMeasure(); }); }
  else { flush(); }   // 切到预览前先把编辑落盘
});
watch([status, viewMode], applyPreview);

onBeforeUnmount(() => {
  disposed = true;
  flush();
  if (view) { view.destroy(); view = null; }
});
</script>

<template>
  <div class="preview">
    <img v-if="kind === 'image'" :src="rawUrl(projectId, path)" class="img" alt="" />
    <iframe v-else-if="kind === 'pdf'" :src="rawUrl(projectId, path)" class="pdf" />
    <template v-else>
      <div class="head">
        <span class="meta">{{ name }}<template v-if="status === 'ok'"> · {{ (size / 1024).toFixed(1) }} KB</template></span>
        <div class="right">
          <span v-if="saveState === 'saving'" class="save saveing">保存中…</span>
          <span v-else-if="saveState === 'saved'" class="save saveok">✓ {{ saveMsg }} 已保存</span>
          <span v-else-if="saveState === 'error'" class="save saveerr" title="点击重试" @click="onRetrySave">⚠ 保存失败：{{ saveMsg }}</span>
          <div v-if="isMd" class="seg">
            <button type="button" :class="{ on: viewMode === 'preview' }" @click="viewMode = 'preview'">预览</button>
            <button type="button" :class="{ on: viewMode === 'code' }" @click="viewMode = 'code'">代码</button>
          </div>
        </div>
      </div>
      <div v-if="status === 'loading'" class="note">加载中…</div>
      <div v-else-if="status === 'error'" class="note err">打开失败：{{ errMsg }}</div>
      <template v-else>
        <div v-show="isMd && viewMode === 'preview'" class="scroll">
          <div v-if="mdErr" class="note err">{{ mdErr }}</div>
          <div v-show="!mdErr" ref="mdBodyRef" class="md-body" v-html="mdHtml" />
        </div>
        <div v-show="showEditor" ref="editorHost" class="editor" />
      </template>
    </template>
  </div>
</template>

<style scoped>
.preview { display: flex; flex-direction: column; height: 100%; background: #0e1116; overflow: hidden; }
.img { max-width: 100%; max-height: 100%; object-fit: contain; margin: auto; }
.pdf { width: 100%; height: 100%; border: none; background: #fff; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: none; padding: 2px 10px; border-bottom: 1px solid #1e242e; }
.meta { color: #8b96a5; font-size: 11px; }
.right { display: flex; align-items: center; gap: 10px; }
.save { font-size: 11px; }
.saveok { color: #22c55e; }
.saveing { color: #eab308; }
.saveerr { color: #fca5a5; cursor: pointer; }
.seg { display: flex; gap: 2px; background: #141920; border: 1px solid #242c38; border-radius: 4px; padding: 1px; }
.seg button { background: transparent; border: none; color: #8b96a5; font-size: 11px; padding: 2px 10px; cursor: pointer; border-radius: 3px; }
.seg button.on { background: #2f6feb; color: #fff; }
.scroll { flex: 1; overflow: auto; min-height: 0; padding: 14px 20px 40px; }
.editor { flex: 1; min-height: 0; overflow: auto; }
.editor :deep(.cm-editor) { height: 100%; font-size: 12.5px; }
.editor :deep(.cm-editor.cm-focused) { outline: none; }
.note { color: #8b96a5; padding: 16px; }
.note.err { color: #fca5a5; }
</style>
