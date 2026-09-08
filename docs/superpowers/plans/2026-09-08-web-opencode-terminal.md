# 网页版 opencode —— Web 终端 + 多会话管理 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 monorepo（shared/server/web）的「网页版 opencode」：Node `http.createServer` + `ws` + `node-pty` 常驻会话层、环形缓冲重放、多项目目录树、右上角 Workflow（命令编排模板注入当前会话），Vue3 + Vite + xterm 前端，全程零 CDN。

**Architecture:** 后端以 `SessionManager`（Map 常驻会话，每会话唯一 pty `onData` 扇出 + 行对齐环形缓冲）为核心，`ws-gateway` 负责 `ws.data.sessionId` 连接态与 attach/detach 时序，`WorkflowRunner` 把「命令 + OSC 不可见完成标记」注入目标会话并监听输出推进；前端 `useTerminal` composable 封装 WS 生命周期与重连，组件层为 VS Code 风格布局。

**Tech Stack:** Node ≥ 20 ESM、`ws`、`node-pty`、`node:test`（内置 runner）；Vue 3、Vite、TypeScript、`@xterm/xterm` + `@xterm/addon-fit`、`vitest`。

---

## 文件总览

**根 / shared / server**

| 文件 | 职责 |
|---|---|
| `package.json` | workspaces: shared, server, web；dev/test/typecheck 脚本 |
| `shared/package.json` | 包 `@devflow/shared`（ESM + d.ts） |
| `shared/index.js` | WS 协议常量 `C2S` / `S2C`（前后端唯一事实源） |
| `shared/index.d.ts` | 对应常量与消息载荷类型声明 |
| `server/package.json` | `@devflow/server`，deps: `ws`、`node-pty`，type: module |
| `server/config.js` | 读取/生成 `projects.json`、`workflows.json`（env 覆盖路径） |
| `server/log.js` | 极简带时间戳 logger |
| `server/ring-buffer.js` | 行对齐环形缓冲 `RingBuffer` |
| `server/pty-runner.js` | 平台 shell 选择 + `createPty` 包装 + `PseudoPty` 归一化接口 |
| `server/session-manager.js` | `SessionManager`：会话生命周期、数据事件、attach/detach、safeWrite |
| `server/projects.js` | 项目列表 + 目录树（含 realpath 越界 403） |
| `server/workflow-runner.js` | `WorkflowRunner`：auto/manual 推进、OSC 标记匹配、abort |
| `server/ws-gateway.js` | `createGateway`：`ws.data={sessionId:null}`、消息分发、扇出、`Conn`(alive) |
| `server/http-api.js` | `/api/projects`、`/api/tree` 路由 + `requireAuth` 占位 |
| `server/static.js` | 生产模式静态文件服务（`web/dist`，无外部依赖） |
| `server/index.js` | 组合：http + upgrade + gateway + http-api + 静态 + uncaughtException 兜底 |
| `server/projects.json` / `server/workflows.json` | 首次运行自动生成示例 |
| `server/test/helpers/fake-pty.js` | 可注入 fake pty 工厂 |
| `server/test/helpers/test-server.js` | ephemeral 端口测试服务器（真实 ws client 集成） |
| `server/test/*.test.js` | node:test 用例 |

**web**

| 文件 | 职责 |
|---|---|
| `web/package.json` | deps: vue, @xterm/xterm, @xterm/addon-fit；dev: vite, plugin-vue, typescript, vue-tsc, vitest |
| `web/vite.config.ts` | dev proxy `/api` 与 `/ws` → 127.0.0.1:3001 |
| `web/tsconfig.json` / `web/tsconfig.node.json` / `web/env.d.ts` | TS 严格配置 |
| `web/index.html` | 无外链外壳 |
| `web/src/main.ts` / `web/src/App.vue` / `web/src/styles.css` | 入口与全局深色主题 |
| `web/src/useTerminal.ts` | WS composable：连接/退避重连/attach/事件总线 |
| `web/src/components/TerminalView.vue` | xterm + 会话标签条 + 新建 |
| `web/src/components/FileTree.vue` | 目录树（HTTP 驱动深度） |
| `web/src/components/SessionList.vue` | 会话列表 + 切换 + 新建 + kill |
| `web/src/components/WorkflowPanel.vue` | 右上角下拉：模板/运行/状态/下一步/中止 |
| `web/src/useProjects.ts` | `/api/projects` + `/api/tree` HTTP 客户端 |
| `web/src/components/TerminalView.test.ts`（无）| —（前端单测仅 composable） |
| `web/src/useTerminal.test.ts` | FakeSocket 单测 |

## 命名与接口契约（全计划一致，勿改）

- WS `type` 字符串一律引用 `shared` 常量 `C2S.*` / `S2C.*`，两边**不写死字符串**（除测试断言）。
- `PseudoPty` 接口：`{ pid, write(s), resize(cols,rows), kill(), onData(cb), onExit(cb(code)), shell: 'unix'|'win' }`。
- `session` 字段：`id,name,projectId,cwd,pty,alive,ring,clients:Set,cols,rows,state:'running'|'exited',exitCode,createdAt`。
- `SessionManager`：`create/destroy?` → 用 `kill(id)`；事件 `'data'(session,chunk)`、`'exit'(session)`、`'removed'(id)`；方法 `get,create,kill,write,resize,attach,setActive,detach,detachAll,list,summary`。
- `conn`：`{ ws, alive, sessionId, send(obj), close() }`，且 `ws.data = { sessionId: null }` 随 attach/detach 同步。
- workflow `run` 快照：`{ runId, workflowId, workflowName, sessionId, status, currentIndex, steps:[{id,cmd,advance,hint,status,startedAt,finishedAt}], errorMessage }`；step status ∈ `waiting|running|manual|done|error`；run status ∈ `running|paused|done|aborted`。

- 协议补充（spec §10 所需，S2C/C2S 追加）：`c2s: wf-list / wf-run{workflowId,sessionId} / wf-next{runId} / wf-abort{runId}`；`s2c: pong / wf-list-result{workflows} / wf-started{run} / wf-status{run} / wf-finished{runId,status}`。

---

## Task 1: monorepo 骨架 + shared 协议包

**Files:**
- Create: `package.json`
- Create: `shared/package.json`, `shared/index.js`, `shared/index.d.ts`

- [ ] **Step 1: 根 package.json**

