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
import { useProjects, type FileMeta } from '../useProjects';
import { isMarkdownFile, renderMarkdown, renderMermaid } from '../markdown';
import { parseCurl, type CurlRequest } from '../curl';

const props = defineProps<{ projectId: string; path: string; name: string; detailToken?: number; detailPath?: string }>();
const { text, write, rawUrl, format, runScript, fileMeta, fileHash } = useProjects();
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
const canB64 = computed(() => kind.value === 'text' && status.value === 'ok' && showEditor.value);
const RUN_EXT = new Set(['bat', 'cmd', 'ps1', 'sh']);
const canRun = computed(() => RUN_EXT.has(ext.value) && kind.value === 'text' && status.value === 'ok');
const canCurl = computed(() => kind.value === 'text' && status.value === 'ok' && /\bcurl\b/.test(raw.value || ''));
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
const fileAbs = ref('');
const fileMtime = ref(0);
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

// —— 底部常驻状态栏：最近一次工具反馈（保存状态单独在最左）——
const toolMsg = ref('');
const toolOk = ref(true);
function setToolMsg(text: string, ok = true) {
  toolMsg.value = text;
  toolOk.value = ok;
}

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
function fmtMtime(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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
  if (b64Open.value) refreshB64Encode();
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
      EditorView.updateListener.of((u) => {
        if (u.docChanged) docChanged();
        if (u.selectionSet && b64Open.value) refreshB64Encode();
      }),
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
  toolMsg.value = '';
  resetB64Panel();
  closeDetail();
  status.value = 'loading';
  errMsg.value = '';
  try {
    const f = await text(props.projectId, props.path);
    size.value = f.size;
    fileAbs.value = f.abs || '';
    fileMtime.value = f.mtime || 0;
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
    setToolMsg('✓ 已压缩为一行');
  } catch (e: any) {
    setToolMsg(`压缩失败：${e?.message || e}`, false);
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
const SORT_LABEL: Record<SortMode, string> = {
  asc: '升序', desc: '降序', 'asc-ci': '升序（不分大小写）', 'desc-ci': '降序（不分大小写）',
  'num-asc': '数字升序', 'num-desc': '数字降序',
};
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
  setToolMsg(`✓ 已按${SORT_LABEL[mode]}排列`);
}
let unbindSort: (() => void) | null = null;
watch(sortOpen, (o) => {
  if (o) {
    const h = (e: Event) => { const t = e.target as HTMLElement | null; if (t && !t.closest('.sortwrap')) sortOpen.value = false; };
    document.addEventListener('pointerdown', h, true);
    unbindSort = () => document.removeEventListener('pointerdown', h, true);
  } else if (unbindSort) { unbindSort(); unbindSort = null; }
});

// —— Base64 编解码结果面板 ——
const b64Open = ref(false);
const b64EncodeOut = ref('');
const b64DecodeInput = ref('');
const b64DecodeOut = ref('');
const b64DecodeErr = ref('');
function encodeB64(src: string): string {
  return btoa(unescape(encodeURIComponent(src)));
}
function decodeB64(src: string): string {
  return decodeURIComponent(escape(atob(src.trim())));
}
function currentText(): string {
  if (!view) return '';
  const s = view.state.selection.main;
  return s.empty ? view.state.doc.toString() : view.state.sliceDoc(s.from, s.to);
}
function refreshB64Encode() {
  if (!b64Open.value) return;
  try {
    b64EncodeOut.value = encodeB64(currentText());
  } catch {
    b64EncodeOut.value = '';
  }
}
function refreshB64Decode() {
  const src = b64DecodeInput.value;
  b64DecodeErr.value = '';
  b64DecodeOut.value = '';
  if (!src.trim()) return;
  try {
    b64DecodeOut.value = decodeB64(src);
  } catch {
    b64DecodeErr.value = '不是合法的 Base64 内容';
  }
}
watch(b64DecodeInput, refreshB64Decode);
function fallbackCopy(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  document.execCommand('copy'); ta.remove();
}
async function b64Copy(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    fallbackCopy(text);
  }
}
function feedDecodeFromEncode() {
  b64DecodeInput.value = b64EncodeOut.value;   // watch 自动触发解码
}
function toggleB64() {
  b64Open.value = !b64Open.value;
  if (b64Open.value) { refreshB64Encode(); refreshB64Decode(); }
}
function resetB64Panel() {
  b64Open.value = false;
  b64EncodeOut.value = '';
  b64DecodeInput.value = '';
  b64DecodeOut.value = '';
  b64DecodeErr.value = '';
}

