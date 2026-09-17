# 手机遥控（remote_coder 手机界面）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本仓库约定：**inline（本会话）执行**，不要用 subagent。

**Goal:** 顶栏 `📷` 换成 `📱`，新标签页打开 `/?phone=1` 手机页（只有 opencode 画面图片 + 输入框）；手机点「截图」时桌面端截终端图覆盖写 `remote_coder/screen.png` 并 commit+push；手机发的文字写入 `remote_coder/messages.jsonc` 并送进桌面当前活动会话。

**Architecture:** 服务端新增两个模块——`remote-coder-store.js`（纯文件逻辑：JSONC 收发、PNG 覆盖写、git 提交）与 `remote-coder-mount.js`（6 个 `/api/remote-coder/*` 端点，挂进现有 `http-api.js`）。前端新增 `web/src/remote-coder/`：手机页 `PhoneView.vue`、手机侧 API `useRemoteCoder.ts`、桌面侧轮询 `useDesktopRemoteCoder.ts`；桌面与终端之间用现有 `window` 自定义事件（`df-remote-send` / `df-remote-screen`）解耦。**不用 WS**：桌面端每 2s 拉 `/inbox`，天然兼容「外部直接改 jsonc 文件」的兜底通道。

**Tech Stack:** Node ESM + `node:test`（server）、Vue 3 + Vite + vitest + `@vue/test-utils`（web）、Element Plus（已装）、`html-to-image`（已装，复用 `web/src/snapshot.ts`）。

**Spec:** `docs/superpowers/specs/2026-09-17-remote-coder-phone-design.md`

**环境提醒（本机）：** 一律 `npm.cmd`；server 测试 `npm.cmd run test:server`（= `node --test "server/test/*.test.js"`）；web 测试 `npm.cmd --prefix web run test`；类型 `npm.cmd run typecheck`；i18n `npm.cmd run check:i18n`。

---

## File Structure

**Create**
- `server/remote-coder-store.js` — 目录/文件读写、JSONC 解析、PNG 解码、git 提交（git 可注入）
- `server/remote-coder-mount.js` — `/api/remote-coder/*` 端点（不依赖 http-api 内部实现，只吃注入的 helper）
- `server/test/remote-coder-store.test.js`
- `server/test/remote-coder-mount.test.js`
- `web/src/remote-coder/entry.ts` — `isPhoneEntry(search)` 纯函数（决定挂载哪个根组件）
- `web/src/remote-coder/entry.test.ts`
- `web/src/remote-coder/useRemoteCoder.ts` — 手机侧 HTTP 客户端（fetch 可注入）
- `web/src/remote-coder/useRemoteCoder.test.ts`
- `web/src/remote-coder/useDesktopRemoteCoder.ts` — 桌面侧 2s 轮询 + 事件派发 + ack
- `web/src/remote-coder/useDesktopRemoteCoder.test.ts`
- `web/src/remote-coder/PhoneView.vue` — 手机页（图片 + 输入框）
- `web/src/remote-coder/PhoneView.test.ts`

**Modify**
- `server/http-api.js` — 挂 `remote-coder-mount`；删除 `/api/snapshot` 路由与 `saveSnapshotFn` 依赖
- `server/index.js` — 传 `remoteCoder` 依赖（可选，默认自动创建）
- `shared/i18n/zh-CN.js`、`shared/i18n/en.js` — 新增 `top.remote` / `remote.*`，删除 `top.snapshot*`
- `web/src/main.ts` — `?phone=1` 时挂 `PhoneView`
- `web/src/App.vue` — `📷`→`📱`、`onPhone()`、启动桌面轮询、删除快照逻辑与 `.snap-*` 样式
- `web/src/components/TerminalView.vue` — 监听 `df-remote-send` / `df-remote-screen`
- `web/src/snapshot.ts` — 删除 `uploadSnapshot` 与 `SnapshotResult`/`UploadDeps`（只保留捕获）
- `web/src/snapshot.test.ts` — 删除 `uploadSnapshot` 用例
- `web/src/components/HistoryList.vue` 等无关文件**不动**

**Delete**
- `server/snapshot-store.js`、`server/test/snapshot-store.test.js`
- `server/test/http-api.test.js` 中 `/api/snapshot` 用例（只删这一段）

---

## Task 1: 服务端 store（`remote-coder-store.js`）

**Files:**
- Create: `server/remote-coder-store.js`
- Create: `server/test/remote-coder-store.test.js`

- [ ] **Step 1: 写失败测试**

