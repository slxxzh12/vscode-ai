<script setup lang="ts">
import { ref, watch, computed, nextTick, onBeforeUnmount } from 'vue';
import { EditorView, basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { useTheme } from '../theme';
import { StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { php } from '@codemirror/lang-php';
import { sql } from '@codemirror/lang-sql';
import { sass } from '@codemirror/lang-sass';
import { go } from '@codemirror/legacy-modes/mode/go';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import '../styles/markdown.css';
import { useProjects } from '../useProjects';
import { isMarkdownFile, renderMarkdown, renderMermaid } from '../markdown';

const props = defineProps<{ projectId: string; path: string; name: string }>();
const { text, write, rawUrl, format } = useProjects();
const { isDark } = useTheme();

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
const isHtmlFile = computed(() => ['html', 'htm'].includes(ext.value));
const hasPreviewToggle = computed(() => isMd.value || isHtmlFile.value);
const canMinify = computed(() => ['js', 'mjs', 'cjs', 'jsx', 'json'].includes(ext.value) && kind.value === 'text');
const canSort = computed(() => kind.value === 'text' && status.value === 'ok' && showEditor.value);
const viewMode = ref<'preview' | 'code'>(isMarkdownFile(props.name) || isHtmlFile.value ? 'preview' : 'code');
const showEditor = computed(() => kind.value === 'text' && (!hasPreviewToggle.value || viewMode.value === 'code'));

function cmLangFor(extension: string) {
  const L = (m: any) => StreamLanguage.define(m);
  switch (extension) {
    case 'js': case 'mjs': case 'cjs': case 'jsx': return javascript();
    case 'ts': case 'tsx': case 'mts': return javascript({ typescript: true });
    case 'json': return json();
    case 'css': return css();
    case 'html': case 'htm': case 'xml': case 'svg': case 'vue': return html();
    case 'md': case 'markdown': return markdown();
    case 'py': return python();
    case 'java': return java();
    case 'c': case 'h': case 'cc': case 'cpp': case 'cxx': case 'hpp': case 'hh': case 'cs': return cpp();
    case 'php': return php();
    case 'sql': return sql();
    case 'sass': case 'scss': return sass();
    case 'go': return L(go);
    case 'rs': return L(rust);
    case 'sh': case 'bash': case 'zsh': case 'ksh': return L(shell);
    case 'ps1': return L(powerShell);
    case 'yml': case 'yaml': return L(yaml);
    case 'toml': return L(toml);
    case 'dockerfile': case 'Dockerfile': return L(dockerFile);
    case 'lua': return L(lua);
    case 'swift': return L(swift);
    case 'rb': case 'ruby': return L(ruby);
    case 'pl': case 'pm': return L(perl);
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
      ...(isDark.value ? [oneDark] : []),
      EditorView.lineWrapping,
      ...(lang ? [lang] : []),
      EditorView.updateListener.of((u) => { if (u.docChanged) docChanged(); }),
    ],
    parent: editorHost.value,
  });
}
watch(isDark, () => {
  if (!view) return;
  const doc = view.state.doc.toString();
  view.destroy();
  view = null;
  mountEditor(doc);
  requestMeasure();
});
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

// —— 压缩成一行（js/json）——
const minifying = ref(false);
async function minifyOneLine() {
  if (!view || minifying.value) return;
  const src = view.state.doc.toString();
  minifying.value = true;
  try {
    const r = await format(props.name, src);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: r.content } });
    requestMeasure();
  } catch (e: any) {
    alert(`压缩失败：${e?.message || e}`);
  } finally {
    minifying.value = false;
  }
}

