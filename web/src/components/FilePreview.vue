<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
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
import { useProjects, type FileMeta, type FileText } from '../useProjects';
import { t, locale } from '../i18n';
import { isMarkdownFile, renderMarkdown, renderMermaid, printMarkdown } from '../markdown';
import { parseCurlCommands } from '../curl';
import CurlView from './CurlView.vue';
import YamlView from './YamlView.vue';
import { diffText, type DiffRow } from '../diff';
import { sortText, dedupText, type SortMode } from '../textTools';
import type { TreeItem } from '@devflow/shared';

const props = defineProps<{ projectId: string; path: string; name: string; detailToken?: number; detailPath?: string }>();
const { text, write, rawUrl, format, runScript, fileMeta, fileHash, reveal, tree, pickTextFile } = useProjects();
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
const canSort = computed(() => kind.value === 'text' && status.value === 'ok' && showEditor.value && !isBinary.value);
const canB64 = computed(() => kind.value === 'text' && status.value === 'ok' && showEditor.value && !isBinary.value);
const RUN_EXT = new Set(['bat', 'cmd', 'ps1', 'sh']);
const canRun = computed(() => RUN_EXT.has(ext.value) && kind.value === 'text' && status.value === 'ok');
const canCurl = computed(() => kind.value === 'text' && status.value === 'ok' && /\bcurl\b/.test(raw.value || ''));
const isYaml = computed(() => ['yml', 'yaml'].includes(ext.value));
const isCurlFile = computed(() => ['http', 'rest', 'curl'].includes(ext.value));
type ViewMode = 'preview' | 'code' | 'visual' | 'curl';
function defaultMode(): ViewMode {
  if (isMarkdownFile(props.name) || isHtmlFile.value) return 'preview';
  if (isCurlFile.value) return 'curl';
  return 'code';
}
const viewMode = ref<ViewMode>(defaultMode());
const showEditor = computed(() => kind.value === 'text' && viewMode.value === 'code');

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

// —— 顶栏闪字（格式化/运行 短暂提示，与底部状态栏并存）——
const fmtMsg = ref('');
let fmtTimer: ReturnType<typeof setTimeout> | null = null;
function flashFmt(m: string) {
  fmtMsg.value = m;
  if (fmtTimer) clearTimeout(fmtTimer);
  fmtTimer = setTimeout(() => { fmtMsg.value = ''; }, 2600);
}
const runMsg = ref('');
let runTimer: ReturnType<typeof setTimeout> | null = null;
function flashRun(m: string) {
  runMsg.value = m;
  if (runTimer) clearTimeout(runTimer);
  runTimer = setTimeout(() => { runMsg.value = ''; }, 3200);
}

// —— 二进制文件：不支持网页预览 ——
const isBinary = ref(false);
async function revealInExplorer() {
  try {
    await reveal(props.projectId, props.path);
    setToolMsg(t('fp.revealed'));
  } catch (e: any) {
    setToolMsg(t('fp.reveal_failed', { msg: e?.message || e }), false);
  }
}

function nowTime() {
  return new Date().toLocaleTimeString(locale.value, { hour12: false });
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
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await write(props.projectId, props.path, content);
      if (disposed) return;
      saveState.value = 'saved';
      saveMsg.value = nowTime();
      dirty.value = false;
      return;
    } catch (e: unknown) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  dirty.value = true;
  setSaveError(lastErr);
}
function scheduleSave() {
  dirty.value = true;
  saveState.value = 'idle';
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flush(), 10000);
}
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!dirty.value) return;
  const snapshot = raw.value;
  saveChain = saveChain.then(() => doWrite(snapshot)).catch(() => { /* doWrite 已处理 */ });
}
function saveNow() {
  if (!dirty.value) return;
  saveState.value = 'idle';
  flush();
}
function onGlobalKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
  if (status.value !== 'ok' || !showEditor.value || isBinary.value) return;
  e.preventDefault();
  saveNow();
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
  fmtMsg.value = '';
  runMsg.value = '';
  isBinary.value = false;
  resetB64Panel();
  closeDetail();
  closeDiff();
  status.value = 'loading';
  errMsg.value = '';
  try {
    const f = await text(props.projectId, props.path);
    size.value = f.size;
    fileAbs.value = f.abs || '';
    fileMtime.value = f.mtime || 0;
    status.value = 'ok';
    viewMode.value = defaultMode();
    if (f.binary === true) {
      isBinary.value = true;
      return;
    }
    raw.value = f.content;
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

function applyExternalText(next: string) {
  raw.value = next;
  if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
  scheduleSave();
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
    flashFmt(t('fp.minified'));
    setToolMsg(t('fp.minified'));
  } catch (e: any) {
    const m = t('fp.minify_failed', { msg: e?.message || e });
    flashFmt(m);
    setToolMsg(m, false);
  } finally {
    minifying.value = false;
  }
}

