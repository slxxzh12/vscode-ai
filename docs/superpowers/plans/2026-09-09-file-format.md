# 文件预览：JSON / 代码格式化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `FilePreview.vue` 标题栏加入「格式化」按钮，对 `.json`（原生）与 prettier 支持类型（js/ts/css/html/vue/markdown/yaml 等）在客户端格式化，并走现有 800ms 自动保存链。

**Architecture:** 新增纯函数模块 `web/src/format.ts`（ext→parser 映射 + 动态加载 prettier standalone 插件），供测试；`FilePreview.vue` 增加按钮与写回逻辑，并把「待保存文本」从强依赖 CodeMirror `view` 重构为独立 `pendingText` ref，使预览态（md/html 未挂编辑器）也能可靠落盘。

**Tech Stack:** Vue3 + CodeMirror 6（已有）+ prettier@3（standalone + 按需插件动态 import）+ vitest。环境为 Windows / npm workspaces（根 node_modules 提升），一律用 `npm.cmd`。

前置：spec `docs/superpowers/specs/2026-09-09-file-format-design.md`（已确认方案 A）。开始前 dev:web/dev:server 已在后台异步运行（:5173/:3001）。

---

## 文件结构

- 新增 `web/src/format.ts` — 纯函数：`parserForExt(ext)`、`formatCode(src, ext)`。顶层不 import prettier。
- 新增 `web/src/format.test.ts` — vitest 单测。
- 修改 `web/package.json` — dependencies 加 `prettier`（根 workspaces，lockfile 更新）。
- 修改 `web/src/components/FilePreview.vue` — 按钮 + onFormat + 保存链重构。

---

### Task 1: 安装 prettier 依赖

**Files:**
- Modify: `web/package.json`
- Modify: `package-lock.json`（npm 自动）

- [ ] **Step 1: 安装**

Run（根目录，用 workspaces 语法使依赖落到 web）：
```powershell
npm.cmd install -w web prettier@^3.3.3
```

- [ ] **Step 2: 验证**

Expected：`web/package.json` dependencies 出现 `"prettier": "^3.3.3"`；根 `node_modules/prettier` 存在；`package.json`（根）allowScripts 无需加项（prettier 无原生脚本）。

Run: `Test-Path node_modules\prettier\standalone.mjs` → `True`

- [ ] **Step 3: 确认插件模块路径**

Run:
```powershell
node -e "import('prettier/standalone').then(()=>console.log('standalone ok'))"
node -e "import('prettier/plugins/babel.js').then(()=>console.log('babel ok'))"
node -e "import('prettier/plugins/estree.js').then(()=>console.log('estree ok'))"
```
Expected：三条均打印 ok。若 plugins 路径报错，改用无 `.js` 后缀重试并据此修正本计划 import 串（prettier exports 同时支持 `prettier/plugins/babel` 与 `prettier/plugins/babel.js`，以实际为准并统一）。

- [ ] **Step 4: Commit**

```powershell
git add web/package.json package-lock.json
git commit -m "feat(web): 新增 prettier 依赖（standalone 格式化用）"
```

---

### Task 2: format.ts — 先写失败测试

