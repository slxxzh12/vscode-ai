# opencode 自动下载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户把默认 agent 选为 opencode 时，服务端自动从其平台配置的 Gitee 地址下载 `opencode.exe` 到 `<应用目录>/opencode/`（存在即跳过），前端设置面板显示下载状态。

**Architecture:** `devflow.xml` 新增 `<opencode url-<platform>-<arch>="…">`；`server/opencode-download.js` 提供可注入、可单测的异步下载器（流式下载 zip → yauzl 解出 `opencode.exe` → 临时文件 rename）；`server/opencode-mount.js` 暴露 `/api/opencode/status` 与 `/api/opencode/download`；`POST /api/agents/default` 设置成功后顺带触发；前端 `TerminalView.vue` 轮询状态并显示进度/失败重试。

**Tech Stack:** Node ESM（`node:stream`、全局 `fetch`）、`yauzl`、Vue 3 + Vitest、`node --test`。

设计依据：`docs/superpowers/specs/2026-09-18-opencode-auto-download-design.md`

---

### Task 1: 下载器模块（`server/opencode-download.js`）+ `yauzl` 依赖

**Files:**
- Create: `server/opencode-download.js`
- Create: `server/test/opencode-download.test.js`
- Modify: `server/package.json`（新增依赖）
- Modify: `package-lock.json`（npm install 生成）

- [ ] **Step 1: 安装 zip 依赖**

Run: `npm.cmd install yauzl -w @devflow/server`
Expected: `server/package.json` 的 `dependencies` 出现 `"yauzl"`；命令退出码 0。

- [ ] **Step 2: 写失败测试 `server/test/opencode-download.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOpencodeDownloader, platformKey, DEFAULT_OPENCODE_URLS } from '../opencode-download.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ocdl-')); }
function streamOf(buf) {
  return new ReadableStream({ start(c) { c.enqueue(new Uint8Array(buf)); c.close(); } });
}
function fakeFetch(buf, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, headers: new Map([['content-length', String(buf.length)]]), body: streamOf(buf) });
}
const OPTS = (appDir, over = {}) => ({
  appDir, platform: 'win32-x64', urls: () => ({ 'win32-x64': 'http://x/oc.zip' }),
  unzip: async (_z, _e, out) => { fs.writeFileSync(out, 'EXE'); }, ...over,
});

test('platformKey 组合平台与架构', () => {
  assert.equal(platformKey('win32', 'x64'), 'win32-x64');
  assert.equal(platformKey('darwin', 'arm64'), 'darwin-arm64');
});

test('DEFAULT_OPENCODE_URLS 含 win32-x64 默认地址', () => {
  assert.match(DEFAULT_OPENCODE_URLS['win32-x64'], /opencode-windows-x64\.zip$/);
});

test('目标已存在：跳过，state=done 且不发起 fetch', async () => {
  const appDir = tmpDir();
  fs.mkdirSync(path.join(appDir, 'opencode'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'opencode', 'opencode.exe'), 'x');
  let calls = 0;
  const d = createOpencodeDownloader(OPTS(appDir, { fetchFn: async () => { calls += 1; throw new Error('no'); } }));
  assert.equal(d.start().state, 'done');
  await d.whenSettled();
  assert.equal(calls, 0);
});

test('平台无地址：state=unavailable', () => {
  const d = createOpencodeDownloader({ appDir: tmpDir(), platform: 'linux-x64', urls: () => ({}) });
  assert.equal(d.start().state, 'unavailable');
});

test('成功：流式落盘 opencode.exe、state=done、onDone 回调、清理临时文件', async () => {
  const appDir = tmpDir();
  const zip = Buffer.from('ZIPDATA');
  let done = 0;
  const d = createOpencodeDownloader(OPTS(appDir, { fetchFn: fakeFetch(zip), onDone: () => { done += 1; } }));
  assert.equal(d.start().state, 'downloading');
  await d.whenSettled();
  const s = d.status();
  assert.equal(s.state, 'done');
  assert.equal(s.downloaded, zip.length);
  assert.equal(s.total, zip.length);
  assert.equal(fs.readFileSync(path.join(appDir, 'opencode', 'opencode.exe'), 'utf8'), 'EXE');
  const files = fs.readdirSync(path.join(appDir, 'opencode'));
  assert.equal(files.some((f) => f.endsWith('.zip') || f.endsWith('.tmp')), false);
  assert.equal(done, 1);
});

test('fetch 非 2xx：state=error 且不写目标文件', async () => {
  const appDir = tmpDir();
  const d = createOpencodeDownloader(OPTS(appDir, { fetchFn: async () => ({ ok: false, status: 500, headers: new Map(), body: null }) }));
  d.start();
  await d.whenSettled();
  const s = d.status();
  assert.equal(s.state, 'error');
  assert.match(s.message, /500/);
  assert.equal(fs.existsSync(path.join(appDir, 'opencode', 'opencode.exe')), false);
});

test('解压失败：state=error 且清理临时文件', async () => {
  const appDir = tmpDir();
  const d = createOpencodeDownloader(OPTS(appDir, {
    fetchFn: fakeFetch(Buffer.from('ZIP')), unzip: async () => { throw new Error('bad-zip'); },
  }));
  d.start();
  await d.whenSettled();
  assert.equal(d.status().state, 'error');
  assert.match(d.status().message, /bad-zip/);
  assert.equal(fs.existsSync(path.join(appDir, 'opencode', 'opencode.exe')), false);
});

test('并发 start：只发起一次 fetch', async () => {
  const appDir = tmpDir();
  let calls = 0;
  const d = createOpencodeDownloader(OPTS(appDir, {
    fetchFn: async () => { calls += 1; await new Promise((r) => setTimeout(r, 10)); return fakeFetch(Buffer.from('Z'))(); },
  }));
  d.start(); d.start();
  await d.whenSettled();
  assert.equal(calls, 1);
  assert.equal(d.status().state, 'done');
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `node --test server/test/opencode-download.test.js`
Expected: FAIL —— `Cannot find module '../opencode-download.js'`。

- [ ] **Step 4: 实现 `server/opencode-download.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';