// —— 文本排序 ——
const SORT_ITEMS = computed<Array<{ mode: SortMode; label: string }>>(() => [
  { mode: 'asc', label: t('fp.sort.asc') },
  { mode: 'desc', label: t('fp.sort.desc') },
  { mode: 'num-asc', label: t('fp.sort.num_asc') },
  { mode: 'num-desc', label: t('fp.sort.num_desc') },
]);
const SORT_KEY: Record<SortMode, string> = {
  asc: 'fp.sort.short.asc', desc: 'fp.sort.short.desc',
  'num-asc': 'fp.sort.short.num_asc', 'num-desc': 'fp.sort.short.num_desc',
};
function sortLines(mode: SortMode): string {
  if (!view) return '';
  return sortText(view.state.doc.toString(), mode);
}
function applySort(mode: SortMode) {
  if (!view) return;
  const out = sortLines(mode);
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: out } });
  toolsOpen.value = false;
  requestMeasure();
  flashFmt(t('fp.sorted', { label: t(SORT_KEY[mode]) }));
  setToolMsg(t('fp.sorted', { label: t(SORT_KEY[mode]) }));
}

// —— 文本去重（忽略首尾空白，去重后升序排列）——
function dedupLines(): string {
  if (!view) return '';
  return dedupText(view.state.doc.toString());
}
function applyDedup() {
  if (!view) return;
  const out = dedupLines();
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: out } });
  toolsOpen.value = false;
  requestMeasure();
  flashFmt(t('fp.deduped'));
  setToolMsg(t('fp.deduped'));
}

// —— 文本对比（左右两栏 + 行级/行内高亮）——
const canDiff = computed(() => kind.value === 'text' && status.value === 'ok' && !isBinary.value);
const diffOpen = ref(false);
const diffLeft = ref('');
const diffRight = ref('');
const diffLeftName = ref('');
const diffRightName = ref('');
const diffRows = ref<DiffRow[]>([]);
const diffStats = ref<{ added: number; removed: number; changed: number } | null>(null);
interface DiffPickerState { side: 'left' | 'right'; dir: string; items: TreeItem[]; }
const diffPicker = ref<DiffPickerState | null>(null);

// —— 对比面板高度：拖动顶部边框上下调整，本地记忆 ——
const DIFF_H_KEY = 'devflow-diff-h';
const diffHeight = ref(380);
function loadDiffH() {
  try {
    const h = Number(localStorage.getItem(DIFF_H_KEY));
    if (h >= 200 && h <= 1200) diffHeight.value = h;
  } catch { /* ignore */ }
}
function saveDiffH() { try { localStorage.setItem(DIFF_H_KEY, String(Math.round(diffHeight.value))); } catch { /* ignore */ } }
function onDiffDragDown(e: MouseEvent) {
  e.preventDefault();
  const startY = e.clientY;
  const startH = diffHeight.value;
  const move = (ev: MouseEvent) => {
    const max = Math.max(240, window.innerHeight - 160);
    diffHeight.value = Math.min(max, Math.max(200, startH + (startY - ev.clientY)));
  };
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); saveDiffH(); };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

