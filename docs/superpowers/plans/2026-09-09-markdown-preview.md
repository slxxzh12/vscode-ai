# Markdown 文件预览模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在中央区文件页签里，为 `.md/.markdown` 文件增加「代码 | 预览」切换；预览把 Markdown 渲染成 GitHub-dark 风格网页，代码块 hljs 高亮，` ```mermaid ` 出图，相对图片/链接解析为 `/api/raw`。

**Architecture:** 纯前端方案，全部落在 `web/`。新增 `markdown-it`（小、同步）+ `mermaid`（重，动态 `import()` 拆异步 chunk）。新模块 `web/src/markdown.ts` 封装渲染：`html:false` 转义、自定义 fence（mermaid/hljs）、block 内图片与链接相对路径改写。`FilePreview.vue` 对 md 文件加顶部分段切换条（默认「预览」），预览经 `v-html` 进 `.md-body` 容器，`nextTick` 后调 `renderMermaid()`。样式新文件 `web/src/styles/markdown.css`（全局，选择器挂 `.md-body` 前缀）。不改 server/shared。

**Tech Stack:** Vue 3 SFC、TypeScript、Vite、markdown-it、mermaid、highlight.js（已有）、vitest、vue-tsc。

**参考 spec:** `docs/superpowers/specs/2026-09-09-markdown-preview-design.md`

**关键约定（环境，来自 AGENTS.md）：**
- Windows + PowerShell 5.1，**无 bash**；npm 一律用 `npm.cmd`；禁止前台阻塞常驻进程。
- 用 Node（v24）运行，勿用 bun。
- 测试：web 单测 `npm.cmd --prefix web run test`；单文件 `npm.cmd --prefix web exec vitest run src/<file>.test.ts`。
- 类型：`npm.cmd run typecheck`（根）。
- 仓库规则：不留实现注释；提交信息风格沿用仓库中文 gitmoji 式（`feat:`/`docs:`）。
- web 依赖一律本地打包，禁止外链 CDN。
- 所有提交在 `master`。工作区当前有**未提交的在途改动**（FilePreview 等文件级预览的早期工作），本计划产生的提交只 `git add` 自己触碰的文件，**不要**把在途改动一并 add。

---

### Task 1: 安装依赖 markdown-it / mermaid / @types/markdown-it

**Files:**
- Modify: `web/package.json`（由 npm 自动改）
- Modify: `package-lock.json`（根，由 npm 自动改）

- [ ] **Step 1: 安装运行时依赖**

在仓库根（workspaces 仓库，`--workspace web` 把声明写进 `web/package.json`）：

```powershell
npm.cmd install --workspace web markdown-it mermaid
```

Expected: exit 0；`web/package.json` 的 `dependencies` 出现 `markdown-it`（~^14.1.0）与 `mermaid`（~^11.x），根 `package-lock.json` 更新。mermaid 依赖树较大，等待完成即可，不要求网络成功外任何产物。

- [ ] **Step 2: 安装类型包（仅开发）**

```powershell
npm.cmd install --workspace web --save-dev @types/markdown-it
```

Expected: exit 0；`web/package.json` 的 `devDependencies` 出现 `@types/markdown-it`（^14.x）。mermaid 自带类型，无需额外 @types。

- [ ] **Step 3: 快速冒烟：两个包能 ESM 解析**

```powershell
node -e "import('markdown-it').then(m=>console.log(typeof m.default))"
node -e "import('mermaid').then(m=>console.log(typeof (m.default||{}).render))"
```

Expected: 两条分别打印 `function`。

- [ ] **Step 4: Commit**

```powershell
git add web/package.json package-lock.json
git commit -m "feat: web 增加 markdown-it / mermaid 依赖（md 预览用）"
```

---

### Task 2: `web/src/markdown.ts` 渲染模块（TDD）

**Files:**
- Test: `web/src/markdown.test.ts`（新建）
- Create: `web/src/markdown.ts`（新建）