// 默认下载源：按 `<platform>-<arch>` 给 opencode 压缩包地址（包内单个 opencode.exe）
export const DEFAULT_OPENCODE_URLS = {
  'win32-x64': 'https://gitee.com/wglj/devflow/releases/download/v20260918/opencode-windows-x64.zip',
};

export function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

// 从 zip 解出单个条目到 outPath（yauzl 流式，避免把 ~180MB 读进内存）
export function unzipEntry(zipPath, entryName, outPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      let found = false;
      zip.on('error', reject);
      zip.on('end', () => { if (!found) reject(new Error('entry-not-found')); });
      zip.on('entry', (entry) => {
        if (path.basename(entry.fileName) !== entryName) { zip.readEntry(); return; }
        found = true;
        zip.openReadStream(entry, (e, rs) => {
          if (e) return reject(e);
          pipeline(rs, fs.createWriteStream(outPath)).then(resolve, reject);
        });
      });
      zip.readEntry();
    });
  });
}

// appDir 下的 opencode 下载器：存在即跳过 → 流式下载 zip → 解压 opencode.exe → 原子 rename。
// 返回 { start, status, whenSettled }；start 幂等、异步，status 可随时读。
export function createOpencodeDownloader({
  appDir,
  platform = platformKey(),
  urls = () => DEFAULT_OPENCODE_URLS,
  fetchFn = fetch,
  unzip = unzipEntry,
  onDone = null,
  logger = console,
} = {}) {
  const dir = path.join(appDir, 'opencode');
  const target = path.join(dir, 'opencode.exe');
  const tmpExe = `${target}.tmp`;
  const tmpZip = path.join(dir, `.opencode-download-${process.pid}.zip`);

  let state = { state: 'idle', platform, url: '', downloaded: 0, total: 0, message: '' };
  let current = null;

  const urlOf = () => String((urls() || {})[platform] || '');
  const set = (patch) => { state = { ...state, ...patch }; };
  const cleanup = () => {
    try { fs.rmSync(tmpZip, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(tmpExe, { force: true }); } catch { /* ignore */ }
  };

  async function run(url) {
    set({ state: 'downloading', url, downloaded: 0, total: 0, message: '' });
    try {
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ total: Number(res.headers.get('content-length')) || 0 });
      fs.mkdirSync(dir, { recursive: true });
      const counter = new Transform({
        transform(chunk, _enc, cb) { set({ downloaded: state.downloaded + chunk.length }); cb(null, chunk); },
      });
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmpZip));
      await unzip(tmpZip, 'opencode.exe', tmpExe);
      fs.renameSync(tmpExe, target);
      cleanup();
      set({ state: 'done', message: '' });
      try { onDone?.(); } catch (e) { logger?.warn?.('opencode onDone failed', (e && e.message) || e); }
    } catch (e) {
      cleanup();
      set({ state: 'error', message: String((e && e.message) || e) });
    } finally {
      current = null;
    }
  }

  function start() {
    if (current) return status();                        // 已有任务在跑：幂等
    if (fs.existsSync(target)) { set({ state: 'done', url: '', downloaded: 0, total: 0, message: '' }); return status(); }
    const url = urlOf();
    if (!url) { set({ state: 'unavailable', url: '', downloaded: 0, total: 0, message: '' }); return status(); }
    current = run(url);
    return status();
  }

  function status() { return { ...state }; }
  function whenSettled() { return current || Promise.resolve(); }

  return { start, status, whenSettled };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test server/test/opencode-download.test.js`
Expected: PASS（8 个测试全绿）。

- [ ] **Step 6: 提交**

```bash
git add server/opencode-download.js server/test/opencode-download.test.js server/package.json package-lock.json
git commit -m "feat(server): 新增 opencode 下载器（yauzl 流式解压 opencode.exe）"
```

---

### Task 2: 配置解析 `<opencode>`（`devflow-config.js` + 模板）

**Files:**
- Modify: `server/devflow-config.js`
- Modify: `config/devflow.xml`
- Test: `server/test/devflow-config.test.js`

- [ ] **Step 1: 写失败测试（追加到 `server/test/devflow-config.test.js` 末尾）**

在文件顶部 import 补 `DEFAULT_OPENCODE_URLS`：

```js
import { DEFAULT_OPENCODE_URLS } from '../opencode-download.js';
```

文件末尾追加：

```js
test('parseDevflowConfig 解析 <opencode> 平台地址并缺省回退默认', () => {
  const c = parseDevflowConfig('<devflow><opencode url-win32-x64="http://a/1.zip" url-darwin-arm64="http://a/2.zip" /></devflow>');
  assert.equal(c.opencode.urls['win32-x64'], 'http://a/1.zip');
  assert.equal(c.opencode.urls['darwin-arm64'], 'http://a/2.zip');
  const d = parseDevflowConfig('<devflow></devflow>');
  assert.equal(d.opencode.urls['win32-x64'], DEFAULT_OPENCODE_URLS['win32-x64']);
});

