# 设计文档：文件搜索去截断 + 流式增量（项目文件与小工具统一）

日期：2026-09-22
分支：master
状态：已与用户确认方案（待实现）
前置：`2026-09-21-file-search-design.md`（当前搜索实现）、`2026-09-22-postman-navicat-tool-tabs-design.md`（postman/navicat 迁移 + 客户端搜索）

## 1. 背景与现状

当前搜索实现：

- 后端 `server/project-search.js` 的 `searchProject(root, {query, caseSensitive, searchName, searchContent, limits})` 同步遍历（`fs.readdirSync` / `readFileSync`），返回 `{ nameHits, contentHits, truncated, scanned }`。
- 硬上限（`DEFAULT_LIMITS`，命中任一即 `truncated: true`）：文件名命中 ≤ 200、内容命中总数 ≤ 300、单文件命中 ≤ 50、扫描文件数 ≤ 20000。
- 另有：单文件 > 1MB 跳过、每行文本截断到 400 字符。
- HTTP：`GET /api/search`（`server/http-api.js`）解析参数后 `sendJson(res, 200, searchProject(...))`。
- 前端契约 `web/src/tree/treeSource.ts` 的 `search?(query, opts): Promise<SearchResult>`；`projectTreeSource.ts` 经 `web/src/search/projectSearch.ts` 调 `/api/search`。
- 面板 `web/src/search/FileSearchPanel.vue`：内嵌于 `TreeView.vue`，勾选「内容/文件名/大小写」，底部提示「结果过多，已截断」（`search.truncated`）。
- 工具侧：文件型工具（notepad/yaml/translate/js）用 `web/src/tree/toolFileTreeSource.ts`，**无 search**；postman/navicat 的迁移与客户端搜索见前置文档（进行中）。

现状问题：结果会被静默截断，用户看不到完整命中；面板无「连忽略目录/二进制也搜」的开关；工具侧树没有同款搜索。

## 2. 需求原文（用户）

> 文件搜索能力，不要出现截断，可以懒加载，但是不要截断，或者直接全部铺开也可以。

后续确认：

- 输出与扫描**全部不设上限**（真全量）。
- 文件过大可能卡死时，**界面提示用户即可**，不靠硬上限避免。
- 保留目录跳过 + 二进制跳过，放开文件大小与行长；界面加勾选，用户主动取消勾选后连忽略目录/二进制也搜。
- 交付方式：**流式扫描 + 增量渲染**（不截断也不卡死）。
- 小工具（postman/notepad 等）也要保留/具备同样的搜索能力。

## 3. 目标

- 搜索**永不截断**：去掉全部数字上限、去掉单文件大小上限、去掉每行字符截断。
- 默认跳过忽略目录与二进制文件；新增界面勾选「包含忽略目录/二进制」，取消勾选即放开。
- 服务端边扫边流式返回，不阻塞事件循环；前端随到随渲染，不一次性塞满 DOM。
- 文件型小工具（notepad/yaml/translate/js）获得与项目文件**完全一致**的搜索能力。
- postman/navicat 的搜索（前置文档定义的客户端纯函数）适配新的流式契约。
- 全文案中英 i18n 对称。

## 4. 非目标

- 结果列表虚拟滚动（先靠流式 + 提示；若后续仍卡再加）。
- 二进制内容的十六进制预览。
- `.gitignore` 精确解析、正则/全词/类型过滤。
- 跨项目 / 全局搜索。
- 替 postman/navicat 迁移收尾（其迁移由前置文档负责，本设计只保证新契约可被其实现）。
- 本地目录来源（`localTreeSource`，File System Access）的搜索。

## 5. 设计

### 5.1 流式协议（NDJSON）

`GET /api/search`、`/api/files/<tool>/search`、`/api/notepad/search` 统一改为流式响应：

- 请求：现有 query 参数（`project`/`q`/`case`/`name`/`content`）不变，新增 `all=1`（= 包含忽略目录与二进制；缺省/`0` 表示默认跳过）。
- 响应头：`Content-Type: application/x-ndjson; charset=utf-8`、`Cache-Control: no-store`。
- 响应体：每行一个 JSON 事件（`\n` 分隔）：

  | `type` | 载荷 | 说明 |
  | --- | --- | --- |
  | `name` | `{ hits: [{path,name},...] }` | 一批文件名命中 |
  | `content` | `{ path, name, lines: [{line,text},...] }` | 单个文件的内容命中（同文件行连续，前端直接挂一个分组） |
  | `progress` | `{ scanned }` | 周期性进度（每扫过 N 个文件发一次） |
  | `done` | `{ scanned }` | 扫描结束（终态） |

- 客户端断开（`res.on('close')`）立即停止扫描。
- 参数非法（`q` 为空）：仍为普通 JSON `400 { error:'q required' }`（在开始流式前返回）。

### 5.2 后端扫描（`server/project-search.js`）

