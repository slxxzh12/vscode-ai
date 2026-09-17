# 设计文档：按目录恢复窗口（页签 + 消息历史）

日期：2026-09-17
分支：master
状态：已评审通过，待编写实施计划

## 1. 概述

刷新页面或重开 devflow 时，当前的"窗口状态"会丢：中心区的**文件页签**全没（会话页签还能回来），左侧停在哪儿、历史面板选的是"文件"还是"消息"、消息页的筛选开关，都不保留。本设计让 devflow 记住上次的窗口，使得**回到同一个项目目录时，页签和消息历史都能接着上次看**。

同时给左侧「消息」页加一个**筛选开关**：默认只显示当前会话的消息；关掉则显示当前项目的消息。

核心约束（已与用户逐条确认）：

| # | 决定 | 取值 |
|---|------|------|
| 1 | 页签恢复范围 | **全部文件页签**（跨项目一起恢复，含顺序）+ **上次激活的页签**；会话页签沿用现有自动恢复，不做持久化 |
| 2 | 左侧栏位 | 恢复 `rail` 与「历史」子页（文件/消息）；**URL hash 优先级最高**（显式深链不被覆盖） |
| 3 | 消息筛选开关 | 位置在左侧「历史」→「消息」页头部；**默认开启**（仅当前会话） |
| 4 | 筛选匹配规则 | 消息有 `sessionId` 就比 `sessionId === 当前会话 id`；没有 `sessionId` 的老消息退回比 `tabName === 当前页签显示名` |
| 5 | 无当前会话时 | 激活的是文件页签、或停在通讯录/统计等非终端视图 → 视为"无当前会话"，筛选自动退化为"当前项目" |
| 6 | 关闭筛选时 | 显示"当前项目的消息"**+ 无法归属的老消息**（照常显示，见 §5） |
| 7 | 项目归属来源 | 先查活跃会话（`terminal.state.sessions` 的 `projectId`），查不到再查 `sessionId → projectId` 映射 |
| 8 | 映射写入点 | **服务端**在会话创建时记录（`SessionManager`），只增不删，上限 500 条淘汰最旧 |
| 9 | 存储位置 | **用户数据目录**（`<数据目录>/ports/<端口>/`），不用 localStorage；一个端口一份，dev 与绿色包天然隔离 |
| 10 | 多端 | **全局一份**，最后写者覆盖（不做按客户端分槽） |
| 11 | 失效项处理 | 保存的页签其 `projectId` 不在 `projects.json` 里 → 跳过；`activeTab` 找不到对应页签 → 忽略，回到默认 |
| 12 | opencode 会话续接 | **不做**（不引入 `--continue`/`--session`） |

## 2. 现状与落点

现状（改动前）：

- `web/src/useCenter.ts:15-19` — `tabs`/`activeId` 是纯内存 ref，**没有任何持久化**；页签形状 `{ id, kind: 'session' | 'file', label, sub?, projectId?, path? }`，文件页签 id 为 `f:<projectId>|<path>`。
- `web/src/components/TerminalView.vue:706-713` — `watch(state.sessions)` 对每个服务端会话 `ensureSession()`；**会话页签本来就能在刷新后自动回来**（PTY 活在服务端）。
- `web/src/components/TerminalView.vue:685-695` — `SESSION_LIST` 命中 `agentSids` 时绑定回固定 Agent 会话，否则新建，`autoTried` 保证只做一次。
- `web/src/App.vue:147-175` — `rail` / `historyTab` / `collabTab` + `applyHash()`/`syncHash()`：点击栏位会 `replaceState` 写 URL hash，**刷新时能靠 hash 恢复栏位**；但从启动器重新打开（URL 无 hash）就退回默认 `explorer`。
- `web/src/App.vue:227-265` — 文件**历史**（不是页签）持久化在 localStorage，键名按服务端公钥指纹隔离（`devflow-file-history-<fp>`）。
- `web/src/App.vue:374-377` — `selectProject()` 只切 `currentProject`，**不关任何文件页签**；所以文件页签现状就是跨项目常驻。
- `web/src/useMessageHistory.ts:9,25-34` — 消息是**全局一份**（服务端 `message-history.jsonc`，上限 200），每条 `{ text, ts, sessionId?, tabName? }`，**不带 projectId**；`App.vue:445` 启动时 `load()`。
- `server/session-manager.js:7,20-35` — 会话 id 是 `s_` + 8 位随机 hex（**不会跨重启复用**，可安全做历史映射键）；`create({ projectId })` 已知项目。
- `server/port-paths.js:11-36` — 端口数据目录的纯路径推导（`message-history.jsonc`、`code-groups.json`、`code-prefs.json`、`composer-prefs.json` …）。
- `server/json-store.js:5-30` — 通用小存储 `createJsonStore`：读时归一化、写时先临时文件再 rename、损坏回退默认值。
- 现成范式：`server/composer-prefs.js`（归一化 + `createJsonStore`）+ `server/http-api.js:250-257`（`GET/POST /api/composer/prefs`）+ `web/src/codePrefs.ts`（前端去抖 `POST`）。
- `server/index.js:601-614` — `/api/history` 的 GET/POST 直接写在 `index.js` 的 HTTP 分发里。