test('serialize → parse 保留 opencode 平台地址', () => {
  const cfg = buildDefaultConfig();
  const back = parseDevflowConfig(serializeDevflowConfig(cfg));
  assert.deepEqual(back.opencode.urls, cfg.opencode.urls);
});

test('updateWorkflows 保留 opencode 平台地址', () => {
  const f = tmpFile();
  fs.writeFileSync(f, serializeDevflowConfig(buildDefaultConfig()), 'utf8');
  updateWorkflows(f, validateWorkflows([]), null);
  assert.match(fs.readFileSync(f, 'utf8'), /<opencode /);
  assert.deepEqual(loadDevflowConfig(f).opencode.urls, DEFAULT_OPENCODE_URLS);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/test/devflow-config.test.js`
Expected: FAIL —— `c.opencode` 为 `undefined`。

- [ ] **Step 3: 实现解析/序列化**

`server/devflow-config.js` 顶部 import 区新增：

```js
import { DEFAULT_OPENCODE_URLS } from './opencode-download.js';
```

`buildDefaultConfig()` 的返回对象加入 `opencode`：

```js
export function buildDefaultConfig() {
  return {
    server: { language: DEFAULT_LOCALE, host: '127.0.0.1' },
    agents: { default: DEFAULT_AGENT, list: DEFAULT_AGENTS.map((a) => ({ ...a })), chosen: false },
    opencode: { urls: { ...DEFAULT_OPENCODE_URLS } },
    workflows: fallbackWorkflows(),
  };
}
```

`parseDevflowConfig` 在 `const workflows = parseWorkflowXml(text);` 之前插入：

```js
  const opencodeTag = (text.match(/<opencode\b([^>]*?)\/?>/i) || [])[1] || '';
  const urls = { ...defaults.opencode.urls };
  const urlRe = /url-([a-z0-9_-]+)\s*=\s*"([^"]*)"/gi;
  let um;
  while ((um = urlRe.exec(opencodeTag))) {
    const val = decode(um[2]).trim();
    if (val) urls[um[1].toLowerCase()] = val;
  }