function openDiff() {
  diffLeft.value = raw.value;
  diffLeftName.value = props.name;
  diffRight.value = '';
  diffRightName.value = '';
  diffOpen.value = true;
  runDiff();
}
function closeDiff() {
  diffOpen.value = false;
  diffPicker.value = null;
}
function runDiff() {
  const r = diffText(diffLeft.value, diffRight.value);
  diffRows.value = r.rows;
  diffStats.value = { added: r.added, removed: r.removed, changed: r.changed };
}
function clearDiff() {
  diffLeft.value = '';
  diffRight.value = '';
  diffLeftName.value = '';
  diffRightName.value = '';
  runDiff();
}
async function openDiffPicker(side: 'left' | 'right') {
  try {
    const items = await tree(props.projectId, '');
    diffPicker.value = { side, dir: '', items };
  } catch (e: any) {
    setToolMsg(t('fp.diff.load_failed', { msg: e?.message || e }), false);
  }
}
async function diffPickDir(dir: string) {
  if (!diffPicker.value) return;
  try {
    const items = await tree(props.projectId, dir);
    diffPicker.value = { ...diffPicker.value, dir, items };
  } catch (e: any) {
    setToolMsg(t('fp.diff.load_failed', { msg: e?.message || e }), false);
  }
}
async function diffPickFile(item: TreeItem) {
  if (!diffPicker.value) return;
  const rel = diffPicker.value.dir ? `${diffPicker.value.dir}/${item.name}` : item.name;
  const side = diffPicker.value.side;
  diffPicker.value = null;
  try {
    const f = await text(props.projectId, rel);
    if (f.binary) { setToolMsg(t('fp.binary_unsupported'), false); return; }
    if (side === 'left') { diffLeft.value = f.content; diffLeftName.value = f.name; }
    else { diffRight.value = f.content; diffRightName.value = f.name; }
    setToolMsg(t('fp.diff.loaded', { name: f.name }));
    runDiff();
  } catch (e: any) {
    setToolMsg(t('fp.diff.load_failed', { msg: e?.message || e }), false);
  }
}
function diffPickUp() {
  if (!diffPicker.value) return;
  const dir = diffPicker.value.dir;
  if (!dir) return;
  const i = dir.lastIndexOf('/');
  diffPickDir(i >= 0 ? dir.slice(0, i) : '');
}
// 从“其他目录”加载：弹出系统文件对话框，选择工程目录之外的文件
async function loadDiffOther(side: 'left' | 'right') {
  try {
    const r = await pickTextFile();
    if ('cancelled' in r) return;
    if ('error' in r) { setToolMsg(t('fp.diff.load_failed', { msg: r.message || r.error }), false); return; }
    const f = r as FileText;
    if (f.binary) { setToolMsg(t('fp.binary_unsupported'), false); return; }
    if (side === 'left') { diffLeft.value = f.content; diffLeftName.value = f.name; }
    else { diffRight.value = f.content; diffRightName.value = f.name; }
    setToolMsg(t('fp.diff.loaded', { name: f.name }));
    runDiff();
  } catch (e: any) {
    setToolMsg(t('fp.diff.load_failed', { msg: e?.message || e }), false);
  }
}

// —— 保存 PDF（markdown 预览 → 打印窗口仅含文档内容）——
function printPdf() {
  const html = mdBodyRef.value?.innerHTML || mdHtml.value;
  if (!html) return;
  printMarkdown(html, props.name);
}

// —— 🧰 小工具（顶栏右上收纳菜单）：排序/Base64/格式化/压缩/运行/curl ——
const toolsOpen = ref(false);
let toolsOpenedAt = 0;
let unbindTools: (() => void) | null = null;
const anyTool = computed(() =>
  !!(canFormat.value && showEditor.value)
  || !!(canMinify.value && showEditor.value && status.value === 'ok')
  || !!canSort.value || !!canB64.value || !!canDiff.value || !!canRun.value || !!canCurl.value);
watch(toolsOpen, (o) => {
  if (o) {
    toolsOpenedAt = Date.now();
    const h = (e: Event) => {
      if (Date.now() - toolsOpenedAt < 250) return;   // 忽略打开瞬间的重复/合成事件
      const t = e.target as HTMLElement | null;
      if (t && !t.closest('.twrap')) toolsOpen.value = false;
    };
    document.addEventListener('pointerdown', h, true);
    unbindTools = () => document.removeEventListener('pointerdown', h, true);
  } else if (unbindTools) { unbindTools(); unbindTools = null; }
});
function runTools(t: 'format' | 'minify' | 'b64' | 'diff' | 'run' | 'curl') {
  toolsOpen.value = false;
  if (t === 'format') formatDoc();
  else if (t === 'minify') minifyOneLine();
  else if (t === 'b64') toggleB64();
  else if (t === 'diff') openDiff();
  else if (t === 'run') runFile();
  else if (t === 'curl') openCurlView();
}
function openCurlView() {
  if (!parseCurlCommands(raw.value).length) { setToolMsg(t('fp.curl_no_command'), false); return; }
  viewMode.value = 'curl';
}

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
    b64DecodeErr.value = t('fp.b64_invalid');
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