- 改为主入口 `async function* streamProject(root, opts)` 异步生成器：
  - `opts`: `{ query, caseSensitive, searchName, searchContent, skipIgnores }`（`skipIgnores` 由路由层把 `all` 取反传入）。
  - 用 `node:fs/promises` 的 `readdir`/`stat`/`readFile`，每次 `await` 让出事件循环 → 不阻塞服务端。
  - 保留 `IGNORE_DIRS` 跳过（`skipIgnores=false` 时跳过；`true` 时不跳过）与二进制探测（读前 64KB 含 NUL）。
  - 文件名命中按批 `yield { type:'name', hits }`；内容命中**按文件** `yield { type:'content', path, name, lines }`；周期性 `yield { type:'progress', scanned }`；末尾 `yield { type:'done', scanned }`。
  - 删除 `DEFAULT_LIMITS`、`truncated` 字段、`maxLineLength` 截断、`maxFileBytes` 限制。
  - 空 `query` / 无有效分词 / 两种模式都关：立即 `yield { type:'done', scanned: 0 }`。
- 保留一个便捷收集器供测试与旧调用方使用：

  ```js
  export async function searchProject(root, opts) { // 消费生成器，聚合为 { nameHits, contentHits, scanned }
    const nameHits = []; const contentHits = [];
    for await (const ev of streamProject(root, opts)) {
      if (ev.type === 'name') nameHits.push(...ev.hits);
      else if (ev.type === 'content') for (const l of ev.lines) contentHits.push({ path: ev.path, name: ev.name, line: l.line, text: l.text });
      else if (ev.type === 'done') return { nameHits, contentHits, scanned: ev.scanned };
    }
    return { nameHits, contentHits, scanned: 0 };
  }
  ```

- **排序变化**：流式下无法做「按命中分词数」的全局排序，结果按目录遍历顺序到达（同文件内容仍连续）。排序相关的 `_score`/`_fileScore` 逻辑删除。

### 5.3 HTTP 路由（`server/http-api.js`）

- 抽一个小工具 `sendNdjsonStart(res)`（写响应头）与 `writeNdjson(res, ev)`（`res.write(JSON.stringify(ev) + '\n')`）。
- `/api/search` 分支：解析参数后，`for await (const ev of streamProject(root, {...}))` 逐条写；`res.on('close', ...)` 用标志位停止消费生成器（`return` 或破坏循环）。
- `handleFiles` 增加 `sub === '/search' && req.method === 'GET'` 分支：`store.dir` 为工具目录，其余同 `/api/search`。`/api/notepad/*` 与 `/api/files/<tool>/*` 自动共用。
- 错误处理：流开始前抛错仍走 `treeStatusOf`；流开始后出错则写一行 `{ type:'done' }`（或 `res.end()`）并结束。

### 5.4 前端契约（`web/src/tree/treeSource.ts`）

```ts
export interface SearchNameHit { path: string; name: string; }
export interface SearchContentHit { path: string; name: string; line: number; text: string; }
export interface SearchLine { line: number; text: string; }
export type SearchEvent =
  | { type: 'name'; hits: SearchNameHit[] }
  | { type: 'content'; path: string; name: string; lines: SearchLine[] }
  | { type: 'progress'; scanned: number }
  | { type: 'done'; scanned: number };
export interface SearchHit { path: string; name: string; line?: number; }

export interface TreeSource {
  // …
  search?(query: string, opts: { caseSensitive: boolean; name: boolean; content: boolean; all: boolean }, signal?: AbortSignal): AsyncIterable<SearchEvent>;
  openHit?(hit: SearchHit): void;
}
```

- 删除 `SearchResult` 类型（改由流事件表达）；`SearchHit`/`openHit` 不变。
- `projectSearch.ts`：`searchProject(projectId, query, opts, signal)` 改为 `async function*`，`fetch(url, { signal })` 后读 `res.body` 的 `ReadableStream`，用 `TextDecoder` 按 `\n` 拆行、逐行 `JSON.parse` 并 `yield`；非 2xx 抛错。
- `projectTreeSource.ts`：`search` 透传 `signal`。

### 5.5 面板（`web/src/search/FileSearchPanel.vue`）

- 新增勾选项（`data-mode="all"`）：「包含忽略目录/二进制」，默认**不勾**（= 默认跳过）；变更即重搜，带 `all`。
- 改为流式消费：
  - 每次 `run()` 新建 `AbortController`，取消上一次（防抖 / 改词 / 改开关）。
  - `nameHits` 追加；内容按 `path` 维护 `Map` 分组，收到 `content` 事件即追加一个文件分组。
  - `scanned` 随 `progress`/`done` 更新；`done` 置 `loading=false`。
  - 错误：非 2xx 或流中断时展示 `search.error`。