// —— 文本排序 ——
type SortMode = 'asc' | 'desc' | 'asc-ci' | 'desc-ci' | 'num-asc' | 'num-desc';
const sortOpen = ref(false);
const SORT_ITEMS: Array<{ mode: SortMode; label: string }> = [
  { mode: 'asc', label: '升序排列（A-Z）' },
  { mode: 'desc', label: '降序排列（Z-A）' },
  { mode: 'asc-ci', label: '升序排列（不分大小写）' },
  { mode: 'desc-ci', label: '降序排列（不分大小写）' },
  { mode: 'num-asc', label: '按数字大小升序' },
  { mode: 'num-desc', label: '按数字大小降序' },
];
function leadingNumber(s: string): number | null {
  const m = s.trim().match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function numVal(s: string): number {
  const v = leadingNumber(s);
  return v ?? Number.MAX_SAFE_INTEGER;   // 非数字排最后
}
function sortLines(mode: SortMode): string {
  if (!view) return '';
  let text = view.state.doc.toString();
  const endsNL = text.endsWith('\n');
  let lines = text.split('\n');
  if (endsNL) lines.pop();
  const asc = (a: string, b: string) => { const an = a.toLowerCase(), bn = b.toLowerCase(); return an < bn ? -1 : an > bn ? 1 : 0; };
  const raw = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  switch (mode) {
    case 'asc': lines.sort(raw); break;
    case 'desc': lines.sort((a, b) => raw(b, a)); break;
    case 'asc-ci': lines.sort(asc); break;
    case 'desc-ci': lines.sort((a, b) => asc(b, a)); break;
    case 'num-asc': lines.sort((a, b) => numVal(a) - numVal(b)); break;
    case 'num-desc': lines.sort((a, b) => numVal(b) - numVal(a)); break;
  }
  let out = lines.join('\n');
  if (endsNL) out += '\n';
  return out;
}
function applySort(mode: SortMode) {
  if (!view) return;
  const out = sortLines(mode);
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: out } });
  sortOpen.value = false;
  requestMeasure();
}
let unbindSort: (() => void) | null = null;
watch(sortOpen, (o) => {
  if (o) {
    const h = (e: Event) => { const t = e.target as HTMLElement | null; if (t && !t.closest('.sortwrap')) sortOpen.value = false; };
    document.addEventListener('pointerdown', h, true);
    unbindSort = () => document.removeEventListener('pointerdown', h, true);
  } else if (unbindSort) { unbindSort(); unbindSort = null; }
});

// —— 一键格式化（Prettier 按需加载）——
const fmtMsg = ref('');
let fmtTimer: ReturnType<typeof setTimeout> | null = null;
const PARSER_BY_EXT: Record<string, string> = {
  js: 'babel', mjs: 'babel', cjs: 'babel', jsx: 'babel',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  json: 'json', css: 'css', html: 'html', htm: 'html',
  md: 'markdown', markdown: 'markdown', yml: 'yaml', yaml: 'yaml',
};
const canFormat = computed(() => kind.value === 'text' && !!PARSER_BY_EXT[ext.value]);
function flashFmt(m: string) {
  fmtMsg.value = m;
  if (fmtTimer) clearTimeout(fmtTimer);
  fmtTimer = setTimeout(() => { fmtMsg.value = ''; }, 2600);
}
async function formatDoc() {
  if (!view || !canFormat.value) return;
  const parser = PARSER_BY_EXT[ext.value];
  const doc = view.state.doc.toString();
  try {
    const [{ default: prettierAny }, babelM, estreeM, tsM, htmlM, postcssM, mdM] = await Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
      import('prettier/plugins/typescript'),
      import('prettier/plugins/html'),
      import('prettier/plugins/postcss'),
      import('prettier/plugins/markdown'),
    ]);
    const prettier = (prettierAny as any).default ?? prettierAny;
    const pl = (m: any) => (m.default ?? m);
    const plugins = [pl(babelM), pl(estreeM), pl(tsM), pl(htmlM), pl(postcssM), pl(mdM)];
    const out = await prettier.format(doc, { parser, plugins });
    if (out !== doc) {
      view.dispatch({ changes: { from: 0, to: doc.length, insert: out } });
      flashFmt('✓ 已格式化');
    } else {
      flashFmt('格式已是最佳');
    }
  } catch (e: any) {
    flashFmt(`格式化失败：${e?.message || e}`);
  }
}

watch(() => [props.projectId, props.path], load, { immediate: true });
watch(viewMode, (m) => {
  applyPreview();
  if (m === 'code') { nextTick(() => { mountEditor(raw.value); requestMeasure(); }); }
  else { flush(); }   // 切到预览前先把编辑落盘
});
watch([status, viewMode], applyPreview);