`server/test/remote-coder-store.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  REMOTE_DIR, SCREEN_FILE, MESSAGES_FILE, dirOf, decodePng, parseJsonc,
  readMessages, writeMessages, newId, makeEntry, appendMessage, inbox, markHandled,
  saveScreen, screenRev, commitScreen,
} from '../remote-coder-store.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-rc-')); }
const png = (s) => `data:image/png;base64,${Buffer.from(s).toString('base64')}`;

test('decodePng 接受合法 dataURL，拒绝非 PNG 或空', () => {
  const bytes = Buffer.from([137, 80, 78, 71]);
  assert.deepEqual(decodePng(`data:image/png;base64,${bytes.toString('base64')}`), bytes);
  for (const bad of ['data:image/jpeg;base64,AAAA', 'data:image/png;base64,', '', null, 123]) {
    assert.throws(() => decodePng(bad), (e) => e.code === 'bad-image');
  }
});

test('parseJsonc 支持 // 行注释；坏 JSON 抛错', () => {
  assert.deepEqual(parseJsonc('[\n  // c\n  {"a":1}\n]'), [{ a: 1 }]);
  assert.throws(() => parseJsonc('{ nope'), (e) => e instanceof SyntaxError);
});

test('makeEntry：消息必须有非空 text；截图无 text；都带 id/ts/handled', () => {
  const now = 1758000000000;
  const rand = () => 0.5;
  const m = makeEntry({ kind: 'message', text: '  继续  ' }, now, rand);
  assert.deepEqual(m, { id: 'm-1758000000000-8000', ts: now, kind: 'message', text: '继续', handled: false });
  const c = makeEntry({ kind: 'screenshot' }, now, rand);
  assert.deepEqual(c, { id: 'c-1758000000000-8000', ts: now, kind: 'screenshot', handled: false });
  assert.throws(() => makeEntry({ kind: 'message', text: '   ' }, now, rand), (e) => e.code === 'bad-message');
  assert.throws(() => makeEntry({ kind: 'message', text: 'x'.repeat(40000) }, now, rand), (e) => e.code === 'too-large');
});

test('newId 前缀按 kind 区分且随机段 4 位', () => {
  assert.match(newId('screenshot', 1, () => 0), /^c-1-0000$/);
  assert.match(newId('message', 1, () => 0.999), /^m-1-fff./);
});

test('append/inbox/markHandled：只回未处理条目，处理后入库', () => {
  const dir = dirOf(tmp());
  assert.deepEqual(inbox(dir), []);                       // 文件不存在 = 空
  const a = appendMessage(dir, makeEntry({ kind: 'message', text: 'a' }, 1, () => 0));
  appendMessage(dir, makeEntry({ kind: 'screenshot' }, 2, () => 0));
  assert.equal(readMessages(dir).length, 2);
  assert.equal(inbox(dir).length, 2);
  assert.equal(markHandled(dir, [a.id]), 1);
  assert.deepEqual(inbox(dir).map((x) => x.kind), ['screenshot']);
  assert.equal(markHandled(dir, [a.id]), 0);              // 幂等
  const raw = fs.readFileSync(path.join(dir, MESSAGES_FILE), 'utf8');
  assert.ok(raw.includes('"handled": true'));
});

test('坏 messages.jsonc：读抛 bad-jsonc，且不会被覆盖', () => {
  const dir = path.join(tmp(), REMOTE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, MESSAGES_FILE);
  fs.writeFileSync(file, '{ nope');
  assert.throws(() => readMessages(dir), (e) => e.code === 'bad-jsonc');
  assert.equal(fs.readFileSync(file, 'utf8'), '{ nope');
  assert.throws(() => appendMessage(dir, makeEntry({ kind: 'screenshot' }, 1, () => 0)), (e) => e.code === 'bad-jsonc');
});

test('saveScreen 反复写同一文件：目录里只有一个 png，内容为最后一次，rev 会变', async () => {
  const root = tmp();
  const dir = dirOf(root);
  const r1 = saveScreen(dir, png('first'));
  assert.ok(r1.bytes > 0);
  assert.equal(screenRev(dir), r1.rev);
  await new Promise((r) => setTimeout(r, 12));
  const r2 = saveScreen(dir, png('second'));
  assert.deepEqual(fs.readdirSync(dir), [SCREEN_FILE]);
  assert.equal(fs.readFileSync(path.join(dir, SCREEN_FILE), 'utf8'), 'second');
  assert.notEqual(r2.rev, r1.rev);
  fs.rmSync(root, { recursive: true, force: true });
});

test('commitScreen：非 git 返回 not-a-repo 且不调 git', async () => {
  const root = tmp();
  let called = 0;
  const r = await commitScreen(root, { git: async () => { called += 1; }, isGitRepoFn: () => false });
  assert.deepEqual(r, { uploaded: false, reason: 'not-a-repo' });
  assert.equal(called, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('commitScreen：依次 add/commit/push；失败标 git-failed', async () => {
  const root = tmp();
  const calls = [];
  const ok = await commitScreen(root, { isGitRepoFn: () => true, git: async (repo, args) => { calls.push(args); return ''; } });
  assert.deepEqual(ok, { uploaded: true, reason: '' });
  assert.deepEqual(calls, [
    ['add', '--', `${REMOTE_DIR}/${SCREEN_FILE}`],
    ['commit', '-m', `snapshot(remote): ${SCREEN_FILE}`, '--', `${REMOTE_DIR}/${SCREEN_FILE}`],
    ['push', 'origin', 'HEAD'],
  ]);
  const bad = await commitScreen(root, { isGitRepoFn: () => true, git: async () => { const e = new Error('rejected'); e.code = 'git-failed'; throw e; } });
  assert.deepEqual(bad, { uploaded: false, reason: 'git-failed' });
  fs.rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd run test:server`
Expected: FAIL（`Cannot find module '../remote-coder-store.js'`）

- [ ] **Step 3: 实现 `server/remote-coder-store.js`**

```js
// remote_coder 目录的文件层：messages.jsonc 收发、screen.png 覆盖写、git 提交。
// 只做文件与 git，不认识 HTTP；git 可注入以便单测。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const REMOTE_DIR = 'remote_coder';
export const SCREEN_FILE = 'screen.png';
export const MESSAGES_FILE = 'messages.jsonc';
const PNG_PREFIX = 'data:image/png;base64,';
const MAX_TEXT_BYTES = 32 * 1024;

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

export function dirOf(root) {
  return path.join(root, REMOTE_DIR);
}

export function decodePng(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_PREFIX)) {
    throw err('bad-image', 'expected data:image/png;base64 URL');
  }
  const buf = Buffer.from(dataUrl.slice(PNG_PREFIX.length), 'base64');
  if (!buf.length) throw err('bad-image', 'empty image');
  return buf;
}

// JSONC：仅支持整行 `//` 注释（机器写出的就是纯 JSON）
export function parseJsonc(text) {
  return JSON.parse(String(text || '').replace(/^[ \t]*\/\/.*$/gm, ''));
}

export function readMessages(dir) {
  const file = path.join(dir, MESSAGES_FILE);
  if (!fs.existsSync(file)) return [];
  let parsed;
  try {
    parsed = parseJsonc(fs.readFileSync(file, 'utf8'));
  } catch {
    throw err('bad-jsonc', 'messages.jsonc is not valid jsonc');
  }
  if (!Array.isArray(parsed)) throw err('bad-jsonc', 'messages.jsonc must be an array');
  return parsed;
}

export function writeMessages(dir, list) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, MESSAGES_FILE);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

export function newId(kind, now = Date.now(), rand = Math.random) {
  const prefix = kind === 'screenshot' ? 'c' : 'm';
  const suffix = Math.floor(rand() * 0x10000).toString(16).padStart(4, '0');
  return `${prefix}-${now}-${suffix}`;
}

export function makeEntry(input, now = Date.now(), rand = Math.random) {
  const kind = input && input.kind === 'screenshot' ? 'screenshot' : 'message';
  const text = kind === 'message' ? String((input && input.text) ?? '').trim() : '';
  if (kind === 'message' && !text) throw err('bad-message', 'text is required');
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw err('too-large', 'text too large');
  const entry = { id: newId(kind, now, rand), ts: now, kind, handled: false };
  if (text) entry.text = text;
  return entry;
}

export function appendMessage(dir, entry) {
  const list = readMessages(dir);
  list.push(entry);
  writeMessages(dir, list);
  return entry;
}

export function inbox(dir) {
  return readMessages(dir).filter((m) => m && m.handled !== true);
}