```

`parseDevflowConfig` 返回值加入：

```js
    opencode: { urls },
```

`serializeDevflowConfig` 在 `const wfs = ...` 之前加：

```js
  const opencodeAttrs = Object.entries(cfg.opencode?.urls || {})
    .map(([k, v]) => `url-${k}="${escXml(v)}"`).join(' ');
  const opencodeBlock = opencodeAttrs ? `  <opencode ${opencodeAttrs} />\n\n` : '';
```

模板中 `<server … />` 与其后的空行之后、`<agents …>` 之前插入 `${opencodeBlock}`：

```js
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- DevFlow 统一配置：server（端口/语言）+ agents（默认 Agent 列表）+ opencode（下载源）+ workflows（工作流/提示语） -->
<devflow>
  <server language="${escXml(cfg.server.language)}" host="${escXml(cfg.server.host || '127.0.0.1')}" />

${opencodeBlock}  <agents default="${escXml(cfg.agents.default)}"${cfg.agents.chosen ? ' chosen="1"' : ''}>
${agents}
  </agents>

  <workflows>
${wfs}
  </workflows>
</devflow>
`;
```

`updateWorkflows` 的 serialize 调用补 `opencode`：

```js
  fs.writeFileSync(file, serializeDevflowConfig({ server: cur.server, agents: cur.agents, opencode: cur.opencode, workflows: list }), 'utf8');
```

- [ ] **Step 4: 更新模板 `config/devflow.xml`**

在 `<server … />` 行下方（`agents` 注释之前）插入：