## 3. 服务端

### 3.1 `server/session-projects.js`（新增）

`sessionId → projectId` 映射存储，只承担这一件事：

```js
// 条目形状：{ "s_ab12cd34": "<projectId>" }
export function normalizeSessionProjects(input)   // 只保留 key/value 皆非空字符串的项
export function createSessionProjects({ file, logger })
  // → { read(), record(sessionId, projectId) }
```

- 内部用 `createJsonStore({ file, logger, normalize: normalizeSessionProjects, defaults: () => ({}) })`。
- `record()`：`sessionId`/`projectId` 任一为空/非字符串则直接返回当前值（不写盘）；否则幂等写入（值相同不重复写盘）。
- **上限**：500 条，超出时删除最旧插入的键（插入顺序即 Map/对象键序）。
- 只增不删：会话被 kill 不清映射（消息还在，仍需归属）。

### 3.2 `server/window-state.js`（新增）

窗口状态存储，含白名单校验：

```js
// 形状
{
  "rail": "explorer" | "history" | "contacts" | "stat" | "scheduler" | "proxy" | "mobile",
  "historyTab": "files" | "messages",
  "msgFilter": true,
  "tabs": [{ "projectId": "p1", "path": "src/a.ts", "label": "a.ts" }],
  "activeTab": "f:p1|src/a.ts"
}
export function normalizeWindowState(input)   // 见下
export function createWindowState({ file, logger })  // → { read(), write(next) }
```

`normalizeWindowState` 规则：

- `rail`：必须在 rail 白名单内，**且不等于 `mobile`**（手机视图由 `web/src/mobileLanding.ts` 的自动逻辑管理，不参与窗口恢复），否则丢弃该键。
- `historyTab`：必须是 `'files' | 'messages'`，否则丢弃。
- `msgFilter`：必须是 boolean，否则丢弃。
- `tabs`：数组；每项 `projectId`/`path`/`label` 皆为字符串且 `path` 非空才保留；`label` 缺失时用 path 反推文件名；**上限 50 条**（超出截断尾部）。
- `activeTab`：字符串或 `null`，否则丢弃。
- 未知键一律丢弃；整体非法 → 返回 `{}`（由 `createJsonStore` 的容错兜底）。

### 3.3 `server/session-manager.js`

构造参数新增 `onCreated = null`，在 `create()` 内 `this.sessions.set(...)` 之后调用：

```js
constructor({ ptyFactory = createPty, ringMaxBytes = 256 * 1024, logger = console, projectResolver = null, onCreated = null } = {}) {
  ...
  this.onCreated = onCreated;   // (session) => void，记录 sessionId → projectId
}
// create() 末尾：
this.onCreated?.(session);
```

选在 `SessionManager` 而非 `ws-gateway.js` 的 `C2S.CREATE` 分支：scheduler / workflow-runner 也走 `sessionManager.create()`，所有创建路径都能覆盖，且无需改动这些模块。

### 3.4 接线

- `server/port-paths.js`：新增
  - `sessionProjectsFile: path.join(dir, 'session-projects.json')`
  - `windowStateFile: path.join(dir, 'window-state.json')`