// —— 文件详细信息 ——
const HASH_WARN = 50 * 1024 * 1024;
const detailOpen = ref(false);
const detail = ref<FileMeta | null>(null);
const detailErr = ref('');
const hashing = ref(false);
const hashMd5 = ref('');
const hashSha256 = ref('');
const hashErr = ref('');
const kindLabel = computed(() => ({ image: '图片', pdf: 'PDF', text: '文本' })[kind.value] || '文件');
let seenDetail = -1;
async function openDetail() {
  detailErr.value = '';
  detail.value = null;
  hashMd5.value = '';
  hashSha256.value = '';
  hashErr.value = '';
  try {
    detail.value = await fileMeta(props.projectId, props.path);
  } catch (e: any) {
    detailErr.value = String(e?.message || e);
  }
}
function toggleDetail(force?: boolean) {
  detailOpen.value = force ?? !detailOpen.value;
  if (detailOpen.value && status.value === 'ok') openDetail();
}
function closeDetail() {
  detailOpen.value = false;
  detail.value = null;
  detailErr.value = '';
  hashMd5.value = '';
  hashSha256.value = '';
  hashErr.value = '';
}
async function computeHash() {
  if (!detail.value || hashing.value) return;
  if (detail.value.size > HASH_WARN) {
    const ok = window.confirm(`文件较大（${fmtBytes(detail.value.size)}），计算 MD5/SHA256 可能需要一段时间，是否继续？`);
    if (!ok) return;
  }
  hashing.value = true;
  hashErr.value = '';
  try {
    const h = await fileHash(props.projectId, props.path);
    hashMd5.value = h.md5;
    hashSha256.value = h.sha256;
  } catch (e: any) {
    hashErr.value = `计算失败：${e?.message || e}`;
  } finally {
    hashing.value = false;
  }
}
watch(() => props.detailToken, (tk) => {
  if (tk && tk !== seenDetail && props.detailPath === props.path) {
    seenDetail = tk;
    if (!detailOpen.value) toggleDetail(true);
  }
}, { immediate: true });

// —— 运行脚本（bat/cmd/ps1/sh）——
async function runFile() {
  try {
    await runScript(props.projectId, props.path);
    setToolMsg('✓ 已在系统中执行');
  } catch (e: any) {
    setToolMsg(`执行失败：${e?.message || e}`, false);
  }
}

// —— curl → 构建请求 ——
const curlOpen = ref(false);
const curlErr = ref('');
const req = ref<CurlRequest>({ method: 'GET', url: '', headers: [], body: '', raw: '' });
const headerLines = ref('');
const sending = ref(false);
const respStatus = ref<number | null>(null);
const respText = ref('');
const curlUrl = ref('');
function reqBody(): string | undefined {
  if (['GET', 'HEAD'].includes(req.value.method.toUpperCase())) return undefined;
  return req.value.body || undefined;
}
function openCurl() {
  const src = view ? view.state.doc.toString() : raw.value;
  const parsed = parseCurl(src);
  if (!parsed) { curlErr.value = '未识别到 curl 命令'; curlOpen.value = false; return; }
  req.value = parsed;
  curlUrl.value = parsed.url;
  headerLines.value = parsed.headers.map((h) => `${h.name}: ${h.value}`).join('\n');
  respStatus.value = null; respText.value = ''; curlErr.value = '';
  curlOpen.value = true;
}
function applyHeaderEdits() {
  const out: Array<{ name: string; value: string }> = [];
  for (const line of headerLines.value.split('\n')) {
    const c = line.indexOf(':');
    if (c > 0) out.push({ name: line.slice(0, c).trim(), value: line.slice(c + 1).trim() });
  }
  req.value.headers = out;
}
async function sendRequest() {
  if (!curlUrl.value) { curlErr.value = 'URL 不能为空'; return; }
  applyHeaderEdits();
  sending.value = true;
  curlErr.value = '';
  respStatus.value = null;
  respText.value = '';
  try {
    const headers: Record<string, string> = {};
    for (const h of req.value.headers) if (h.name) headers[h.name] = h.value;
    const r = await fetch(curlUrl.value, { method: req.value.method.toUpperCase(), headers, body: reqBody() });
    respStatus.value = r.status;
    const text = await r.text();
    respText.value = text.length > 300000 ? text.slice(0, 300000) + '\n…(截断)' : text;
  } catch (e: any) {
    curlErr.value = `请求失败：${e?.message || e}`;
  } finally {
    sending.value = false;
  }
}