export function markHandled(dir, ids) {
  const set = new Set((Array.isArray(ids) ? ids : []).map(String));
  if (!set.size) return 0;
  const list = readMessages(dir);
  let changed = 0;
  for (const m of list) {
    if (m && set.has(String(m.id)) && m.handled !== true) { m.handled = true; changed += 1; }
  }
  if (changed) writeMessages(dir, list);
  return changed;
}

export function screenRev(dir) {
  try {
    const st = fs.statSync(path.join(dir, SCREEN_FILE));
    return `${st.mtimeMs}-${st.size}`;
  } catch {
    return '';
  }
}

export function saveScreen(dir, dataUrl) {
  const buf = decodePng(dataUrl);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, SCREEN_FILE), buf);
  return { bytes: buf.length, rev: screenRev(dir) };
}

export function isGitRepo(root) {
  return fs.existsSync(path.join(root, '.git'));
}

function defaultGit(repo, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120 * 1000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') { reject(err('git-unavailable', 'git not found in PATH')); return; }
        reject(err('git-failed', String(stderr || error.message).trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function commitScreen(root, { git = defaultGit, isGitRepoFn = isGitRepo } = {}) {
  const rel = `${REMOTE_DIR}/${SCREEN_FILE}`;
  if (!isGitRepoFn(root)) return { uploaded: false, reason: 'not-a-repo' };
  try {
    await git(root, ['add', '--', rel]);
    await git(root, ['commit', '-m', `snapshot(remote): ${SCREEN_FILE}`, '--', rel]);
    await git(root, ['push', 'origin', 'HEAD']);
    return { uploaded: true, reason: '' };
  } catch (e) {
    return { uploaded: false, reason: e && e.code === 'git-unavailable' ? 'git-unavailable' : 'git-failed' };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd run test:server`
Expected: 新增 8 个用例全 PASS（含既有用例）

- [ ] **Step 5: 提交**

```powershell
git add server/remote-coder-store.js server/test/remote-coder-store.test.js
git commit -m "feat(server): remote_coder 文件层（jsonc 收发/覆盖写 screen.png/提交）"
```

---

## Task 2: 服务端端点（`remote-coder-mount.js`）并移除旧 `/api/snapshot`

**Files:**
- Create: `server/remote-coder-mount.js`
- Create: `server/test/remote-coder-mount.test.js`
- Modify: `server/http-api.js`（import、依赖项、路由、删除 `/api/snapshot`、错误映射）
- Modify: `server/test/http-api.test.js`（删 `/api/snapshot` 用例）
- Delete: `server/snapshot-store.js`、`server/test/snapshot-store.test.js`

- [ ] **Step 1: 写失败测试**

`server/test/remote-coder-mount.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Projects } from '../projects.js';
import { createHttpApi } from '../http-api.js';
import { SCREEN_FILE } from '../remote-coder-store.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfrc-')); }

function req(server, url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, type: res.headers['content-type'] || '', buf, text: buf.toString('utf8') });
      });
    });
    r.on('error', reject);
    if (data) r.end(data); else r.end();
  });
}

async function start(repoRoot, deps = {}) {
  const server = http.createServer(createHttpApi({ projects: new Projects({ projects: [] }), repoRoot, ...deps }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}
const json = (r) => JSON.parse(r.text);
const png = (s) => `data:image/png;base64,${Buffer.from(s).toString('base64')}`;

test('message 端点：截图命令与文本消息入库，文本为空 400', async (t) => {
  const root = tmpDir();
  const server = await start(root, { remoteCoderGit: async () => '' });
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const shot = json(await req(server, '/api/remote-coder/message', { method: 'POST', body: { kind: 'screenshot' } }));
  assert.equal(shot.ok, true);
  assert.match(shot.id, /^c-/);
  const msg = json(await req(server, '/api/remote-coder/message', { method: 'POST', body: { text: '继续' } }));
  assert.match(msg.id, /^m-/);
  assert.equal((await req(server, '/api/remote-coder/message', { method: 'POST', body: { text: '  ' } })).status, 400);

  const list = json(await req(server, '/api/remote-coder/inbox'));
  assert.deepEqual(list.entries.map((e) => e.kind), ['screenshot', 'message']);
  assert.equal(list.entries[1].text, '继续');
});

test('ack 端点：处理后 inbox 变空', async (t) => {
  const root = tmpDir();
  const server = await start(root, { remoteCoderGit: async () => '' });
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const a = json(await req(server, '/api/remote-coder/message', { method: 'POST', body: { kind: 'screenshot' } }));
  const r = json(await req(server, '/api/remote-coder/ack', { method: 'POST', body: { ids: [a.id] } }));
  assert.deepEqual(r, { ok: true, changed: 1 });
  assert.deepEqual(json(await req(server, '/api/remote-coder/inbox')).entries, []);
});

test('screen 端点：写盘 + commit；state/screen.png 可读；无图 404', async (t) => {
  const root = tmpDir();
  const calls = [];
  const server = await start(root, { remoteCoderGit: async (repo, args) => { calls.push(args); return ''; }, remoteCoderIsGitRepo: () => true });
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });

  assert.equal((await req(server, '/api/remote-coder/screen.png')).status, 404);
  assert.deepEqual(json(await req(server, '/api/remote-coder/state')), { rev: '' });

  const r = json(await req(server, '/api/remote-coder/screen', { method: 'POST', body: { dataUrl: png('ONE') } }));
  assert.equal(r.ok, true);
  assert.equal(r.uploaded, true);
  assert.equal(r.reason, '');
  assert.ok(r.rev);
  assert.equal(fs.readFileSync(path.join(root, 'remote_coder', SCREEN_FILE), 'utf8'), 'ONE');
  assert.deepEqual(calls[1], ['commit', '-m', `snapshot(remote): ${SCREEN_FILE}`, '--', `remote_coder/${SCREEN_FILE}`]);

  const img = await req(server, '/api/remote-coder/screen.png');
  assert.equal(img.status, 200);
  assert.equal(img.type, 'image/png');
  assert.equal(img.buf.toString('utf8'), 'ONE');
  assert.equal(json(await req(server, '/api/remote-coder/state')).rev, r.rev);

  const second = json(await req(server, '/api/remote-coder/screen', { method: 'POST', body: { dataUrl: png('TWO') } }));
  assert.equal(fs.readdirSync(path.join(root, 'remote_coder')).filter((f) => f.endsWith('.png')).length, 1);
  assert.notEqual(second.rev, r.rev);
});

test('screen 端点：坏图 400；非 git 只回 reason 仍 200', async (t) => {
  const root = tmpDir();
  const server = await start(root);
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  assert.equal((await req(server, '/api/remote-coder/screen', { method: 'POST', body: { dataUrl: 'data:image/jpeg;base64,AAAA' } })).status, 400);
  const r = json(await req(server, '/api/remote-coder/screen', { method: 'POST', body: { dataUrl: png('X') } }));
  assert.equal(r.ok, true);
  assert.equal(r.uploaded, false);
  assert.equal(r.reason, 'not-a-repo');
});