// —— 文件详细信息｜≤20MB 打开即自动计算 MD5/SHA256；>20MB 显示“计算”按钮手动触发 ——
const HASH_AUTO_LIMIT = 20 * 1024 * 1024;
const detailOpen = ref(false);
const detail = ref<FileMeta | null>(null);
const detailErr = ref('');
const hashing = ref(false);
const hashMd5 = ref('');
const hashSha256 = ref('');
const hashErr = ref('');
const kindLabel = computed(() => ({ image: t('fp.kind.image'), pdf: 'PDF', text: t('fp.kind.text') })[kind.value] || t('fp.kind.file'));
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
    return;
  }
  if (detail.value.size <= HASH_AUTO_LIMIT) computeHash();   // 小文件直接算；大文件给按钮手动触发
}
const needHashBtn = computed(() => !!detail.value && detail.value.size > HASH_AUTO_LIMIT && !hashMd5.value && !hashSha256.value && !hashing.value);
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
  hashing.value = true;
  hashErr.value = '';
  try {
    const h = await fileHash(props.projectId, props.path);
    hashMd5.value = h.md5;
    hashSha256.value = h.sha256;
  } catch (e: any) {
    hashErr.value = t('fp.hash_failed', { msg: e?.message || e });
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
    flashRun(t('fp.ran'));
    setToolMsg(t('fp.ran'));
  } catch (e: any) {
    const m = t('fp.run_failed', { msg: e?.message || e });
    flashRun(m);
    setToolMsg(m, false);
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
      flashFmt(t('fp.formatted'));
      setToolMsg(t('fp.formatted'));
    } else {
      flashFmt(t('fp.format_optimal'));
      setToolMsg(t('fp.format_optimal'));
    }
  } catch (e: any) {
    const m = t('fp.format_failed', { msg: e?.message || e });
    flashFmt(m);
    setToolMsg(m, false);
  }
}

watch(() => [props.projectId, props.path], load, { immediate: true });
watch(viewMode, (m) => {
  applyPreview();
  if (m === 'code') { nextTick(() => { mountEditor(raw.value); requestMeasure(); }); }
  else { flush(); }   // 切到预览前先把编辑落盘
});
watch([status, viewMode], applyPreview);

onMounted(() => { window.addEventListener('keydown', onGlobalKey); loadDiffH(); });

onBeforeUnmount(() => {
  disposed = true;
  window.removeEventListener('keydown', onGlobalKey);
  unbindTools?.();
  if (fmtTimer) clearTimeout(fmtTimer);
  if (runTimer) clearTimeout(runTimer);
  flush();
  if (view) { view.destroy(); view = null; }
});
</script>