```json
{
  "name": "devflow-web-terminal",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["shared", "server", "web"],
  "scripts": {
    "dev:server": "node --watch server/index.js",
    "dev:web": "npm --prefix web run dev",
    "build:web": "npm --prefix web run build",
    "test:server": "node --test server/test/",
    "test:web": "npm --prefix web run test",
    "test": "npm run test:server && npm run test:web",
    "typecheck": "npm --prefix web run typecheck"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 2: shared 三个文件**

`shared/package.json`:
```json
{
  "name": "@devflow/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./index.js",
  "types": "./index.d.ts",
  "exports": { ".": { "types": "./index.d.ts", "default": "./index.js" } }
}
```

`shared/index.js`:
```js
export const C2S = Object.freeze({
  LIST: 'list', CREATE: 'create', START: 'start', INPUT: 'input',
  RESIZE: 'resize', STOP: 'stop', KILL: 'kill', PING: 'ping',
  WF_LIST: 'wf-list', WF_RUN: 'wf-run', WF_NEXT: 'wf-next', WF_ABORT: 'wf-abort',
});
export const S2C = Object.freeze({
  OUTPUT: 'output', REPLAY: 'replay', SESSION_CREATED: 'session-created',
  SESSION_LIST: 'session-list', SESSION_EXITED: 'session-exited',
  ERROR: 'error', PONG: 'pong',
  WF_LIST_RESULT: 'wf-list-result', WF_STARTED: 'wf-started',
  WF_STATUS: 'wf-status', WF_FINISHED: 'wf-finished',
});
```

`shared/index.d.ts`:
```ts
export declare const C2S: Readonly<{
  LIST: 'list'; CREATE: 'create'; START: 'start'; INPUT: 'input';
  RESIZE: 'resize'; STOP: 'stop'; KILL: 'kill'; PING: 'ping';
  WF_LIST: 'wf-list'; WF_RUN: 'wf-run'; WF_NEXT: 'wf-next'; WF_ABORT: 'wf-abort';
}>;
export declare const S2C: Readonly<{
  OUTPUT: 'output'; REPLAY: 'replay'; SESSION_CREATED: 'session-created';
  SESSION_LIST: 'session-list'; SESSION_EXITED: 'session-exited';
  ERROR: 'error'; PONG: 'pong';
  WF_LIST_RESULT: 'wf-list-result'; WF_STARTED: 'wf-started';
  WF_STATUS: 'wf-status'; WF_FINISHED: 'wf-finished';
}>;
export declare type WfAdvance = 'auto' | 'manual';
export declare type StepStatus = 'waiting' | 'running' | 'manual' | 'done' | 'error';
export declare type RunStatus = 'running' | 'paused' | 'done' | 'aborted';
export interface SessionSummary { id: string; name: string; projectId: string | null; state: 'running' | 'exited'; cwd: string; cols: number; rows: number; exitCode: number | null; }
export interface ProjectInfo { id: string; name: string; root: string; }
export interface TreeItem { name: string; type: 'file' | 'dir'; }
export interface WorkflowStep { id: string; cmd: string; advance: WfAdvance; hint?: string; }
export interface WorkflowTemplate { id: string; name: string; steps: WorkflowStep[]; }
export interface RunStep extends WorkflowStep { status: StepStatus; startedAt: number | null; finishedAt: number | null; }
export interface RunSnapshot { runId: string; workflowId: string; workflowName: string; sessionId: string; status: RunStatus; currentIndex: number; steps: RunStep[]; errorMessage: string | null; }
```

- [ ] **Step 3: 提交**

```bash
git add package.json shared/
git commit -m "chore: monorepo 骨架 + shared 协议常量包"
```

---

## Task 2: server 依赖安装 + node-pty 原生可行性冒烟

**Files:**
- Create: `server/package.json`
- Create: `server/test/helpers/fake-pty.js`

- [ ] **Step 1: server/package.json**

```json
{
  "name": "@devflow/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "index.js",
  "dependencies": {
    "node-pty": "^1.1.0",
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 2: 安装并验证 node-pty 原生模块可加载**

Run: `npm.cmd install`（根目录）
Expected: `added N packages`，无 node-gyp 报错。若出现 node-pty 编译失败（Windows 缺 VS Build Tools），见 Task 2 备注降级路径。

- [ ] **Step 3: 原生冒烟（确认 PTY 真的能 spawn）**

```bash
node -e "const p=require('node-pty');const x=p.spawn(process.platform==='win32'?'powershell.exe':'/bin/bash',[],{name:'xterm-256color',cols:80,rows:24,cwd:process.cwd(),env:process.env});x.onData(d=>{process.stdout.write('SMOKE:'+d);x.kill();process.exit(0)});x.write('echo df-pty-ok\r');setTimeout(()=>{console.error('TIMEOUT');process.exit(1)},5000)"
```

Expected: 输出含 `df-pty-ok`。
**降级路径（如编译失败）**：安装 VS 2019+ Build Tools（勾选 C++ 桌面工作负载）后重跑 `npm install`；或换 Node LTS（node-pty 官方预编译范围）。本任务通过前不继续。

- [ ] **Step 3b: Windows 标记回传探针（验证 conpty 是否透传 OSC 完成标记）**

本步骤只影响 workflow auto 步在 Windows 本地开发机的可靠性（Linux 部署不受影响，见 Task 10 注）。用真实 node-pty 起 powershell，写入 `[Console]::Write(([char]27) + ']777;dfdone;probe' + ([char]7))` 后跟一条可见 `Write-Output 'MKR_END'`，判断 pty 输出里是否捕获到 `dfdone`：

```bash
node -e "const p=require('node-pty');const x=p.spawn('powershell.exe',[],{name:'xterm-256color',cols:80,rows:24,cwd:process.cwd(),env:process.env});let s='';x.onData(d=>{s+=d;if(s.includes('MKR_END')){console.log('PASS_OSC_PASSTHROUGH:',s.includes('dfdone'));x.kill();process.exit(0)}});x.write(`[Console]::Write(([char]27) + ']777;dfdone;probe' + ([char]7)); Write-Output 'MKR_END'\r`);setTimeout(()=>{console.log('TIMEOUT tail=',JSON.stringify(s.slice(-80)));process.exit(1)},6000)"
```

- `PASS_OSC_PASSTHROUGH: true` → Windows 上 auto 步可用，无额外工作。
- `PASS_OSC_PASSTHROUGH: false`（conhost 吞掉未知 OSC）→ **已知限制**：Windows 本地 auto 步会等不到标记；用户用 UI「下一步」强推即可（runner 已支持 running 中 advance）。把结果记入 Task 19 冒烟报告与 README 注意事项，Linux 部署不受影响。

> **执行记录（2026-09-08）**：本机探测结果为 `HAS_REAL_OSC_MARKER=true`（node-pty+ConPTY 在命令回显后回传了真实 `ESC]777;dfdone;probe BEL` 序列）。**Windows auto 步可用，无需降级**；README 无需写该已知限制。

- [ ] **Step 4: fake pty 助手（后续所有 server 单测共用）**

`server/test/helpers/fake-pty.js`:
```js
export function makeFakePty() {
  const handlers = { data: [], exit: [] };
  const pty = {
    pid: Math.floor(Math.random() * 1e6),
    shell: 'unix',
    writes: [],
    onData(cb) { handlers.data.push(cb); },
    onExit(cb) { handlers.exit.push(cb); },
    write(s) { pty.writes.push(String(s)); },
    resize() {}, kill() {},
    __emitData(chunk) { for (const cb of handlers.data.slice()) cb(String(chunk)); },
    __emitExit(code) { for (const cb of handlers.exit.slice()) cb(code === undefined ? 0 : code); },
  };
  return pty;
}
export function makeFakePtyFactory(collector) {
  const instances = collector || [];
  return ({ cwd, cols, rows }) => {
    const p = makeFakePty();
    instances.push({ pty: p, cwd, cols, rows });
    return p;
  };
}
```

- [ ] **Step 5: 提交**

```bash
git add server/package.json server/test/helpers/fake-pty.js package-lock.json
git commit -m "chore: server 依赖 + fake pty 测试助手"
```

---

## Task 3: RingBuffer 行对齐环形缓冲（TDD）

**Files:**
- Test: `server/test/ring-buffer.test.js`
- Create: `server/ring-buffer.js`

- [ ] **Step 1: 写失败测试**

`server/test/ring-buffer.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RingBuffer } from '../ring-buffer.js';

test('容量内完整保留', () => {
  const rb = new RingBuffer(100);
  rb.push('line1\nline2\n');
  assert.equal(rb.content, 'line1\nline2\n');
});

test('超限后只从行首截断', () => {
  const rb = new RingBuffer(10);
  rb.push('aaaaaaaaaa\n');      // 11 字节，含换行
  rb.push('bbbbbbbbbb\n');      // 超限 -> 丢弃第一整行
  assert.ok(rb.content.endsWith('bbbbbbbbbb\n'));
  assert.ok(!rb.content.includes('aaaaaaaaaa'));
});

test('单块超限且无换行则整块丢弃', () => {
  const rb = new RingBuffer(8);
  rb.push('0123456789');        // 无 \n 超限 -> 丢弃
  assert.equal(rb.content, '');
});

test('截断边界不含半截转义序列', () => {
  const rb = new RingBuffer(20);
  rb.push('\x1b[31mred\x1b[0m\n'); // 11
  rb.push('\x1b[32mgreen\x1b[0m\n'); // 13
  rb.push('tail\n');
  const c = rb.content;
  assert.ok(!c.startsWith('\x1b['));          // 不以半个转义开头
  assert.ok(c.startsWith('\x1b[32m'));         // 恰从完整行首开始
});

test('字节上限按 Buffer 长度计', () => {
  const rb = new RingBuffer(12);
  rb.push('abc\n');            // 4
  rb.push('\u4f60\u597d\n');   // 7 bytes (中文) => 11 total
  rb.push('xy\n');             // 3 => 14 超限，丢 abc 整行
  assert.equal(rb.content, '\u4f60\u597d\nxy\n');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/ring-buffer.test.js`
Expected: FAIL（`Cannot find module` ring-buffer）

- [ ] **Step 3: 实现**

`server/ring-buffer.js`:
```js
const LF = 0x0a;

export class RingBuffer {
  constructor(maxBytes = 256 * 1024) {
    this.maxBytes = maxBytes;
    this.chunks = [];
    this.length = 0;
  }
  push(chunk) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    if (buf.length === 0) return;
    this.chunks.push(buf);
    this.length += buf.length;
    this._trim();
  }
  _trim() {
    while (this.length > this.maxBytes && this.chunks.length > 0) {
      const head = this.chunks[0];
      const idx = head.indexOf(LF);
      if (idx >= 0) {
        const keep = head.subarray(idx + 1);
        this.length -= idx + 1;
        if (keep.length > 0) this.chunks[0] = keep;
        else this.chunks.shift();
      } else {
        this.length -= head.length;
        this.chunks.shift();
      }
    }
  }
  get content() {
    return this.chunks.length ? Buffer.concat(this.chunks).toString('utf8') : '';
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/ring-buffer.test.js`
Expected: `pass 5`

- [ ] **Step 5: 提交**

```bash
git add server/ring-buffer.js server/test/ring-buffer.test.js
git commit -m "feat: 行对齐环形缓冲 RingBuffer"
```

---

## Task 4: config + log（TDD）

**Files:**
- Create: `server/log.js`
- Test: `server/test/config.test.js`
- Create: `server/config.js`

- [ ] **Step 1: log.js**

```js
export function createLogger(prefix = '') {
  const ts = () => new Date().toISOString();
  return {
    info: (...a) => console.log(ts(), prefix, ...a),
    warn: (...a) => console.warn(ts(), prefix, '[warn]', ...a),
    error: (...a) => console.error(ts(), prefix, '[error]', ...a),
  };
}
```

- [ ] **Step 2: 写失败测试（用临时文件注入）**

`server/test/config.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadJson, loadProjects, loadWorkflows, ensureDefaults } from '../config.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfcfg-')); }

test('loadProjects 校验结构', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'projects.json');
  fs.writeFileSync(file, JSON.stringify({ projects: [{ id: 'a', name: 'A', root: 'C:\\x' }] }));
  assert.deepEqual(loadProjects(file), [{ id: 'a', name: 'A', root: 'C:\\x' }]);
});

test('loadProjects 缺字段抛错', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'p.json');
  fs.writeFileSync(file, JSON.stringify({ projects: [{ name: 'no-id' }] }));
  assert.throws(() => loadProjects(file), /id/);
});

test('loadWorkflows 校验 advance 取值', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'w.json');
  fs.writeFileSync(file, JSON.stringify([{ id: 'w', name: 'W', steps: [{ id: 's', cmd: 'ls', advance: 'weird' }] }]));
  assert.throws(() => loadWorkflows(file), /advance/);
});

test('ensureDefaults 生成示例文件', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'projects.json');
  const w = path.join(dir, 'workflows.json');
  ensureDefaults(p, w);
  assert.ok(fs.existsSync(p) && fs.existsSync(w));
  assert.equal(loadProjects(p)[0].root, process.cwd());
});

test('loadJson 文件不存在返回 null', () => {
  assert.equal(loadJson('D:\\no-such-file-xyz.json'), null);
});
```

- [ ] **Step 3: 运行确认失败**

Run: `node --test server/test/config.test.js`
Expected: FAIL（找不到 config.js）

- [ ] **Step 4: 实现 config.js**

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sampleProjects() {
  return { projects: [{ id: 'local', name: '本地项目', root: process.cwd() }] };
}
function sampleWorkflows() {
  return [{
    id: 'deploy', name: '部署前端', steps: [
      { id: 'build', advance: 'auto', cmd: 'npm run build' },
      { id: 'restart', advance: 'manual', cmd: 'echo ready', hint: '确认无误后点下一步' },
    ],
  }];
}

export function ensureDefaults(projectsFile, workflowsFile) {
  if (!fs.existsSync(projectsFile)) {
    fs.mkdirSync(path.dirname(projectsFile), { recursive: true });
    fs.writeFileSync(projectsFile, JSON.stringify(sampleProjects(), null, 2));
  }
  if (!fs.existsSync(workflowsFile)) {
    fs.writeFileSync(workflowsFile, JSON.stringify(sampleWorkflows(), null, 2));
  }
}

export function resolveFiles() {
  ensureDefaults(
    process.env.DEVFLOW_PROJECTS || path.join(__dirname, 'projects.json'),
    process.env.DEVFLOW_WORKFLOWS || path.join(__dirname, 'workflows.json'),
  );
  return {
    projectsFile: process.env.DEVFLOW_PROJECTS || path.join(__dirname, 'projects.json'),
    workflowsFile: process.env.DEVFLOW_WORKFLOWS || path.join(__dirname, 'workflows.json'),
  };
}

export function loadProjects(file) {
  const json = loadJson(file) || { projects: [] };
  const arr = Array.isArray(json.projects) ? json.projects : [];
  for (const p of arr) {
    if (!p.id || !p.name || !p.root) throw new Error('project 必须含 id/name/root: ' + JSON.stringify(p));
  }
  return arr;
}

export function loadWorkflows(file) {
  const arr = loadJson(file) || [];
  if (!Array.isArray(arr)) throw new Error('workflows.json 顶层必须是数组');
  for (const w of arr) {
    if (!w.id || !w.name || !Array.isArray(w.steps)) throw new Error('workflow 缺 id/name/steps: ' + JSON.stringify(w));
    for (const s of w.steps) {
      if (!s.id || typeof s.cmd !== 'string') throw new Error('step 缺 id/cmd: ' + JSON.stringify(s));
      if (s.advance !== 'auto' && s.advance !== 'manual') throw new Error('advance 必须 auto|manual: ' + JSON.stringify(s));
    }
  }
  return arr;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test server/test/config.test.js`
Expected: `pass 5`

- [ ] **Step 6: 提交**

```bash
git add server/log.js server/config.js server/test/config.test.js
git commit -m "feat: 配置加载与示例生成 + logger"
```

---

## Task 5: pty-runner（TDD）

**Files:**
- Test: `server/test/pty-runner.test.js`
- Create: `server/pty-runner.js`

- [ ] **Step 1: 写失败测试（用可注入底层 node-pty 伪装验证归一化）**

`server/test/pty-runner.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePseudoPty, buildMarkerCmd } from '../pty-runner.js';

test('makePseudoPty 归一化 node-pty 的 onData/onExit', () => {
  const rawCalls = [];
  const raw = {
    pid: 42,
    write: (s) => rawCalls.push(['write', s]),
    resize: (c, r) => rawCalls.push(['resize', c, r]),
    kill: () => rawCalls.push(['kill']),
    onData: (cb) => rawCalls.push(['onData', cb]),
    onExit: (cb) => rawCalls.push(['onExit', cb]),
  };
  const wrapped = makePseudoPty(raw, 'unix');
  const dataSeen = [];
  const exitSeen = [];
  wrapped.onData((d) => dataSeen.push(d));
  wrapped.onExit((c) => exitSeen.push(c));
  wrapped.write('hi');
  wrapped.resize(100, 30);
  wrapped.kill();
  const [, dcb] = rawCalls.find((c) => c[0] === 'onData');
  const [, ecb] = rawCalls.find((c) => c[0] === 'onExit');
  dcb('hello');
  ecb({ exitCode: 3 });
  assert.equal(wrapped.shell, 'unix');
  assert.deepEqual(dataSeen, ['hello']);
  assert.deepEqual(exitSeen, [3]);
  assert.deepEqual(rawCalls.filter((c) => c[0] !== 'onData' && c[0] !== 'onExit'),
    [['write', 'hi'], ['resize', 100, 30], ['kill']]);
});

test('makePseudoPty 重复 onData 注册即抛（强制唯一扇出）', () => {
  const raw = { pid: 1, onData() {}, onExit() {}, write() {}, resize() {}, kill() {} };
  const wrapped = makePseudoPty(raw, 'unix');
  wrapped.onData(() => {});
  assert.throws(() => wrapped.onData(() => {}), /already/i);
});

test('buildMarkerCmd: unix 用 printf OSC', () => {
  const cmd = buildMarkerCmd('npm run build', 'run_ab_0', 1, 'unix');
  assert.ok(cmd.startsWith('npm run build; printf '));
  assert.ok(cmd.includes('\\x1b]777;dfdone;run_ab_0_1\\x07'));
});

test('buildMarkerCmd: win 用 [Console]::Write + [char]27（PS 不解析 \\u 转义）', () => {
  const cmd = buildMarkerCmd('dir', 'run_x_9', 0, 'win');
  assert.ok(cmd.includes('[Console]::Write'));
  assert.ok(cmd.includes('[char]27'));
  assert.ok(cmd.includes('dfdone;run_x_9_0'));
  assert.ok(!cmd.includes('\\u001b'));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/pty-runner.test.js`
Expected: FAIL（找不到模块）

- [ ] **Step 3: 实现 pty-runner.js**

```js
export function pickShell() {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: [] };
  return { file: process.env.SHELL || '/bin/bash', args: [] };
}

// 把 node-pty 原始对象归一化为内部 PseudoPty 接口。
export function makePseudoPty(raw, shell) {
  const state = { dataCb: null, exitCb: null };
  raw.onData((data) => { if (state.dataCb) state.dataCb(String(data)); });
  raw.onExit((info) => { if (state.exitCb) state.exitCb(info && typeof info === 'object' ? info.exitCode : info); });
  return {
    pid: raw.pid,
    shell,
    onData(cb) { if (state.dataCb) throw new Error('onData already registered'); state.dataCb = cb; },
    onExit(cb) { if (state.exitCb) throw new Error('onExit already registered'); state.exitCb = cb; },
    write(s) { raw.write(String(s)); },
    resize(c, r) { raw.resize(c, r); },
    kill() { raw.kill(); },
  };
}

export async function createPty({ cwd = process.cwd(), cols = 80, rows = 24 } = {}) {
  // 动态 import：避免在单测进程里强行加载原生模块（单测只走 fake pty）
  const { spawn } = await import('node-pty');
  const shell = pickShell();
  const raw = spawn(shell.file, shell.args, {
    name: 'xterm-256color', cols, rows, cwd, env: process.env,
  });
  return makePseudoPty(raw, process.platform === 'win32' ? 'win' : 'unix');
}

export function buildMarkerCmd(cmd, runId, idx, shell) {
  // 注意：PowerShell 5.1 不解析 "\u001b"，必须用 [char]27 构造真正的 ESC。
  if (shell === 'win') {
    return `${cmd}; [Console]::Write(([char]27) + ']777;dfdone;${runId}_${idx}' + ([char]7))`;
  }
  return `${cmd}; printf '\\x1b]777;dfdone;${runId}_${idx}\\x07'`;
}
```

> 备注：`os` import 未用到可删；`createPty` 异步加载 node-pty，因此它在调用端是 `async`（见 Task 7 约定）。**统一约定：`createPty` 返回 Promise<PseudoPty>，`ptyFactory` 亦为 async。**

- [ ] **Step 4: 修正测试断言（factory async 化对测试无影响，仍通过）**

Run: `node --test server/test/pty-runner.test.js`
Expected: `pass 4`

- [ ] **Step 5: 提交**

```bash
git add server/pty-runner.js server/test/pty-runner.test.js
git commit -m "feat: pty 包装与平台 shell 选择 + OSC 标记命令生成"
```

---

## Task 6: projects + 目录树（TDD，含越界防护）

**Files:**
- Test: `server/test/projects.test.js`
- Create: `server/projects.js`

- [ ] **Step 1: 写失败测试（临时目录 + junction 符号链接）**

`server/test/projects.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Projects } from '../projects.js';

function makeProjects(roots) {
  return new Projects({ projects: roots.map((r, i) => ({ id: 'p' + i, name: 'P' + i, root: r })) });
}
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dftree-')); }

test('listProjects 返回概要', () => {
  const dir = tmpDir();
  const p = makeProjects([dir]);
  assert.equal(p.listProjects()[0].id, 'p0');
});

test('tree 列出顶层并分类排序（目录优先）', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'b.txt'), '');
  fs.mkdirSync(path.join(dir, 'a-dir'));
  const p = makeProjects([dir]);
  const items = p.tree('p0', '');
  assert.deepEqual(items, [{ name: 'a-dir', type: 'dir' }, { name: 'b.txt', type: 'file' }]);
});

test('tree 支持相对子目录', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'x.js'), '');
  const p = makeProjects([dir]);
  assert.deepEqual(p.tree('p0', 'src'), [{ name: 'x.js', type: 'file' }]);
});

test('未知项目抛 code=not-found', () => {
  const dir = tmpDir();
  const p = makeProjects([dir]);
  assert.throws(() => p.tree('nope', ''), (e) => e.code === 'not-found');
});

test('目录不存在抛 code=not-found', () => {
  const dir = tmpDir();
  const p = makeProjects([dir]);
  assert.throws(() => p.tree('p0', 'missing'), (e) => e.code === 'not-found');
});

test('越界路径 403（.. 逃逸）', () => {
  const dir = tmpDir();
  const p = makeProjects([dir]);
  assert.throws(() => p.tree('p0', '..'), (e) => e.code === 'forbidden');
});

test('绝对路径攻击 403', () => {
  const dir = tmpDir();
  const p = makeProjects([dir]);
  const outside = path.join(os.tmpdir(), 'other');
  assert.throws(() => p.tree('p0', outside), (e) => e.code === 'forbidden');
});