**Files:**
- Create: `web/src/format.ts`
- Test: `web/src/format.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/src/format.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { parserForExt, formatCode } from './format';

describe('parserForExt', () => {
  it('受支持扩展 → 非空 parser 名', () => {
    expect(parserForExt('json')).toBe('json');
    expect(parserForExt('js')).toBe('babel');
    expect(parserForExt('mjs')).toBe('babel');
    expect(parserForExt('jsx')).toBe('babel');
    expect(parserForExt('ts')).toBe('typescript');
    expect(parserForExt('tsx')).toBe('typescript');
    expect(parserForExt('css')).toBeTruthy();
    expect(parserForExt('scss')).toBeTruthy();
    expect(parserForExt('less')).toBeTruthy();
    expect(parserForExt('html')).toBeTruthy();
    expect(parserForExt('htm')).toBeTruthy();
    expect(parserForExt('vue')).toBe('vue');
    expect(parserForExt('md')).toBe('markdown');
    expect(parserForExt('markdown')).toBe('markdown');
    expect(parserForExt('yml')).toBe('yaml');
    expect(parserForExt('yaml')).toBe('yaml');
  });

  it('大小写不敏感', () => {
    expect(parserForExt('JSON')).toBe('json');
    expect(parserForExt('Ts')).toBe('typescript');
  });

  it('不支持/空/无扩展 → null', () => {
    expect(parserForExt('py')).toBeNull();
    expect(parserForExt('java')).toBeNull();
    expect(parserForExt('go')).toBeNull();
    expect(parserForExt('sh')).toBeNull();
    expect(parserForExt('ps1')).toBeNull();
    expect(parserForExt('toml')).toBeNull();
    expect(parserForExt('txt')).toBeNull();
    expect(parserForExt('')).toBeNull();
    expect(parserForExt('mdx')).toBeNull();
  });
});

describe('formatCode', () => {
  it('JSON：格式化 → 缩进 2 空格', async () => {
    const out = await formatCode('{"a":1,"b":[1,2]}', 'json');
    expect(out).toBe('{\n  "a": 1,\n  "b": [1, 2]\n}');
  });

  it('JSON 语法错误 → reject 含 "解析错误"', async () => {
    await expect(formatCode('{"a":', 'json')).rejects.toThrow(/解析错误/);
  });

  it('js：prettier babel 输出（单引号/无分号按默认 prettier 3）', async () => {
    const out = await formatCode('const a={x:1,y:2};', 'js');
    expect(out).toBe('const a = { x: 1, y: 2 };\n');
  });

  it('ts：prettier typescript 输出', async () => {
    const out = await formatCode('type T = {a:string;b:number};', 'ts');
    expect(out).toContain('type T = { a: string; b: number };');
  });

  it('css：prettier 输出', async () => {
    const out = await formatCode('.a{color:red;margin:0}', 'css');
    expect(out).toContain('.a {');
    expect(out).toContain('color: red;');
  });

  it('markdown：prettier 输出', async () => {
    const out = await formatCode('# t\n\n\npara', 'md');
    expect(out).toBe('# t\n\npara\n');
  });

  it('vue：prettier vue parser 可处理 <script setup>', async () => {
    const out = await formatCode('<script setup lang="ts">const a=1</script>\n\n<template><div>{{a}}</div></template>', 'vue');
    expect(out).toContain('<template>');
  });

  it('yaml：prettier 输出', async () => {
    const out = await formatCode('a: 1\nb:\n  - x', 'yml');
    expect(out).toContain('a: 1');
  });

  it('不支持类型 → reject 明确文案', async () => {
    await expect(formatCode('print(1)', 'py')).rejects.toThrow(/不支持/);
  });

  it('prettier 解析失败（残缺代码）→ reject 明确文案', async () => {
    await expect(formatCode('const a = {', 'js')).rejects.toThrow(/格式化失败/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd run test:web`
Expected：FAIL — `format.test.ts` 无法 import `./format`（模块不存在 / 无导出）。

- [ ] **Step 3: 实现 format.ts**

Create `web/src/format.ts`：
```ts
type PluginModules = Array<string>;

const PLUGIN_GROUP: Record<string, PluginModules> = {
  babel: ['prettier/plugins/babel.js', 'prettier/plugins/estree.js'],
  typescript: ['prettier/plugins/typescript.js', 'prettier/plugins/estree.js'],
  css: ['prettier/plugins/postcss.js'],
  scss: ['prettier/plugins/postcss.js'],
  less: ['prettier/plugins/postcss.js'],
  html: ['prettier/plugins/html.js'],
  vue: ['prettier/plugins/html.js'],
  markdown: ['prettier/plugins/markdown.js'],
  yaml: ['prettier/plugins/yaml.js'],
};

const EXT_TO_PARSER: Record<string, string> = {
  json: 'json',
  js: 'babel',
  mjs: 'babel',
  cjs: 'babel',
  jsx: 'babel',
  ts: 'typescript',
  tsx: 'typescript',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'vue',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
};

export function parserForExt(ext: string): string | null {
  const key = ext.trim().toLowerCase().replace(/^\./, '');
  if (!key) return null;
  return EXT_TO_PARSER[key] ?? null;
}

async function loadPlugins(parser: string): Promise<Array<{ format: unknown }>> {
  const specList = PLUGIN_GROUP[parser];
  const out: Array<{ format: unknown }> = [];
  for (const spec of specList ?? []) {
    const mod = (await import(spec)) as { default?: unknown };
    const plugin = (mod.default ?? mod) as { format: unknown };
    if (plugin) out.push(plugin);
  }
  return out;
}

export async function formatCode(src: string, ext: string): Promise<string> {
  const parser = parserForExt(ext);
  if (!parser) throw new Error('该类型不支持格式化');
  if (parser === 'json') {
    let obj: unknown;
    try {
      obj = JSON.parse(src);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`JSON 解析错误：${msg}`);
    }
    return `${JSON.stringify(obj, null, 2)}\n`;
  }
  try {
    const prettier = (await import('prettier/standalone.js')) as { format: (s: string, o: Record<string, unknown>) => Promise<string> };
    const plugins = await loadPlugins(parser);
    const options: Record<string, unknown> = { parser, plugins };
    if (parser === 'html' || parser === 'vue') options.htmlWhitespaceSensitivity = 'ignore';
    return await prettier.format(src, options);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`格式化失败：${msg}`);
  }
}
```