- `server/http-api.js`：`createHttpApi({ …, sessionProjects = createSessionProjects({}), windowState = createWindowState({}) })`；新增
  - `GET /api/session-projects` → `sessionProjects.read()`
  - `GET /api/window-state` → `windowState.read()`
  - `POST /api/window-state` → `windowState.write(body)`，返回归一化结果
  - 只读的映射不需要 `POST`（服务端自己写）。
- `server/index.js`：
  - `const sessionProjects = createSessionProjects({ file: paths.sessionProjectsFile, logger: log })`
  - `const windowState = createWindowState({ file: paths.windowStateFile, logger: log })`
  - `new SessionManager({ …, onCreated: (s) => sessionProjects.record(s.id, s.projectId) })`
  - 两个 store 传入 `createHttpApi`。

## 4. 前端

### 4.1 `web/src/sessionProjects.ts`（新增）

```ts
export type SessionProjectMap = Record<string, string>;
export async function fetchSessionProjects(): Promise<SessionProjectMap>   // GET /api/session-projects，失败返回 {}
export function useSessionProjects()   // → { map: Ref<SessionProjectMap>, load(): Promise<void> }
```

模块级单例（与 `useMessageHistory` 一致），失败静默（映射只是筛选的兜底，拿不到就退化为"只认活跃会话"）。

### 4.2 `web/src/windowState.ts`（新增）

```ts
export type Rail = 'explorer' | 'history' | 'contacts' | 'stat' | 'scheduler' | 'proxy' | 'mobile';
export interface SavedTab { projectId: string; path: string; label: string }
export interface WindowState {
  rail?: Rail; historyTab?: 'files' | 'messages'; msgFilter?: boolean;
  tabs?: SavedTab[]; activeTab?: string | null;
}
export function toSavedTabs(tabs: CenterTab[]): SavedTab[]        // 只取 kind === 'file'，保留顺序
export function fileTabsOf(state: WindowState): SavedTab[]        // 归一化后的文件页签列表（无则 []）
export async function fetchWindowState(): Promise<WindowState | null>
export function useWindowState()   // → { load(), save(state): void, flush(): Promise<void> }
```

- `save()` 去抖 600ms 合并写；`flush()` 立即写（`beforeunload` 与测试用）；失败静默（窗口状态丢了不影响使用）。
- 契约：只在"恢复完成"之后才允许 `save()`，由调用方（`App.vue`）持有闸门，避免用空状态覆盖存档。

### 4.3 `web/src/msgFilter.ts`（新增，纯函数，便于单测）

```ts
export interface FilterInput {
  messages: HistoryMessage[];
  filterOn: boolean;
  sessionId: string | null;      // 当前会话页签对应的会话 id
  tabName: string | null;        // 当前会话页签的显示名
  projectId: string | null;      // 当前项目
  liveProjectBySession: Record<string, string | null>;   // 来自 terminal.state.sessions
  map: SessionProjectMap;        // 来自 session-projects.json
}
export function resolveProject(msg, liveProjectBySession, map): string | null
export function filterMessages(input: FilterInput): HistoryMessage[]
export function sessionOfActiveTab(activeTab: CenterTab | null): { sessionId: string; tabName: string } | null
```

规则：

- `resolveProject(msg)`：`msg.sessionId` 在 `liveProjectBySession` 里且值非空 → 返回值；否则 `map[msg.sessionId]` 非空 → 返回它；否则 `null`。
- `filterMessages`：
  - `filterOn && sessionId`：保留 `msg.sessionId === sessionId`，或（该消息没有 `sessionId` 时）`msg.tabName === tabName`。
  - 否则（关闭筛选，或没有当前会话）：保留 `resolveProject(msg) === projectId` **或** `resolveProject(msg) === null`（无法归属的老消息照常显示，见 §5）；`projectId` 为空时全量返回。
- `sessionOfActiveTab`：`activeTab.kind === 'session'` 时返回 `{ sessionId: t.id.slice(2), tabName: t.label }`，否则 `null`。

### 4.4 `web/src/components/HistoryList.vue`