纯函数，node 环境可测；mermaid 不进本模块顶层（放动态 import，见 Task 3）。

- [ ] **Step 1: 写失败测试**

创建 `web/src/markdown.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { isMarkdownFile, renderMarkdown } from './markdown';

const P = { projectId: 'p', fileDir: '' };

describe('isMarkdownFile', () => {
  it('识别 md/markdown（忽略大小写），排除其它/无扩展', () => {
    expect(isMarkdownFile('README.md')).toBe(true);
    expect(isMarkdownFile('A.MD')).toBe(true);
    expect(isMarkdownFile('CHANGELOG.markdown')).toBe(true);
    expect(isMarkdownFile('a.txt')).toBe(false);
    expect(isMarkdownFile('.md')).toBe(false);
    expect(isMarkdownFile('notes')).toBe(false);
  });
});

describe('renderMarkdown', () => {
  it('mermaid 代码块 → pre.mermaid 且内容转义', () => {
    const h = renderMarkdown('```mermaid\ngraph LR\nA-->B\n```', P);
    expect(h).toContain('class="mermaid"');
    expect(h).toContain('data-processed="false"');
  });

  it('js 代码块 → hljs 高亮', () => {
    const h = renderMarkdown('```js\nconst a = 1\n```', P);
    expect(h).toContain('hljs');
    expect(h).toContain('language-javascript');
  });

  it('未知语言与无语言代码块 → 纯文本转义输出', () => {
    const h = renderMarkdown('```unknownlang\n<b>x</b>\n```', P);
    expect(h).not.toContain('<b>x</b>');
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt;');
    const h2 = renderMarkdown('```\n<b>y</b>\n```', P);
    expect(h2).toContain('&lt;b&gt;y&lt;/b&gt;');
  });

  it('html:false → 原始 HTML/脚本被转义', () => {
    const h = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>', P);
    expect(h).not.toContain('<script>');
    expect(h).not.toContain('onerror=');
    expect(h).toContain('&lt;script&gt;');
    expect(h).toContain('&lt;img');
  });

  it('相对图片基于 fileDir 归一化为 /api/raw，同目录/上跳/含空格中文', () => {
    const a = renderMarkdown('![logo](../assets/logo.png)', { projectId: 'p', fileDir: 'docs' });
    expect(a).toContain('/api/raw?project=p&path=assets%2Flogo.png');
    expect(a).toContain('alt="logo"');
    expect(a).not.toContain('../assets');
    const b = renderMarkdown('![x](imgs/a.png)', { projectId: 'p', fileDir: 'docs/sub' });
    expect(b).toContain('path=docs%2Fsub%2Fimgs%2Fa.png');
    const c = renderMarkdown('![pic](./my pic.png)', { projectId: 'p', fileDir: 'docs/文档 区' });
    expect(c).toContain('docs%2F文档%20区%2Fmy%20pic.png');
  });

  it('外部 http(s)/data/# 引用不改写', () => {
    const h = renderMarkdown('[外](https://ex.com/a.png) ![d](data:image/png;base64,AA) [锚](#sec)', P);
    expect(h).toContain('href="https://ex.com/a.png"');
    expect(h).toContain('src="data:image/png;base64,AA"');
    expect(h).toContain('href="#sec"');
    expect(h).not.toContain('/api/raw');
  });

  it('相对链接 → /api/raw 并新窗口', () => {
    const h = renderMarkdown('[doc](./other.md)', { projectId: 'p', fileDir: 'docs' });
    expect(h).toContain('href="/api/raw?project=p&path=docs%2Fother.md"');
    expect(h).toContain('target="_blank"');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```powershell
npm.cmd --prefix web exec vitest run src/markdown.test.ts
```

Expected: FAIL，报 `Cannot find module './markdown'`（或类似解析失败）。

- [ ] **Step 3: 实现 `web/src/markdown.ts`**

创建文件（完整内容）：

```ts
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';