注意：
- 顶部**不得**静态 import prettier；全部动态 `import()`（`vue-tsc` 对 `Record<string, unknown>` 的 options 足够宽松，避免 TS 复杂泛型）。
- import 后缀 `.js` 与 Task 1 Step 3 实测结果一致（若实际只认无后缀路径，改 `PLUGIN_GROUP` 与 standalone 串后同步 Task 3 校验）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd run test:web`
Expected：PASS（全部 format.test.ts 用例）。注意若 prettier 默认输出与断言不符（例如 JSON 尾随换行差异），以 prettier/JSON.stringify 真实行为为准微调断言，勿为让测试过而弱化实现。

- [ ] **Step 5: typecheck**

Run: `npm.cmd run typecheck`
Expected：通过（无 vue-tsc 报错）。

- [ ] **Step 6: Commit**

```powershell
git add web/src/format.ts web/src/format.test.ts
git commit -m "feat(web): format.ts 格式化模块（json 原生 + prettier 按需插件）"
```

---

### Task 3: FilePreview.vue — 保存链重构（pendingText）

**Files:**
- Modify: `web/src/components/FilePreview.vue`

说明：预览态 md/html 未挂 CodeMirror，现有 `flush()` 依赖 `view` 取文本会空转。把「待保存文本」收敛到 `pendingText` ref。

- [ ] **Step 1: 现状核对**

Read `web/src/components/FilePreview.vue` 第 91-217 行，定位：
- `const dirty`/`saveState`/`saveTimer`/`saveChain`/`doWrite`/`scheduleSave`/`flush`/`docChanged`/`mountEditor`。

- [ ] **Step 2: 编辑 script（增 pendingText，改 scheduleSave/flush/docChanged）**

在 `const dirty = ref(false);` 前新增：
```ts
const pendingText = ref('');
```
将以下函数替换为：
```ts
function scheduleSave(text?: string) {
  if (typeof text === 'string') pendingText.value = text;
  dirty.value = true;
  saveState.value = 'idle';
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flush(), 800);
}
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!dirty.value) return;
  const snapshot = pendingText.value;
  saveChain = saveChain.then(() => doWrite(snapshot)).catch(() => { /* doWrite 已处理 */ });
}
function docChanged() {
  if (!view) return;
  const s = view.state.doc.toString();
  raw.value = s;                 // 供 md 预览实时使用
  pendingText.value = s;
  scheduleSave();
}
```
同时 `onRetrySave`/`onBeforeUnmount` 里对 `flush()` 的调用不变（现不再读 view）。

- [ ] **Step 3: typecheck + 现有测试回归**

Run: `npm.cmd run typecheck; npm.cmd run test:web`
Expected：通过；`markdown.test.ts`/`useTerminal.test.ts` 不受影响。

- [ ] **Step 4: Commit**

```powershell
git add web/src/components/FilePreview.vue
git commit -m "refactor(web): 自动保存链改用 pendingText，消除对 CodeMirror view 的强依赖"
```

---

### Task 4: FilePreview.vue — 格式化按钮与写回

**Files:**
- Modify: `web/src/components/FilePreview.vue`

- [ ] **Step 1: script 增 import 与状态**

顶部 import 加：`import { parserForExt, formatCode } from '../format';`

在 save 相关 ref 区新增：
```ts
const canFormat = computed(() => kind.value === 'text' && status.value === 'ok' && !!parserForExt(ext.value));
const fmtBusy = ref(false);
const fmtErr = ref('');
```
（`computed` 已 import。）

在 `flush`/`docChanged` 之后新增：
```ts
async function onFormat() {
  if (!canFormat.value || fmtBusy.value) return;
  const parser = parserForExt(ext.value);
  if (!parser) return;
  fmtBusy.value = true;
  fmtErr.value = '';
  try {
    const src = view ? view.state.doc.toString() : raw.value;
    const out = await formatCode(src, ext.value);
    if (view) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: out } });
    } else {
      raw.value = out;
      scheduleSave(out);
    }
  } catch (e: any) {
    fmtErr.value = String(e?.message || e);
  } finally {
    fmtBusy.value = false;
  }
}
```
说明：
- 编辑器态 dispatch 会触发 `docChanged` → 自动保存链；预览态直接更新 `raw.value` + `scheduleSave(out)`。
- 切文件时清空 fmtErr：在 `load()` 开头加 `fmtErr.value = '';`。

- [ ] **Step 2: 模板加按钮与错误条**

在 `.head` 的 `.right` 内、`save` 状态 span 之后、「预览/代码」`seg` 之前插入：
```html
<button type="button" class="fmt" :disabled="!canFormat || fmtBusy" @click="onFormat">格式化</button>
<span v-if="fmtErr" class="save saveerr" title="格式化失败">⚠ {{ fmtErr }}</span>
```

样式（scoped，加在现有 `.seg button` 附近）：
```css
.fmt { background: #262c34; color: #c8d0da; border: 1px solid #2a323e; border-radius: 4px; padding: 2px 10px; font-size: 11px; cursor: pointer; }
.fmt:disabled { opacity: .4; cursor: default; }
.fmt:not(:disabled):hover { border-color: #4c9aff; color: #fff; }
```

- [ ] **Step 3: typecheck**

Run: `npm.cmd run typecheck`
Expected：通过。

- [ ] **Step 4: Commit**

```powershell
git add web/src/components/FilePreview.vue
git commit -m "feat(web): 文件预览标题栏格式化按钮（json/prettier）"
```

---

### Task 5: 手动验证（HMR 实时生效）

前置：dev:web 在 :5173 后台运行。

- [ ] **Step 1: 浏览器验证 JSON**

打开 http://localhost:5173 → 文件树打开一个 `.json`（内容乱缩进，如 `package.json`）→ 点「格式化」→ 内容变为 2 空格缩进；约 800ms 后状态显示「✓ … 已保存」。
Expected：如上。

- [ ] **Step 2: 不支持类型置灰**

打开 `.py` / `.toml` 文件 → 「格式化」按钮 disabled。
Expected：按钮灰、不可点。

- [ ] **Step 3: 代码文件格式化**

打开 `.js`/`.ts`/`.vue` 文件 → 点「格式化」→ 代码规范化、自动保存。
Expected：如上。

- [ ] **Step 4: md/html 预览态格式化**

打开 `.md`（预览态，未进代码态）→ 点「格式化」→ markdown 预览即时刷新且 ~800ms 落盘；再点「代码」确认内容已格式化。
Expected：如上。

- [ ] **Step 5: 错误路径**

把 `.json` 改成非法内容（缺 `}`）→ 点「格式化」→ 头部红字 `JSON 解析错误：…`，原内容不动；`.md` 预览态格式化的 md 预览同步刷新。

- [ ] **Step 6: 回归**

切项目、开新会话、终端交互、md 预览相对图片/链接仍正常。

---

## Self-Review

对照 spec：
- JSON 原生格式化 ✅ Task 2（json parser + 原生 JSON.parse/stringify）
- prettier 常用类型 ✅ Task 2（babel/typescript/postcss/html/vue/markdown/yaml）
- 工具栏按钮 + 置灰 ✅ Task 4
- 800ms 自动保存（不强制落盘）✅ Task 3/4（dispatch 或 scheduleSave 均走 debounce 链）
- 保存链小重构消除 view 依赖 ✅ Task 3
- 错误处理不破坏原内容 ✅ Task 4（catch 仅设 fmtErr；dispatch 前先成功）
- 测试 format.test.ts + 回归 ✅ Task 2/3/5
- 离线打包约束：无 CDN，prettier 本地依赖经 Vite 打包 ✅ Task 1 + format.ts 动态 import

类型一致性：`parserForExt(ext)`、`formatCode(src, ext)`、`PLUGIN_GROUP`/`EXT_TO_PARSER` 键在各 Task 一致；`scheduleSave(out)` 可选参在 Task 3 定义、Task 4 预览态调用一致。