test('旧 /api/snapshot 已移除（404）', async (t) => {
  const root = tmpDir();
  const server = await start(root);
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  assert.equal((await req(server, '/api/snapshot', { method: 'POST', body: { dataUrl: png('X') } })).status, 404);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd run test:server`
Expected: FAIL（`Cannot find module '../remote-coder-mount.js'`；且 `/api/snapshot` 仍返回 200）

- [ ] **Step 3: 实现 `server/remote-coder-mount.js`**

```js
// /api/remote-coder/* 端点：手机发命令/消息，桌面端取件与回执。文件与 git 全在 store 里。
import fs from 'node:fs';
import path from 'node:path';
import * as defaultStore from './remote-coder-store.js';

const PREFIX = '/api/remote-coder';

export function createRemoteCoder({ repoRoot, logger = console, store = defaultStore, git, isGitRepoFn } = {}) {
  const dir = store.dirOf(repoRoot);
  return async function handle({ pathname, req, res, sendJson, readJsonBody }) {
    if (!pathname.startsWith(PREFIX)) return false;
    const send400 = (code) => sendJson(res, 400, { error: code });
    try {
      if (pathname === `${PREFIX}/inbox` && req.method === 'GET') {
        sendJson(res, 200, { entries: store.inbox(dir) });
        return true;
      }
      if (pathname === `${PREFIX}/state` && req.method === 'GET') {
        sendJson(res, 200, { rev: store.screenRev(dir) });
        return true;
      }
      if (pathname === `${PREFIX}/message` && req.method === 'POST') {
        const body = await readJsonBody(req);
        const entry = store.makeEntry(body);
        store.appendMessage(dir, entry);
        sendJson(res, 200, { ok: true, id: entry.id });
        return true;
      }
      if (pathname === `${PREFIX}/ack` && req.method === 'POST') {
        const body = await readJsonBody(req);
        sendJson(res, 200, { ok: true, changed: store.markHandled(dir, body.ids) });
        return true;
      }
      if (pathname === `${PREFIX}/screen.png` && req.method === 'GET') {
        const file = path.join(dir, store.SCREEN_FILE);
        if (!fs.existsSync(file)) { sendJson(res, 404, { error: 'no-screen' }); return true; }
        const size = fs.statSync(file).size;
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': size, 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res);
        return true;
      }
      if (pathname === `${PREFIX}/screen` && req.method === 'POST') {
        const body = await readJsonBody(req, 32 * 1024 * 1024);
        const saved = store.saveScreen(dir, body.dataUrl);
        const commit = await store.commitScreen(repoRoot, { git, isGitRepoFn });
        logger?.info?.('remote-coder: screen saved', saved.bytes, commit.uploaded ? '(pushed)' : `(${commit.reason || 'local'})`);
        sendJson(res, 200, { ok: true, rev: saved.rev, uploaded: commit.uploaded, reason: commit.reason });
        return true;
      }
      send400('bad-request');
      return true;
    } catch (err) {
      if (err.code === 'bad-image' || err.code === 'bad-message' || err.code === 'bad-jsonc') { sendJson(res, 400, { error: err.code, message: String(err.message) }); return true; }
      if (err.code === 'too-large') { sendJson(res, 413, { error: 'too-large' }); return true; }
      sendJson(res, 500, { error: 'internal', message: String((err && err.message) || err) });
      return true;
    }
  };
}
```

- [ ] **Step 4: 接进 `server/http-api.js`**

删掉 `import { saveSnapshotToRepo } from './snapshot-store.js';`，加：

```js
import { createRemoteCoder } from './remote-coder-mount.js';
```

`createHttpApi` 参数里删掉 `saveSnapshotFn = saveSnapshotToRepo`，加 `remoteCoder = null`、`remoteCoderGit = undefined`、`remoteCoderIsGitRepo = undefined`；函数体开头（`sendJson` 之前）加：

```js
  const remoteCoderFn = remoteCoder || createRemoteCoder({ repoRoot, logger, git: remoteCoderGit, isGitRepoFn: remoteCoderIsGitRepo });
```

删掉 `/api/snapshot` 那段 `if`（原 221–228 行），并在 try 块末尾（`if (url.pathname === '/api/export/zip' ...)` 之后、`} catch (err) {` 之前）加：

```js
      if (await remoteCoderFn({ pathname: url.pathname, req, res, sendJson, readJsonBody })) return;
```

- [ ] **Step 5: 删旧文件与旧用例**

- 删除 `server/snapshot-store.js`、`server/test/snapshot-store.test.js`
- `server/test/http-api.test.js`：删除 `/api/snapshot 写入保存并返回200...` 那个 `test(...)` 整块（原约 613–625 行），并确认文件顶部没有残留的 `saveSnapshotFn` 注入用法

- [ ] **Step 6: 跑测试确认通过**

Run: `npm.cmd run test:server`
Expected: 全 PASS（新 5 个 remote-coder 用例 + 既有用例，无 snapshot 用例）

- [ ] **Step 7: 提交**

```powershell
git add server/remote-coder-mount.js server/test/remote-coder-mount.test.js server/http-api.js server/test/http-api.test.js
git rm server/snapshot-store.js server/test/snapshot-store.test.js
git commit -m "feat(server): /api/remote-coder 端点，移除旧 /api/snapshot 与 snapshot-store"
```

---

## Task 3: 桌面侧轮询 `useDesktopRemoteCoder.ts`

**Files:**
- Create: `web/src/remote-coder/useDesktopRemoteCoder.ts`
- Create: `web/src/remote-coder/useDesktopRemoteCoder.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { startDesktopRemoteCoder } from './useDesktopRemoteCoder';

type Call = { url: string; init?: RequestInit };

function mkFetch(responses: unknown[]) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = responses.shift() ?? { entries: [] };
    return { ok: true, status: 200, json: async () => body };
  });
  return { fetchFn, calls };
}

function tick(ms = 0) { return new Promise((r) => setTimeout(r, ms)); }