export interface MarkdownOptions {
  projectId: string;
  fileDir: string;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function safeClass(s: string): string {
  return s.replace(/[^a-zA-Z0-9-_]/g, '');
}
function escLang(s: string): string {
  return s.replace(/[^a-zA-Z0-9-_+.#]/g, '');
}

function buildRaw(projectId: string, rel: string, suffix: string): string {
  return `/api/raw?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(rel)}${suffix}`;
}

function resolveTarget(raw: string, dir: string): { rel: string; suffix: string } | null {
  if (/^(https?:|data:|mailto:)/i.test(raw)) return null;
  if (raw.startsWith('#')) return null;
  const qi = raw.search(/[?#]/);
  const before = qi < 0 ? raw : raw.slice(0, qi);
  const suffix = qi < 0 ? '' : raw.slice(qi);
  if (!before) return null;
  const segs = dir.split('/').filter(Boolean);
  for (const part of before.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') segs.pop();
    else segs.push(part);
  }
  return { rel: segs.join('/'), suffix };
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  highlight(code: string, lang: string): string {
    if (!lang) return '';
    try {
      if (!hljs.getLanguage(lang)) return '';
      return `<pre class="hljs"><code class="hljs language-${escLang(lang)}">${hljs.highlight(code, { language: lang }).value}</code></pre>`;
    } catch {
      return '';
    }
  },
});

const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = (token.info || '').trim().split(/\s+/)[0].toLowerCase();
  if (info === 'mermaid') {
    return `<pre class="mermaid" data-processed="false">${escHtml(token.content)}</pre>\n`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

const defaultImage = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = token.attrGet('src') || '';
  const opt = (env && (env as { opt?: MarkdownOptions }).opt) || undefined;
  const r = opt ? resolveTarget(src, opt.fileDir) : null;
  if (r) token.attrSet('src', buildRaw(opt!.projectId, r.rel, r.suffix));
  return defaultImage(tokens, idx, options, env, self);
};

const defaultLinkOpen = md.renderer.rules.link_open!;
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') || '';
  const opt = (env && (env as { opt?: MarkdownOptions }).opt) || undefined;
  const r = opt ? resolveTarget(href, opt.fileDir) : null;
  if (r) {
    token.attrSet('href', buildRaw(opt!.projectId, r.rel, r.suffix));
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(mdText: string, opt: MarkdownOptions): string {
  return md.render(mdText, { opt });
}

export function isMarkdownFile(name: string): boolean {
  const i = name.lastIndexOf('.');
  if (i <= 0) return false;
  const ext = name.slice(i + 1).toLowerCase();
  return ext === 'md' || ext === 'markdown';
}

export async function renderMermaid(container: HTMLElement): Promise<void> {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('pre.mermaid:not([data-processed="true"])'));
  if (nodes.length === 0) return;
  const mod = await import('mermaid');
  const mm = mod.default;
  mm.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' });
  let seq = 0;
  await Promise.all(nodes.map(async (pre) => {
    const code = pre.textContent || '';
    const id = `df-mm-${Date.now().toString(36)}-${seq++}`;
    try {
      const { svg } = await mm.render(id, code);
      pre.outerHTML = svg;
    } catch (e) {
      pre.innerHTML = `<div class="mermaid-err">Mermaid 渲染失败：${escHtml(String((e as Error)?.message || e))}</div>`;
    }
  }));
}
```

要点（本步正确性自检）：
- `resolveTarget` 返回 `null` 表示不改写（外部/锚点/纯 #）；否则按 `fileDir` 逐段归并 `.`/`..`，产出相对项目根的 rel。
- fence 规则先拦截 `mermaid`；其余走默认（默认经上面 `highlight` 回调输出 hljs 或纯转义）。`highlight` 对未知语言返回 `''` → markdown-it 走纯文本转义（满足测试）。
- image/link_open 覆盖在 `default...` 基础上做属性改写，不改整体结构。

- [ ] **Step 4: 跑测试确认通过**

```powershell
npm.cmd --prefix web exec vitest run src/markdown.test.ts
```

Expected: PASS，8 个 it 全绿。

- [ ] **Step 5: Commit**

```powershell
git add web/src/markdown.ts web/src/markdown.test.ts
git commit -m "feat: markdown.ts 渲染模块（fence/hljs/mermaid + 相对路径改写）"
```

---

### Task 3: `FilePreview.vue` 预览模式 + `markdown.css` 样式

**Files:**
- Create: `web/src/styles/markdown.css`（新建）
- Rewrite: `web/src/components/FilePreview.vue`（整文件替换）
- Test: `web/src/components/FilePreview.vue`（无单测，用 vue-tsc + 手工验证）

- [ ] **Step 1: 创建 `web/src/styles/markdown.css`**

先建目录 `web/src/styles`，再写完整样式（全局 CSS；选择器全部带 `.md-body` 前缀，避免污染其它 UI）：

```css
.md-body { color: #d5dae1; font-size: 14px; line-height: 1.7; font-family: ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; word-wrap: break-word; }
.md-body > :first-child { margin-top: 0; }
.md-body > :last-child { margin-bottom: 0; }
.md-body h1, .md-body h2, .md-body h3, .md-body h4, .md-body h5, .md-body h6 { margin: 1.2em 0 0.6em; line-height: 1.3; font-weight: 600; color: #e6e9ef; }
.md-body h1 { font-size: 1.7em; padding-bottom: 0.3em; border-bottom: 1px solid #2a323e; }
.md-body h2 { font-size: 1.4em; padding-bottom: 0.25em; border-bottom: 1px solid #2a323e; }
.md-body h3 { font-size: 1.2em; }
.md-body h4 { font-size: 1.05em; }
.md-body p { margin: 0.7em 0; }
.md-body a { color: #6aa2ff; text-decoration: none; }
.md-body a:hover { text-decoration: underline; }
.md-body ul, .md-body ol { margin: 0.7em 0; padding-left: 1.8em; }
.md-body li { margin: 0.25em 0; }
.md-body li > input[type="checkbox"] { margin-right: 0.4em; }
.md-body blockquote { margin: 0.8em 0; padding: 0.1em 1em; color: #9aa4b2; border-left: 3px solid #2f6feb; background: #141920; border-radius: 0 6px 6px 0; }
.md-body hr { margin: 1.4em 0; border: none; border-top: 1px solid #2a323e; }
.md-body table { border-collapse: collapse; margin: 0.9em 0; display: block; max-width: 100%; overflow: auto; }
.md-body th, .md-body td { border: 1px solid #2a323e; padding: 6px 12px; }
.md-body th { background: #161b22; font-weight: 600; }
.md-body tr:nth-child(2n) td { background: #141920; }
.md-body code { font-family: ui-monospace, Consolas, monospace; font-size: 0.88em; background: #1c242f; padding: 0.15em 0.4em; border-radius: 4px; color: #e6c07b; }
.md-body pre { background: #0d1117; border: 1px solid #21262d; border-radius: 6px; overflow: auto; margin: 0.9em 0; }
.md-body pre code { background: transparent; padding: 0; color: #d5dae1; font-size: 12.5px; line-height: 1.55; display: block; }
.md-body pre.hljs { padding: 12px 14px; }
.md-body code.hljs { padding: 0; }
.md-body img { max-width: 100%; border-radius: 6px; }
.md-body .mermaid { display: flex; justify-content: center; background: #0d1117; border: 1px solid #21262d; border-radius: 6px; padding: 10px; margin: 0.9em 0; }
.md-body .mermaid svg { max-width: 100%; }
.md-body .mermaid-err { color: #fca5a5; font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; padding: 8px 12px; }
```

- [ ] **Step 2: 替换 `FilePreview.vue`**

整文件替换为（完整内容）：

```vue
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
```

行为自检：
- 打开 md：`viewMode='preview'` → `applyPreview` 在 `status=ok` 时渲染 `mdHtml`，`nextTick` 后 `mdBodyRef` 已挂载，调 `renderMermaid`。
- 切「代码」→ `watch([status, viewMode])` 触发，`applyPreview` 提前 return（不渲染）；`previewSeq` 自增使在途 mermaid 结果作废。
- 打开图片/PDF/非 md 文本：`head` 条仍显示文件名（无 seg），布局与功能同现状一致（非 md 默认 `viewMode='code'`，只显示 hljs-pre）。

- [ ] **Step 3: 类型检查**

```powershell
npm.cmd run typecheck
```

Expected: exit 0，无 vue-tsc 报错（`markdown.ts`、`FilePreview.vue`、`markdown.css` 通过）。

- [ ] **Step 4: 全量 web 单测确保无回归**

```powershell
npm.cmd --prefix web run test
```

Expected: PASS（含 Task 2 的 8 个 it + 既有 `useTerminal.test.ts`）。

- [ ] **Step 5: Commit**

```powershell
git add web/src/styles/markdown.css web/src/components/FilePreview.vue
git commit -m "feat: md 文件预览模式 + GitHub-dark 样式 + mermaid 渲染"
```

---

### Task 4: 手工验收 + 收尾

- [ ] **Step 1: 手工样例文件**

任选一个项目 root，创建 `preview-demo.md`，内容覆盖：`#` 标题层级、表格、引用、行内 code、代码块（` ```js ` + 一个未知语言 + 一个 ` ```mermaid `：`graph LR; A-->B`）、相对图片引用（如 `![x](README.png)`，没有真图也能验证 URL 拼对了不炸）、`[链接](../...)`、`<script>` 原文。若想验证图片显示，可在同目录放一张 `png`。

- [ ] **Step 2: 启动并目测（异步后台启动）**

先确认后端已起（未起则启动，两个进程都走 Start-Process 后台 + 日志重定向，禁止前台阻塞）。日志文件写到仓库外临时目录 `C:\Users\slxxzh11\AppData\Local\Temp\opencode\`。

```powershell
# 后端（若未运行）
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev:server" -RedirectStandardOutput "$env:TEMP\opencode\df-server.out.log" -RedirectStandardError "$env:TEMP\opencode\df-server.err.log" -WindowStyle Hidden
# 前端
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev:web" -RedirectStandardOutput "$env:TEMP\opencode\df-web.out.log" -RedirectStandardError "$env:TEMP\opencode\df-web.err.log" -WindowStyle Hidden
```

Expected: 打开 http://localhost:5173 → 文件树点开 `preview-demo.md` → 直接进预览：标题/表格/引用/代码高亮/相对图片渲染正确、` ```mermaid ` 出图、`<script>` 显示为文字；切换「代码」看源码高亮、「预览」切回重新渲染；点开 `.ts/.txt` 无 seg 按钮、行为不变；目录无同名 mermaid 处理正常。

- [ ] **Step 3: 核对产物构建可过**

```powershell
npm.cmd run build:web
```

Expected: exit 0，`web/dist` 生成；mermaid 拆成独立异步 chunk（`dist/assets/` 里体积最大的 js chunk 之一），首页 bundle 不显著变大。

- [ ] **Step 4: 清理演示文件**

删除 Step 1 的 `preview-demo.md`（及其临时图片），保持工作区只含计划内改动。**若手工验收发现缺陷**：回到对应 Task 修（Task 3 组件层用 applyPreview/`previewSeq` 修复竞态或样式，Task 2 用单测固定渲染行为），重跑 `npm.cmd --prefix web exec vitest run src/markdown.test.ts` 与 `npm.cmd run typecheck` 后追加提交。

- [ ] **Step 5: 汇总提交并报告**

```powershell
git status
git log --oneline -5
```

Expected: 只有本计划涉及的提交与文件改动。向用户汇报：预览开关位置、支持内容、mermaid 动态加载对首屏的影响、以及未交付项（如需目录大纲/主题切换可另开 spec）。
