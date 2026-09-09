<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github-dark.css';
import '../styles/markdown.css';
import { useProjects } from '../useProjects';
import { isMarkdownFile, renderMarkdown, renderMermaid } from '../markdown';

const props = defineProps<{ projectId: string; path: string; name: string }>();
const { text, rawUrl } = useProjects();

const IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']);
const LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  json: 'json', css: 'css', scss: 'scss', html: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  md: 'markdown', sh: 'bash', bash: 'bash', ps1: 'powershell', yml: 'yaml', yaml: 'yaml', py: 'python',
};
const ext = computed(() => {
  const i = props.name.lastIndexOf('.');
  return i >= 0 ? props.name.slice(i + 1).toLowerCase() : '';
});
const kind = computed<'image' | 'pdf' | 'text'>(() => {
  if (IMG.has(ext.value)) return 'image';
  if (ext.value === 'pdf') return 'pdf';
  return 'text';
});
const imgUrl = computed(() => rawUrl(props.projectId, props.path));
const pdfUrl = computed(() => rawUrl(props.projectId, props.path));

const isMd = computed(() => isMarkdownFile(props.name));
const viewMode = ref<'preview' | 'code'>(isMarkdownFile(props.name) ? 'preview' : 'code');

const status = ref<'loading' | 'ok' | 'error'>('loading');
const errMsg = ref('');
const raw = ref('');
const code = ref('');
const size = ref(0);
const mdHtml = ref('');
const mdErr = ref('');
const mdBodyRef = ref<HTMLElement | null>(null);
let previewSeq = 0;

async function load() {
  status.value = 'loading';
  errMsg.value = '';
  try {
    const f = await text(props.projectId, props.path);
    size.value = f.size;
    raw.value = f.content;
    const l = LANG[ext.value];
    try {
      code.value = l ? hljs.highlight(f.content, { language: l }).value
        : hljs.highlightAuto(f.content).value;
    } catch {
      code.value = escapeHtml(f.content);
    }
    status.value = 'ok';
  } catch (e: any) {
    status.value = 'error';
    errMsg.value = String(e?.message || e);
  }
}
function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

watch(() => [props.projectId, props.path], load, { immediate: true });
watch([status, viewMode], applyPreview);
</script>

<template>
  <div class="preview">
    <img v-if="kind === 'image'" :src="imgUrl" class="img" alt="" />
    <iframe v-else-if="kind === 'pdf'" :src="pdfUrl" class="pdf" />
    <template v-else>
      <div class="head">
        <span class="meta">{{ name }}<template v-if="status === 'ok'"> · {{ (size / 1024).toFixed(1) }} KB</template></span>
        <div v-if="isMd" class="seg">
          <button type="button" :class="{ on: viewMode === 'code' }" @click="viewMode = 'code'">代码</button>
          <button type="button" :class="{ on: viewMode === 'preview' }" @click="viewMode = 'preview'">预览</button>
        </div>
      </div>
      <div v-if="status === 'loading'" class="note">加载中…</div>
      <div v-else-if="status === 'error'" class="note err">打开失败：{{ errMsg }}</div>
      <template v-else>
        <div v-show="viewMode === 'preview'" class="scroll">
          <div v-if="mdErr" class="note err">{{ mdErr }}</div>
          <div v-show="!mdErr" ref="mdBodyRef" class="md-body" v-html="mdHtml" />
        </div>
        <pre v-show="viewMode === 'code'" class="hljs-pre"><code class="hljs" v-html="code" /></pre>
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
.seg { display: flex; gap: 2px; background: #141920; border: 1px solid #242c38; border-radius: 4px; padding: 1px; }
.seg button { background: transparent; border: none; color: #8b96a5; font-size: 11px; padding: 2px 10px; cursor: pointer; border-radius: 3px; }
.seg button.on { background: #2f6feb; color: #fff; }
.scroll { flex: 1; overflow: auto; min-height: 0; padding: 14px 20px 40px; }
.hljs-pre { flex: 1; margin: 0; overflow: auto; padding: 10px 12px; font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; line-height: 1.5; }
.hljs-pre :deep(code.hljs) { background: transparent; padding: 0; }
.note { color: #8b96a5; padding: 16px; }
.note.err { color: #fca5a5; }
</style>