describe('startDesktopRemoteCoder', () => {
  it('拉 inbox → 先 ack，再按 kind 派发事件', async () => {
    const { fetchFn, calls } = mkFetch([
      { entries: [{ id: 'm1', kind: 'message', text: '继续' }, { id: 'c1', kind: 'screenshot' }] },
    ]);
    const events: Array<{ name: string; detail?: any }> = [];
    const stop = startDesktopRemoteCoder({
      fetch: fetchFn as any,
      visibility: () => 'visible',
      dispatch: (name, detail) => events.push({ name, detail }),
      intervalMs: 5,
    });
    await tick(20);
    stop();
    expect(calls[0].url).toBe('/api/remote-coder/inbox');
    const ack = calls.find((c) => c.url === '/api/remote-coder/ack');
    expect(JSON.parse(String(ack?.init?.body))).toEqual({ ids: ['m1', 'c1'] });
    expect(events).toEqual([
      { name: 'df-remote-send', detail: { text: '继续' } },
      { name: 'df-remote-screen', detail: undefined },
    ]);
  });

  it('页面不可见时不请求也不 ack', async () => {
    const { fetchFn, calls } = mkFetch([]);
    const stop = startDesktopRemoteCoder({ fetch: fetchFn as any, visibility: () => 'hidden', dispatch: () => {}, intervalMs: 5 });
    await tick(20);
    stop();
    expect(calls).toHaveLength(0);
  });

  it('空 inbox 只拉取，不 ack', async () => {
    const { fetchFn, calls } = mkFetch([{ entries: [] }, { entries: [] }]);
    const stop = startDesktopRemoteCoder({ fetch: fetchFn as any, visibility: () => 'visible', dispatch: () => {}, intervalMs: 5 });
    await tick(20);
    stop();
    expect(calls.every((c) => c.url === '/api/remote-coder/inbox')).toBe(true);
  });

  it('请求失败不抛出，下一轮继续', async () => {
    let n = 0;
    const fetchFn = vi.fn(async () => { n += 1; if (n === 1) throw new Error('boom'); return { ok: true, status: 200, json: async () => ({ entries: [] }) }; });
    const stop = startDesktopRemoteCoder({ fetch: fetchFn as any, visibility: () => 'visible', dispatch: () => {}, intervalMs: 5 });
    await tick(25);
    stop();
    expect(fetchFn.mock.calls.length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- useDesktopRemoteCoder`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `useDesktopRemoteCoder.ts`**

```ts
// 桌面端每 2s 取件：拿到即 ack（避免下一轮重复），再按 kind 派发窗口事件给 TerminalView。
export interface RemoteEntry { id: string; kind: 'screenshot' | 'message'; text?: string }

export interface DesktopRemoteDeps {
  fetch: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;
  visibility: () => string;
  dispatch: (name: string, detail?: unknown) => void;
  intervalMs?: number;
  now?: () => number;
}

const defaultDeps = (): Omit<DesktopRemoteDeps, 'intervalMs' | 'now'> => ({
  fetch: (url, init) => fetch(url, init),
  visibility: () => (typeof document === 'undefined' ? 'visible' : document.visibilityState),
  dispatch: (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail })),
});

export function mediaState(): 'visible' | 'hidden' {
  return typeof document === 'undefined' || document.visibilityState === 'visible' ? 'visible' : 'hidden';
}

export function startDesktopRemoteCoder(depsIn: Partial<DesktopRemoteDeps> = {}): () => void {
  const deps = { ...defaultDeps(), ...depsIn } as DesktopRemoteDeps;
  const intervalMs = deps.intervalMs ?? 2000;
  let stopped = false;
  let running = false;

  async function tickOnce() {
    if (stopped || running) return;
    if (deps.visibility() !== 'visible') return;   // 不可见不认领，等可见后补处理
    running = true;
    try {
      const res = await deps.fetch('/api/remote-coder/inbox');
      const data = await res.json().catch(() => ({}));
      const entries: RemoteEntry[] = Array.isArray(data?.entries) ? data.entries : [];
      if (!entries.length) return;
      await deps.fetch('/api/remote-coder/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: entries.map((e) => e.id) }),
      }).catch(() => {});
      for (const e of entries) {
        if (e.kind === 'screenshot') deps.dispatch('df-remote-screen');
        else if (e.kind === 'message' && e.text) deps.dispatch('df-remote-send', { text: e.text });
      }
    } catch {
      /* 网络抖动：下一轮再试 */
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => { void tickOnce(); }, intervalMs);
  void tickOnce();
  return () => { stopped = true; clearInterval(timer); };
}
```

（`mediaState` 不需要，删掉它——上面的最终版只有 `startDesktopRemoteCoder` 导出。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- useDesktopRemoteCoder`
Expected: PASS（4 个用例）

- [ ] **Step 5: 提交**

```powershell
git add web/src/remote-coder/useDesktopRemoteCoder.ts web/src/remote-coder/useDesktopRemoteCoder.test.ts
git commit -m "feat(web): 桌面端 remote-coder 取件轮询（ack + 事件派发）"
```

---

## Task 4: 手机侧客户端 `useRemoteCoder.ts`

**Files:**
- Create: `web/src/remote-coder/useRemoteCoder.ts`
- Create: `web/src/remote-coder/useRemoteCoder.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest';
import { requestShot, fetchScreenRev, sendRemoteMessage, waitForNewScreen, screenUrl } from './useRemoteCoder';

function mkFetch(body: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const b = typeof body === 'function' ? (body as any)(calls.length) : body;
    return { ok: true, status: 200, json: async () => b };
  });
  return { fetchFn, calls };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('useRemoteCoder', () => {
  it('requestShot 发截图命令', async () => {
    const { fetchFn, calls } = mkFetch({ ok: true });
    await requestShot({ fetch: fetchFn as any });
    expect(calls[0].url).toBe('/api/remote-coder/message');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ kind: 'screenshot' });
  });

  it('sendRemoteMessage 发文本消息，失败抛错', async () => {
    const { fetchFn, calls } = mkFetch({ ok: true });
    await sendRemoteMessage('继续', { fetch: fetchFn as any });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ kind: 'message', text: '继续' });

    const bad = mkFetch({});
    bad.fetchFn.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({ message: 'boom' }) }));
    await expect(sendRemoteMessage('x', { fetch: bad.fetchFn as any })).rejects.toThrow('boom');
  });

  it('fetchScreenRev 取版本号，缺字段返回空串', async () => {
    const { fetchFn } = mkFetch({ rev: 'r1' });
    expect(await fetchScreenRev({ fetch: fetchFn as any })).toBe('r1');
    const empty = mkFetch({});
    expect(await fetchScreenRev({ fetch: empty.fetchFn as any })).toBe('');
  });

  it('waitForNewScreen：rev 变化即返回；超时返回 null', async () => {
    const { fetchFn } = mkFetch((n) => (n <= 1 ? { rev: 'r1' } : { rev: 'r2' }));
    expect(await waitForNewScreen('r1', { fetch: fetchFn as any, timeoutMs: 300, intervalMs: 5 })).toEqual({ rev: 'r2' });

    const stuck = mkFetch({ rev: 'r1' });
    expect(await waitForNewScreen('r1', { fetch: stuck.fetchFn as any, timeoutMs: 60, intervalMs: 5 })).toBeNull();
  });

  it('screenUrl 带 rev', () => {
    expect(screenUrl('r1')).toBe('/api/remote-coder/screen.png?v=r1');
    expect(screenUrl('')).toBe('/api/remote-coder/screen.png?v=');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- useRemoteCoder`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `useRemoteCoder.ts`**

```ts
// 手机侧 HTTP 客户端：请求截图、发消息、取图版本、等待新图。fetch 可注入以便单测。
export interface FetchLike {
  (url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;
}
export interface RemoteDeps { fetch: FetchLike }

const realFetch: FetchLike = (url, init) => fetch(url, init);

async function postJson(path: string, body: unknown, deps: RemoteDeps): Promise<any> {
  const res = await deps.fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  return data;
}

export async function requestShot(deps: RemoteDeps = { fetch: realFetch }): Promise<void> {
  await postJson('/api/remote-coder/message', { kind: 'screenshot' }, deps);
}

export async function sendRemoteMessage(text: string, deps: RemoteDeps = { fetch: realFetch }): Promise<void> {
  await postJson('/api/remote-coder/message', { kind: 'message', text }, deps);
}

export async function fetchScreenRev(deps: RemoteDeps = { fetch: realFetch }): Promise<string> {
  try {
    const res = await deps.fetch('/api/remote-coder/state');
    const data = await res.json().catch(() => ({}));
    return typeof data?.rev === 'string' ? data.rev : '';
  } catch {
    return '';
  }
}

export function screenUrl(rev: string): string {
  return `/api/remote-coder/screen.png?v=${encodeURIComponent(rev)}`;
}

export interface WaitOptions extends Partial<RemoteDeps> {
  timeoutMs?: number;
  intervalMs?: number;
}

export async function waitForNewScreen(prevRev: string, opts: WaitOptions = {}): Promise<{ rev: string } | null> {
  const deps: RemoteDeps = { fetch: opts.fetch ?? realFetch };
  const timeoutMs = opts.timeoutMs ?? 15000;
  const intervalMs = opts.intervalMs ?? 2000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rev = await fetchScreenRev(deps);
    if (rev && rev !== prevRev) return { rev };
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- useRemoteCoder`
Expected: PASS（5 个用例）

- [ ] **Step 5: 提交**

```powershell
git add web/src/remote-coder/useRemoteCoder.ts web/src/remote-coder/useRemoteCoder.test.ts
git commit -m "feat(web): 手机侧 remote-coder HTTP 客户端"
```

---

## Task 5: 手机页 `PhoneView.vue`

**Files:**
- Create: `web/src/remote-coder/PhoneView.vue`
- Create: `web/src/remote-coder/PhoneView.test.ts`
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`（先补 `remote.*`，本任务用到）

- [ ] **Step 1: 加 i18n 词条**

`shared/i18n/zh-CN.js` 增加（放在 `top.*` 附近，或文件末尾按现有分组）：

```js
  'top.remote': '手机遥控',
  'remote.title': '手机遥控',
  'remote.shot': '截图',
  'remote.shot_pending': '等待桌面端响应…',
  'remote.shot_timeout': '桌面端未响应（请保持桌面页面打开）',
  'remote.shot_done': '已更新 {time}',
  'remote.commit_failed': '已保存到本地（提交失败：{reason}）',
  'remote.no_screen': '还没有截图，点「截图」',
  'remote.placeholder': '输入消息发给当前会话…',
  'remote.send': '发送',
  'remote.sent': '已发送',
  'remote.send_failed': '发送失败：{msg}',
```

`shared/i18n/en.js` 对应：

```js
  'top.remote': 'Remote phone',
  'remote.title': 'Remote control',
  'remote.shot': 'Capture',
  'remote.shot_pending': 'Waiting for desktop…',
  'remote.shot_timeout': 'No response from desktop (keep the desktop page open)',
  'remote.shot_done': 'Updated {time}',
  'remote.commit_failed': 'Saved locally (commit failed: {reason})',
  'remote.no_screen': 'No capture yet — tap “Capture”',
  'remote.placeholder': 'Message the active session…',
  'remote.send': 'Send',
  'remote.sent': 'Sent',
  'remote.send_failed': 'Send failed: {msg}',
```

- [ ] **Step 2: 写失败测试**

`web/src/remote-coder/PhoneView.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import { t } from '../i18n';
import PhoneView from './PhoneView.vue';

type Call = { url: string; init?: RequestInit };

function stubFetch(state = { rev: 'r1' }) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith('/api/remote-coder/state')) {
      const cur = state.rev;
      return { ok: true, status: 200, json: async () => ({ rev: cur }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, rev: state.rev, uploaded: true, reason: '' }) };
  });
  vi.stubGlobal('fetch', fetchFn);
  return { fetchFn, calls, state };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('PhoneView', () => {
  it('无图时显示占位，有 rev 时显示图片', async () => {
    stubFetch({ rev: '' });
    const w = mountC(PhoneView);
    await flushPromises();
    expect(w.find('.empty').text()).toBe(t('remote.no_screen'));
    expect(w.find('img').exists()).toBe(false);
  });

  it('点「截图」：发命令并等到新 rev 后换图', async () => {
    const s = stubFetch({ rev: 'r1' });
    const w = mountC(PhoneView);
    await flushPromises();
    expect(w.find('img').attributes('src')).toContain('v=r1');

    s.state.rev = 'r2';                        // 桌面端截完图后的新版本
    await w.find('.shot').trigger('click');
    await flushPromises();
    const shotCall = s.calls.find((c) => c.url === '/api/remote-coder/message');
    expect(JSON.parse(String(shotCall?.init?.body))).toEqual({ kind: 'screenshot' });
    expect(w.find('img').attributes('src')).toContain('v=r2');
  });

  it('发送消息成功：清空输入并提示；失败提示原因', async () => {
    const s = stubFetch({ rev: 'r1' });
    const w = mountC(PhoneView);
    await flushPromises();
    await w.find('.inp').setValue('继续');
    await w.find('.send').trigger('click');
    await flushPromises();
    const call = s.calls.find((c) => c.url === '/api/remote-coder/message');
    expect(JSON.parse(String(call?.init?.body))).toEqual({ kind: 'message', text: '继续' });
    expect((w.find('.inp').element as HTMLTextAreaElement).value).toBe('');
    expect(w.find('.st').text()).toContain(t('remote.sent'));

    s.fetchFn.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({ message: 'bad' }) }));
    await w.find('.inp').setValue('x');
    await w.find('.send').trigger('click');
    await flushPromises();
    expect(w.find('.st').text()).toContain('bad');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- PhoneView`
Expected: FAIL（组件不存在）

- [ ] **Step 4: 实现 `web/src/remote-coder/PhoneView.vue`**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fetchScreenRev, requestShot, screenUrl, sendRemoteMessage, waitForNewScreen } from './useRemoteCoder';
import { t } from '../i18n';

const rev = ref('');
const pending = ref(false);
const status = ref('');
const text = ref('');
const sending = ref(false);
let statusTimer: ReturnType<typeof setTimeout> | null = null;

function showStatus(msg: string, autoClearMs = 4000) {
  status.value = msg;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = null;
  if (autoClearMs > 0) statusTimer = setTimeout(() => { status.value = ''; statusTimer = null; }, autoClearMs);
}

function clockLabel(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function loadRev() {
  rev.value = await fetchScreenRev();
}

async function onShot() {
  if (pending.value) return;
  pending.value = true;
  const prev = rev.value;
  showStatus(t('remote.shot_pending'), 0);
  try {
    await requestShot();
    const next = await waitForNewScreen(prev);
    if (!next) { showStatus(t('remote.shot_timeout')); return; }
    rev.value = next.rev;
    showStatus(t('remote.shot_done', { time: clockLabel() }));
  } catch (e) {
    showStatus((e as Error).message || String(e));
  } finally {
    pending.value = false;
  }
}

async function onSend() {
  const body = text.value.trim();
  if (!body || sending.value) return;
  sending.value = true;
  try {
    await sendRemoteMessage(body);
    text.value = '';
    showStatus(t('remote.sent'));
  } catch (e) {
    showStatus(t('remote.send_failed', { msg: (e as Error).message || String(e) }));
  } finally {
    sending.value = false;
  }
}

onMounted(() => { void loadRev(); });
</script>

<template>
  <div class="phone">
    <header class="ph">
      <span class="ttl">{{ $t('remote.title') }}</span>
      <button class="shot" :disabled="pending" @click="onShot">{{ $t('remote.shot') }}</button>
      <span class="st" :title="status">{{ status }}</span>
    </header>
    <div class="screen">
      <img v-if="rev" class="img" :src="screenUrl(rev)" alt="opencode" />
      <div v-else class="empty">{{ $t('remote.no_screen') }}</div>
    </div>
    <footer class="pf">
      <textarea
        v-model="text"
        class="inp"
        :placeholder="$t('remote.placeholder')"
        @keydown.enter.exact.prevent="onSend"
      />
      <button class="send" :disabled="sending || !text.trim()" @click="onSend">{{ $t('remote.send') }}</button>
    </footer>
  </div>
</template>

<style scoped>
.phone { position: fixed; inset: 0; display: flex; flex-direction: column; background: var(--bg0); color: var(--tx); }
.ph { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--bg1); border-bottom: 1px solid var(--bd2); }
.ttl { font-weight: 700; color: var(--tx1); }
.shot { background: var(--ac); color: var(--onac); border: none; border-radius: 6px; padding: 5px 14px; cursor: pointer; font-size: 13px; font-weight: 600; }
.shot:disabled { opacity: .6; cursor: default; }
.st { flex: 1; min-width: 0; color: var(--tx3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.screen { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: auto; background: var(--bg3); }
.img { max-width: 100%; max-height: 100%; object-fit: contain; }
.empty { color: var(--tx4); font-size: 13px; }
.pf { flex: none; display: flex; align-items: stretch; gap: 8px; padding: 8px 10px; background: var(--bg2); border-top: 1px solid var(--bd2); }
.inp { flex: 1; min-width: 0; min-height: 52px; background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 8px; padding: 8px 10px; font-size: 14px; line-height: 1.5; resize: none; outline: none; font-family: inherit; }
.inp:focus { border-color: var(--ac2); }
.send { background: var(--ac); color: var(--onac); border: none; border-radius: 8px; padding: 0 20px; cursor: pointer; font-size: 14px; font-weight: 700; flex: none; }
.send:disabled { opacity: .55; cursor: default; }
</style>
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- PhoneView`
Expected: PASS（3 个用例）

- [ ] **Step 6: 提交**

```powershell
git add web/src/remote-coder/PhoneView.vue web/src/remote-coder/PhoneView.test.ts shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(web): 手机遥控页 PhoneView（截图请求 + 消息发送）与词条"
```

---

## Task 6: 入口接线（`main.ts` + `App.vue` + `TerminalView.vue`）

**Files:**
- Create: `web/src/remote-coder/entry.ts`、`web/src/remote-coder/entry.test.ts`
- Modify: `web/src/main.ts`、`web/src/App.vue`、`web/src/components/TerminalView.vue`
- Modify: `web/src/snapshot.ts`、`web/src/snapshot.test.ts`（删 `uploadSnapshot`）
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`（删 `top.snapshot*`）

- [ ] **Step 1: 写 `entry.test.ts`（失败测试）**

```ts
import { describe, it, expect } from 'vitest';
import { isPhoneEntry } from './entry';

describe('isPhoneEntry', () => {
  it('识别 ?phone=1（含其它参数、hash）', () => {
    expect(isPhoneEntry('?phone=1')).toBe(true);
    expect(isPhoneEntry('?access=abc&phone=1')).toBe(true);
    expect(isPhoneEntry('?phone=1#x')).toBe(true);
  });
  it('其它情况为 false', () => {
    for (const s of ['', '?phone=0', '?phone', '?foo=1', '?phonenumber=1']) expect(isPhoneEntry(s)).toBe(false);
  });
});
```

- [ ] **Step 2: 实现 `entry.ts` 并跑测试**

```ts
// 手机页入口判定：URL 查询串里 phone=1 就走 PhoneView（不加载主界面、不连终端 WS）。
export function isPhoneEntry(search: string): boolean {
  return new URLSearchParams(search || '').get('phone') === '1';
}
```

Run: `npm.cmd --prefix web run test -- entry`
Expected: PASS

- [ ] **Step 3: `main.ts` 按入口挂载**

```ts
import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import App from './App.vue';
import PhoneView from './remote-coder/PhoneView.vue';
import { isPhoneEntry } from './remote-coder/entry';
import './styles.css';
import { t } from './i18n';

const app = createApp(isPhoneEntry(location.search) ? PhoneView : App);
app.config.globalProperties.$t = t;
app.use(ElementPlus);
app.mount('#app');
```

- [ ] **Step 4: `App.vue`：按钮替换 + 启动轮询 + 删快照**

- 删除 `import { captureToPngDataUrl, uploadSnapshot } from './snapshot';`
- 加 `import { startDesktopRemoteCoder } from './remote-coder/useDesktopRemoteCoder';`
- 删除 `snapshotting` / `snapshotMsg` / `snapshotMsgTimer` / `showSnapshotMsg` / `onSnapshot`（原 26–54 行）
- `onMounted` 里加 `stopRemoteCoder = startDesktopRemoteCoder();`；`onBeforeUnmount` 里加 `stopRemoteCoder?.()` 与删除快照定时器清理
- 新增：

```ts
// 顶栏手机按钮：新标签页打开手机页（带上当前 access 参数，远端/手机可直接访问）
let stopRemoteCoder: (() => void) | null = null;
function onPhone() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  const access = new URLSearchParams(location.search).get('access');
  if (access) url.searchParams.set('access', access);
  url.searchParams.set('phone', '1');
  window.open(url.toString(), '_blank', 'noopener');
}
```

- 模板：把

```html
      <button class="snap-btn" :disabled="snapshotting" :class="{ 'snap-hidden': snapshotting }" :title="$t('top.snapshot')" @click="onSnapshot">📷</button>