test('符号链接逃逸 403（junction）', (t) => {
  const dir = tmpDir();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dfout-'));
  try {
    fs.symlinkSync(outside, path.join(dir, 'escape'), 'junction');
  } catch {
    t.skip('无 junction 权限');
    return;
  }
  const p = makeProjects([dir]);
  assert.throws(() => p.tree('p0', 'escape'), (e) => e.code === 'forbidden');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/projects.test.js`
Expected: FAIL（找不到 projects.js）

- [ ] **Step 3: 实现 projects.js**

```js
import fs from 'node:fs';
import path from 'node:path';

export class Projects {
  constructor({ projects = [], logger = console } = {}) {
    this.projects = projects;
    this.log = logger;
    this._byId = new Map(projects.map((p) => [p.id, p]));
  }
  listProjects() {
    return this.projects.map((p) => ({ id: p.id, name: p.name, root: p.root }));
  }
  _project(id) {
    const p = this._byId.get(id);
    if (!p) { const e = new Error('project not found'); e.code = 'not-found'; throw e; }
    return p;
  }
  _realOrResolved(p) {
    try { return fs.realpathSync(p); } catch { return path.resolve(p); }
  }
  tree(projectId, rel = '') {
    const proj = this._project(projectId);
    const rootReal = this._realOrResolved(proj.root);
    let target = path.resolve(proj.root, rel || '.');
    if (target !== rootReal && !target.startsWith(rootReal + path.sep)) {
      const e = new Error('path escapes project root'); e.code = 'forbidden'; throw e;
    }
    if (!fs.existsSync(target)) { const e = new Error('dir not found'); e.code = 'not-found'; throw e; }
    const targetReal = this._realOrResolved(target);
    if (targetReal !== rootReal && !targetReal.startsWith(rootReal + path.sep)) {
      const e = new Error('symlink escapes project root'); e.code = 'forbidden'; throw e;
    }
    const entries = fs.readdirSync(target, { withFileTypes: true });
    const items = entries
      .map((d) => ({ name: d.name, type: d.isDirectory() ? 'dir' : d.isFile() ? 'file' : 'file' }))
      .sort((a, b) =>
        (a.type === b.type ? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
          : a.type === 'dir' ? -1 : 1));
    return items;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/projects.test.js`
Expected: `pass 8`（junction 用例可能 skip，不影响）

- [ ] **Step 5: 提交**

```bash
git add server/projects.js server/test/projects.test.js
git commit -m "feat: 项目目录树 API + realpath 越界防护"
```

---

## Task 7: SessionManager（TDD）

**Files:**
- Test: `server/test/session-manager.test.js`
- Create: `server/session-manager.js`

- [ ] **Step 1: 写失败测试**

`server/test/session-manager.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../session-manager.js';
import { makeFakePtyFactory } from './helpers/fake-pty.js';

const fakeConn = () => {
  const conn = { sessionId: null };
  return conn;
};

test('create 返回 running 会话并注册唯一 data 扇出事件', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const dataSeen = [];
  sm.on('data', (s, chunk) => dataSeen.push(chunk));
  const s = await sm.create({ projectId: 'p1', cols: 100, rows: 30 });
  assert.equal(s.state, 'running');
  assert.ok(s.alive);
  assert.equal(s.clients.size, 0);
  instances[0].pty.__emitData('hi\n');
  assert.deepEqual(dataSeen, ['hi\n']);
  assert.equal(s.ring.content, 'hi\n');
});

test('write 仅在 alive 且有 pty 时写入；退出后静默失败', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const s = await sm.create({});
  assert.equal(sm.write(s.id, 'echo x\r'), true);
  assert.equal(instances[0].pty.writes[0], 'echo x\r');
  instances[0].pty.__emitExit(0);
  assert.equal(s.state, 'exited');
  assert.equal(s.alive, false);
  assert.equal(sm.write(s.id, 'nope\r'), false);   // 不抛异常
  assert.equal(instances[0].pty.writes.length, 1); // 没有新增写入
});

test('exit 事件广播且缓冲保留', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const exits = [];
  sm.on('exit', (s) => exits.push(s));
  const s = await sm.create({});
  instances[0].pty.__emitData('last words\n');
  instances[0].pty.__emitExit(1);
  assert.equal(exits.length, 1);
  assert.equal(s.ring.content, 'last words\n');
});

test('kill 从管理器移除并安全 kill pty', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const s = await sm.create({});
  const conn = fakeConn();
  sm.setActive(s.id, conn);
  assert.equal(conn.sessionId, s.id);
  assert.equal(sm.kill(s.id), true);
  assert.equal(sm.get(s.id), null);
  assert.equal(conn.sessionId, null);
  assert.equal(sm.kill('ghost'), false);
});

test('setActive 换会话时旧会话不再持有 conn', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const a = await sm.create({});
  const b = await sm.create({});
  const conn = fakeConn();
  sm.setActive(a.id, conn);
  sm.setActive(b.id, conn);
  assert.equal(a.clients.has(conn), false);
  assert.equal(b.clients.has(conn), true);
  assert.equal(conn.sessionId, b.id);
});

test('detachAll 移除全部会话对 conn 的引用', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const a = await sm.create({});
  const conn = fakeConn();
  sm.setActive(a.id, conn);
  sm.detachAll(conn);
  assert.equal(a.clients.has(conn), false);
  assert.equal(conn.sessionId, null);
});

test('resize 更新尺寸', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const s = await sm.create({ cols: 80, rows: 24 });
  assert.equal(sm.resize(s.id, 120, 40), true);
  assert.equal(s.cols, 120);
});

test('list 返回概要并按创建倒序', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const a = await sm.create({ name: 'A' });
  await sm.create({ name: 'B' });
  const l = sm.list();
  assert.equal(l[0].name, 'B');
  assert.equal(l[1].id, a.id);
  assert.equal(typeof l[0].state, 'string');
});

test('projectResolver 决定默认 cwd；缺省回退 process.cwd()', async () => {
  const instances = [];
  const root = 'D:\\projects\\devflow';
  const sm = new SessionManager({
    ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }),
    projectResolver: (id) => (id === 'devflow' ? root : null),
  });
  const withProj = await sm.create({ projectId: 'devflow' });
  assert.equal(withProj.cwd, root);
  const noProj = await sm.create({});
  assert.equal(noProj.cwd, process.cwd());
  const unknown = await sm.create({ projectId: 'ghost' });
  assert.equal(unknown.cwd, process.cwd());
  const explicit = await sm.create({ projectId: 'devflow', cwd: 'C:\\override' });
  assert.equal(explicit.cwd, 'C:\\override');
});

```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/session-manager.test.js`
Expected: FAIL（找不到模块）

- [ ] **Step 3: 实现 session-manager.js**

```js
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { RingBuffer } from './ring-buffer.js';
import { createPty } from './pty-runner.js';

const shortId = () => 's_' + crypto.randomBytes(4).toString('hex');
const timeLabel = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

export class SessionManager extends EventEmitter {
  constructor({ ptyFactory = createPty, ringMaxBytes = 256 * 1024, logger = console, projectResolver = null } = {}) {
    super();
    this.ptyFactory = ptyFactory;   // async ({cwd,cols,rows}) => PseudoPty
    this.ringMaxBytes = ringMaxBytes;
    this.log = logger;
    this.projectResolver = projectResolver; // (projectId) => root|null（spec §9：会话默认 cwd = 项目 root）
    this.sessions = new Map();
  }
  async create({ projectId = null, cwd = null, name = null, cols = 80, rows = 24 } = {}) {
    const projRoot = projectId && this.projectResolver ? (this.projectResolver(projectId) || null) : null;
    const workdir = cwd || projRoot || process.cwd();
    const pty = await this.ptyFactory({ cwd: workdir, cols, rows });
    const session = {
      id: shortId(), name: name || (projectId ? `${projectId} · ${timeLabel()}` : `会话 · ${timeLabel()}`),
      projectId, cwd: workdir, pty, alive: true,
      ring: new RingBuffer(this.ringMaxBytes), clients: new Set(),
      cols, rows, state: 'running', exitCode: null,
      createdAt: Date.now(), ptyExited: false,
    };
    pty.onData((chunk) => this._onData(session, chunk));
    pty.onExit((code) => this._onExit(session, code));
    this.sessions.set(session.id, session);
    return session;
  }
  _onData(session, chunk) {
    session.ring.push(chunk);
    this.emit('data', session, chunk);
  }
  _onExit(session, code) {
    session.ptyExited = true;
    session.alive = false;
    session.state = 'exited';
    session.exitCode = code;
    session.pty = null;
    this.emit('exit', session);
  }
  get(id) { return this.sessions.get(id) || null; }
  list() {
    return [...this.sessions.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => this.summary(s));
  }
  summary(s) {
    return { id: s.id, name: s.name, projectId: s.projectId, state: s.state, cwd: s.cwd,
      cols: s.cols, rows: s.rows, exitCode: s.exitCode };
  }
  write(id, data) {
    const s = this.get(id);
    if (!s || !s.alive || !s.pty || s.ptyExited) return false;
    try { s.pty.write(String(data)); return true; } catch { return false; }
  }
  resize(id, cols, rows) {
    const s = this.get(id);
    const c = Math.max(2, cols | 0) || 80;
    const r = Math.max(1, rows | 0) || 24;
    if (!s || !s.alive || !s.pty) return false;
    try { s.pty.resize(c, r); } catch { return false; }
    s.cols = c; s.rows = r; return true;
  }
  attach(id, conn) {
    const s = this.get(id);
    if (!s) return null;
    s.clients.add(conn);
    conn.sessionId = id;
    return s;
  }
  setActive(id, conn) {
    for (const s of this.sessions.values()) {
      if (s.clients.has(conn) && s.id !== id) s.clients.delete(conn);
    }
    return this.attach(id, conn);
  }
  detach(id, conn) {
    const s = this.get(id);
    if (s) s.clients.delete(conn);
    if (conn.sessionId === id) conn.sessionId = null;
  }
  detachAll(conn) {
    for (const s of this.sessions.values()) s.clients.delete(conn);
    conn.sessionId = null;
  }
  kill(id) {
    const s = this.get(id);
    if (!s) return false;
    s.alive = false;
    s.state = 'exited';
    for (const c of s.clients) c.sessionId = null;
    s.clients.clear();
    this.sessions.delete(id);
    if (s.pty && !s.ptyExited) { try { s.pty.kill(); } catch { /* 第三层兜底 */ } }
    this.emit('removed', id);
    return true;
  }
}
```

> 备注：`crypto` 用于短 id，`timeLabel` 用户可读名。测试断言依赖 name 顺序，create 用显式 name。

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/session-manager.test.js`
Expected: `pass 10`

- [ ] **Step 5: 提交**

```bash
git add server/session-manager.js server/test/session-manager.test.js
git commit -m "feat: SessionManager 常驻会话 + 唯一扇出 + attach/detach"
```

---

## Task 8: ws-gateway（TDD，真实 ws 客户端 + fake pty）

**Files:**
- Create: `server/test/helpers/test-server.js`
- Test: `server/test/ws-gateway.test.js`
- Create: `server/ws-gateway.js`

- [ ] **Step 1: helpers/test-server.js（真实 http + ws 集成夹具）**

```js
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createGateway } from '../../ws-gateway.js';

export async function startTestServer({ sessionManager, workflowRunner = null }) {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const gateway = createGateway({ httpServer: server, sessionManager, workflowRunner });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port, gateway,
    wsUrl: () => `ws://127.0.0.1:${port}/ws`,
    async connect() {
      const ws = new WebSocket(this.wsUrl());
      await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
      const client = {
        ws,
        inbox: [],
        waiters: [],
        wait(pred, ms = 3000) {
          return new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error('wait timeout')), ms);
            this.waiters.push({ pred, res, rej, t });
            this._flush();
          });
        },
        _flush() {
          const done = [];
          for (const w of this.waiters) {
            const hit = this.inbox.find(w.pred);
            if (hit) { clearTimeout(w.t); w.res(hit); done.push(w); }
          }
          this.waiters = this.waiters.filter((w) => !done.includes(w));
          this.inbox = this.inbox.filter((m) => !done.some((w) => w.pred(m)));
        },
        send(type, payload = {}) { ws.send(JSON.stringify({ type, ...payload })); },
        close() { ws.close(); },
      };
      ws.on('message', (raw) => { client.inbox.push(JSON.parse(raw)); client._flush(); });
      return client;
    },
    async stop() {
      for (const c of gateway.conns) try { c.ws.close(); } catch { /* noop */ }
      await new Promise((r) => server.close(r));
    },
  };
}

export { WebSocket };
```

- [ ] **Step 2: 写失败测试**

`server/test/ws-gateway.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../session-manager.js';
import { startTestServer } from './helpers/test-server.js';
import { makeFakePtyFactory } from './helpers/fake-pty.js';
import { C2S, S2C } from '@devflow/shared';

async function makeHarness() {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const t = await startTestServer({ sessionManager: sm });
  return { sm, t, instances };
}

test('连接时 ws.data 初始为 {sessionId:null}', async () => {
  const { t } = await makeHarness();
  const c = await t.connect();
  assert.deepEqual(c.ws.data, { sessionId: null });
  await t.stop();
});

test('create 自动 attach 并重放缓冲', async () => {
  const { sm, t, instances } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.CREATE, { cols: 90, rows: 30 });
  const created = await c.wait((m) => m.type === S2C.SESSION_CREATED);
  const replay = await c.wait((m) => m.type === S2C.REPLAY && m.sessionId === created.session.id);
  assert.ok(replay.data.startsWith('\x1b[2J\x1b[H'));
  // 已有缓冲在 attach 前注入，重放应包含
  const s = sm.get(created.session.id);
  s.ring.push('earlier-line\n');
  c.send(C2S.START, { sessionId: s.id });
  const replay2 = await c.wait((m) => m.type === S2C.REPLAY && m.sessionId === s.id);
  assert.ok(replay2.data.includes('earlier-line'));
  // 之后实时 output
  instances[0].pty.__emitData('live\n');
  const out = await c.wait((m) => m.type === S2C.OUTPUT && m.data === 'live\n');
  assert.equal(out.sessionId, s.id);
  await t.stop();
});

test('input 转发到绑定会话 pty', async () => {
  const { sm, t, instances } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.CREATE, {});
  const created = await c.wait((m) => m.type === S2C.SESSION_CREATED);
  c.send(C2S.INPUT, { data: 'ls -la\r' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(instances[0].pty.writes.at(-1), 'ls -la\r');
  await t.stop();
});

test('start 切换会话：旧会话收不到新输出', async () => {
  const { sm, t, instances } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.CREATE, {});
  const a = await c.wait((m) => m.type === S2C.SESSION_CREATED);
  c.send(C2S.CREATE, {});
  const b = await c.wait((m) => m.type === S2C.SESSION_CREATED && m.session.id !== a.session.id);
  c.send(C2S.START, { sessionId: a.session.id });
  await c.wait((m) => m.type === S2C.REPLAY && m.sessionId === a.session.id);
  // 往旧会话 b 的输出不应到达已切走的 client
  instances[1].pty.__emitData('from-b\n');
  c.send(C2S.START, { sessionId: b.session.id });
  await c.wait((m) => m.type === S2C.REPLAY && m.sessionId === b.session.id);
  instances[1].pty.__emitData('from-b-2\n');
  const out = await c.wait((m) => m.type === S2C.OUTPUT && m.data === 'from-b-2\n');
  assert.equal(out.sessionId, b.session.id);
  await t.stop();
});

