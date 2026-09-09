# 文件预览窗口：JSON / 代码格式化 — 设计

日期：2026-09-09
状态：已确认（方案 A）
范围：`web/` 纯前端；不改 server / shared / 协议

## 背景与目的

中央区 `FilePreview.vue` 目前以 CodeMirror 6 编辑器打开文本文件并自动保存。用户希望在文件预览窗口增加**格式化**能力：

1. `.json` 文件格式化（原生 `JSON.stringify` 缩进）。
2. 常用代码文件（JS/TS/CSS/HTML/Markdown/YAML…）用 prettier 格式化。
3. 统一在标题栏右侧放一个「格式化」按钮，点击生效；结果走现有 800ms 自动保存链。

前置修复（本次已完成）：HTML 文件预览默认进「预览」态、顶部提供「预览/代码」切换，因 Vite 预构建缓存陈旧导致白屏/无控件，已通过修正 legacy-modes 导出名（`dockerFile`、`powerShell`）+ 清 `.vite` 缓存 + 重启 dev:web 解决。

## 需求要点（已与用户确认）

- 格式化触发：**标题栏右侧一个「格式化」按钮**。
- 覆盖类型：prettier 覆盖常用格式；JSON 用原生；不支持的扩展名按钮置灰。
- 保存：格式化后写入缓冲区并走**现有 800ms 自动保存**（不强制立即写盘）。
- 本应用为离线绿色包，依赖必须 Vite 本地打包，禁止外链 CDN。

## 方案

**方案 A（选定）**：prettier 浏览器端（`prettier/standalone`）+ 动态 `import()` 按需插件。

- 新依赖：`prettier`（dev 与运行均经 Vite 打包）。
- `.json` 走原生：`JSON.parse` → `JSON.stringify(src, null, 2)`。
- 其余受支持类型走 prettier，插件按需动态导入拆 chunk：
  - js/mjs/cjs/jsx → parser `babel`（需 `prettier/plugins/babel.js` + `prettier/plugins/estree.js`）
  - ts/tsx → parser `typescript`（`prettier/plugins/typescript.js` + `estree.js`）
  - css → `css`、scss → `scss`、less → `less`（`prettier/plugins/postcss.js`）
  - html/htm → `html`；vue → `vue`（两者同用 `prettier/plugins/html.js`，该插件内置 vue parser）
  - md/markdown → `markdown`（`prettier/plugins/markdown.js`）
  - yml/yaml → `yaml`（`prettier/plugins/yaml.js`）
  - 插件模块以 `import('prettier/plugins/xxx.js')` 命名空间方式加载，取整对象放入 `plugins:[...]`。
- 不受支持（py/java/go/shell/ps1/toml/lua/swift/rb/pl/c/cpp/php/sql/dockerfile…）→ 按钮禁用。
- 不改后端：格式化纯客户端，`/api/file` 写入逻辑复用。

## 组件与数据流

### 新模块 `web/src/format.ts`

纯函数式，供测试。

```ts
export function parserForExt(ext: string): string | null
// 'json'|'babel'|'typescript'|'css'|'scss'|'less'|'html'|'markdown'|'yaml' | null
// json 与 prettier 支持项返回非 null；其余返回 null（禁用按钮）

export async function formatCode(src: string, ext: string): Promise<string>
// 统一入口：
//  - ext === 'json' → JSON.parse/stringify(,2)；语法错误抛 "JSON 解析错误：…"
//  - 其它 → 动态 import prettier/standalone + 对应插件，format({ parser });
//    prettier 解析/格式化失败抛明确文案
//  - 未知 ext（parserForExt 为 null）抛 "该类型不支持格式化"
```

要点：
- `format.ts` 顶层**不得**静态 import prettier（体积大），全部 `await import()`，首击才加载对应 chunk。
- JSON 解析错误信息要回传用户可见（例如定位行号可选，最低限度为 `JSON.parse` 的 message）。
- 常量表把 ext ↔ parser ↔ 需加载插件子串映射集中一处，便于测试与后续加类型。

### `FilePreview.vue` 改动

- 标题栏右侧（save 状态与 seg 之间）加「格式化」按钮。
  - `canFormat = computed(() => kind==='text' && status==='ok' && !!parserForExt(ext.value))`
  - 不可点时置灰（`disabled` / 样式）。
- 点击处理 `async function onFormat()`：
  1. 取当前源码：编辑器已挂载则 `view.state.doc.toString()`，否则用 `raw.value`（预览态 md/html）。
  2. `formatCode(src, ext.value)`。
  3. 成功：写回——编辑器态用 `view.dispatch` 整体替换 doc（自动触发 `docChanged` → 自动保存链）；预览态直接更新 `raw.value` 并纳入保存链。
  4. 失败：头部显示红色错误条（复用现有 `note err` 视觉），**不破坏原内容**。
- 格式化中短暂禁用按钮，防止连点。

### 保存路径小重构（消除对 CodeMirror 的强依赖）

当前自动保存强依赖 `view`：
- `flush()` 里 `if (!view || !dirty) return;`，且用 `view.state.doc` 取内容 → 预览态 md/html 未挂编辑器时，格式化落盘会空转。

重构目标（改动尽量小）：
- 增加 `pendingText = ref('')` 作为待保存文本的唯一来源。
- `docChanged` 时同时 `pendingText.value = doc 内容`。
- `flush()` 改为 `if (!dirty) return; doWrite(pendingText.value)`，不再读 `view`。
- 预览态写回路径：`raw.value = formatted; pendingText.value = formatted; scheduleSave()`，由同一 debounce 链落盘。
- 该重构是**纯内部**整理，不改变对外行为与保存时机（仍 800ms debounce、失败重试、成功提示）。

## 错误处理

| 场景 | 表现 |
|---|---|
| JSON 语法错误 | 错误条：`JSON 解析错误：<msg>`；原内容不动 |
| prettier 解析错误 | 错误条：`格式化失败：<msg>`；原内容不动 |
| 不支持类型 | 按钮置灰，不触发 |
| 并发格式化 | 按钮禁用至完成；无竞态写盘 |

## 测试

`web/src/format.test.ts`（vitest）：
- `parserForExt`：json/babel/typescript/html/css/markdown/yaml 映射；py/java/go/shell/toml… 返回 null；空/无扩展 null。
- `formatCode`：
  - JSON 合法 → 缩进 2 空格输出；
  - JSON 非法 → reject 且含「解析错误」；
  - js（babel）→ prettier 化输出（引号/缩进/分号按默认）；
  - css/markdown 冒烟；
  - 未知 ext → reject。
- 注：vitest（node 环境）能直接 `await import('prettier/standalone')`，无需浏览器。

回归：现有 `web/src/markdown.test.ts` 与 `useTerminal.test.ts` 不受影响。

## 验证命令

```powershell
npm.cmd run typecheck
npm.cmd run test:web
```

手动：dev:web（:5173）打开 `.json`（缩进乱）→ 点「格式化」→ 内容缩进、~800ms 后显示「已保存」；`.py` → 按钮置灰；`.md` 预览态格式化 → 预览即时刷新且落盘。