```

换成

```html
      <button class="snap-btn" :title="$t('top.remote')" @click="onPhone">📱</button>
```

- 删除 `<span v-if="snapshotMsg" class="snap-msg" ...>` 与样式表里的 `.snap-msg` / `.snap-hidden`

- [ ] **Step 5: `TerminalView.vue`：监听两个事件**

在 `sendToActive` 附近加：

```ts
// —— remote_coder：手机端发起截图/发消息 ——
function onRemoteSend(e: Event) {
  const text = (e as CustomEvent).detail?.text;
  if (typeof text === 'string' && text.trim()) sendToActive(text);
}
async function onRemoteScreen() {
  const el = hostRef.value;
  if (!el) return;
  try {
    // 隐藏/最小化标签页 rAF 不触发：用定时器兜底 + 整体超时，避免无限等待
    await new Promise<void>((r) => setTimeout(r, 50));
    const dataUrl = await Promise.race([
      captureToPngDataUrl(el),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('capture-timeout')), 10000)),
    ]);
    const res = await fetch('/api/remote-coder/screen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (data.reason) console.warn('remote-coder commit failed:', data.reason);
  } catch (e) {
    console.warn('remote-coder capture failed:', (e as Error).message);
  }
}
```

- 顶部 import：`import { captureToPngDataUrl } from '../snapshot';`（若已有 `snapshot` 相关 import 则合并）
- `onMounted` 注册 `window.addEventListener('df-remote-send', onRemoteSend)`、`window.addEventListener('df-remote-screen', onRemoteScreen)`；`onBeforeUnmount` 对应移除

- [ ] **Step 6: 清理 `snapshot.ts` 与旧词条**

- `web/src/snapshot.ts`：删除 `SnapshotResult`、`UploadInit`、`UploadDeps`、`uploadSnapshot`（保留 `snapshotBackground`/`snapshotFilter`/`snapshotOptions`/`captureToPngDataUrl`）
- `web/src/snapshot.test.ts`：删除 `uploadSnapshot` 的用例与相关 import
- `shared/i18n/zh-CN.js` + `en.js`：删除 `top.snapshot`、`top.snapshot.saved`、`top.snapshot.savedLocal`、`top.snapshot.savedGitFailed`、`top.snapshot.failed`

- [ ] **Step 7: 全量验证**

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run check:i18n
```
Expected: 全部通过（server + web 测试全绿、类型无错、无中文硬编码命中）