- 去掉底部「结果过多，已截断」（删除 `search.truncated` 使用）。改为纯提示：命中总数超过阈值（如 2000）时显示 `search.too_many`「结果较多，界面可能变慢」，**不裁剪**。
- 命中高亮（`segments`）逻辑不变。

### 5.6 文件型工具搜索

- 后端：`handleFiles` 的 `/search` 分支复用 `streamProject(store.dir, ...)`，无需改 `notepad-store.js`（已暴露 `dir`）。
- 前端 `toolFileTreeSource.ts` 实现：
  - `search(query, opts, signal)`：调 `${base}/search`（`base = /api/files/<tool>`）流式，语义与项目侧一致。
  - `openHit(hit)`：设 `activeId = hit.path` 打开该文件。
- 效果：notepad/yaml/translate/js 的左侧 `TreeView` 自动出现 🔍 与「包含忽略目录/二进制」勾选；能力与项目文件一致。
- **内容命中定位**：工具侧暂无「定位到行」能力（`DocSource` 无 locate），内容命中先只打开文件（不跳行）；项目侧保留定位到行。

### 5.7 postman/navicat 适配

- 前置文档中 postman/navicat 的 `search` 是**客户端纯函数**，返回旧 `SearchResult` 结构。本设计下需改为返回 `AsyncIterable<SearchEvent>`（把即时计算结果 yield 成 `name` / `content` / `done` 事件即可，无需服务端改动）。
- 前置文档的 `postmanTreeSource.test.ts` / `navicatTreeSource.test.ts` 中针对 `search` 的断言同步改为消费流。
- 若前置迁移尚未完成，本设计只定义契约并要求其实现遵循，不替其收尾。

### 5.8 i18n（`shared/i18n/zh-CN.js` + `en.js`）

- 新增（中英对称）：
  - `search.include_ignored`：「包含忽略目录/二进制」/ "Include ignored dirs & binaries"
  - `search.too_many`：「结果较多，界面可能变慢」/ "Many results; the UI may slow down"
  - （可选）`search.progress`：「已扫描 {n} 个文件…」/ "Scanned {n} files…"
- 删除 `search.truncated`（中英同步删除）。
- 提交前跑 `npm.cmd run check:i18n`。

## 6. 影响文件

**修改（后端）**
- `server/project-search.js`（改异步生成器 + 收集器、去上限）
- `server/http-api.js`（`/api/search` 流式、`handleFiles` 加 `/search`、NDJSON 助手）

**修改（前端）**
- `web/src/tree/treeSource.ts`（`SearchEvent` 契约）
- `web/src/tree/projectTreeSource.ts`（透传 signal）
- `web/src/tree/toolFileTreeSource.ts`（+ `search`/`openHit`）
- `web/src/search/projectSearch.ts`（改异步生成器）
- `web/src/search/FileSearchPanel.vue`（流式增量 + `all` 勾选 + 提示）
- `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

**测试**
- `server/test/project-search.test.js`（改流式 + 去上限）
- `web/src/search/FileSearchPanel.test.ts`（改异步生成器 mock + `all`）
- `web/src/tree/projectTreeSource.test.ts`（改契约）
- `web/src/tree/toolFileTreeSource.test.ts`（补 `search`）
- （按需）`server/test/http-api.test.js`、`server/test/notepad-http.test.js`（流式端点）

## 7. 测试计划

- server `project-search`：临时目录构造树；覆盖名字/内容命中、行号与整行文本（不再截 400）、大小写开关、`skipIgnores` 开关（能/不能搜到 `node_modules`、二进制、大文件）、多分词任一分词命中、流事件序列（`name`/`content`/`progress`/`done`）、空 `q`。
- server 路由：`/api/search` 与 `/api/notepad/search`（或 `/api/files/<tool>/search`）流式返回 `application/x-ndjson`，行可被逐条解析；`q` 为空 400，未知项目 404。
- web `projectSearch` / `projectTreeSource`：请求 URL 与参数（含 `all`）、`signal` 透传、NDJSON 拆行与事件映射。
- web `FileSearchPanel`：`all` 勾选触发带参重搜；流式事件增量渲染 name/content 分组；`scanned` 更新；`too_many` 提示出现；错误态。
- web `toolFileTreeSource`：`search` 调 `${base}/search` 并映射事件；`openHit` 设 `activeId`。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。
- 手工（dev，`npm.cmd run dev`，http://localhost:5173）：目录页签搜索大仓库，结果持续增长且无「已截断」；勾选/取消「包含忽略目录/二进制」能搜到 `node_modules` 内容；notepad/yaml/translate 左侧 🔍 同款可用。

## 8. 风险与取舍

- **取消全局排序**：结果按遍历顺序（非同文件按路径分组、内容按文件连续）。这是流式 + 不截断的必要取舍。
- **超大文件全读**：去掉 1MB 上限后单文件全量读入内存，命中行整行返回；由界面 `too_many` 提示兜底。
- **工具内容命中不跳行**：工具侧无 locate 能力，先只打开文件。