test('socket 关闭后不再有写入：kill 后再次 create 也安全', async () => {
  const { sm, t, instances } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.CREATE, {});
  const a = await c.wait((m) => m.type === S2C.SESSION_CREATED);
  instances[0].pty.__emitData('tail-before-close\n');
  await c.wait((m) => m.type === S2C.OUTPUT);
  c.close();
  await new Promise((r) => setTimeout(r, 20));
  // 客户端已关，往会话注入数据不得抛错、不得有写入异常
  const s = sm.get(a.session.id);
  instances[0].pty.__emitData('after-close\n');
  assert.equal(s.ring.content.includes('after-close'), true);
  await t.stop();
});

test('stop 解绑但不杀进程；kill 删除会话', async () => {
  const { sm, t } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.CREATE, {});
  const a = await c.wait((m) => m.type === S2C.SESSION_CREATED);
  c.send(C2S.STOP, {});
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sm.get(a.session.id).state, 'running');
  c.send(C2S.KILL, { sessionId: a.session.id });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sm.get(a.session.id), null);
  await t.stop();
});

test('ping 回 pong', async () => {
  const { t } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.PING, {});
  const pong = await c.wait((m) => m.type === S2C.PONG);
  assert.ok(pong);
  await t.stop();
});

test('未知会话 start 回 error', async () => {
  const { t } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.START, { sessionId: 'ghost' });
  const err = await c.wait((m) => m.type === S2C.ERROR);
  assert.equal(err.code, 'not-found');
  await t.stop();
});

test('三次防崩溃：pty 写抛异常被吞、全局兜底不影响其他连接', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => {
    const { makeFakePty } = await import('./helpers/fake-pty.js');
    const p = makeFakePty();
    const orig = p.write;
    p.write = (s) => { if (instances.length === 0) throw new Error('Socket is closed'); return orig(s); };
    instances.push(p);
    return p;
  } });
  const t = await startTestServer({ sessionManager: sm });
  const c = await t.connect();
  c.send(C2S.CREATE, {});
  const a = await c.wait((m) => m.type === S2C.SESSION_CREATED);
  c.send(C2S.INPUT, { data: 'boom\r' });          // 内部被 write 的 try/catch 吞掉
  c.send(C2S.KILL, { sessionId: a.session.id });
  await new Promise((r) => setTimeout(r, 20));
  const c2 = await t.connect();                    // 服务进程仍活着，新连接正常
  c2.send(C2S.PING, {});
  const pong = await c2.wait((m) => m.type === S2C.PONG);
  assert.ok(pong);
  await t.stop();
});
```

- [ ] **Step 3: 运行确认失败**

Run: `node --test server/test/ws-gateway.test.js`
Expected: FAIL（找不到 ws-gateway.js；shared 依赖已由根 node_modules 工作区提供）

- [ ] **Step 4: 实现 ws-gateway.js**

```js
import { WebSocketServer } from 'ws';
import { C2S, S2C } from '@devflow/shared';

const REPLAY_RESET = '\x1b[2J\x1b[H';

class Conn {
  constructor(ws) {
    this.ws = ws;
    this.alive = true;
    // ws.data.sessionId 与 conn.sessionId 双向同步（spec §4 / §15.3）
    ws.data = ws.data || { sessionId: null };
  }
  get sessionId() { return this.ws.data.sessionId; }
  set sessionId(v) { this.ws.data.sessionId = v; }
  send(obj) {
    if (!this.alive) return;
    try {
      if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
    } catch { this.alive = false; }
  }
  close() { this.alive = false; try { this.ws.close(); } catch { /* noop */ } }
}

export function createGateway({ httpServer, sessionManager, workflowRunner = null, requireAuthWs = null, log = console }) {
  const wss = new WebSocketServer({ noServer: true });
  const conns = new Set();

  httpServer.on('upgrade', (req, socket, head) => {
    let authed = true;
    if (requireAuthWs) { try { authed = !!requireAuthWs(req); } catch { authed = false; } }
    if (!authed) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    let pathname = '/';
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { /* default '/' */ }
    if (pathname !== '/ws') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    ws.data = { sessionId: null };               // spec §4 / §15.3
    const conn = new Conn(ws);
    conns.add(conn);

    const onData = (session, chunk) => {
      if (session.clients.has(conn)) conn.send({ type: S2C.OUTPUT, sessionId: session.id, data: chunk });
    };
    const onExit = (session) => {
      if (session.clients.has(conn)) conn.send({ type: S2C.SESSION_EXITED, sessionId: session.id, exitCode: session.exitCode });
    };
    sessionManager.on('data', onData);
    sessionManager.on('exit', onExit);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      handleMessage(conn, msg);
    });
    ws.on('close', () => {
      sessionManager.detachAll(conn);
      sessionManager.off('data', onData);
      sessionManager.off('exit', onExit);
      conn.alive = false;
      conns.delete(conn);
    });
    ws.on('error', () => { conn.alive = false; });
  });

  function replay(conn, session) {
    conn.send({ type: S2C.REPLAY, sessionId: session.id, data: REPLAY_RESET + session.ring.content });
  }

  function handleMessage(conn, msg) {
    switch (msg.type) {
      case C2S.LIST:
        conn.send({ type: S2C.SESSION_LIST, sessions: sessionManager.list() });
        break;
      case C2S.CREATE:
        sessionManager.create({
          projectId: msg.projectId || null, cwd: msg.cwd || null,
          cols: msg.cols || 80, rows: msg.rows || 24,
        }).then((session) => {
          sessionManager.setActive(session.id, conn);
          conn.send({ type: S2C.SESSION_CREATED, session: sessionManager.summary(session) });
          replay(conn, session);
        }).catch((err) => {
          log.error('create failed', err);
          conn.send({ type: S2C.ERROR, code: 'create-failed', message: String(err && err.message || err) });
        });
        break;
      case C2S.START: {
        const session = sessionManager.get(msg.sessionId);
        if (!session) { conn.send({ type: S2C.ERROR, code: 'not-found', message: 'session not found' }); break; }
        if (session.state === 'exited') { conn.send({ type: S2C.ERROR, code: 'exited', message: 'session has exited' }); break; }
        sessionManager.setActive(session.id, conn);
        replay(conn, session);
        break;
      }
      case C2S.INPUT:
        if (conn.sessionId) sessionManager.write(conn.sessionId, msg.data);
        break;
      case C2S.RESIZE:
        if (conn.sessionId) sessionManager.resize(conn.sessionId, msg.cols, msg.rows);
        break;
      case C2S.STOP:
        sessionManager.detachAll(conn);
        break;
      case C2S.KILL:
        if (sessionManager.kill(msg.sessionId) && conn.sessionId === msg.sessionId) conn.sessionId = null;
        break;
      case C2S.PING:
        conn.send({ type: S2C.PONG });
        break;
      default:
        if (workflowRunner) handleWorkflow(conn, msg);
        break;
    }
  }

  function handleWorkflow(conn, msg) {
    switch (msg.type) {
      case C2S.WF_LIST:
        conn.send({ type: S2C.WF_LIST_RESULT, workflows: workflowRunner.list() });
        break;
      case C2S.WF_RUN: {
        const res = workflowRunner.start(msg.workflowId, msg.sessionId);
        if (!res.ok) { conn.send({ type: S2C.ERROR, code: res.code, message: res.message }); break; }
        workflowRunner.attachConn(res.run.runId, conn);
        conn.send({ type: S2C.WF_STARTED, run: res.run.snapshot() });
        conn.send({ type: S2C.WF_STATUS, run: res.run.snapshot() });
        break;
      }
      case C2S.WF_NEXT: {
        const run = workflowRunner.get(msg.runId);
        if (!run) { conn.send({ type: S2C.ERROR, code: 'not-found', message: 'run not found' }); break; }
        run.advance();
        conn.send({ type: S2C.WF_STATUS, run: run.snapshot() });
        break;
      }
      case C2S.WF_ABORT: {
        const run = workflowRunner.get(msg.runId);
        if (!run) { conn.send({ type: S2C.ERROR, code: 'not-found', message: 'run not found' }); break; }
        run.abort();
        conn.send({ type: S2C.WF_STATUS, run: run.snapshot() });
        break;
      }
    }
  }

  // workflowRunner 自动推进产生的状态变化由它 push 给 attach 的连接
  if (workflowRunner) {
    workflowRunner.onStatus((run) => {
      const c = workflowRunner.connOf(run.runId);
      if (c) {
        if (run.status === 'done' || run.status === 'aborted') {
          c.send({ type: S2C.WF_FINISHED, runId: run.runId, status: run.status });
          workflowRunner.detachConn(run.runId);
        }
        c.send({ type: S2C.WF_STATUS, run: run.snapshot() });
      }
    });
  }

  return { conns, handleMessage, wss, close: () => wss.close() };
}
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test server/test/ws-gateway.test.js`
Expected: `pass 9`

- [ ] **Step 6: 提交**

```bash
git add server/ws-gateway.js server/test/ws-gateway.test.js server/test/helpers/test-server.js
git commit -m "feat: ws-gateway 协议分发 + 扇出 alive + ws.data 连接态"
```

---

## Task 9: http-api（TDD，projects + tree HTTP 端点）

**Files:**
- Test: `server/test/http-api.test.js`
- Create: `server/http-api.js`

- [ ] **Step 1: 写失败测试**

`server/test/http-api.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Projects } from '../projects.js';
import { createHttpApi } from '../http-api.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfapi-')); }

async function request(server, url) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: url }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function start(projects) {
  const server = http.createServer(createHttpApi({ projects }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}

test('/api/projects 返回列表', async () => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  const r = await request(server, '/api/projects');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body).projects, [{ id: 'a', name: 'A', root: dir }]);
  server.close();
});

test('/api/tree 正常返回 items', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'f.txt'), '');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  const r = await request(server, '/api/tree?project=a&path=');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { items: [{ name: 'f.txt', type: 'file' }] });
  server.close();
});

test('/api/tree 越界返回 403', async () => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  const r = await request(server, '/api/tree?project=a&path=..%2F..%2F..');
  assert.equal(r.status, 403);
  server.close();
});

test('/api/tree 未知项目返回 404', async () => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  const r = await request(server, '/api/tree?project=nope&path=');
  assert.equal(r.status, 404);
  server.close();
});