- [ ] **Step 8: 人工验收（dev 33333）**

```powershell
# 已有 dev 在跑则跳过；否则：
npm.cmd run dev
```
1. 顶栏点 `📱` → 新标签打开 `http://localhost:33333/?phone=1`
2. 点「截图」→ 手机页出现终端画面；`git log --oneline -1` 出现 `snapshot(remote): screen.png`
3. 输入框输入文字发送 → 桌面当前 agent 会话收到并发送（等同回车）；`remote_coder/messages.jsonc` 出现该条目且 `handled: true`
4. 手改 `remote_coder/messages.jsonc` 追加一条未处理消息 → 桌面 2s 内自动发送并回填 `handled`

- [ ] **Step 9: 提交**

```powershell
git add web/src/remote-coder/entry.ts web/src/remote-coder/entry.test.ts web/src/main.ts web/src/App.vue web/src/components/TerminalView.vue web/src/snapshot.ts web/src/snapshot.test.ts shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(web): 顶栏手机按钮与 ?phone=1 手机页入口，终端侧响应远端截图/消息"
```

---

## Task 7: 收尾核对

- [ ] **Step 1: 文档同步**

- `AGENTS.md`「目录速览」补一行：`server/remote-coder-store.js` / `remote-coder-mount.js`（remote_coder 文件层与端点）、`web/src/remote-coder/`（手机页与两侧客户端）
- 若 `docs/learn/` 有相关操作说明（提交/发布规范）需同步命令改动（旧 `/api/snapshot` 已删），一并更新