<template>
  <div class="preview">
    <div v-if="kind === 'image' || kind === 'pdf'" class="head mediahead">
      <span class="meta">{{ name }}<template v-if="status === 'ok'"> · {{ (size / 1024).toFixed(1) }} KB</template></span>
      <div class="right">
        <button class="fmt-btn" :class="{ on: detailOpen }" :title="$t('fp.detail.title')" @click="toggleDetail()">{{ $t('fp.detail') }}</button>
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
          <div v-if="hasPreviewToggle" class="seg">
            <button type="button" :class="{ on: viewMode === 'preview' }" @click="viewMode = 'preview'">{{ $t('fp.preview') }}</button>
            <button type="button" :class="{ on: viewMode === 'code' }" @click="viewMode = 'code'">{{ isHtmlFile ? $t('fp.source') : $t('fp.code') }}</button>
          </div>
          <div v-else-if="isYaml" class="seg">
            <button type="button" :class="{ on: viewMode === 'visual' }" @click="viewMode = 'visual'">{{ $t('fp.view.visual') }}</button>
            <button type="button" :class="{ on: viewMode === 'code' }" @click="viewMode = 'code'">{{ $t('fp.code') }}</button>
          </div>
          <div v-else-if="isCurlFile" class="seg">
            <button type="button" :class="{ on: viewMode === 'curl' }" @click="viewMode = 'curl'">{{ $t('fp.view.curl') }}</button>
            <button type="button" :class="{ on: viewMode === 'code' }" @click="viewMode = 'code'">{{ $t('fp.code') }}</button>
          </div>
          <button v-if="isMd && status === 'ok' && viewMode === 'preview'" class="fmt-btn" :title="$t('fp.pdf.tip')" @click="printPdf">{{ $t('fp.pdf') }}</button>
          <span v-if="saveState === 'saving'" class="save saveing">{{ $t('fp.saving') }}</span>
          <span v-else-if="saveState === 'saved'" class="save saveok">✓ {{ $t('fp.saved', { msg: saveMsg }) }}</span>
          <span v-else-if="saveState === 'error'" class="save saveerr" :title="$t('fp.retry')" @click="onRetrySave">{{ $t('fp.save_failed', { msg: saveMsg }) }}</span>
          <span v-if="fmtMsg" class="save fmtmsg" :class="{ ok: fmtMsg.startsWith('✓') }">{{ fmtMsg }}</span>
          <span class="twrap">
            <button class="fmt-btn" :class="{ on: toolsOpen }" :title="$t('fp.tools')" @click.stop="toolsOpen = !toolsOpen">{{ $t('fp.tools') }}</button>
            <div v-if="toolsOpen" class="toolsmenu" @click.stop>
              <button v-if="canFormat && showEditor" class="mi" @click="runTools('format')">{{ $t('fp.format') }}</button>
              <button v-if="canMinify && showEditor && status === 'ok'" class="mi" :disabled="minifying" @click="runTools('minify')">{{ minifying ? $t('fp.minifying') : $t('fp.minify') }}</button>
              <div v-if="canSort" class="mi has-sub">{{ $t('fp.sort') }}<span class="caret">▸</span>
                <div class="submenu">
                  <button v-for="s in SORT_ITEMS" :key="s.mode" @click="applySort(s.mode)">{{ s.label }}</button>
                </div>
              </div>
              <button v-if="canSort" class="mi" @click="applyDedup()">{{ $t('fp.dedup') }}</button>
              <button v-if="canDiff" class="mi" @click="runTools('diff')">{{ $t('fp.diff') }}</button>
              <button v-if="canB64" class="mi" :class="{ on: b64Open }" @click="runTools('b64')">{{ $t('fp.b64') }}</button>
              <button v-if="canRun" class="mi run-t" @click="runTools('run')">{{ $t('fp.run') }}</button>
              <button v-if="canCurl" class="mi" @click="runTools('curl')">{{ $t('fp.curl') }}</button>
              <div v-if="!anyTool" class="mi none">{{ $t('fp.no_tools') }}</div>
            </div>
          </span>
          <span v-if="runMsg" class="save runmsg">{{ runMsg }}</span>
          <button v-if="status === 'ok'" class="fmt-btn" :class="{ on: detailOpen }" :title="$t('fp.detail.title')" @click="toggleDetail()">{{ $t('fp.detail') }}</button>
          <button class="fmt-btn savebtn" :disabled="!(status === 'ok' && showEditor && !isBinary && dirty)" :title="$t('fp.save') + ' (Ctrl+S)'" @click="saveNow">{{ $t('fp.save') }}{{ dirty ? ' *' : '' }}</button>
        </div>
      </div>
      <div v-if="status === 'loading'" class="note">{{ $t('fp.loading') }}</div>
      <div v-else-if="status === 'error'" class="note err">{{ $t('fp.open_failed', { msg: errMsg }) }}</div>
      <template v-else>
        <div v-if="isBinary" class="binwrap">
          <div class="binic">🚫</div>
          <div class="bintxt">{{ $t('fp.binary_unsupported') }}</div>
          <div class="binpath mono" :title="fileAbs" @click="revealInExplorer()">{{ fileAbs }}</div>
          <button class="fmt-btn binbtn" @click="revealInExplorer()">{{ $t('fp.reveal') }}</button>
        </div>
        <template v-else>
        <div v-show="viewMode === 'preview'" class="pane">
          <div v-if="isMd" class="scroll">
            <div v-if="mdErr" class="note err">{{ mdErr }}</div>
            <div v-show="!mdErr" ref="mdBodyRef" class="md-body" v-html="mdHtml" />
          </div>
          <iframe v-else-if="isHtmlFile" class="html-frame" :srcdoc="raw" sandbox="allow-scripts allow-modals" />
        </div>
        <div v-show="showEditor" ref="editorHost" class="editor" />
        <CurlView v-if="viewMode === 'curl' && status === 'ok' && !isBinary" :project-id="projectId" :path="path" :text="raw" @update:text="applyExternalText" />
        <YamlView v-else-if="viewMode === 'visual' && status === 'ok' && !isBinary" :text="raw" @update:text="applyExternalText" />

        <div v-if="b64Open && status === 'ok'" class="b64panel">
          <div class="b64col">
            <div class="b64ch">
              <span class="b64t">{{ $t('fp.b64.encode') }}</span>
              <div class="b64btns">
                <button class="b64b" :disabled="!b64EncodeOut" @click="b64Copy(b64EncodeOut)">{{ $t('common.copy') }}</button>
              </div>
            </div>
            <pre class="b64pre">{{ b64EncodeOut }}</pre>
          </div>
          <div class="b64col">
            <div class="b64ch">
              <span class="b64t">{{ $t('fp.b64.decode') }}</span>
              <div class="b64btns">
                <button class="b64b" :disabled="!b64EncodeOut" @click="feedDecodeFromEncode()">{{ $t('fp.b64.encode_to_decode') }}</button>
                <button class="b64b" :disabled="!b64DecodeOut" @click="b64Copy(b64DecodeOut)">{{ $t('common.copy') }}</button>
                <button class="b64b" :disabled="!b64DecodeInput" @click="b64DecodeInput = ''">{{ $t('fp.b64.clear') }}</button>
              </div>
            </div>
            <textarea v-model="b64DecodeInput" class="b64ta" rows="2" spellcheck="false" :placeholder="$t('fp.b64.placeholder')" />
            <div v-if="b64DecodeErr" class="b64err">{{ b64DecodeErr }}</div>
            <pre v-else class="b64pre">{{ b64DecodeOut }}</pre>
          </div>
        </div>

        <div v-if="diffOpen && status === 'ok'" class="diffpanel" :style="{ height: diffHeight + 'px' }">
          <div class="diffresize" @mousedown="onDiffDragDown" />
          <div class="dph">
            <span class="dpt">{{ $t('fp.diff.title') }}</span>
            <button class="cpx" @click="closeDiff">×</button>
          </div>
          <div class="diffcols">
            <div class="diffcol">
              <div class="dch">
                <span class="dct">{{ $t('fp.diff.left') }}<template v-if="diffLeftName"> · <code>{{ diffLeftName }}</code></template></span>
                <span class="b64btns">
                  <button class="b64b" @click="openDiffPicker('left')">{{ $t('fp.diff.load') }}</button>
                  <button class="b64b" @click="loadDiffOther('left')">{{ $t('fp.diff.load_other') }}</button>
                </span>
              </div>
              <textarea v-model="diffLeft" class="diffta" spellcheck="false" :placeholder="$t('fp.diff.left_placeholder')" @input="runDiff" />
            </div>
            <div class="diffcol">
              <div class="dch">
                <span class="dct">{{ $t('fp.diff.right') }}<template v-if="diffRightName"> · <code>{{ diffRightName }}</code></template></span>
                <span class="b64btns">
                  <button class="b64b" @click="openDiffPicker('right')">{{ $t('fp.diff.load') }}</button>
                  <button class="b64b" @click="loadDiffOther('right')">{{ $t('fp.diff.load_other') }}</button>
                </span>
              </div>
              <textarea v-model="diffRight" class="diffta" spellcheck="false" :placeholder="$t('fp.diff.right_placeholder')" @input="runDiff" />
            </div>
          </div>
          <div class="diffbar">
            <span v-if="diffStats" class="diffstat">
              <template v-if="diffStats.added + diffStats.removed + diffStats.changed === 0">{{ $t('fp.diff.same') }}</template>
              <template v-else>{{ $t('fp.diff.stats', { add: diffStats.added, del: diffStats.removed, chg: diffStats.changed }) }}</template>
            </span>
            <span class="diffsp" />
            <button class="b64b" @click="clearDiff">{{ $t('fp.diff.clear') }}</button>
          </div>
          <div class="diffresult">
            <div v-if="diffRows.length === 0" class="diffempty">{{ $t('fp.diff.empty') }}</div>
            <template v-for="(row, idx) in diffRows" :key="idx">
              <div class="diffrow" :class="row.kind">
                <span class="ln">{{ row.leftLine ?? '' }}</span>
                <div class="side left"><template v-if="row.left"><span v-for="(s, i) in row.left" :key="i" :class="{ chg: s.changed }">{{ s.text }}</span></template></div>
                <span class="ln">{{ row.rightLine ?? '' }}</span>
                <div class="side right"><template v-if="row.right"><span v-for="(s, i) in row.right" :key="i" :class="{ chg: s.changed }">{{ s.text }}</span></template></div>
              </div>
            </template>
          </div>
          <div v-if="diffPicker" class="diffpicker">
            <div class="dpkhead">
              <span class="dpt">{{ $t('fp.diff.pick') }} · <span class="dpkdir">{{ diffPicker.dir || '/' }}</span></span>
              <button class="cpx" @click="diffPicker = null">×</button>
            </div>
            <div class="dpklist">
              <button v-if="diffPicker.dir" class="dpkitem" @click="diffPickUp">../ {{ $t('fp.diff.pick_up') }}</button>
              <button v-for="it in diffPicker.items" :key="it.name" class="dpkitem" :class="{ dir: it.type === 'dir' }"
                @click="it.type === 'dir' ? diffPickDir(diffPicker.dir ? diffPicker.dir + '/' + it.name : it.name) : diffPickFile(it)">
                {{ it.type === 'dir' ? '▸ ' : '' }}{{ it.name }}
              </button>
              <div v-if="diffPicker.items.length === 0" class="dpkempty">(—)</div>
            </div>
          </div>
        </div>
        </template>
      </template>
    </template>

    <div v-if="detailOpen" class="detailpanel">
      <div class="dph">
        <span class="dpt">{{ $t('fp.detail.title') }}</span>
        <button class="cpx" @click="toggleDetail()">×</button>
      </div>
      <div v-if="detailErr" class="note err">{{ detailErr }}</div>
      <div v-else-if="detail" class="dbody">
        <div class="drow"><span class="dk">{{ $t('fp.detail.name') }}</span><span class="dv" :title="detail.name">{{ detail.name }}</span></div>
        <div class="drow"><span class="dk">{{ $t('fp.detail.type') }}</span><span class="dv">{{ kindLabel }}</span></div>
        <div class="drow">
          <span class="dk">{{ $t('fp.detail.abs') }}</span>
          <span class="dv mono" :title="detail.abs">{{ detail.abs }}</span>
          <button class="b64b" :disabled="!detail.abs" @click="b64Copy(detail.abs)">{{ $t('common.copy') }}</button>
        </div>
        <div class="drow"><span class="dk">{{ $t('fp.detail.size') }}</span><span class="dv mono">{{ fmtBytes(detail.size) }}</span></div>
        <div class="drow"><span class="dk">{{ $t('fp.detail.mtime') }}</span><span class="dv mono">{{ fmtMtime(detail.mtime) }}</span></div>
        <div class="drow">
          <span class="dk">MD5</span>
          <span class="dv mono hval" :class="{ warn: hashErr }">
            <span v-if="hashing" class="spin" />
            <template v-if="hashing">{{ $t('fp.detail.computing') }}</template>
            <template v-else>{{ hashMd5 || hashErr || '—' }}</template>
          </span>
          <button class="b64b" :disabled="!hashMd5 || hashing" @click="b64Copy(hashMd5)">{{ $t('common.copy') }}</button>
        </div>
        <div class="drow">
          <span class="dk">SHA256</span>
          <span class="dv mono hval" :class="{ warn: hashErr }">
            <span v-if="hashing" class="spin" />
            <template v-if="hashing">{{ $t('fp.detail.computing') }}</template>
            <template v-else>{{ hashSha256 || hashErr || '—' }}</template>
          </span>
          <button class="b64b" :disabled="!hashSha256 || hashing" @click="b64Copy(hashSha256)">{{ $t('common.copy') }}</button>
        </div>
        <div v-if="needHashBtn" class="drow">
          <span class="dk" />
          <button class="b64b hashgo" :title="$t('fp.detail.hash_tip')" @click="computeHash">{{ $t('fp.detail.compute') }}</button>
        </div>
      </div>
    </div>

    <div class="statusbar">
      <span v-if="saveState === 'saving'" class="st saveing">{{ $t('fp.saving') }}</span>
      <span v-else-if="saveState === 'saved'" class="st saveok">✓ {{ $t('fp.saved', { msg: saveMsg }) }}</span>
      <span v-else-if="saveState === 'error'" class="st saveerr" :title="$t('fp.retry')" @click="onRetrySave">{{ $t('fp.save_failed', { msg: saveMsg }) }}</span>
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
.savebtn { border-color: var(--ac2); color: var(--ac2); font-weight: 600; }
.savebtn:hover:not(:disabled) { background: color-mix(in srgb, var(--ac) 12%, transparent); }
.savebtn:disabled { opacity: .45; }
.save { font-size: 11px; line-height: 1; white-space: nowrap; }
.save.saveing { color: var(--warn); }
.save.saveok { color: var(--ok); }
.save.saveerr { color: var(--errtx); cursor: pointer; }
.save.fmtmsg { color: var(--tx3); }
.save.fmtmsg.ok { color: var(--ok); }
.save.runmsg { color: var(--ok); }
.twrap { position: relative; }
.toolsmenu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 70; min-width: 190px; background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; box-shadow: 0 8px 26px rgba(0,0,0,.35); padding: 4px; display: flex; flex-direction: column; }
.mi { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; background: none; border: none; color: var(--tx); padding: 6px 10px; font-size: 12px; cursor: pointer; border-radius: 4px; font-family: inherit; white-space: nowrap; box-sizing: border-box; }
.mi:hover { background: var(--ac); color: var(--onac); }
.mi.on { color: var(--ac2); }
.mi:disabled { opacity: .5; cursor: default; }
.mi.has-sub { position: relative; }
.mi .caret { margin-left: auto; color: var(--tx6); }
.mi:hover .caret { color: var(--onac); }
.submenu { display: none; position: absolute; left: calc(100% - 6px); top: -5px; z-index: 71; min-width: 200px; background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; box-shadow: 0 8px 26px rgba(0,0,0,.35); padding: 4px; flex-direction: column; }
.mi.has-sub:hover > .submenu { display: flex; }
.submenu button { text-align: left; background: none; border: none; color: var(--tx); padding: 6px 10px; font-size: 12px; cursor: pointer; border-radius: 4px; font-family: inherit; white-space: nowrap; }
.submenu button:hover { background: var(--ac); color: var(--onac); }
.mi.run-t { color: var(--ok); }
.mi.none { color: var(--tx6); cursor: default; pointer-events: none; }
.mi.none:hover { background: none; color: var(--tx6); }
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
.hval { display: inline-flex; align-items: center; gap: 6px; }
.spin { width: 11px; height: 11px; flex: none; border: 2px solid var(--bd3); border-top-color: var(--ac); border-radius: 50%; animation: fp-spin .8s linear infinite; }
@keyframes fp-spin { to { transform: rotate(360deg); } }
.statusbar { flex: none; display: flex; align-items: center; gap: 14px; height: 24px; padding: 0 10px; border-top: 1px solid var(--bd); background: var(--bg2); overflow: hidden; white-space: nowrap; box-sizing: border-box; }
.st { font-size: 11px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st.saveing { color: var(--warn); }
.st.saveok { color: var(--ok); }
.st.saveerr { color: var(--errtx); cursor: pointer; }
.st.toolmsg { color: var(--tx2); }
.st.toolmsg.err { color: var(--errtx); }
.binwrap { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 20px; }
.binic { font-size: 42px; line-height: 1; opacity: .5; }
.bintxt { color: var(--tx3); font-size: 13px; }
.binpath { color: var(--ac2); font-family: ui-monospace, Consolas, monospace; font-size: 12px; max-width: 90%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; text-decoration: underline dotted; }
.binpath:hover { color: var(--ac); }
.binbtn { padding: 4px 14px; font-size: 12px; }
.diffpanel { position: relative; flex: none; display: flex; flex-direction: column; height: 380px; border-top: 1px solid var(--bd); background: var(--bg2); box-sizing: border-box; }
.diffresize { flex: none; height: 6px; margin-top: -3px; cursor: ns-resize; background: transparent; z-index: 2; }
.diffresize:hover { background: color-mix(in srgb, var(--ac) 45%, transparent); }
.diffcols { flex: none; display: flex; gap: 8px; padding: 8px 10px 0; }
.diffcol { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.dch { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: none; min-width: 0; }
.dct { font-size: 11px; color: var(--tx2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dct code { color: var(--ac2); font-family: ui-monospace, Consolas, monospace; }
.diffta { width: 100%; box-sizing: border-box; flex: none; height: 96px; resize: vertical; background: var(--bg3); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.diffbar { flex: none; display: flex; align-items: center; gap: 10px; padding: 6px 10px; }
.diffstat { font-size: 11px; color: var(--tx2); }
.diffsp { flex: 1; }
.diffresult { flex: 1; min-height: 0; overflow: auto; margin: 0 10px 10px; background: var(--bg3); border: 1px solid var(--bd); border-radius: 6px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.5; }
.diffempty { color: var(--tx5); padding: 12px; }
.diffrow { display: flex; align-items: stretch; }
.diffrow .ln { flex: none; width: 46px; text-align: right; padding: 1px 6px; color: var(--tx5); background: var(--bg4); border-right: 1px solid var(--bd); user-select: none; }
.diffrow .side { flex: 1; min-width: 0; padding: 1px 8px; white-space: pre-wrap; word-break: break-all; }
.diffrow .side + .ln { border-left: 1px solid var(--bd); border-right: none; }
.diffrow .side .chg { background: color-mix(in srgb, var(--err) 32%, transparent); border-radius: 2px; }
.diffrow.del .side.left, .diffrow.ins .side.right, .diffrow.change .side { background: color-mix(in srgb, var(--err) 13%, transparent); }
.diffrow.del .side.right, .diffrow.ins .side.left { background: var(--bg4); }
.diffpicker { position: absolute; left: 10px; right: 10px; top: 34px; bottom: 10px; z-index: 81; background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; box-shadow: 0 12px 40px rgba(0,0,0,.4); display: flex; flex-direction: column; overflow: hidden; }
.dpkhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 12px; background: var(--bg4); flex: none; }
.dpkdir { color: var(--ac2); font-family: ui-monospace, Consolas, monospace; font-size: 11px; }
.dpklist { flex: 1; overflow: auto; padding: 4px; display: flex; flex-direction: column; }
.dpkitem { text-align: left; background: none; border: none; color: var(--tx); padding: 5px 10px; font-size: 12px; cursor: pointer; border-radius: 4px; font-family: ui-monospace, Consolas, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dpkitem:hover { background: var(--ac); color: var(--onac); }
.dpkitem.dir { color: var(--ac2); }
.dpkempty { color: var(--tx5); padding: 8px 12px; }
</style>