// —— 一键格式化（Prettier 按需加载）——
const PARSER_BY_EXT: Record<string, string> = {
  js: 'babel', mjs: 'babel', cjs: 'babel', jsx: 'babel',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  json: 'json', css: 'css', html: 'html', htm: 'html',
  md: 'markdown', markdown: 'markdown', yml: 'yaml', yaml: 'yaml',
};
const canFormat = computed(() => kind.value === 'text' && !!PARSER_BY_EXT[ext.value]);
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
      setToolMsg('✓ 已格式化');
    } else {
      setToolMsg('格式已是最佳');
    }
  } catch (e: any) {
    setToolMsg(`格式化失败：${e?.message || e}`, false);
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
    <div v-if="kind === 'image' || kind === 'pdf'" class="head mediahead">
      <span class="meta">{{ name }}<template v-if="status === 'ok'"> · {{ (size / 1024).toFixed(1) }} KB</template></span>
      <div class="right">
        <button class="fmt-btn" :class="{ on: detailOpen }" title="文件详细信息" @click="toggleDetail()">ⓘ 详细信息</button>
      </div>
    </div>
    <div v-if="kind === 'image' || kind === 'pdf'" class="media">
      <img v-if="kind === 'image'" :src="rawUrl(projectId, path)" class="img" alt="" />
      <iframe v-else-if="kind === 'pdf'" :src="rawUrl(projectId, path)" class="pdf" />
    </div>
    <template v-else>
      <div class="head">
        <span class="meta">{{ name }}<template v-if="status === 'ok'"> · {{ (size / 1024).toFixed(1) }} KB</template></span>
        <div class="right">
          <button v-if="canFormat && showEditor" class="fmt-btn" title="格式化代码" @click="formatDoc">⇥ 格式化</button>
          <button v-if="canMinify && showEditor && status === 'ok'" class="fmt-btn" :disabled="minifying" title="压缩成一行（js/json）" @click="minifyOneLine">{{ minifying ? '压缩中…' : '⇣ 压成一行' }}</button>
          <span v-if="canSort" class="sortwrap">
            <button class="fmt-btn" :class="{ on: sortOpen }" title="文本排序" @click.stop="sortOpen = !sortOpen">⇅ 排序 ▾</button>
            <div v-if="sortOpen" class="sortmenu" @click.stop>
              <button v-for="s in SORT_ITEMS" :key="s.mode" @click="applySort(s.mode)">{{ s.label }}</button>
            </div>
          </span>
          <span v-if="canB64" class="b64wrap">
            <button class="fmt-btn" :class="{ on: b64Open }" title="打开/关闭 Base64 编解码结果面板（编辑器下方）" @click="toggleB64">⇆ Base64</button>
          </span>
          <button v-if="status === 'ok'" class="fmt-btn" :class="{ on: detailOpen }" title="文件详细信息" @click="toggleDetail()">ⓘ 详细信息</button>
          <button v-if="canRun" class="fmt-btn run-btn" title="在系统中执行该脚本" @click="runFile">▶ 运行</button>
          <button v-if="canCurl" class="fmt-btn" title="解析 curl 命令并构建 HTTP 请求" @click="openCurl">⇀ 转请求</button>
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

        <div v-if="b64Open && status === 'ok'" class="b64panel">
          <div class="b64col">
            <div class="b64ch">
              <span class="b64t">Base64 编码（实时）</span>
              <div class="b64btns">
                <button class="b64b" :disabled="!b64EncodeOut" @click="b64Copy(b64EncodeOut)">复制</button>
              </div>
            </div>
            <pre class="b64pre">{{ b64EncodeOut }}</pre>
          </div>
          <div class="b64col">
            <div class="b64ch">
              <span class="b64t">Base64 解码</span>
              <div class="b64btns">
                <button class="b64b" :disabled="!b64EncodeOut" @click="feedDecodeFromEncode()">编码结果→解码</button>
                <button class="b64b" :disabled="!b64DecodeOut" @click="b64Copy(b64DecodeOut)">复制</button>
                <button class="b64b" :disabled="!b64DecodeInput" @click="b64DecodeInput = ''">清空</button>
              </div>
            </div>
            <textarea v-model="b64DecodeInput" class="b64ta" rows="2" spellcheck="false" placeholder="在此粘贴 Base64，自动实时解码…" />
            <div v-if="b64DecodeErr" class="b64err">{{ b64DecodeErr }}</div>
            <pre v-else class="b64pre">{{ b64DecodeOut }}</pre>
          </div>
        </div>

        <div v-if="curlOpen" class="curlpanel">
          <div class="cph">⇀ 构建 HTTP 请求 <button class="cpx" @click="curlOpen = false">×</button></div>
          <div class="cpf"><label>方法</label><input v-model="req.method" class="cpm" /></div>
          <div class="cpf"><label>URL</label><input v-model="curlUrl" class="cpi" placeholder="https://…" /></div>
          <div class="cpf"><label>请求头</label><textarea v-model="headerLines" rows="3" class="cpt" placeholder="Name: Value，每行一个" /></div>
          <div class="cpf"><label>请求体</label><textarea v-model="req.body" rows="4" class="cpt" placeholder="POST/PUT 请求体" /></div>
          <div class="cpacts">
            <button class="cpsend" :disabled="sending" @click="sendRequest">{{ sending ? '发送中…' : '▶ 发送' }}</button>
            <span class="cprun" @click="curlOpen = false">关闭</span>
          </div>
          <div v-if="curlErr" class="cperr">{{ curlErr }}</div>
          <div v-if="respStatus !== null" class="cpstat">HTTP {{ respStatus }}</div>
          <pre v-if="respText" class="cpre">{{ respText }}</pre>
        </div>
      </template>
    </template>

    <div v-if="detailOpen" class="detailpanel">
      <div class="dph">
        <span class="dpt">文件详细信息</span>
        <button class="cpx" @click="toggleDetail()">×</button>
      </div>
      <div v-if="detailErr" class="note err">{{ detailErr }}</div>
      <div v-else-if="detail" class="dbody">
        <div class="drow"><span class="dk">名称</span><span class="dv" :title="detail.name">{{ detail.name }}</span></div>
        <div class="drow"><span class="dk">类型</span><span class="dv">{{ kindLabel }}</span></div>
        <div class="drow">
          <span class="dk">绝对路径</span>
          <span class="dv mono" :title="detail.abs">{{ detail.abs }}</span>
          <button class="b64b" :disabled="!detail.abs" @click="b64Copy(detail.abs)">复制</button>
        </div>
        <div class="drow"><span class="dk">大小</span><span class="dv mono">{{ fmtBytes(detail.size) }}</span></div>
        <div class="drow"><span class="dk">修改时间</span><span class="dv mono">{{ fmtMtime(detail.mtime) }}</span></div>
        <div class="drow">
          <span class="dk">MD5</span>
          <span class="dv mono" :class="{ warn: hashErr }">{{ hashMd5 || hashErr || '—' }}</span>
          <button class="b64b" :disabled="!hashMd5" @click="b64Copy(hashMd5)">复制</button>
        </div>
        <div class="drow">
          <span class="dk">SHA256</span>
          <span class="dv mono" :class="{ warn: hashErr }">{{ hashSha256 || hashErr || '—' }}</span>
          <button class="b64b" :disabled="!hashSha256" @click="b64Copy(hashSha256)">复制</button>
        </div>
        <div class="drow">
          <span class="dk" />
          <button class="b64b hashgo" :disabled="hashing || !!(hashMd5 && hashSha256)" @click="computeHash">
            {{ hashing ? '计算中…' : hashMd5 ? '已计算' : '计算 MD5+SHA256' }}
          </button>
        </div>
      </div>
    </div>

    <div class="statusbar">
      <span v-if="saveState === 'saving'" class="st saveing">保存中…</span>
      <span v-else-if="saveState === 'saved'" class="st saveok">✓ {{ saveMsg }} 已保存</span>
      <span v-else-if="saveState === 'error'" class="st saveerr" title="点击重试" @click="onRetrySave">⚠ 保存失败：{{ saveMsg }}</span>
      <span v-if="toolMsg" class="st toolmsg" :class="{ err: !toolOk }" :title="toolMsg">{{ toolMsg }}</span>
    </div>
  </div>
</template>

<style scoped>
.preview { display: flex; flex-direction: column; height: 100%; background: var(--bg3); overflow: hidden; }
.media { flex: 1; min-height: 0; overflow: hidden; display: flex; }
.media .img { max-width: 100%; max-height: 100%; object-fit: contain; margin: auto; }
.media .pdf { width: 100%; height: 100%; border: none; background: #fff; display: block; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: none; padding: 2px 10px; border-bottom: 1px solid var(--bd2); }
.meta { color: var(--tx3); font-size: 11px; }
.right { display: flex; align-items: center; gap: 10px; }
.fmt-btn { background: transparent; border: 1px solid var(--bd); color: var(--tx3); font-size: 11px; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-family: inherit; }
.fmt-btn:hover { border-color: var(--ac2); color: var(--tx1); }
.fmt-btn { background: none; border: 1px solid var(--bd); color: var(--tx2); font-size: 11px; padding: 1px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.fmt-btn:hover, .fmt-btn.on { border-color: var(--ac2); color: var(--ac2); }
.fmt-btn:disabled { opacity: .5; cursor: default; }
.sortwrap { position: relative; }
.b64wrap { position: relative; }
.sortmenu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 60; min-width: 210px; background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; box-shadow: 0 8px 26px rgba(0,0,0,.35); padding: 4px; display: flex; flex-direction: column; }
.sortmenu button { text-align: left; background: none; border: none; color: var(--tx); padding: 6px 10px; font-size: 12px; cursor: pointer; border-radius: 4px; font-family: inherit; }
.sortmenu button:hover { background: var(--ac); color: var(--onac); }
.run-btn { color: var(--ok); border-color: var(--ok); }
.curlpanel { position: absolute; top: 34px; right: 10px; bottom: 10px; width: 480px; z-index: 80; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 40px rgba(0,0,0,.4); display: flex; flex-direction: column; overflow: hidden; }
.cph { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--bg4); color: var(--tx1); font-weight: 600; }
.cpx { background: none; border: none; color: var(--tx3); font-size: 15px; cursor: pointer; }
.cpf { padding: 6px 12px; display: flex; flex-direction: column; gap: 4px; }
.cpf label { font-size: 11px; color: var(--tx3); }
.cpm, .cpi, .cpt { background: var(--bg3); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.cpm { width: 100px; }
.cpt { width: 100%; resize: vertical; }
.cpacts { padding: 4px 12px; display: flex; gap: 10px; align-items: center; }
.cpsend { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 6px 16px; cursor: pointer; font-weight: 600; }
.cpsend:disabled { opacity: .55; cursor: default; }
.cprun { color: var(--tx3); cursor: pointer; font-size: 12px; }
.cperr { color: var(--err); padding: 0 12px; font-size: 12px; }
.cpstat { color: var(--ok); padding: 6px 12px 0; font-size: 12px; font-weight: 600; }
.cpre { flex: 1; min-height: 0; overflow: auto; margin: 8px 12px 12px; padding: 10px; background: var(--bg3); border: 1px solid var(--bd); border-radius: 6px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
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
.b64panel { flex: none; display: flex; gap: 8px; height: 220px; padding: 8px 10px; border-top: 1px solid var(--bd); background: var(--bg2); box-sizing: border-box; }
.b64col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; background: var(--bg3); border: 1px solid var(--bd); border-radius: 6px; padding: 6px; }
.b64ch { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: none; }
.b64t { font-size: 11px; font-weight: 600; color: var(--tx2); white-space: nowrap; }
.b64btns { display: flex; gap: 6px; flex: none; }
.b64b { background: transparent; border: 1px solid var(--bd); color: var(--tx2); font-size: 11px; padding: 1px 8px; border-radius: 4px; cursor: pointer; font-family: inherit; white-space: nowrap; }
.b64b:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.b64b:disabled { opacity: .45; cursor: default; }
.b64pre { flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 6px 8px; background: var(--bg3); border: 1px solid var(--bd); border-radius: 4px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; color: var(--tx); box-sizing: border-box; }
.b64ta { width: 100%; box-sizing: border-box; flex: none; resize: vertical; max-height: 45%; background: var(--bg3); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.b64err { color: var(--err); font-size: 12px; flex: none; }
.detailpanel { flex: none; border-top: 1px solid var(--bd); background: var(--bg2); display: flex; flex-direction: column; max-height: 260px; }
.dph { display: flex; align-items: center; justify-content: space-between; padding: 4px 12px; background: var(--bg4); flex: none; }
.dpt { font-size: 11px; font-weight: 600; color: var(--tx1); }
.dbody { overflow: auto; padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 6px; }
.drow { display: flex; align-items: center; gap: 8px; font-size: 12px; min-height: 20px; }
.dk { color: var(--tx3); flex: none; width: 66px; text-align: right; }
.dv { color: var(--tx); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.dv.mono { font-family: ui-monospace, Consolas, monospace; }
.dv.warn { color: var(--err); }
.hashgo { flex: none; }
.statusbar { flex: none; display: flex; align-items: center; gap: 14px; height: 24px; padding: 0 10px; border-top: 1px solid var(--bd); background: var(--bg2); overflow: hidden; white-space: nowrap; box-sizing: border-box; }
.st { font-size: 11px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st.saveing { color: var(--warn); }
.st.saveok { color: var(--ok); }
.st.saveerr { color: var(--errtx); cursor: pointer; }
.st.toolmsg { color: var(--tx2); }
.st.toolmsg.err { color: var(--errtx); }
</style>