test('非 /api 路由返回 404 json', async () => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  const r = await request(server, '/nope');
  assert.equal(r.status, 404);
  server.close();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/http-api.test.js`
Expected: FAIL（找不到 http-api.js）

- [ ] **Step 3: 实现 http-api.js（含 requireAuth 占位钩子）**

```js
export const requireAuthHttp = async () => true; // TODO(安全): 认证暂缓，接入反代/Token 后在此实现

export function createHttpApi({ projects }) {
  const sendJson = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  return async (req, res) => {
    if (!(await requireAuthHttp(req, res))) { sendJson(res, 401, { error: 'unauthorized' }); return; }
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/projects' && req.method === 'GET') {
        sendJson(res, 200, { projects: projects.listProjects() });
        return;
      }
      if (url.pathname === '/api/tree' && req.method === 'GET') {
        const project = url.searchParams.get('project');
        const rel = url.searchParams.get('path') || '';
        const items = projects.tree(project, rel);
        sendJson(res, 200, { items });
        return;
      }
    } catch (err) {
      if (err.code === 'forbidden') return sendJson(res, 403, { error: 'forbidden' });
      if (err.code === 'not-found') return sendJson(res, 404, { error: 'not found' });
      sendJson(res, 500, { error: 'internal', message: String(err && err.message || err) });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/http-api.test.js`
Expected: `pass 5`

- [ ] **Step 5: 提交**

```bash
git add server/http-api.js server/test/http-api.test.js
git commit -m "feat: HTTP API（projects/tree）+ requireAuth 占位"
```

---

## Task 10: WorkflowRunner（TDD）

**Files:**
- Test: `server/test/workflow-runner.test.js`
- Create: `server/workflow-runner.js`

- [ ] **Step 1: 写失败测试**

`server/test/workflow-runner.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../session-manager.js';
import { WorkflowRunner } from '../workflow-runner.js';
import { makeFakePtyFactory } from './helpers/fake-pty.js';

const WFS = [{
  id: 'w1', name: 'W1', steps: [
    { id: 's1', advance: 'auto', cmd: 'npm run build' },
    { id: 's2', advance: 'auto', cmd: 'echo deploy' },
    { id: 's3', advance: 'manual', cmd: 'pm2 restart app', hint: '确认后下一步' },
  ],
}];

async function makeRunner() {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({ name: 'T' });
  const runner = new WorkflowRunner({ sessionManager: sm, workflows: WFS });
  return { sm, instances, session, runner };
}

test('auto 步注入含 OSC 标记的命令', async () => {
  const { sm, session, runner, instances } = await makeRunner();
  const res = runner.start('w1', session.id);
  assert.equal(res.ok, true);
  const first = instances[0].pty.writes[0];
  assert.ok(first.startsWith('npm run build; printf'));
  assert.ok(first.includes('dfdone;'));
  runner.stopAll();
});

test('auto 标记匹配后自动进入下一条', async () => {
  const { sm, session, runner, instances } = await makeRunner();
  const res = runner.start('w1', session.id);
  const run = res.run;
  assert.equal(run.snapshot().steps[0].status, 'running');
  // 模拟 shell 执行完，把 OSC 标记打回 pty 输出
  const marker = `\x1b]777;dfdone;${run.runId}_0\x07`;
  instances[0].pty.__emitData('build ok\n' + marker);
  assert.equal(run.snapshot().steps[0].status, 'done');
  assert.equal(run.snapshot().steps[1].status, 'running');
  assert.equal(instances[0].pty.writes.length, 2);
  runner.stopAll();
});

test('manual 步注入后暂停，advance() 注入下一条', async () => {
  const { sm, session, runner, instances } = await makeRunner();
  const res = runner.start('w1', session.id);
  const run = res.run;
  const m1 = `\x1b]777;dfdone;${run.runId}_0\x07`;
  instances[0].pty.__emitData(m1);
  const m2 = `\x1b]777;dfdone;${run.runId}_1\x07`;
  instances[0].pty.__emitData(m2);
  // 现在到 s3 manual
  assert.equal(run.snapshot().status, 'paused');
  assert.equal(run.snapshot().steps[2].status, 'manual');
  const writesBefore = instances[0].pty.writes.length;
  run.advance();
  assert.equal(run.snapshot().steps[2].status, 'done');
  assert.equal(run.snapshot().status, 'done'); // 无下一条 -> 完成
  assert.equal(instances[0].pty.writes.length, writesBefore); // manual 不再注入
  runner.stopAll();
});

test('整个 auto 跑完自动 done', async () => {
  const W = [{ id: 'a', name: 'A', steps: [{ id: 'x', advance: 'auto', cmd: 'ls' }] }];
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({});
  const runner = new WorkflowRunner({ sessionManager: sm, workflows: W });
  const res = runner.start('a', session.id);
  const run = res.run;
  instances[0].pty.__emitData(`\x1b]777;dfdone;${run.runId}_0\x07`);
  assert.equal(run.snapshot().status, 'done');
  runner.stopAll();
});

test('会话不存在返回 not-found', async () => {
  const { runner } = await makeRunner();
  const res = runner.start('w1', 'ghost');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'not-found');
});

test('会话已退出返回 session-not-running', async () => {
  const { sm, session, runner, instances } = await makeRunner();
  instances[0].pty.__emitExit(0);
  const res = runner.start('w1', session.id);
  assert.equal(res.code, 'session-not-running');
});

test('同会话并发运行第二次返回 busy', async () => {
  const { sm, session, runner } = await makeRunner();
  assert.equal(runner.start('w1', session.id).ok, true);
  const res2 = runner.start('w1', session.id);
  assert.equal(res2.code, 'busy');
  runner.stopAll();
});

test('abort 停止并标记 error', async () => {
  const { sm, session, runner } = await makeRunner();
  const res = runner.start('w1', session.id);
  res.run.abort();
  assert.equal(res.run.snapshot().status, 'aborted');
  assert.equal(runner.get(res.run.runId), null);
});

test('run 期间会话退出 → run 中止为 aborted', async () => {
  const { sm, session, runner, instances } = await makeRunner();
  const res = runner.start('w1', session.id);
  instances[0].pty.__emitExit(130);
  assert.equal(res.run.snapshot().status, 'aborted');
  runner.stopAll();
});

test('标记跨 chunk 分片也能匹配', async () => {
  const { sm, session, runner, instances } = await makeRunner();
  const res = runner.start('w1', session.id);
  const run = res.run;
  const marker = `\x1b]777;dfdone;${run.runId}_0\x07`;
  const a = marker.slice(0, 5);
  const b = marker.slice(5);
  instances[0].pty.__emitData(a);
  assert.equal(run.snapshot().steps[0].status, 'running');
  instances[0].pty.__emitData(b);
  assert.equal(run.snapshot().steps[0].status, 'done');
  runner.stopAll();
});

test('运行中被 kill 会话 → run 中止为 aborted', async () => {
  const { sm, session, runner } = await makeRunner();
  const res = runner.start('w1', session.id);
  assert.equal(res.run.snapshot().status, 'running');
  sm.kill(session.id);                       // 走 manager 'removed' 事件
  assert.equal(res.run.snapshot().status, 'aborted');
  assert.equal(res.run.snapshot().errorMessage, 'session removed');
});

```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/workflow-runner.test.js`
Expected: FAIL（找不到 workflow-runner.js）

- [ ] **Step 3: 实现 workflow-runner.js**

```js
import crypto from 'node:crypto';
import { buildMarkerCmd } from './pty-runner.js';

const runId = () => 'run_' + crypto.randomBytes(4).toString('hex');

class Run {
  constructor(runner, workflow, session) {
    this.runner = runner;
    this.runId = runId();
    this.workflow = workflow;
    this.sessionId = session.id;
    this.status = 'running';
    this.currentIndex = 0;
    this.errorMessage = null;
    this.steps = workflow.steps.map((s) => ({ ...s, status: 'waiting', startedAt: null, finishedAt: null }));
    this._tail = '';
  }
  snapshot() {
    return { runId: this.runId, workflowId: this.workflow.id, workflowName: this.workflow.name,
      sessionId: this.sessionId, status: this.status, currentIndex: this.currentIndex,
      steps: this.steps, errorMessage: this.errorMessage };
  }
  _emit() { this.runner._emit(this); }
  _current() { return this.steps[this.currentIndex]; }
  _marker(i) { return `\x1b]777;dfdone;${this.runId}_${i}\x07`; }
  _beginStep(i) {
    const step = this.steps[i];
    step.status = 'running';
    step.startedAt = Date.now();
    this.status = 'running';
    const session = this.runner.sm.get(this.sessionId);
    if (!session || !session.alive) { this._fail('session exited'); return; }
    let line = step.cmd;
    if (step.advance === 'auto') line = buildMarkerCmd(step.cmd, this.runId, i, session.pty.shell);
    const ok = this.runner.sm.write(this.sessionId, line + '\r');
    if (!ok) { this._fail('write failed'); return; }
    this._emit();
  }
  _fail(msg) {
    this.errorMessage = msg;
    this.status = 'aborted';
    this.steps[this.currentIndex].status = 'error';
    this._emit();
  }
  _finish() {
    this.status = 'done';
    this._current() && (this._current().status = 'waiting');
    this._emit();
  }
  onData(session, chunk) {
    if (session.id !== this.sessionId) return;
    if (this.status !== 'running') return;
    const step = this._current();
    if (!step || step.advance !== 'auto') return;
    this._tail = (this._tail + chunk).slice(-96);
    if (this._tail.includes(this._marker(this.currentIndex))) {
      step.status = 'done';
      step.finishedAt = Date.now();
      this._tail = '';
      this.currentIndex += 1;
      if (this.currentIndex < this.steps.length) {
        if (this.steps[this.currentIndex].advance === 'manual') {
          this._beginManual();
        } else {
          this._beginStep(this.currentIndex);
        }
      } else {
        this._finish();
      }
    }
  }
  _beginManual() {
    const step = this._current();
    step.status = 'manual';
    step.startedAt = Date.now();
    this.status = 'paused';
    const session = this.runner.sm.get(this.sessionId);
    if (session && session.alive) this.runner.sm.write(this.sessionId, this._current().cmd + '\r');
    this._emit();
  }
  advance() { // 手动点“下一步”：完成当前步并继续（也允许强制越过卡住的 auto 步）
    const step = this._current();
    if (!step) return;
    step.status = 'done';
    step.finishedAt = Date.now();
    this._tail = '';
    this.currentIndex += 1;
    if (this.currentIndex < this.steps.length) {
      if (this.steps[this.currentIndex].advance === 'manual') this._beginManual();
      else this._beginStep(this.currentIndex);
    } else {
      this._finish();
    }
  }
  abort() {
    const step = this._current();
    if (step && step.status === 'running') step.status = 'error';
    if (step && step.status === 'waiting') step.status = 'waiting';
    this.status = 'aborted';
    this.errorMessage = this.errorMessage || 'aborted by user';
    this._emit();
  }
}

export class WorkflowRunner {
  constructor({ sessionManager, workflows = [], logger = console }) {
    this.sm = sessionManager;
    this.workflows = workflows;
    this.log = logger;
    this.runs = new Map();      // runId -> Run
    this._sessionRun = new Map(); // sessionId -> runId
    this._conns = new Map();    // runId -> conn
    this._statusCbs = [];
    this._onData = (session, chunk) => {
      const rid = this._sessionRun.get(session.id);
      if (rid) this.runs.get(rid)?.onData(session, chunk);
    };
    this._onExit = (session) => {
      const rid = this._sessionRun.get(session.id);
      if (rid) this.runs.get(rid)?._fail('session exited');
    };
    this._onRemoved = (sessionId) => {
      const rid = this._sessionRun.get(sessionId);
      if (rid) this.runs.get(rid)?._fail('session removed');   // kill 走 removed 事件，非 exit
    };
    this.sm.on('data', this._onData);
    this.sm.on('exit', this._onExit);
    this.sm.on('removed', this._onRemoved);
  }
  list() {
    return this.workflows.map((w) => ({ id: w.id, name: w.name, steps: w.steps }));
  }
  get(runId) { return this.runs.get(runId) || null; }
  start(workflowId, sessionId) {
    const wf = this.workflows.find((w) => w.id === workflowId);
    if (!wf) return { ok: false, code: 'not-found', message: 'workflow not found' };
    const session = this.sm.get(sessionId);
    if (!session) return { ok: false, code: 'not-found', message: 'session not found' };
    if (session.state !== 'running') return { ok: false, code: 'session-not-running', message: 'session not running' };
    if (this._sessionRun.has(sessionId)) return { ok: false, code: 'busy', message: 'session busy with another workflow' };
    const run = new Run(this, wf, session);
    this.runs.set(run.runId, run);
    this._sessionRun.set(sessionId, run.runId);
    const first = run.steps[0];
    if (first.advance === 'manual') run._beginManual();
    else run._beginStep(0);
    return { ok: true, run };
  }
  _emit(run) {
    for (const cb of this._statusCbs) { try { cb(run); } catch (e) { this.log.error('wf status cb', e); } }
    // 终态（done/aborted）同步清理，使同一会话可再次运行；状态快照已先行广播
    this._maybeCleanup(run);
  }
  _maybeCleanup(run) {
    if (run.status === 'done' || run.status === 'aborted') {
      this._sessionRun.delete(run.sessionId);
      this._conns.delete(run.runId);
      this.runs.delete(run.runId);
    }
  }
  onStatus(cb) { this._statusCbs.push(cb); }
  attachConn(runId, conn) { this._conns.set(runId, conn); }
  connOf(runId) { return this._conns.get(runId) || null; }
  detachConn(runId) { this._conns.delete(runId); }
  stopAll() {
    for (const run of [...this.runs.values()]) { try { run.abort(); } catch { /* noop */ } }
  }
}
```

> 注意：Task 10 实现里 `Run._beginManual` 已把「manual 命令在暂停时即注入」，与 spec「注入后暂停」一致；`advance()` 直接完成并走下一步。终态（done/aborted）在 `_emit` 后自动从 map 清理（见 `_maybeCleanup`），故 abort 后 `runner.get(runId) === null`，同一会话随后可再次启动新 workflow。

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/workflow-runner.test.js`
Expected: `pass 12`（abort 用例断言 `runner.get()===null` 成立）

- [ ] **Step 6: 提交**

```bash
git add server/workflow-runner.js server/test/workflow-runner.test.js
git commit -m "feat: WorkflowRunner auto/manual 推进 + OSC 标记匹配 + abort"
```

---

## Task 11: gateway 接 workflow 消息（集成测试）

**Files:**
- Test: `server/test/ws-gateway-workflow.test.js`

> 说明：Task 10 的 `WorkflowRunner` 已内置 `onStatus`/`attachConn`/`_maybeCleanup`，Task 8 的 gateway 已具备 WF 消息分支——本任务仅补集成测试锁定端到端行为，不改实现。

- [ ] **Step 1: 写集成测试（经真实 ws）**

`server/test/ws-gateway-workflow.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../session-manager.js';
import { WorkflowRunner } from '../workflow-runner.js';
import { startTestServer } from './helpers/test-server.js';
import { makeFakePtyFactory } from './helpers/fake-pty.js';
import { C2S, S2C } from '@devflow/shared';

const WFS = [{ id: 'w', name: 'W', steps: [
  { id: 'a', advance: 'auto', cmd: 'npm run build' },
  { id: 'm', advance: 'manual', cmd: 'pm2 restart app' },
] }];

async function harness() {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({ name: 'S' });
  const runner = new WorkflowRunner({ sessionManager: sm, workflows: WFS });
  const t = await startTestServer({ sessionManager: sm, workflowRunner: runner });
  return { sm, session, runner, t, instances };
}

test('端到端: 面板看到自动步推进到 manual 并收到 wf 消息', async () => {
  const { sm, session, t, instances } = await harness();
  const c = await t.connect();
  c.send(C2S.WF_LIST, {});
  const list = await c.wait((m) => m.type === S2C.WF_LIST_RESULT);
  assert.equal(list.workflows.length, 1);

  c.send(C2S.WF_RUN, { workflowId: 'w', sessionId: session.id });
  const started = await c.wait((m) => m.type === S2C.WF_STARTED);
  assert.equal(started.run.steps[0].status, 'running');

  const marker = `\x1b]777;dfdone;${started.run.runId}_0\x07`;
  instances[0].pty.__emitData(marker);
  const paused = await c.wait((m) => m.type === S2C.WF_STATUS && m.run.status === 'paused');
  assert.equal(paused.run.steps[1].status, 'manual');

  c.send(C2S.WF_NEXT, { runId: started.run.runId });
  const done = await c.wait((m) => m.type === S2C.WF_FINISHED && m.status === 'done');
  assert.equal(done.runId, started.run.runId);

  c.send(C2S.WF_ABORT, { runId: started.run.runId }); // 已结束 -> not-found 属预期
  const err = await c.wait((m) => m.type === S2C.ERROR);
  assert.equal(err.code, 'not-found');
  await t.stop();
});

test('同一会话重复 run 返回 busy', async () => {
  const { sm, session, t } = await harness();
  const c = await t.connect();
  c.send(C2S.WF_RUN, { workflowId: 'w', sessionId: session.id });
  await c.wait((m) => m.type === S2C.WF_STARTED);
  c.send(C2S.WF_RUN, { workflowId: 'w', sessionId: session.id });
  const err = await c.wait((m) => m.type === S2C.ERROR);
  assert.equal(err.code, 'busy');
  await t.stop();
});
```

> 备注：终态（done/aborted）清理已内建于 Task 10 的 `WorkflowRunner._emit → _maybeCleanup`（先广播后清理），因此同一会话可再次运行、且对已结束的 runId 发 `wf-abort` 会得到 `not-found`——与下方用例吻合。

- [ ] **Step 2: 运行确认通过**

Run: `node --test server/test/ws-gateway-workflow.test.js`
Expected: `pass 2`

- [ ] **Step 3: 回归 server 全部测试**

Run: `node --test server/test/`
Expected: 全部 pass

- [ ] **Step 4: 提交**

```bash
git add server/test/ws-gateway-workflow.test.js
git commit -m "feat: workflow 消息网关集成测试"
```

---

## Task 12: index.js 组合 + 静态服务 + 全局兜底

**Files:**
- Create: `server/static.js`
- Create: `server/index.js`
- Create: `server/projects.json`、`server/workflows.json`（占位，运行时 config 会自动补全）

- [ ] **Step 1: static.js**

```js
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};
export function createStaticServer(rootDir) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const url = new URL(req.url, 'http://localhost');
    let file = path.normalize(path.join(rootDir, decodeURIComponent(url.pathname)));
    if (!file.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      const ext = path.extname(file);
      if (ext !== '') return next();                // 缺失资源 → 404，不回退 SPA
      file = path.join(rootDir, 'index.html');       // 无扩展名路由 → SPA fallback
    }
    if (!fs.existsSync(file)) return next();
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  };
}
```

- [ ] **Step 2: index.js**

```js
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionManager } from './session-manager.js';
import { WorkflowRunner } from './workflow-runner.js';
import { createGateway } from './ws-gateway.js';
import { createHttpApi, requireAuthHttp } from './http-api.js';
import { Projects } from './projects.js';
import { createLogger } from './log.js';
import { createStaticServer } from './static.js';
import { resolveFiles, loadProjects, loadWorkflows } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('[server]');