- [ ] **Step 2: 最终验证 + 提交**

```powershell
npm.cmd test; npm.cmd run typecheck; npm.cmd run check:i18n
git add AGENTS.md docs
git commit -m "docs: 同步 remote_coder 手机遥控的目录与说明"
```

---

## Self-Review 结论

- **Spec 覆盖**：入口/新标签页（Task 6）、手机页两块（Task 5）、截图数据流（Task 2+6）、消息数据流（Task 2+3+6）、文件兜底（Task 2 `/inbox` 实时读文件 + Task 3 轮询）、`messages.jsonc` 格式（Task 1）、固定图覆盖写（Task 1）、commit 仅截图路径（Task 2）、旧快照移除（Task 2+6）、i18n 词条表（Task 5+6）、测试与验收（各任务 + Task 6 Step 7/8）、边界（超时/非 git/多标签）——均有对应任务。
- **占位符**：无 TBD/TODO，所有步骤含可执行代码与命令。
- **命名一致性**：`makeEntry/inbox/markHandled/saveScreen/screenRev/commitScreen/dirOf`、`startDesktopRemoteCoder`、`requestShot/sendRemoteMessage/fetchScreenRev/waitForNewScreen/screenUrl`、事件名 `df-remote-send`/`df-remote-screen`、端点 `/api/remote-coder/{inbox,state,message,ack,screen,screen.png}` 在各任务中一致。