- 新增 props `filter: boolean`，新增 emit `(e: 'update:filter', v: boolean): void`。
- 在「消息」页头部（`.tabs` 与清除按钮同一行）加一个开关按钮：文案 `$t('hist.filter.on')` / `$t('hist.filter.off')`，`title` 为 `$t('hist.filter.title')`，`class="on"` 表示开启。仅在 `tab === 'messages'` 时渲染。
- 展示的数据仍由 `props.messages` 决定（过滤在 `App.vue` 做，组件保持纯展示）。

### 4.5 `web/src/App.vue`

新增状态：

```ts
const msgFilter = ref(true);
const { map: sessionProjectMap, load: loadSessionProjects } = useSessionProjects();
const { load: loadWindowState, save: saveWindowState, flush: flushWindowState } = useWindowState();
let windowRestored = false;             // 闸门：恢复完成前不保存
const liveProjectBySession = computed(() => {
  const out: Record<string, string | null> = {};
  for (const s of terminal.state.sessions) out[s.id] = s.projectId ?? null;
  return out;
});
const activeSession = computed(() => sessionOfActiveTab(center.active.value));
const visibleMessages = computed(() => filterMessages({
  messages: msgHistory.messages.value, filterOn: msgFilter.value,
  sessionId: activeSession.value?.sessionId ?? null,
  tabName: activeSession.value?.tabName ?? null,
  projectId: currentProject.value, liveProjectBySession: liveProjectBySession.value, map: sessionProjectMap.value,
}));
```

模板：`HistoryList` 传 `:messages="visibleMessages"`（原为 `msgHistory.messages.value`）、`:filter="msgFilter"`、`@update:filter="msgFilter = $event"`。

启动顺序（改写 `onMounted`）：保持现有 `loadVersion/writeRegistry/applyHash/initFileHistory/processOpenParam/syncHash/terminal.connect()` 不动，把恢复插在**项目加载之后、终端连接之前**：

1. `applyHash()`（现有，先按 URL 深链定栏位）
2. `await loadProjects()`（`projects` 就绪，用于校验页签的 `projectId`）
3. `void loadSessionProjects()` / `msgHistory.load()`（并行）
4. `const ws = await fetchWindowState()`
5. 应用 `rail` / `historyTab` / `msgFilter`——**按字段判断 hash 优先级**：`applyHash()`（步骤 1）已经设过的字段不再覆盖（例如 `#history/messages` 能覆盖 `rail` 且能覆盖 `historyTab`，而 `#explorer` 只覆盖 `rail`、`historyTab` 仍用存档值；无 hash 时两者都用存档值）
6. 恢复文件页签：`for (const t of fileTabsOf(ws)) if (projects.some(p => p.id === t.projectId)) center.openFile(t.projectId, t.path, t.label)`
7. 若 `ws.activeTab` 且 `center.tabs` 里存在该 id → `center.setActive(ws.activeTab)`
8. `windowRestored = true`
9. `terminal.connect()`

保存：新增 `watch`，依赖 `[() => center.tabs.value.map(t => t.id + '|' + t.label), center.activeId, rail, historyTab, msgFilter]`，回调里 `if (!windowRestored) return; saveWindowState({...})`；`beforeunload` 时 `flushWindowState()`。

## 5. 边界情况

- **无法归属的老消息**（升级前的历史数据必然如此）：既不在活跃会话里、`session-projects.json` 也查不到 → 关闭筛选时**照常显示**。理由：否则升级后老消息会突然全部消失，看起来像被清空；新消息都带映射后列表自然收敛。
- 没有选中项目（`projects` 为空）：关闭筛选时全量返回，不做项目过滤。
- 当前激活的是文件页签 / 停在通讯录、统计等非终端视图：`activeSession` 为 `null` → 等价于关闭筛选（按当前项目）。
- 消息只有 `tabName`（老数据）：筛选开着时按 `tabName` 比对；两个同名页签可能同时命中，属可接受误差。
- 保存的页签对应的项目已被移出 `projects.json`：跳过该页签；该项目下其它页签同样跳过。
- 上次停在手机视图（`rail === 'mobile'`）：不写入存档（`normalizeWindowState` 丢弃）；刷新仍靠 URL hash `#mobile` 恢复，从启动器重开则由 `mobileLanding` 的自动逻辑决定。
- 保存的 `path` 已不存在：页签照常恢复，`FilePreview` 打开时报错（现有行为，不特殊处理）。
- 服务端重启导致会话 id 全变：`activeTab` 指向 `s:<旧 id>` 时找不到页签 → 忽略，回到默认（固定 Agent 会话）。
- 会话在 `record()` 时 `projectId` 为空（shell 会话 / 无项目会话）：跳过，不写盘。
- `window-state.json` 损坏或被手工改坏：归一化后当空处理，退回默认；不会阻断启动。
- 同一浏览器多窗口 / 多端同时打开：全局一份，最后写者覆盖（已确认的设计取舍）。
- 恢复过程中（步骤 4-7）用户立刻操作导致 `tabs` 变化：`windowRestored` 闸门在步骤 8 才打开，恢复结束前不写盘，避免空状态覆盖存档。