```xml
  <!-- opencode 自动下载源：选 opencode 为默认 agent 时按平台拉取该压缩包解出 opencode.exe。
       属性名 url-<platform>-<arch>；未列出的平台不下载。 -->
  <opencode url-win32-x64="https://gitee.com/wglj/devflow/releases/download/v20260918/opencode-windows-x64.zip" />

```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test server/test/devflow-config.test.js`
Expected: PASS（含新增 3 个用例）。

- [ ] **Step 6: 提交**

```bash
git add server/devflow-config.js config/devflow.xml server/test/devflow-config.test.js
git commit -m "feat(config): devflow.xml 支持按平台配置 opencode 下载源"
```

---

### Task 3: HTTP 端点 + 服务端接入

**Files:**
- Create: `server/opencode-mount.js`
- Modify: `server/index.js`

- [ ] **Step 1: 创建 `server/opencode-mount.js`**

```js
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// /api/opencode/*：查询下载状态、手动触发（前端失败后重试）
export function createOpencodeMount({ downloader }) {
  async function route(req, res, url) {
    const seg = url.pathname.replace(/^\/api\/opencode\/?/, '').split('/').filter(Boolean);
    if (seg[0] === 'status' && seg.length === 1 && req.method === 'GET') return sendJson(res, 200, downloader.status());
    if (seg[0] === 'download' && seg.length === 1 && req.method === 'POST') return sendJson(res, 200, downloader.start());
    return sendJson(res, 404, { error: 'not-found' });
  }
  return { route };
}
```

- [ ] **Step 2: 接入 `server/index.js`**

顶部 import 区新增：

```js
import { createOpencodeDownloader } from './opencode-download.js';
import { createOpencodeMount } from './opencode-mount.js';
```

在 `const translateMount = createTranslateMount({ … });` 之后、`return { … }` 之前加入：

```js
  const opencodeDownloader = createOpencodeDownloader({
    appDir: APP_DIR,
    urls: () => (loadDevflowConfig(configFile).opencode || {}).urls || {},
    onDone: () => { ensureAgentOnPath(defaultAgent().cmd); },   // 本进程 PATH 也立刻命中包内 opencode
    logger: log,
  });
  const opencodeMount = createOpencodeMount({ downloader: opencodeDownloader });
```

`return { … }` 对象里补 `opencodeMount`：

```js
  return { projects, saveProjects, workflows, sessionManager, workflowRunner, engine, collabMount, usageMount, usageReporter, scheduler, httpApi, llmMount, translateMount, opencodeMount, llmVault, usageStore, taskStore, sessionLedger, historyFile: paths.historyFile, paths, restoreSessionById };
```

`/api/agents/default` 处理器：把成功分支的 `res.end(JSON.stringify({ ok: true, default: r.default }));` 替换为：

```js
        const download = (String(body.id) === 'opencode') ? opencodeDownloader.start() : null;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, default: r.default, ...(download ? { download } : {}) }));
```

路由分发处（`if (url.pathname.startsWith('/api/usage/')) …` 之前）新增：

```js
  if (url.pathname.startsWith('/api/opencode')) { await ws.opencodeMount.route(req, res, url); return; }
```

- [ ] **Step 3: 冒烟验证（临时数据目录，避免污染本机）**

Run（PowerShell）：
```powershell
$env:DEVFLOW_PORT='33333'; $env:DEVFLOW_DATA_HOME="$env:TEMP\df-oc-smoke"
Start-Process -FilePath node -ArgumentList 'server/index.js' -RedirectStandardOutput "$env:TEMP\df-oc.log" -RedirectStandardError "$env:TEMP\df-oc.err" -WindowStyle Hidden
Start-Sleep -Seconds 3
Invoke-RestMethod "http://127.0.0.1:33333/api/opencode/status" | ConvertTo-Json -Compress
```
Expected: 返回 `{"state":"idle","platform":"win32-x64",...}`；`Get-Content "$env:TEMP\df-oc.err"` 无 import 错误。验证后结束该进程（`Get-Process node | Stop-Process` 仅限本冒烟进程，谨慎操作）。

- [ ] **Step 4: 提交**

```bash
git add server/opencode-mount.js server/index.js
git commit -m "feat(server): 选择 opencode 默认 agent 时触发下载并暴露状态接口"
```

---

### Task 4: 前端状态模块 + i18n 词条

**Files:**
- Create: `web/src/opencodeDownload.ts`
- Create: `web/src/opencodeDownload.test.ts`
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 写失败测试 `web/src/opencodeDownload.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { percent, fetchOpencodeStatus, startOpencodeDownload } from './opencodeDownload';

const base = { state: 'downloading' as const, platform: 'win32-x64', url: '', downloaded: 0, total: 0, message: '' };