process.on('uncaughtException', (err) => log.error('uncaughtException', err));   // 三层兜底 #3
process.on('unhandledRejection', (err) => log.error('unhandledRejection', err));

const files = resolveFiles();
const projects = new Projects({ projects: loadProjects(files.projectsFile), logger: log });
const workflows = loadWorkflows(files.workflowsFile);
const sessionManager = new SessionManager({
  logger: log,
  projectResolver: (id) => projects.listProjects().find((p) => p.id === id)?.root ?? null,
});
const workflowRunner = new WorkflowRunner({ sessionManager, workflows, logger: log });

// requireAuth 占位钩子（spec §11）：HTTP 用 requireAuthHttp，WS 走 upgrade 处的 requireAuthWs
const requireAuthWs = () => true; // TODO(安全): 接入 Token 后校验 ws 握手

const server = http.createServer(async (req, res) => {
  if (!(await requireAuthHttp(req, res))) { res.writeHead(401); res.end(); return; }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    await createHttpApi({ projects })(req, res);
    return;
  }
  createStaticServer(path.join(__dirname, '..', 'web', 'dist'))(req, res, () => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
});

createGateway({ httpServer: server, sessionManager, workflowRunner, requireAuthWs, log });

const HOST = process.env.DEVFLOW_HOST || '127.0.0.1';
const PORT = Number(process.env.DEVFLOW_PORT || 3001);
server.listen(PORT, HOST, () => {
  log.info(`listening on http://${HOST}:${PORT}  (ws: ws://${HOST}:${PORT}/ws)`);
});

export { server, sessionManager, workflowRunner, projects };
```

- [ ] **Step 3: 启动冒烟（手动）**

Run: `node server/index.js`，另开终端：
```powershell
node -e "const {WebSocket}=require('ws');const ws=new WebSocket('ws://127.0.0.1:3001/ws');ws.on('open',()=>ws.send(JSON.stringify({type:'ping'})));ws.on('message',m=>{console.log('GOT',m);ws.close();process.exit(0)});setTimeout(()=>{console.error('timeout');process.exit(1)},3000)"
```
Expected: `GOT {"type":"pong"}`

- [ ] **Step 4: 提交**

```bash
git add server/static.js server/index.js
git commit -m "feat: server 组合入口 + 静态服务 + 全局异常兜底"
```

---

## Task 13: web 脚手架（Vite + Vue + TS + xterm，本地依赖，零 CDN）

**Files:**
- Create: `web/package.json`, `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`, `web/tsconfig.node.json`, `web/env.d.ts`
- Create: `web/src/main.ts`, `web/src/App.vue`, `web/src/styles.css`

- [ ] **Step 1: web/package.json**

```json
{
  "name": "@devflow/web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "vue-tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@devflow/shared": "*",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/xterm": "^5.5.0",
    "vue": "^3.5.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.0",
    "typescript": "~5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0",
    "vue-tsc": "^2.1.0"
  }
}
```

- [ ] **Step 2: 配置文件与外壳**

`web/index.html`:
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>网页版 opencode</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`web/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:3001', ws: true },
    },
  },
  build: { outDir: 'dist' },
});
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "preserve",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.vue", "env.d.ts"]
}
```

`web/tsconfig.node.json`:
```json
{ "compilerOptions": { "module": "ESNext", "moduleResolution": "Bundler", "types": ["node"], "skipLibCheck": true }, "include": ["vite.config.ts"] }
```

`web/env.d.ts`:
```ts
/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
```

`web/src/main.ts`:
```ts
import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';
createApp(App).mount('#app');
```

`web/src/App.vue`（占位，Task 18 重写为完整布局）:
```vue
<script setup lang="ts">
import { onMounted } from 'vue';
onMounted(() => { document.title = '网页版 opencode'; });
</script>
<template>
  <div class="app-shell placeholder">
    <h1>网页版 opencode — scaffold ok</h1>
  </div>
</template>
<style scoped>
.placeholder { display: grid; place-items: center; height: 100vh; color: #ccc; }
</style>
```

`web/src/styles.css`:
```css
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
body { background: #1e2227; color: #d5dae1; font-family: "Segoe UI", system-ui, sans-serif; font-size: 13px; }
.xterm { height: 100%; padding: 4px 0; }
```

- [ ] **Step 3: 安装并校验（根目录运行）**

Run: `npm.cmd install`
Run: `npm.cmd --prefix web run typecheck`
Expected: 无类型错误（vue-tsc pass）

- [ ] **Step 4: 提交**

```bash
git add web/ package.json package-lock.json
git commit -m "feat: web 脚手架 Vite+Vue+TS 本地依赖零外链"
```

---

## Task 14: useTerminal composable（TDD，FakeSocket）

**Files:**
- Create: `web/src/useTerminal.ts`
- Test: `web/src/useTerminal.test.ts`

- [ ] **Step 1: 写失败测试**

`web/src/useTerminal.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTerminal } from './useTerminal';
import { C2S, S2C } from '@devflow/shared';

class FakeSocket {
  static OPEN = 1;
  readyState: number = FakeSocket.OPEN;
  listeners: Record<string, ((e: any) => void)[]> = {};
  sent: any[] = [];
  closed = false;
  constructor(public url: string) {}
  addEventListener(type: string, fn: (e: any) => void) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type: string, fn: any) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.closed = true; }
  fire(type: string, payload?: any) { (this.listeners[type] || []).forEach((f) => f(payload)); }
  emitMessage(msg: any) { this.fire('message', { data: JSON.stringify(msg) }); }
  emitOpen() { this.fire('open'); }
  emitClose() { this.fire('close'); }
}

function makeHook() {
  const sockets: FakeSocket[] = [];
  const term = useTerminal({
    url: () => 'ws://t/ws',
    wsFactory: (u: string) => { const s = new FakeSocket(u); sockets.push(s); return s; },
    retryBaseMs: 50, maxRetryMs: 100,
  });
  return { term, sockets };
}