onBeforeUnmount(() => {
  disposed = true;
  unbindSort?.();
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
          <span v-if="fmtMsg" class="save fmtmsg" :class="{ ok: fmtMsg.startsWith('✓') }">{{ fmtMsg }}</span>
          <button v-if="canFormat && showEditor" class="fmt-btn" title="格式化代码" @click="formatDoc">⇥ 格式化</button>
          <button v-if="canMinify && showEditor && status === 'ok'" class="fmt-btn" :disabled="minifying" title="压缩成一行（js/json）" @click="minifyOneLine">{{ minifying ? '压缩中…' : '⇣ 压成一行' }}</button>
          <span v-if="canSort" class="sortwrap">
            <button class="fmt-btn" :class="{ on: sortOpen }" title="文本排序" @click.stop="sortOpen = !sortOpen">⇅ 排序 ▾</button>
            <div v-if="sortOpen" class="sortmenu" @click.stop>
              <button v-for="s in SORT_ITEMS" :key="s.mode" @click="applySort(s.mode)">{{ s.label }}</button>
            </div>
          </span>
          <div v-if="hasPreviewToggle" class="seg">
            <button type="button" :class="{ on: viewMode === 'preview' }" @click="viewMode = 'preview'">预览</button>
            <button type="button" :class="{ on: viewMode === 'code' }" @click="viewMode = 'code'">{{ isHtmlFile ? '源码' : '代码' }}</button>
          </div>
        </div>
      </div>
      <div v-if="status === 'loading'" class="note">加载中…</div>
      <div v-else-if="status === 'error'" class="note err">打开失败：{{ errMsg }}</div>
      <template v-else>
        <div v-show="viewMode === 'preview'" class="pane">
          <div v-if="isMd" class="scroll">
            <div v-if="mdErr" class="note err">{{ mdErr }}</div>
            <div v-show="!mdErr" ref="mdBodyRef" class="md-body" v-html="mdHtml" />
          </div>
          <iframe v-else-if="isHtmlFile" class="html-frame" :srcdoc="raw" sandbox="allow-scripts allow-modals" />
        </div>
        <div v-show="showEditor" ref="editorHost" class="editor" />
      </template>
    </template>
  </div>
</template>

<style scoped>
.preview { display: flex; flex-direction: column; height: 100%; background: var(--bg3); overflow: hidden; }
.img { max-width: 100%; max-height: 100%; object-fit: contain; margin: auto; }
.pdf { width: 100%; height: 100%; border: none; background: #fff; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: none; padding: 2px 10px; border-bottom: 1px solid var(--bd2); }
.meta { color: var(--tx3); font-size: 11px; }
.right { display: flex; align-items: center; gap: 10px; }
.save { font-size: 11px; }
.saveok { color: var(--ok); }
.saveing { color: var(--warn); }
.saveerr { color: var(--errtx); cursor: pointer; }
.fmtmsg { color: var(--tx3); }
.fmtmsg.ok { color: var(--ok); }
.fmt-btn { background: transparent; border: 1px solid var(--bd); color: var(--tx3); font-size: 11px; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-family: inherit; }
.fmt-btn:hover { border-color: var(--ac2); color: var(--tx1); }
.fmt-btn { background: none; border: 1px solid var(--bd); color: var(--tx2); font-size: 11px; padding: 1px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.fmt-btn:hover, .fmt-btn.on { border-color: var(--ac2); color: var(--ac2); }
.fmt-btn:disabled { opacity: .5; cursor: default; }
.sortwrap { position: relative; }
.sortmenu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 60; min-width: 210px; background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; box-shadow: 0 8px 26px rgba(0,0,0,.35); padding: 4px; display: flex; flex-direction: column; }
.sortmenu button { text-align: left; background: none; border: none; color: var(--tx); padding: 6px 10px; font-size: 12px; cursor: pointer; border-radius: 4px; font-family: inherit; }
.sortmenu button:hover { background: var(--ac); color: var(--onac); }
.seg { display: flex; gap: 2px; background: var(--bg2); border: 1px solid var(--bd3); border-radius: 4px; padding: 1px; }
.seg button { background: transparent; border: none; color: var(--tx3); font-size: 11px; padding: 2px 10px; cursor: pointer; border-radius: 3px; }
.seg button.on { background: var(--ac); color: var(--onac); }
.pane { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.scroll { flex: 1; overflow: auto; min-height: 0; padding: 14px 20px 40px; }
.html-frame { display: block; width: 100%; height: 100%; border: none; background: #fff; }
.editor { flex: 1; min-height: 0; overflow: auto; }
.editor :deep(.cm-editor) { height: 100%; font-size: 12.5px; }
.editor :deep(.cm-editor.cm-focused) { outline: none; }
.note { color: var(--tx3); padding: 16px; }
.note.err { color: var(--errtx); }
</style>