describe('opencodeDownload', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('percent：无 total 返回 0，正常取整，封顶 100', () => {
    expect(percent(base)).toBe(0);
    expect(percent({ ...base, downloaded: 50, total: 100 })).toBe(50);
    expect(percent({ ...base, downloaded: 200, total: 100 })).toBe(100);
  });

  it('fetchOpencodeStatus：非 2xx 返回 null，正常返回对象', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await fetchOpencodeStatus()).toBeNull();
    const payload = { ...base, state: 'done' as const, total: 1, downloaded: 1 };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })));
    expect(await fetchOpencodeStatus()).toEqual(payload);
  });

  it('startOpencodeDownload：POST /api/opencode/download', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ ...base }) }));
    vi.stubGlobal('fetch', f);
    expect(await startOpencodeDownload()).toEqual({ ...base });
    expect(f).toHaveBeenCalledWith('/api/opencode/download', { method: 'POST' });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- src/opencodeDownload.test.ts`
Expected: FAIL —— 无法解析 `./opencodeDownload`。

- [ ] **Step 3: 实现 `web/src/opencodeDownload.ts`**

```ts
// opencode 自动下载：客户端只读状态、按需重试；实际下载由服务端执行
export type OpencodeState = 'idle' | 'downloading' | 'done' | 'error' | 'unavailable';

export interface OpencodeStatus {
  state: OpencodeState;
  platform: string;
  url: string;
  downloaded: number;
  total: number;
  message: string;
}

export function percent(s: OpencodeStatus): number {
  if (!s || !s.total || s.downloaded <= 0) return 0;
  return Math.min(100, Math.floor((s.downloaded / s.total) * 100));
}

export async function fetchOpencodeStatus(): Promise<OpencodeStatus | null> {
  try {
    const r = await fetch('/api/opencode/status');
    if (!r.ok) return null;
    return (await r.json()) as OpencodeStatus;
  } catch { return null; }
}