## 6. 测试与验证

- `server/test/session-projects.test.js`（新增）：归一化只留字符串键值；`record()` 幂等（同值不重复写盘）；空值跳过；超过 500 条淘汰最旧；文件损坏回退 `{}`。
- `server/test/window-state.test.js`（新增）：`rail`/`historyTab`/`msgFilter` 白名单与类型校验；`tabs` 非法项丢弃、`label` 缺失用文件名补齐、上限 50；`activeTab` 类型校验；未知键丢弃；存取回读。
- `server/test/port-paths.test.js`（扩展）：新增两个路径断言。
- `server/test/http-api.test.js`（扩展）：`GET /api/session-projects` 默认 `{}`；`GET /api/window-state` 默认 `{}`；`POST /api/window-state` 落盘且返回归一化结果、非法字段被剔除。
- `server/test/session-manager.test.js`（扩展）：`onCreated` 在 `create()` 后被调用一次，参数含 `id`/`projectId`；未传 `onCreated` 不报错。
- `web/src/sessionProjects.test.ts`（新增）：GET 成功填 map、失败返回 `{}`、单例复用。
- `web/src/windowState.test.ts`（新增）：`toSavedTabs` 只取文件页签且保序；`fileTabsOf` 容错；`save()` 去抖合并、`flush()` 立即写；失败静默。
- `web/src/msgFilter.test.ts`（新增）：会话匹配（有/无 `sessionId` 两条分支）；`tabName` 回退；关闭筛选按项目过滤；无归属老消息照常显示；`projectId` 为空全量；无当前会话退化为项目过滤；`resolveProject` 活跃会话优先于映射。
- `web/src/components/HistoryList.test.ts`（扩展）：`filter` prop 控制按钮文案与 `on` 态；点击 emit `update:filter`；仅消息页显示。
- 命令：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run check:i18n`。

## 7. 影响面

- 新增：`server/session-projects.js`、`server/window-state.js`、`web/src/sessionProjects.ts`、`web/src/windowState.ts`、`web/src/msgFilter.ts`、5 份新测试、本设计文档。
- 修改：`server/port-paths.js`、`server/session-manager.js`、`server/http-api.js`、`server/index.js`、`web/src/App.vue`、`web/src/components/HistoryList.vue`、`shared/i18n/zh-CN.js`、`shared/i18n/en.js`。
- 扩展测试：`server/test/port-paths.test.js`、`server/test/http-api.test.js`、`server/test/session-manager.test.js`、`web/src/components/HistoryList.test.ts`。
- 新增数据文件（运行时生成，不入库）：`<数据目录>/ports/<端口>/session-projects.json`、`window-state.json`。
- 不改：`shared/` 协议常量、消息存储格式（`message-history.jsonc`）、协作子系统、scheduler、打包脚本（无新增运行时依赖）。

## 8. 不做（明确排除）

- opencode 会话续接（`--continue` / `--session`）：本设计的"恢复聊天记录"指左侧输入历史，不接管 opencode 自身会话。
- 消息按会话页签分组展示；消息按项目隔离存储（仍是全局一份）。
- 按客户端/浏览器分槽保存窗口状态。
- 会话页签自身的持久化（沿用服务端 `SESSION_LIST` 自动恢复）。
- 侧栏宽度、主题、语言、窗口颜色、"最近项目"排序（均已持久化，本次不动）。