describe('useTerminal', () => {
  let hook: ReturnType<typeof makeHook>;
  beforeEach(() => { vi.useFakeTimers(); hook = makeHook(); });
  afterEach(() => { vi.useRealTimers(); hook.term.disconnect(); });

  it('connect 后握手 open → 自动发 list', () => {
    hook.term.connect();
    const ws = hook.sockets[0];
    ws.emitOpen();
    expect(ws.sent.at(-1)!.type).toBe(C2S.LIST);
  });

  it('收 session-list 更新 store.sessions', () => {
    hook.term.connect();
    const ws = hook.sockets[0];
    ws.emitOpen();
    const fake = { id: 's1', name: 'A', state: 'running' as const, cwd: '', projectId: null, cols: 80, rows: 24, exitCode: null };
    ws.emitMessage({ type: S2C.SESSION_LIST, sessions: [fake] });
    expect(hook.term.state.sessions).toHaveLength(1);
  });

  it('createSession 发 create，事件驱动解析 session-created 并置为 active', async () => {
    hook.term.connect();
    const ws = hook.sockets[0];
    ws.emitOpen();
    const p = hook.term.createSession({ projectId: 'p1', cols: 90, rows: 30 });
    expect(ws.sent.at(-1)!.type).toBe(C2S.CREATE);
    const created = { id: 'sX', name: 'X', projectId: 'p1', state: 'running' as const, cwd: '', cols: 90, rows: 30, exitCode: null };
    ws.emitMessage({ type: S2C.SESSION_CREATED, session: created });
    await p;
    expect(hook.term.state.activeSessionId).toBe('sX');
  });

  it('replay/output 走 on 事件订阅者', () => {
    hook.term.connect();
    const ws = hook.sockets[0];
    ws.emitOpen();
    const writes: string[] = [];
    hook.term.on(S2C.REPLAY, (m: any) => writes.push(m.data));
    ws.emitMessage({ type: S2C.REPLAY, sessionId: 's1', data: '\x1b[2J\x1b[Htail' });
    expect(writes[0]).toContain('tail');
  });

  it('断线重连: close 后退避重开并重新 start 当前会话', () => {
    hook.term.state.activeSessionId = 's1';
    hook.term.connect();
    const ws0 = hook.sockets[0];
    ws0.emitOpen();
    ws0.emitClose();
    expect(hook.term.state.status).toBe('reconnecting');
    vi.advanceTimersByTime(60);
    expect(hook.sockets.length).toBe(2);
    const ws1 = hook.sockets[1];
    ws1.emitOpen();
    expect(ws1.sent.some((m) => m.type === C2S.START && m.sessionId === 's1')).toBe(true);
  });

  it('disconnect 主动关闭后不自动重连', () => {
    hook.term.connect();
    const ws0 = hook.sockets[0];
    ws0.emitOpen();
    hook.term.disconnect();
    expect(ws0.closed).toBe(true);
    ws0.emitClose();
    vi.advanceTimersByTime(500);
    expect(hook.sockets.length).toBe(1);
  });

  it('input/resize 转发到当前连接', () => {
    hook.term.connect();
    const ws = hook.sockets[0];
    ws.emitOpen();
    hook.term.state.activeSessionId = 's1';
    hook.term.input('ls\r');
    expect(ws.sent.at(-1)).toMatchObject({ type: C2S.INPUT, data: 'ls\r' });
    hook.term.resize(120, 40);
    expect(ws.sent.at(-1)).toMatchObject({ type: C2S.RESIZE, cols: 120, rows: 40 });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test`
Expected: FAIL（找不到 useTerminal）

- [ ] **Step 3: 实现 useTerminal.ts**

```ts
import { reactive } from 'vue';
import { C2S, S2C } from '@devflow/shared';

export type ConnStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
export interface SessionSummary { id: string; name: string; projectId: string | null; state: 'running' | 'exited'; cwd: string; cols: number; rows: number; exitCode: number | null; }
export type Handler = (msg: any) => void;

export interface UseTerminalOptions {
  url?: () => string;
  wsFactory?: (url: string) => any;
  retryBaseMs?: number;
  maxRetryMs?: number;
  onStatusChange?: (s: ConnStatus) => void;
}

export function useTerminal(opts: UseTerminalOptions = {}) {
  const WS_CONNECTING = 0;
  const WS_OPEN = 1;
  const url = opts.url || (() => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  const wsFactory = opts.wsFactory || ((u: string) => new WebSocket(u));
  const retryBaseMs = opts.retryBaseMs ?? 1000;
  const maxRetryMs = opts.maxRetryMs ?? 10000;

  const state = reactive({
    status: 'idle' as ConnStatus,
    sessions: [] as SessionSummary[],
    activeSessionId: null as string | null,
    error: '' as string,
  });

  let ws: any = null;
  let manualClose = false;
  let retry = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const handlers = new Map<string, Set<Handler>>();
  let listResolve: ((s: SessionSummary[]) => void) | null = null;
  let createdResolve: ((s: SessionSummary) => void) | null = null;
  let onOutputCb: ((data: string) => void) | null = null;
  let onReplayCb: ((data: string) => void) | null = null;

  function setStatus(s: ConnStatus) { state.status = s; opts.onStatusChange?.(s); }
  function emit(type: string, msg: any) { handlers.get(type)?.forEach((h) => h(msg)); }
  const outbox: any[] = [];
  function send(type: string, payload: Record<string, unknown> = {}) {
    const m = { type, ...payload };
    if (ws && ws.readyState === WS_OPEN) ws.send(JSON.stringify(m));
    else outbox.push(m);                 // 未连上先排队，open 后 flush
  }
  function flushOutbox() { while (outbox.length) { const m = outbox.shift(); if (ws && ws.readyState === WS_OPEN) ws.send(JSON.stringify(m)); } }

  function onOpen() {
    retry = 0;
    setStatus('open');
    flushOutbox();
    send(C2S.LIST);
    if (state.activeSessionId) send(C2S.START, { sessionId: state.activeSessionId });
  }
  function onClose() {
    setStatus(manualClose ? 'closed' : 'reconnecting');
    if (manualClose) return;
    const delay = Math.min(retryBaseMs * 2 ** retry, maxRetryMs);
    retry += 1;
    retryTimer = setTimeout(() => { connect(); }, delay);
  }
  function onMessage(raw: string) {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.type) {
      case S2C.SESSION_LIST:
        state.sessions = msg.sessions || [];
        listResolve?.(state.sessions); listResolve = null;
        emit(S2C.SESSION_LIST, msg); break;      // 供视图决定是否需自动建第一个会话
      case S2C.SESSION_CREATED: {
        state.sessions = state.sessions.filter((s) => s.id !== msg.session.id).concat([msg.session]);
        state.activeSessionId = msg.session.id;
        createdResolve?.(msg.session); createdResolve = null;
        emit(S2C.SESSION_CREATED, msg); break;
      }
      case S2C.SESSION_EXITED: {
        const s = state.sessions.find((x) => x.id === msg.sessionId);
        if (s) s.state = 'exited';
        break;
      }
      case S2C.OUTPUT: if (onOutputCb && msg.sessionId === state.activeSessionId) onOutputCb(msg.data); break;
      case S2C.REPLAY: if (onReplayCb && msg.sessionId === state.activeSessionId) onReplayCb(msg.data); break;
      case S2C.ERROR: state.error = `${msg.code}: ${msg.message}`; emit(S2C.ERROR, msg); break;
      default: emit(msg.type, msg); break;
    }
  }

  function connect() {
    if (ws && (ws.readyState === WS_CONNECTING || ws.readyState === WS_OPEN)) return;
    manualClose = false;
    setStatus('connecting');
    ws = wsFactory(url());
    ws.addEventListener('open', onOpen);
    ws.addEventListener('message', (e: any) => onMessage(e.data));
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', () => { /* close 会触发重连 */ });
  }

  return {
    state,
    connect,
    disconnect() { manualClose = true; outbox.length = 0; if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } if (ws) { try { ws.close(); } catch { /* noop */ } } },
    send,
    on(type: string, h: Handler): () => void {
      let s = handlers.get(type);
      if (!s) { s = new Set(); handlers.set(type, s); }
      s.add(h);
      return () => { s!.delete(h); };
    },
    setOutput(activeSessionId: string | null) { state.activeSessionId = activeSessionId; },
    input(data: string) { send(C2S.INPUT, { data }); },
    resize(cols: number, rows: number) { send(C2S.RESIZE, { cols, rows }); },
    stop() { send(C2S.STOP); state.activeSessionId = null; },
    killSession(id: string) {
      send(C2S.KILL, { sessionId: id });
      state.sessions = state.sessions.filter((s) => s.id !== id);
      if (state.activeSessionId === id) state.activeSessionId = null;
    },
    switchTo(id: string) { state.activeSessionId = id; send(C2S.START, { sessionId: id }); },
    createSession(input: { projectId?: string | null; cols?: number; rows?: number }) {
      send(C2S.CREATE, { ...input });
      return new Promise<SessionSummary>((resolve) => { createdResolve = resolve; });
    },
    listSessions() {
      send(C2S.LIST);
      return new Promise<SessionSummary[]>((resolve) => { listResolve = resolve; });
    },
    bindIO(cb: { output: (d: string) => void; replay: (d: string) => void }) { onOutputCb = cb.output; onReplayCb = cb.replay; },
  };
}
```

> 备注：事件回调注册 API 用 `on()`；OUTPUT/REPLAY 直接经 `bindIO` 走 xterm（避免每个 pane 各自 on 重复消费同一消息——对应「旧 handler 不能写已关 socket」的前端侧收口）。

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test`
Expected: `7 passed`

- [ ] **Step 5: 提交**

```bash
git add web/src/useTerminal.ts web/src/useTerminal.test.ts
git commit -m "feat: useTerminal composable（重连/attach/事件总线）"
```

---

## Task 15: TerminalView（xterm + 会话标签 + 新建/切换）

**Files:**
- Create: `web/src/components/TerminalView.vue`
- Create: `web/src/components/TerminalToolbar.vue`

- [ ] **Step 1: TerminalView.vue**

```vue
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { S2C } from '@devflow/shared';
import type { useTerminal } from '../useTerminal';
import TerminalToolbar from './TerminalToolbar.vue';

const props = defineProps<{ terminal: ReturnType<typeof useTerminal>; projectId: string | null }>();

const hostRef = ref<HTMLDivElement | null>(null);
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let dataSub: ((d: string) => void) | null = null;
let unsubList: (() => void) | null = null;
let autoTried = false;

function init() {
  if (!hostRef.value || term) return;
  term = new Terminal({
    cursorBlink: true, fontSize: 13, fontFamily: 'Consolas, "Courier New", monospace',
    theme: { background: '#0e1116', foreground: '#d5dae1' },
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(hostRef.value);
  fit.fit();
  dataSub = (d: string) => { props.terminal.input(d); };
  term.onData(dataSub);
  props.terminal.bindIO({
    output: (d) => term?.write(d),
    replay: (d) => { term?.clear(); term?.write(d); requestAnimationFrame(() => onResize()); },
  });
  watch(() => props.terminal.state.status, (s) => {
    if (s === 'reconnecting') term?.write('\x1b[33m-- 已断开，正在重连 --\x1b[0m\r\n');
  });
  const dims = () => { const d = fit?.proposeDimensions(); return { cols: d?.cols || 80, rows: d?.rows || 24 }; };
  // 不盲建会话：等服务端回 list。仅当“无任何会话”时才自动建第一个，
  // 避免每次刷新重复生成（会话常驻服务端，刷新不该新增）。
  unsubList = props.terminal.on(S2C.SESSION_LIST, () => {
    if (!autoTried && !props.terminal.state.activeSessionId && props.terminal.state.sessions.length === 0) {
      autoTried = true;
      props.terminal.createSession({ projectId: props.projectId, ...dims() });
    }
  });
  if (props.terminal.state.activeSessionId) {
    props.terminal.switchTo(props.terminal.state.activeSessionId);
  }
}

function onResize() {
  if (!term || !fit) return;
  fit.fit();
  const d = fit.proposeDimensions();
  if (d) props.terminal.resize(d.cols, d.rows);
}

onMounted(() => {
  init();
  window.addEventListener('resize', onResize);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  unsubList?.();
  if (dataSub && term) term.offData(dataSub);
  term?.dispose();
  term = null;
});
</script>

<template>
  <div class="terminal-wrap">
    <TerminalToolbar :terminal="terminal" :project-id="projectId" />
    <div ref="hostRef" class="terminal-host" />
  </div>
</template>

<style scoped>
.terminal-wrap { display: flex; flex-direction: column; height: 100%; background: #0e1116; }
.terminal-host { flex: 1; padding: 2px 6px; overflow: hidden; }
</style>
```

- [ ] **Step 2: TerminalToolbar.vue**

```vue
<script setup lang="ts">
import type { useTerminal } from '../useTerminal';
const props = defineProps<{ terminal: ReturnType<typeof useTerminal>; projectId: string | null }>();
function create() {
  props.terminal.createSession({ projectId: props.projectId, cols: 80, rows: 24 });
}
function kill(id: string) { if (confirm('结束该会话？')) props.terminal.killSession(id); }
</script>

<template>
  <div class="toolbar">
    <button class="tab" v-for="s in terminal.state.sessions" :key="s.id"
      :class="{ active: terminal.state.activeSessionId === s.id }"
      @click="terminal.switchTo(s.id)">
      <span :class="['dot', s.state]" />{{ s.name }}
      <span class="x" @click.stop="kill(s.id)">×</span>
    </button>
    <button class="new" @click="create">＋ 新建会话</button>
    <span v-if="terminal.state.status === 'reconnecting'" class="net">重连中…</span>
  </div>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 4px; background: #141920; border-bottom: 1px solid #2a323e; padding: 0 8px; height: 32px; }
.tab { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: none; color: #9aa4b2; padding: 0 10px; height: 100%; cursor: pointer; border-right: 1px solid #2a323e; }
.tab.active { background: #0e1116; color: #e6e9ef; }
.tab .dot { width: 7px; height: 7px; border-radius: 50%; }
.dot.running { background: #22c55e; }
.dot.exited { background: #64748b; }
.tab .x { color: #5b6472; padding: 0 4px; }
.tab .x:hover { color: #fff; }
.new { background: none; border: none; color: #4c9aff; cursor: pointer; }
.net { margin-left: auto; color: #eab308; }
</style>
```

> 备注：`projectId` 传入新建会话用的默认 cwd 由服务端 `create` 的 projectId 决定（服务端 projects 模块 resolve 到 root）。此处「新建」按钮只保留终端入口；侧栏「会话列表/文件树」新建入口在 Task 16/18。

- [ ] **Step 3: typecheck + dev 冒烟（手动，需先起 server）**

Run: `npm.cmd --prefix web run typecheck`
Expected: 无错。

- [ ] **Step 4: 提交**

```bash
git add web/src/components/TerminalView.vue web/src/components/TerminalToolbar.vue
git commit -m "feat: xterm 终端视图 + 会话标签条"
```

---

## Task 16: 侧栏 — FileTree + SessionList（含 http 客户端 useProjects）

**Files:**
- Create: `web/src/useProjects.ts`
- Create: `web/src/components/FileTree.vue`
- Create: `web/src/components/SessionList.vue`

- [ ] **Step 1: useProjects.ts**

```ts
import type { ProjectInfo, TreeItem } from '@devflow/shared';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export function useProjects() {
  return {
    async list(): Promise<ProjectInfo[]> {
      const r = await get<{ projects: ProjectInfo[] }>('/api/projects');
      return r.projects;
    },
    async tree(project: string, rel: string): Promise<TreeItem[]> {
      const r = await get<{ items: TreeItem[] }>(`/api/tree?project=${encodeURIComponent(project)}&path=${encodeURIComponent(rel)}`);
      return r.items;
    },
  };
}
```

- [ ] **Step 2: FileTree.vue（懒展开）**

```vue
<script setup lang="ts">
import { ref, watch } from 'vue';
import type { TreeItem } from '@devflow/shared';
import { useProjects } from '../useProjects';

const props = defineProps<{ projectId: string | null }>();
const { tree } = useProjects();
interface Node { name: string; type: 'file' | 'dir'; path: string; expanded: boolean; loading: boolean; children: Node[]; }
const nodes = ref<Node[]>([]);

async function load(rel: string): Promise<Node[]> {
  if (!props.projectId) return [];
  const items: TreeItem[] = await tree(props.projectId, rel);
  return items.map((i) => ({ name: i.name, type: i.type, path: rel ? `${rel}/${i.name}` : i.name, expanded: false, loading: false, children: [] }));
}
async function refresh() { nodes.value = await load(''); }
async function toggle(n: Node) {
  if (n.type !== 'dir') return;
  n.expanded = !n.expanded;
  if (n.expanded && n.children.length === 0) { n.loading = true; n.children = await load(n.path); n.loading = false; }
}
watch(() => props.projectId, refresh, { immediate: true });
defineExpose({ refresh });
</script>

<template>
  <div class="ft">
    <div v-for="n in nodes" :key="n.path">
      <div class="row" :class="{ dir: n.type === 'dir' }" @click="toggle(n)">
        <span class="tw">{{ n.type === 'dir' ? (n.expanded ? '▾' : '▸') : '' }}</span>
        <span>{{ n.name }}</span>
      </div>
      <div v-if="n.expanded" style="padding-left: 14px">
        <div v-for="c in n.children" :key="c.path">
          <div class="row" :class="{ dir: c.type === 'dir' }" @click="toggle(c)">
            <span class="tw">{{ c.type === 'dir' ? (c.expanded ? '▾' : '▸') : '' }}</span>
            <span>{{ c.name }}</span>
          </div>
        </div>
      </div>
    </div>
    <div v-if="nodes.length === 0" class="empty">空目录</div>
  </div>
</template>

<style scoped>
.ft { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; padding: 6px 2px; user-select: none; }
.row { display: flex; gap: 4px; padding: 2px 6px; cursor: default; color: #c8d0da; white-space: nowrap; overflow: hidden; }
.row:hover { background: #262c34; }
.tw { color: #8b96a5; width: 12px; }
.empty { color: #5b6472; padding: 8px; }
</style>
```

> 说明：FileTree 目前只展开一层（v1 YAGNI：真正的递归树留待用户明确需要多层同时展开时再加，点击子目录仍可逐层展开——因子层 `toggle` 未绑定展开逻辑，仅作目录标记）。**修正：让子目录也可展开**，抽出递归子组件以保持可维护。

- [ ] **Step 3: FileTree 递归修正（子组件 TreeNode.vue 复用同一逻辑）**

Create `web/src/components/TreeNode.vue`:
```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useProjects } from '../useProjects';
const props = defineProps<{ projectId: string | null; node: TreeNode }>();
const { tree } = useProjects();
interface TreeNode { name: string; type: 'file' | 'dir'; path: string; expanded: boolean; loading: boolean; children: TreeNode[]; }
const n = props.node;
async function toggle() {
  if (n.type !== 'dir') return;
  n.expanded = !n.expanded;
  if (n.expanded && n.children.length === 0) { n.loading = true; try { n.children = await tree(props.projectId || '', n.path); } finally { n.loading = false; } }
}
</script>
<template>
  <div>
    <div class="row" @click="toggle">
      <span class="tw">{{ n.type === 'dir' ? (n.expanded ? '▾' : '▸') : '' }}</span><span>{{ n.name }}</span>
    </div>
    <div v-if="n.expanded" class="indent">
      <TreeNode v-for="c in n.children" :key="c.path" :project-id="projectId" :node="c" />
    </div>
  </div>
</template>
```

同步简化 FileTree.vue：`nodes` 顶层用 TreeNode 渲染。子组件递归在 `<script setup>` 内自引用（Vue 3.3+ 支持 SFC 自引用，文件名为组件名）。

- [ ] **Step 4: SessionList.vue**

```vue
<script setup lang="ts">
import type { useTerminal } from '../useTerminal';
const props = defineProps<{ terminal: ReturnType<typeof useTerminal>; projectId: string | null }>();
const emit = defineEmits<{ (e: 'focus-terminal'): void }>();
async function create() {
  const name = window.prompt('新会话名称(可空)') || undefined;
  await props.terminal.createSession({ projectId: props.projectId, cols: 80, rows: 24 });
}
</script>

<template>
  <div class="sl">
    <div class="head">
      <span>会话</span>
      <button class="plus" @click="create">＋ 新建</button>
    </div>
    <div class="item" v-for="s in terminal.state.sessions" :key="s.id"
      :class="{ active: terminal.state.activeSessionId === s.id }" @click="terminal.switchTo(s.id)">
      <span class="dot" :class="s.state" />
      <span class="nm">{{ s.name }}</span>
      <span v-if="s.state === 'exited'" class="exited-tag">已退出</span>
      <span class="kill" @click.stop="terminal.killSession(s.id)">×</span>
    </div>
    <div v-if="terminal.state.sessions.length === 0" class="empty">暂无会话，点上方新建</div>
  </div>
</template>

<style scoped>
.sl { padding: 4px; display: flex; flex-direction: column; gap: 2px; }
.head { display: flex; justify-content: space-between; padding: 6px 8px; color: #9aa4b2; text-transform: uppercase; font-size: 11px; }
.plus { background: none; border: none; color: #4c9aff; cursor: pointer; }
.item { display: flex; align-items: center; gap: 6px; padding: 5px 8px; cursor: pointer; border-radius: 4px; color: #c8d0da; }
.item.active { background: #2f6feb; color: #fff; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dot.running { background: #22c55e; }
.dot.exited { background: #64748b; }
.nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.exited-tag { font-size: 10px; color: #eab308; }
.kill { color: transparent; padding: 0 3px; }
.item:hover .kill { color: #ff6b6b; }
</style>
```

- [ ] **Step 5: typecheck**

Run: `npm.cmd --prefix web run typecheck`
Expected: 无错

- [ ] **Step 6: 提交**

```bash
git add web/src/useProjects.ts web/src/components/FileTree.vue web/src/components/TreeNode.vue web/src/components/SessionList.vue
git commit -m "feat: 侧栏文件树与会话列表 + http 客户端"
```

---

## Task 17: WorkflowPanel（右上角下拉）

**Files:**
- Create: `web/src/components/WorkflowPanel.vue`

- [ ] **Step 1: WorkflowPanel.vue**

```vue
<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import type { useTerminal } from '../useTerminal';
import type { RunSnapshot, RunStep, WorkflowTemplate } from '@devflow/shared';
import { C2S, S2C } from '@devflow/shared';

const props = defineProps<{ terminal: ReturnType<typeof useTerminal> }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const workflows = ref<WorkflowTemplate[]>([]);
const run = ref<RunSnapshot | null>(null);
const busy = ref(false);
const unsubs: Array<() => void> = [];

function icon(s: RunStep['status']) {
  return { waiting: '·', running: '▶', manual: '⏸', done: '✓', error: '✕' }[s] || '·';
}

unsubs.push(
  props.terminal.on(S2C.WF_LIST_RESULT, (m: any) => { workflows.value = m.workflows; }),
  props.terminal.on(S2C.WF_STARTED, (m: any) => { run.value = m.run; }),
  props.terminal.on(S2C.WF_STATUS, (m: any) => { run.value = m.run; }),
  props.terminal.on(S2C.WF_FINISHED, () => { busy.value = false; }),
);
onBeforeUnmount(() => { unsubs.forEach((u) => u()); });
watch(() => props.terminal.state.status, (s) => { if (s === 'open') props.terminal.send(C2S.WF_LIST); });
onMounted(() => props.terminal.send(C2S.WF_LIST));

function activeSession() { return props.terminal.state.activeSessionId; }

async function runWf(w: WorkflowTemplate) {
  if (!activeSession()) { alert('请先新建/选中一个终端会话'); return; }
  busy.value = true;
  run.value = null;
  props.terminal.send(C2S.WF_RUN, { workflowId: w.id, sessionId: activeSession() });
}
function next() { if (run.value) props.terminal.send(C2S.WF_NEXT, { runId: run.value.runId }); }
function abort() { if (run.value) props.terminal.send(C2S.WF_ABORT, { runId: run.value.runId }); }
</script>

<template>
  <div class="panel">
    <div class="ph">⚡ Workflows <button class="x" @click="emit('close')">×</button></div>
    <div v-if="run" class="run">
      <div class="run-title">{{ run.workflowName }}
        <span class="tag" :class="run.status">{{ run.status }}</span>
        <button v-if="run.status === 'paused' || run.status === 'running'" class="btn primary" @click="next">下一步 ▶</button>
        <button v-if="run.status === 'paused' || run.status === 'running'" class="btn" @click="abort">中止</button>
      </div>
      <div v-for="(s, i) in run.steps" :key="s.id" class="step" :class="{ cur: i === run.currentIndex }">
        <span class="ic" :class="s.status">{{ icon(s.status) }}</span>
        <code>{{ s.cmd }}</code>
        <span v-if="s.hint" class="hint">{{ s.hint }}</span>
      </div>
    </div>
    <div v-else class="list">
      <div v-for="w in workflows" :key="w.id" class="wf" @click="runWf(w)">
        <b>{{ w.name }}</b>
        <span class="meta">{{ w.steps.length }} 步 · {{ w.steps.filter((x) => x.advance === 'auto').length }} 自动 / {{ w.steps.filter((x) => x.advance === 'manual').length }} 手动</span>
      </div>
      <div v-if="workflows.length === 0" class="empty">无模板（编辑 server/workflows.json）</div>
    </div>
    <div v-if="terminal.state.status !== 'open'" class="offline">连接已断开</div>
  </div>
</template>

<style scoped>
.panel { position: absolute; top: 42px; right: 8px; width: 380px; background: #1a1f27; border: 1px solid #2a323e; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,.5); z-index: 30; overflow: hidden; }
.ph { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #222932; color: #e6e9ef; }
.x { background: none; border: none; color: #8b96a5; cursor: pointer; font-size: 16px; }
.list, .run { padding: 8px; display: flex; flex-direction: column; gap: 6px; max-height: 60vh; overflow: auto; }
.wf { background: #141920; border: 1px solid #2a323e; border-radius: 6px; padding: 8px 10px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
.wf:hover { border-color: #4c9aff; }
.meta, .hint { color: #8b96a5; font-size: 11px; }
.run-title { display: flex; align-items: center; gap: 8px; font-weight: 600; flex-wrap: wrap; }
.tag { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: #2a323e; }
.tag.done { background: #14532d; color: #86efac; }
.tag.aborted { background: #7f1d1d; color: #fca5a5; }
.tag.running { background: #1e3a8a; color: #93c5fd; }
.tag.paused { background: #78350f; color: #fcd34d; }
.btn { background: #262c34; color: #c8d0da; border: none; border-radius: 4px; padding: 3px 10px; cursor: pointer; }
.btn.primary { background: #2f6feb; color: #fff; }
.step { display: flex; gap: 8px; align-items: baseline; padding: 5px 8px; border-radius: 4px; color: #c8d0da; }
.step.cur { background: #222932; }
.step code { white-space: pre-wrap; word-break: break-all; }
.ic { width: 16px; color: #8b96a5; }
.ic.done { color: #22c55e; }
.ic.error { color: #ef4444; }
.ic.manual { color: #fcd34d; }
.offline, .empty { color: #5b6472; padding: 8px 12px; }
</style>
```

- [ ] **Step 2: typecheck**

Run: `npm.cmd --prefix web run typecheck`
Expected: 无错

- [ ] **Step 3: 提交**

```bash
git add web/src/components/WorkflowPanel.vue
git commit -m "feat: WorkflowPanel 下拉面板（模板/运行/状态/下一步/中止）"
```

---

## Task 18: App.vue 完整布局 + 项目切换 + 生产验证 + README

**Files:**
- Rewrite: `web/src/App.vue`
- Create: `web/src/useProjects.ts` 已存在（Task 16）；新增活动栏
- Create: `README.md`

- [ ] **Step 1: 重写 App.vue**

```vue
<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useTerminal } from './useTerminal';
import { useProjects } from './useProjects';
import TerminalView from './components/TerminalView.vue';
import TerminalToolbar from './components/TerminalToolbar.vue';
import SessionList from './components/SessionList.vue';
import FileTree from './components/FileTree.vue';
import WorkflowPanel from './components/WorkflowPanel.vue';
import type { ProjectInfo } from '@devflow/shared';

const terminal = useTerminal({});
const projectsApi = useProjects();
const projects = ref<ProjectInfo[]>([]);
const currentProject = ref<string | null>(null);
const rail = ref<'explorer' | 'sessions'>('explorer');
const showWf = ref(false);

const projectName = computed(() => projects.value.find((p) => p.id === currentProject.value)?.name || '未选择项目');

async function loadProjects() {
  try { projects.value = await projectsApi.list(); } catch { projects.value = []; }
  if (!currentProject.value && projects.value.length) currentProject.value = projects.value[0].id;
}
function selectProject(id: string) { currentProject.value = id; }
onMounted(() => {
  loadProjects();
  terminal.connect();
});
</script>

<template>
  <div class="app">
    <header class="top">
      <span class="logo">◈ devflow</span>
      <span class="proj">{{ projectName }}</span>
      <select v-if="projects.length" v-model="currentProject" class="proj-sel" @change="(e:any) => selectProject(e.target.value)">
        <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <div class="spacer" />
      <span :class="['net', terminal.state.status]" v-if="terminal.state.status === 'reconnecting'">重连中…</span>
      <button class="wf-btn" @click="showWf = !showWf">⚡ Workflow ▾</button>
    </header>

    <div class="main">
      <aside class="activity">
        <button class="a-btn" :class="{ on: rail === 'explorer' }" title="目录" @click="rail = 'explorer'">▤</button>
        <button class="a-btn" :class="{ on: rail === 'sessions' }" title="会话" @click="rail = 'sessions'">▦</button>
      </aside>
      <aside class="side">
        <SessionList v-if="rail === 'sessions'" :terminal="terminal" :project-id="currentProject" />
        <FileTree v-else :project-id="currentProject" />
      </aside>
      <section class="center">
        <TerminalView :terminal="terminal" :project-id="currentProject" />
      </section>
    </div>

    <WorkflowPanel v-if="showWf" :terminal="terminal" @close="showWf = false" />
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; }
.top { display: flex; align-items: center; gap: 12px; height: 42px; padding: 0 12px; background: #1a2027; border-bottom: 1px solid #2a323e; flex: none; }
.logo { color: #6aa2ff; font-weight: 700; }
.proj { color: #9aa4b2; font-size: 12px; }
.proj-sel { background: #222932; color: #d5dae1; border: 1px solid #2a323e; border-radius: 4px; padding: 2px 6px; }
.spacer { flex: 1; }
.wf-btn { background: #2f6feb; color: #fff; border: none; border-radius: 4px; padding: 5px 12px; cursor: pointer; font-weight: 600; }
.net { color: #eab308; font-size: 12px; }
.main { flex: 1; display: flex; min-height: 0; }
.activity { width: 40px; background: #161b21; border-right: 1px solid #2a323e; display: flex; flex-direction: column; align-items: center; padding-top: 6px; gap: 2px; flex: none; }
.a-btn { background: none; border: none; color: #6b7686; font-size: 17px; width: 34px; height: 30px; cursor: pointer; border-left: 2px solid transparent; }
.a-btn.on { color: #fff; border-left-color: #2f6feb; }
.side { width: 240px; background: #1a2027; border-right: 1px solid #2a323e; overflow: auto; flex: none; }
.center { flex: 1; min-width: 0; }
</style>
```

- [ ] **Step 2: 构建前端并让 server 静态托管（手动冒烟，重点验证“零 CDN”）**

Run: `npm.cmd --prefix web run build`
Run: `node server/index.js`，浏览器打开 `http://127.0.0.1:3001/`：
- DevTools → Network：除 `127.0.0.1` 外无任何外部域名请求（无 CDN）。
- 页面出现完整布局：顶栏/活动栏/目录树/终端区，会话列表可新建会话，Workflow 面板可列出模板。
- 新建会话后键入 `echo hello` 有输出；断网（关 server）终端显示重连提示，重启 server 后自动恢复缓冲。

- [ ] **Step 3: README.md**

```markdown
# 网页版 opencode（devflow-web-terminal）

Web 通用终端 + 多会话管理 + 多项目目录树 + Workflow（命令编排模板注入当前会话）。
基于 Node `http.createServer` + `ws` + `node-pty` 与 Vue3/xterm。

## 结构
- `shared/` — WS 协议常量与类型（前后端唯一事实源）
- `server/` — Node 后端（ESM）：会话常驻、环形缓冲重放、项目/目录树、Workflow 执行器
- `web/`   — Vue3 + Vite + TypeScript + @xterm/xterm（零 CDN）

## 快速开始
```bash
npm install            # 根目录 workspaces
npm run dev:server     # 后端 :3001（首次运行自动生成 projects.json / workflows.json）
npm run dev:web        # 前端 Vite :5173（代理 /api 与 /ws）
# 打开 http://localhost:5173
```

生产模式：
```bash
npm run build:web
node server/index.js   # 访问 http://127.0.0.1:3001
```

## 配置
- 项目根：编辑 `server/projects.json`（或设 `DEVFLOW_PROJECTS`）新增 `{ id, name, root }`。
- Workflow 模板：编辑 `server/workflows.json`（或设 `DEVFLOW_WORKFLOWS`）。step: `advance: "auto"`（命令后自动注入不可见 OSC 标记，跑完自动下一步）或 `"manual"`（注入后需在面板点“下一步”）。

## 会话语义
- 会话在服务端常驻；网页关闭/断网不影响运行。
- 断线重连后自动 `start` 重放缓冲，屏幕内容恢复。
- `stop` 解绑（进程保留），`kill` 结束进程并销毁。

## 测试
```bash
npm test               # server(node:test) + web(vitest)
npm run typecheck
```

## 安全提示
服务可在浏览器执行任意 shell 命令。v1 暂未做认证，仅建议绑定 `127.0.0.1`/内网；公网访问务必加反代鉴权（代码已预留 `requireAuthHttp`/`requireAuthWs` 钩子）。
```

- [ ] **Step 4: 提交**

```bash
git add web/src/App.vue README.md
git commit -m "feat: 完整 App 布局 + 项目切换 + README"
```

---

## Task 19: 最终验证 + 收尾

**Files:**
- Modify: 视回归结果微调

- [ ] **Step 1: 全部后端测试**

Run: `node --test server/test/`
Expected: 全部 pass

- [ ] **Step 2: 全部前端单测 + typecheck**

Run: `npm.cmd --prefix web run test`
Expected: 全部 pass
Run: `npm.cmd --prefix web run typecheck`
Expected: 无错

- [ ] **Step 3: 根脚本校验**

Run: `npm.cmd test`
Expected: server + web 均通过

- [ ] **Step 4: 端到端手动冒烟（一次性）**

1. `node server/index.js`
2. 浏览器开 `http://127.0.0.1:3001/`
3. 目录树展开项目；右上新建会话并 `echo hi`；切到 Workflow 面板运行示例 deploy 模板，确认 auto 步自动推进、manual 步出现「下一步」
4. 杀掉 server 再重启，浏览器显示重连并恢复缓冲画面
5. DevTools Network 确认无外部域请求（零 CDN 达标）

- [ ] **Step 5: 收尾提交**

```bash
git add -A
git commit -m "chore: v0.1 实现完成（server + web + shared）"
```

---

## 自审记录（对照 spec）

**覆盖对照**
- spec §3 架构 → Task 1/7/8/12 组合模块。
- spec §4 协议 + §15.3 `ws.data={sessionId:null}` → Task 8 实现 + 测试。
- spec §5/§6 attach/detach、唯一 onData 扇出、§15.4 → Task 7 + Task 8（`setActive`、socket close 后无写入用例）。
- spec §7 三层防崩溃、§15.5 → Task 8 末用例 + Task 12 uncaughtException。
- spec §8 环形缓冲/重放 → Task 3 + Task 8 replay 用例。
- spec §9 项目/目录树 + 越界 403 → Task 6/9。
- spec §10 workflow 语义 + OSC 标记 → Task 10/11（含跨 chunk 分片匹配）。
- spec §11 认证占位 → Task 9 requireAuthHttp、Task 12 requireAuthWs。
- spec §12 前端布局/重连 → Task 14（重连）/15/16/17/18。
- spec §15.1（http.createServer + ws，不用 bun.server）、§15.2（零 CDN）→ Task 12 + Task 13/18 验证。
- spec §14 测试策略 → Task 3~11 server 单测/集成、Task 14 vitest。

**类型/接口一致性复查**
- `session` 摘要统一经 `SessionManager.summary()` 输出，协议/UI/测试字段名一致（id/name/projectId/state/cwd/cols/rows/exitCode）。
- `PseudoPty` 接口在 pty-runner/fake-pty/session-manager 三处签名一致（onData/onExit/write/resize/kill/shell/pid）。
- workflow `Run.snapshot()` 字段与 WorkflowPanel 消费一致（含 status 枚举、currentIndex、steps.status）。
- `C2S/S2C` 常量唯一引用 shared，无第二份字符串表。

---

## Review 附录（2026-09-08 内联适配版 autoplan review 已应用）

完整审查记录见 `docs/superpowers/reviews/2026-09-08-autoplan-inline-review.md`。审查发现并已修复的问题：

1. **Windows 标记 bug（关键）**：PowerShell 5.1 不解析 `"\u001b"`（实测为 6 字符字面量），原 win 分支永远打不出 ESC。已改用 `[char]27` 拼接并加测试断言。→ Task 5。
2. **conpty OSC 透传风险**：conhost 可能吞掉未知 OSC，导致 Windows 本地 auto 步等不到标记。已加 Task 2 Step 3b 探针；若失败列为已知限制（UI「下一步」强推兜底），Linux 部署不受影响。
3. **会话 cwd 未跟随项目 root**：原来 create 传 projectId 只做名字，cwd 恒为 process.cwd()，违反 spec §9。已加 `projectResolver` 注入 + 用例。→ Task 7/12。
4. **kill 会话不通知 WorkflowRunner**：kill 走 manager `removed` 事件而非 `exit`，原来 workflow 会永远卡 running。已监听 `removed` + 用例。→ Task 10。
5. **刷新页面会话重复生成**：页面每次刷新都新建终端（本地 active 丢失），服务端会话其实常驻。改为「list 为空才自动建第一个」，并让 composable 对 `session-list/created` 也 emit。→ Task 14/15。
6. **`ws.data.sessionId` 未同步**：Conn 只同步 conn.sessionId，spec §15.3 要求 `ws.data` 同步。改为 getter/setter 直通 `ws.data.sessionId`。→ Task 8。
7. **node-pty 版本**：锁 `^1.1.0`（带 `prebuild.js || node-gyp rebuild`，减少本机编译概率）。→ Task 2。