export async function startOpencodeDownload(): Promise<OpencodeStatus | null> {
  try {
    const r = await fetch('/api/opencode/download', { method: 'POST' });
    if (!r.ok) return null;
    return (await r.json()) as OpencodeStatus;
  } catch { return null; }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- src/opencodeDownload.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 补 i18n 词条**

`shared/i18n/zh-CN.js` 在 `'term.agent_set_default_failed'` 行后插入：

```js
  'term.opencode.downloading': 'opencode 下载中…（{p}%）',
  'term.opencode.done': 'opencode 已就绪',
  'term.opencode.failed': 'opencode 下载失败：{msg}',
  'term.opencode.retry': '重试',
  'term.opencode.unavailable': '该平台暂无 opencode 下载包，请手动安装',
```

`shared/i18n/en.js` 在对应 `'term.agent_set_default_failed'` 行后插入：

```js
  'term.opencode.downloading': 'Downloading opencode… ({p}%)',
  'term.opencode.done': 'opencode is ready',
  'term.opencode.failed': 'opencode download failed: {msg}',
  'term.opencode.retry': 'Retry',
  'term.opencode.unavailable': 'No opencode download is available for this platform; install it manually',
```

- [ ] **Step 6: 校验词条对称并提交**

Run: `npm.cmd run check:i18n`
Expected: 通过（中英键集合对称，无缺失）。

```bash
git add web/src/opencodeDownload.ts web/src/opencodeDownload.test.ts shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(web): opencode 下载状态模块与中英词条"
```

---

### Task 5: TerminalView 设置面板显示下载状态并轮询

**Files:**
- Modify: `web/src/components/TerminalView.vue`

- [ ] **Step 1: 引入模块与新增状态**

顶部 import 区（`import { setTabDescription } from './tabDescriptions';` 之后）加：

```ts
import { fetchOpencodeStatus, startOpencodeDownload, percent, type OpencodeStatus } from '../opencodeDownload';
```

在 `const agentSecRef = ref<HTMLElement | null>(null);`（约 `:267`）之后加：

```ts
const opencodeStatus = ref<OpencodeStatus | null>(null);
let opencodePoll: number | null = null;
function stopOpencodePoll() { if (opencodePoll != null) { clearInterval(opencodePoll); opencodePoll = null; } }
function startOpencodePoll() {
  stopOpencodePoll();
  opencodePoll = window.setInterval(async () => {
    const s = await fetchOpencodeStatus();
    if (s) opencodeStatus.value = s;
    if (!s || s.state !== 'downloading') stopOpencodePoll();
  }, 1000);
}
async function refreshOpencodeStatus() {
  const s = await fetchOpencodeStatus();
  if (!s) return;
  opencodeStatus.value = s;
  if (s.state === 'downloading') startOpencodePoll();
}
async function retryOpencodeDownload() {
  const s = await startOpencodeDownload();
  if (!s) return;
  opencodeStatus.value = s;
  if (s.state === 'downloading') startOpencodePoll();
}
```

- [ ] **Step 2: 打开设置时刷新、关闭时停轮询、卸载时停轮询**

`onOpenSettings` 内 `loadSettings();` 后加：

```ts
  void refreshOpencodeStatus();
```

`watch(settingsOpen, …)` 的关闭分支加 `stopOpencodePoll();`：

```ts
watch(settingsOpen, (open, was) => {
  if (was && !open) {
    firstRunHint.value = false;
    stopOpencodePoll();
    window.dispatchEvent(new Event('df-settings-closed'));
  }
});
```

`onBeforeUnmount` 内加（`if (renameHintTimer) …` 附近）：

```ts
  stopOpencodePoll();
```

- [ ] **Step 3: 选择默认 agent 后接住下载状态**

`setDefaultAgent` 改为：

```ts
async function setDefaultAgent(id: string) {
  agentId.value = id;                    // 本机当前项目即时生效
  try {
    const res = await fetch('/api/agents/default', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    firstRunHint.value = false;
    if (id === 'opencode' && data?.download) {
      opencodeStatus.value = data.download as OpencodeStatus;
      if ((data.download as OpencodeStatus).state === 'downloading') startOpencodePoll();
    }
  } catch (e: any) {
    alert(t('term.agent_set_default_failed', { msg: e?.message || e }));
  }
}
```

- [ ] **Step 4: 模板加状态行**

在 `<div v-if="firstRunHint" class="cfghint warn">{{ $t('term.agent_first_run_hint') }}</div>` 之后插入：

```html
            <div v-if="opencodeStatus && opencodeStatus.state !== 'idle'" class="cfghint" :class="{ warn: opencodeStatus.state === 'error' }">
              <template v-if="opencodeStatus.state === 'downloading'">{{ $t('term.opencode.downloading', { p: percent(opencodeStatus) }) }}</template>
              <template v-else-if="opencodeStatus.state === 'done'">{{ $t('term.opencode.done') }}</template>
              <template v-else-if="opencodeStatus.state === 'unavailable'">{{ $t('term.opencode.unavailable') }}</template>
              <template v-else-if="opencodeStatus.state === 'error'">
                {{ $t('term.opencode.failed', { msg: opencodeStatus.message }) }}
                <button class="ghostcfg" @click="retryOpencodeDownload">{{ $t('term.opencode.retry') }}</button>
              </template>
            </div>
```

- [ ] **Step 5: 类型检查与前端测试**

Run: `npm.cmd run typecheck`
Expected: PASS（无 TS 报错）。

Run: `npm.cmd --prefix web run test -- src/opencodeDownload.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add web/src/components/TerminalView.vue
git commit -m "feat(web): 设置面板显示 opencode 下载进度并支持重试"
```

---

### Task 6: 忽略产物、文档同步、整体验证

**Files:**
- Modify: `.gitignore`
- Modify: `AGENTS.md`

- [ ] **Step 1: `.gitignore` 忽略运行时下载的 opencode**

在 `# 协作子系统运行时数据…` 段后追加：

```
# 选择 opencode 默认 agent 时自动下载的产物（禁止入库）
opencode/
```

- [ ] **Step 2: 同步 `AGENTS.md` 配置说明与目录速览**

在「配置（端口 + XML）」节、描述活动配置文件内容的那条（`活动配置文件：<dataHome>/ports/<端口>/downloads/devflow.xml（只含 <server language host> + <agents> + <workflows>）；…`）改为包含 `<opencode>`，并补一句：

```markdown
- 活动配置文件：`<dataHome>/ports/<端口>/downloads/devflow.xml`（含 `<server language host>` + `<agents>` + `<opencode url-<platform>-<arch>>` + `<workflows>`）；首次启动从仓库模板 `config/devflow.xml` 复制生成，**已存在则不覆盖**。`<opencode>` 按平台给 opencode 自动下载地址（选 opencode 为默认 agent 时服务端据此拉取并解出 `opencode.exe` 到 `<应用目录>/opencode/`，已存在即跳过）；缺失时用内置默认（`win32-x64`）。
```

在「目录速览」`server/` 相关行补一句模块说明：

```markdown
- opencode 自动下载：`server/opencode-download.js`（下载器）+ `server/opencode-mount.js`（`/api/opencode/*`）；下载源在 `devflow.xml` 的 `<opencode>`。
```

- [ ] **Step 3: 全量验证**

Run: `npm.cmd test`
Expected: server（`node --test`）与 web（vitest）全部 PASS。

Run: `npm.cmd run typecheck`
Expected: PASS。

Run: `npm.cmd run check:i18n`
Expected: PASS。

- [ ] **Step 4: 手工验收（dev）**

1. 删除 `<应用目录>/opencode/opencode.exe`（若存在）。
2. 启动服务后打开设置面板，把默认 agent 设为 opencode。
3. 面板出现「opencode 下载中…（NN%）」，约 58MB 下完后变「opencode 已就绪」；`<仓库根>/opencode/opencode.exe` 生成。
4. 再次设为 opencode（或刷新后重开设置面板）→ 直接显示已就绪，不重复下载。
5. 断网/改成错误 URL（临时改 `devflow.xml`）→ 显示「下载失败」且有「重试」按钮。
6. 「该平台暂无 opencode 下载包」：把 `<opencode>` 删掉且平台非 win32-x64 时出现（可临时把属性名改成别的平台验证）。

- [ ] **Step 5: 提交**

```bash
git add .gitignore AGENTS.md
git commit -m "docs(config): 记录 opencode 自动下载配置与忽略产物"
```

---

## Self-Review

- **Spec coverage：** 决策 1（落点 `APP_DIR/opencode`）→ Task 1/3；决策 2（存在即跳过）→ Task 1 `start()`；决策 3/4（平台配置 + URL）→ Task 2；决策 5（无平台提示）→ Task 1 `unavailable` + Task 5 UI；决策 6（异步 + 轮询）→ Task 3/4/5；决策 7（yauzl）→ Task 1；决策 8（临时文件 rename、不冒烟）→ Task 1；决策 9（先写默认 + 失败重试）→ Task 3/5。测试与非目标均有对应任务。
- **Placeholder scan：** 无 TBD/TODO；所有代码步骤给出完整代码与命令。
- **Type consistency：** `OpencodeStatus`/`percent`/`fetchOpencodeStatus`/`startOpencodeDownload` 在 Task 4 定义、Task 5 使用；下载器返回 `{ state, platform, url, downloaded, total, message }` 与前端类型字段一致；`createOpencodeDownloader` 选项 `urls/fetchFn/unzip/onDone` 在 Task 1 定义、Task 3 以 `appDir/urls/onDone/logger` 使用，一致。
