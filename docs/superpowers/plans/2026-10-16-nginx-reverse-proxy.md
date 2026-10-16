# Nginx 反代（内置反向代理）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 devflow 内新增「Nginx 反代」小工具：纯 Node 反向代理，两种接入模式（独立监听端口 / 挂 devflow 路径），支持 HTTP/WS/SSE 透传、访问日志与可持久化抓包。

**Architecture:** 后端四个模块（`proxy-store` 规则持久化、`proxy-capture` 抓包落盘、`proxy-engine` 转发引擎、`proxy-mount` HTTP 面），装配进 `server/index.js`，路径规则接进主 HTTP 分发与 `upgrade` 路由。前端为自包含工具页签（左规则列表 + 右表单/日志/抓包），空侧栏（对齐 base64）。

**Tech Stack:** Node ESM + `node:http`/`node:https`（零新增依赖），`node:test`；Vue3 + Vite + Vitest + element-plus。

**相对 spec 的一处简化（实现细节，非行为变更）：** 规则状态/日志/抓包不用 WS 推送，改用前端每 2s 轮询 `GET /api/nginx/rules` 与 `GET /api/nginx/log`（更简单、无 gateway 耦合；`shared/index.js` 与 `ws-gateway` 事件广播不变）。WS **升级路由**仍必须改 `ws-gateway`（见 Task 6）。

---

## 文件结构

- 新增 `server/proxy-store.js` — 规则持久化 `<数据目录>/proxy/rules.json` + 校验/冲突检测
- 新增 `server/proxy-capture.js` — 抓包落盘 `<数据目录>/proxy/captures/<ruleId>/`
- 新增 `server/proxy-ws-frames.js` — WebSocket 帧解析器（纯函数，供抓包用）
- 新增 `server/proxy-engine.js` — 转发引擎（HTTP/WS/SSE 透传、监听/路径注册、状态、访问日志环形缓冲）
- 新增 `server/proxy-mount.js` — `/api/nginx/*`
- 新增 `server/test/proxy-store.test.js`、`proxy-capture.test.js`、`proxy-ws-frames.test.js`、`proxy-engine.test.js`、`proxy-http.test.js`
- 新增 `web/src/tools/nginx/useNginx.ts`、`NginxTool.vue` + `*.test.ts`
- 改 `server/port-paths.js`、`server/index.js`、`server/ws-gateway.js`
- 改 `web/src/tools/catalog.ts`、`web/src/components/ToolSidebar.vue`、`web/src/components/TerminalView.vue`、`web/src/components/MiniTools.test.ts`
- 改 `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

---

### Task 1: 规则存储 `server/proxy-store.js`

**Files:**
- Create: `server/proxy-store.js`
- Test: `server/test/proxy-store.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/proxy-store.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProxyStore, normalizeRule } from '../proxy-store.js';

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-proxystore-')), 'rules.json'); }

const PORT_RULE = { name: 'web', mode: 'port', listenHost: '127.0.0.1', listenPort: 18080, target: { protocol: 'http', host: '127.0.0.1', port: 5173 }, enabled: true };
const PATH_RULE = { name: 'app', mode: 'path', pathPrefix: '/app1', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: 8080 }, enabled: true };

test('normalizeRule：默认值（tlsInsecure=true / capture=false / stripPrefix=true）', () => {
  const r = normalizeRule(PATH_RULE);
  assert.equal(r.tlsInsecure, true);
  assert.equal(r.capture, false);
  assert.equal(r.stripPrefix, true);
  assert.deepEqual(r.headers, []);
});

test('normalizeRule：非法 mode / 端口 / 保留前缀报错', () => {
  assert.throws(() => normalizeRule({ ...PORT_RULE, mode: 'x' }), (e) => e.code === 'bad-request');
  assert.throws(() => normalizeRule({ ...PORT_RULE, listenPort: 0 }), (e) => e.code === 'bad-request');
  assert.throws(() => normalizeRule({ ...PATH_RULE, pathPrefix: '/api/x' }), (e) => e.code === 'bad-request');
  assert.throws(() => normalizeRule({ ...PATH_RULE, pathPrefix: 'app' }), (e) => e.code === 'bad-request');
});

test('create/update/remove：CRUD 且落盘后重载仍在', () => {
  const file = tmpFile();
  const s = createProxyStore({ file });
  const a = s.create(PORT_RULE);
  assert.ok(a.id);
  assert.equal(a.listenPort, 18080);
  const b = s.create({ ...PATH_RULE, pathPrefix: '/app2' });
  assert.equal(s.list().length, 2);
  const up = s.update(a.id, { name: 'web2', capture: true });
  assert.equal(up.name, 'web2');
  assert.equal(up.capture, true);
  assertEqualsReload(file, 2);
  s.remove(b.id);
  assertEqualsReload(file, 1);
});

function assertEqualsReload(file, n) {
  const s2 = createProxyStore({ file });
  assert.equal(s2.list().length, n);
}

test('端口冲突（同 host 同端口均启用）报 port-in-use', () => {
  const s = createProxyStore({ file: tmpFile() });
  s.create(PORT_RULE);
  assert.throws(() => s.create({ ...PORT_RULE, name: 'dup' }), (e) => e.code === 'port-in-use');
});

test('路径前缀冲突（互相包含）报 bad-request', () => {
  const s = createProxyStore({ file: tmpFile() });
  s.create({ ...PATH_RULE, pathPrefix: '/app' });
  assert.throws(() => s.create({ ...PATH_RULE, pathPrefix: '/app/sub' }), (e) => e.code === 'bad-request');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/proxy-store.test.js`
Expected: FAIL（`Cannot find module '../proxy-store.js'`）

- [ ] **Step 3: 实现 `server/proxy-store.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PROXY_MODES = ['port', 'path'];
export const RESERVED_PREFIXES = ['/api', '/ws'];

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }
function nowIso() { return new Date().toISOString(); }

export function normalizeRule(input) {
  const mode = String(input?.mode || 'port');
  if (!PROXY_MODES.includes(mode)) throw err('bad-request', 'bad mode');
  const name = String(input?.name || '').trim();
  if (!name) throw err('bad-request', 'name required');
  const listenHost = String(input?.listenHost || '127.0.0.1');
  if (!['127.0.0.1', '0.0.0.0'].includes(listenHost)) throw err('bad-request', 'bad listen host');

  const t = input?.target || {};
  const protocol = String(t.protocol || 'http');
  if (!['http', 'https'].includes(protocol)) throw err('bad-request', 'bad protocol');
  const host = String(t.host || '').trim();
  if (!host) throw err('bad-request', 'target host required');
  const port = Number(t.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw err('bad-request', 'bad target port');

  const headers = Array.isArray(input?.headers)
    ? input.headers.map((h) => ({ name: String(h?.name || '').trim(), value: String(h?.value ?? '') })).filter((h) => h.name)
    : [];

  const base = {
    name, mode, listenHost,
    target: { protocol, host, port },
    tlsInsecure: input?.tlsInsecure !== false,
    headers,
    capture: !!input?.capture,
    enabled: !!input?.enabled,
  };

  if (mode === 'port') {
    const listenPort = Number(input?.listenPort);
    if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) throw err('bad-request', 'bad listen port');
    return { ...base, listenPort, pathPrefix: '', stripPrefix: true };
  }

  const pathPrefix = String(input?.pathPrefix || '').trim();
  if (!/^\/[^/]/.test(pathPrefix)) throw err('bad-request', 'bad prefix');
  if (pathPrefix.endsWith('/')) throw err('bad-request', 'bad prefix');
  if (RESERVED_PREFIXES.some((p) => pathPrefix === p || pathPrefix.startsWith(p + '/'))) throw err('bad-request', 'reserved prefix');
  return { ...base, listenPort: 0, pathPrefix, stripPrefix: input?.stripPrefix !== false };
}

export function createProxyStore({ file }) {
  let items = null;

  function load() {
    if (items) return items;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      items = Array.isArray(raw?.items) ? raw.items : [];
    } catch { items = []; }
    return items;
  }

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ items }, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  function checkConflict(list, rule, selfId) {
    const others = list.filter((x) => x.id !== selfId);
    if (rule.mode === 'port') {
      const clash = others.some((x) => x.mode === 'port' && x.enabled && rule.enabled
        && x.listenHost === rule.listenHost && x.listenPort === rule.listenPort);
      if (clash) throw err('port-in-use', 'listen port conflict');
    } else {
      const clash = others.some((x) => x.mode === 'path'
        && (x.pathPrefix === rule.pathPrefix
          || x.pathPrefix.startsWith(rule.pathPrefix + '/')
          || rule.pathPrefix.startsWith(x.pathPrefix + '/')));
      if (clash) throw err('bad-request', 'prefix conflict');
    }
  }

  return {
    list() { return load().map((x) => ({ ...x })); },
    get(id) {
      const it = load().find((x) => x.id === id);
      if (!it) throw err('not-found');
      return it;
    },
    create(input) {
      const rule = normalizeRule(input);
      checkConflict(load(), rule, null);
      const it = { id: crypto.randomUUID(), ...rule, createdAt: nowIso(), updatedAt: nowIso() };
      load().push(it);
      persist();
      return { ...it };
    },
    update(id, patch) {
      const list = load();
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) throw err('not-found');
      const rule = normalizeRule({ ...list[i], ...patch });
      checkConflict(list, rule, id);
      const it = { ...list[i], ...rule, updatedAt: nowIso() };
      list[i] = it;
      persist();
      return { ...it };
    },
    remove(id) {
      const list = load();
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      persist();
      return true;
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/proxy-store.test.js`
Expected: PASS（5 个 test）

- [ ] **Step 5: 提交**

```bash
git add server/proxy-store.js server/test/proxy-store.test.js
git commit -m "feat(nginx): 反代规则存储与校验"
```

---

### Task 2: WS 帧解析 `server/proxy-ws-frames.js`

**Files:**
- Create: `server/proxy-ws-frames.js`
- Test: `server/test/proxy-ws-frames.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/proxy-ws-frames.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WsFrameParser, encodeFrameData } from '../proxy-ws-frames.js';

// 手工构造一个未分片帧；masked=true 时按客户端帧加掩码
function makeFrame(opcode, payload, masked) {
  const data = Buffer.from(payload);
  const len = data.length;
  const header = [];
  header.push(0x80 | opcode);
  if (masked) header.push(0x80 | len); else header.push(len);
  const key = Buffer.from([1, 2, 3, 4]);
  const out = Buffer.concat([Buffer.from(header), masked ? key : Buffer.alloc(0), data]);
  if (masked) for (let i = 0; i < out.length - 3 - 0; i++) { /* noop */ }
  if (masked) {
    const base = 2 + 4;
    for (let i = 0; i < len; i++) out[base + i] = data[i] ^ key[i & 3];
  }
  return out;
}

test('解析单个文本帧', () => {
  const p = new WsFrameParser(false);
  const frames = p.push(makeFrame(0x1, 'hello', false));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].opcode, 0x1);
  assert.equal(encodeFrameData(0x1, frames[0].payload), 'hello');
});

test('解析带掩码的客户端帧', () => {
  const p = new WsFrameParser(true);
  const frames = p.push(makeFrame(0x1, 'abc', true));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].payload.toString('utf8'), 'abc');
});

test('分片到达时缓冲直到完整', () => {
  const p = new WsFrameParser(false);
  const full = makeFrame(0x1, 'streamed', false);
  assert.deepEqual(p.push(full.subarray(0, 2)), []);
  const frames = p.push(full.subarray(2));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].payload.toString('utf8'), 'streamed');
});

test('一个 chunk 含多帧', () => {
  const p = new WsFrameParser(false);
  const frames = p.push(Buffer.concat([makeFrame(0x1, 'a', false), makeFrame(0x1, 'b', false)]));
  assert.equal(frames.length, 2);
});

test('encodeFrameData：二进制帧 base64', () => {
  assert.equal(encodeFrameData(0x2, Buffer.from([0, 1, 2])), Buffer.from([0, 1, 2]).toString('base64'));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/proxy-ws-frames.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `server/proxy-ws-frames.js`**

```js
// 最小 WebSocket 帧解析（仅用于抓包；不参与转发，转发是原始字节 pipe）
const MAX_FRAME = 16 * 1024 * 1024;

export class WsFrameParser {
  constructor(masked = false) {
    this.masked = masked;
    this.buf = Buffer.alloc(0);
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk);
    const frames = [];
    for (;;) {
      const f = this.tryParse();
      if (!f) break;
      frames.push(f);
    }
    return frames;
  }

  tryParse() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2); off = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      const big = b.readBigUInt64BE(2);
      if (big > BigInt(MAX_FRAME)) { this.buf = Buffer.alloc(0); return null; }
      len = Number(big); off = 10;
    }
    if (len > MAX_FRAME) { this.buf = Buffer.alloc(0); return null; }
    let maskKey = null;
    if (masked) {
      if (b.length < off + 4) return null;
      maskKey = b.subarray(off, off + 4); off += 4;
    }
    if (b.length < off + len) return null;
    let payload = b.subarray(off, off + len);
    if (masked) {
      const out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
      payload = out;
    }
    this.buf = b.subarray(off + len);
    return { fin, opcode, payload };
  }
}

// 文本帧原样；其它（二进制/控制帧）base64
export function encodeFrameData(opcode, payload) {
  if (opcode === 0x1) return payload.toString('utf8');
  return payload.toString('base64');
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/proxy-ws-frames.test.js`
Expected: PASS（5 个 test）

- [ ] **Step 5: 提交**

```bash
git add server/proxy-ws-frames.js server/test/proxy-ws-frames.test.js
git commit -m "feat(nginx): WebSocket 帧解析器（抓包用）"
```

---

### Task 3: 抓包存储 `server/proxy-capture.js`

**Files:**
- Create: `server/proxy-capture.js`
- Test: `server/test/proxy-capture.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/proxy-capture.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProxyCapture } from '../proxy-capture.js';

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-proxycap-')); }
const RID = '11111111-1111-1111-1111-111111111111';

test('begin/finish：写入记录并可从 list 读到摘要', () => {
  const cap = createProxyCapture({ rootDir: tmpRoot() });
  const h = cap.begin(RID, { method: 'GET', url: '/x', headers: { host: 'h' } });
  h.resHeaders({ 'content-type': 'text/plain' });
  h.resBody(Buffer.from('hello'));
  h.finish({ status: 200, durationMs: 5 });
  const list = cap.list(RID);
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 200);
  assert.equal(list[0].kind, 'http');
  assert.equal(list[0].resBodySize, 5);
  assert.equal(list[0].resHeaders, undefined, '摘要不含 headers');
});

test('read：取到完整记录与正文', () => {
  const cap = createProxyCapture({ rootDir: tmpRoot() });
  const h = cap.begin(RID, { method: 'POST', url: '/p', headers: {} });
  h.reqBody(Buffer.from('body'));
  h.resHeaders({ 'content-type': 'text/event-stream' });
  h.resBody(Buffer.from('data: 1\n\n'));
  h.finish({ status: 200, durationMs: 9 });
  const id = cap.list(RID)[0].id;
  const rec = cap.read(RID, id);
  assert.equal(rec.record.kind, 'sse');
  assert.equal(rec.reqBody, 'body');
  assert.equal(rec.resBody, 'data: 1\n\n');
});

test('WS：帧写入并在 read 中返回', () => {
  const cap = createProxyCapture({ rootDir: tmpRoot() });
  const h = cap.begin(RID, { method: 'GET', url: '/ws', headers: {}, kind: 'ws' });
  h.frame('c2s', 0x1, Buffer.from('hi'));
  h.frame('s2c', 0x2, Buffer.from([1, 2]));
  h.finish({ status: 101, durationMs: 1 });
  const id = cap.list(RID)[0].id;
  const rec = cap.read(RID, id);
  assert.equal(rec.record.kind, 'ws');
  assert.equal(rec.frames.length, 2);
  assert.equal(rec.frames[0].data, 'hi');
});

test('超过 maxBody 的正文标 truncated 且不再增长', () => {
  const cap = createProxyCapture({ rootDir: tmpRoot(), maxBody: 4 });
  const h = cap.begin(RID, { method: 'GET', url: '/b', headers: {} });
  h.resHeaders({});
  h.resBody(Buffer.from('123456789'));
  h.finish({ status: 200, durationMs: 1 });
  const id = cap.list(RID)[0].id;
  const rec = cap.read(RID, id);
  assert.equal(rec.record.truncated, true);
  assert.equal(rec.resBody, '1234');
});

test('clear / removeRule 清目录', () => {
  const root = tmpRoot();
  const cap = createProxyCapture({ rootDir: root });
  const h = cap.begin(RID, { method: 'GET', url: '/', headers: {} });
  h.finish({ status: 200, durationMs: 1 });
  cap.clear(RID);
  assert.equal(cap.list(RID).length, 0);
  const h2 = cap.begin(RID, { method: 'GET', url: '/', headers: {} });
  h2.finish({ status: 200, durationMs: 1 });
  cap.removeRule(RID);
  assert.equal(fs.existsSync(path.join(root, RID)), false);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/proxy-capture.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `server/proxy-capture.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_MAX_BODY = 5 * 1024 * 1024;
const MAX_FRAMES = 1000;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

function safe(id) { return ID_RE.test(String(id || '')) ? String(id) : null; }

export function createProxyCapture({ rootDir, maxBody = DEFAULT_MAX_BODY, onEvent = () => {} }) {
  const active = new Map(); // captureId -> { ruleId, record }

  function ruleDir(ruleId) { return path.join(rootDir, safe(ruleId) || '_'); }
  function indexFile(ruleId) { return path.join(ruleDir(ruleId), 'index.ndjson'); }

  function bodyPath(ruleId, id, ext) { return path.join(ruleDir(ruleId), `${id}.${ext}`); }

  function detectKind(record, hasFrames) {
    if (hasFrames) return 'ws';
    const ct = record.resHeaders ? String(record.resHeaders['content-type'] || '') : '';
    return ct.includes('text/event-stream') ? 'sse' : (record.meta?.kind || 'http');
  }

  function begin(ruleId, meta = {}) {
    const id = crypto.randomUUID();
    const record = {
      id, ts: new Date().toISOString(),
      method: meta.method || 'GET', url: meta.url || '/',
      reqHeaders: meta.headers || {},
      resHeaders: null, status: 0, kind: meta.kind || 'http', state: 'active',
      reqBodySize: 0, resBodySize: 0, frameCount: 0,
      hasReqBody: false, hasResBody: false, hasFrames: false,
      truncated: false, durationMs: 0,
      meta,
    };
    fs.mkdirSync(ruleDir(ruleId), { recursive: true });
    const state = { record, reqSize: 0, resSize: 0, reqTrunc: false, resTrunc: false, frames: [] };
    active.set(id, { ruleId, state });
    onEvent({ kind: 'capture', ruleId, record: summary(record) });
    return {
      id,
      reqBody(buf) {
        if (state.reqTrunc) return;
        const room = maxBody - state.reqSize;
        if (room <= 0) { state.reqTrunc = true; return; }
        const slice = buf.length > room ? buf.subarray(0, room) : buf;
        fs.appendFileSync(bodyPath(ruleId, id, 'req'), slice);
        state.reqSize += slice.length;
        if (slice.length < buf.length) state.reqTrunc = true;
      },
      resHeaders(h) { record.resHeaders = { ...h }; },
      resBody(buf) {
        if (state.resTrunc) return;
        const room = maxBody - state.resSize;
        if (room <= 0) { state.resTrunc = true; return; }
        const slice = buf.length > room ? buf.subarray(0, room) : buf;
        fs.appendFileSync(bodyPath(ruleId, id, 'res'), slice);
        state.resSize += slice.length;
        if (slice.length < buf.length) state.resTrunc = true;
      },
      frame(dir, opcode, payload) {
        if (state.frames.length >= MAX_FRAMES) return;
        state.frames.push({ dir, opcode, ts: Date.now(), data: encodeFrame(opcode, payload) });
      },
      finish(info = {}) {
        record.status = Number(info.status || 0);
        record.durationMs = Number(info.durationMs || 0);
        record.state = 'done';
        record.reqBodySize = state.reqSize;
        record.resBodySize = state.resSize;
        record.hasReqBody = state.reqSize > 0;
        record.hasResBody = state.resSize > 0;
        record.hasFrames = state.frames.length > 0;
        record.frameCount = state.frames.length;
        record.truncated = state.reqTrunc || state.resTrunc;
        record.kind = detectKind(record, record.hasFrames);
        fs.mkdirSync(ruleDir(ruleId), { recursive: true });
        if (record.hasFrames) {
          const lines = state.frames.map((f) => JSON.stringify(f)).join('\n') + '\n';
          fs.writeFileSync(bodyPath(ruleId, id, 'frames.ndjson'), lines, 'utf8');
        }
        fs.writeFileSync(bodyPath(ruleId, id, 'json'), JSON.stringify(record), 'utf8');
        fs.appendFileSync(indexFile(ruleId), JSON.stringify(summary(record)) + '\n');
        active.delete(id);
        onEvent({ kind: 'capture', ruleId, record: summary(record) });
      },
    };
  }

  function encodeFrame(opcode, payload) {
    return opcode === 0x1 ? payload.toString('utf8') : payload.toString('base64');
  }

  function summary(record) {
    return {
      id: record.id, ts: record.ts, method: record.method, url: record.url,
      status: record.status, durationMs: record.durationMs, kind: record.kind,
      state: record.state, reqBodySize: record.reqBodySize, resBodySize: record.resBodySize,
      frameCount: record.frameCount, truncated: record.truncated,
    };
  }

  function list(ruleId, { limit = 200 } = {}) {
    const out = [];
    for (const [, v] of active) if (v.ruleId === ruleId) out.push(summary(v.state.record));
    try {
      const lines = fs.readFileSync(indexFile(ruleId), 'utf8').split('\n').filter(Boolean);
      for (const line of lines) { try { out.push(JSON.parse(line)); } catch { /* skip */ } }
    } catch { /* no index yet */ }
    out.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    return out.slice(-limit);
  }

  function read(ruleId, id) {
    const sid = safe(id);
    if (!sid) { const e = new Error('bad id'); e.code = 'bad-request'; throw e; }
    const raw = JSON.parse(fs.readFileSync(bodyPath(ruleId, sid, 'json'), 'utf8'));
    const readBody = (ext) => { try { return fs.readFileSync(bodyPath(ruleId, sid, ext), 'utf8'); } catch { return ''; } };
    let frames = [];
    try {
      frames = fs.readFileSync(bodyPath(ruleId, sid, 'frames.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch { /* none */ }
    return { record: raw, reqBody: readBody('req'), resBody: readBody('res'), frames };
  }

  function clear(ruleId) {
    try { fs.rmSync(ruleDir(ruleId), { recursive: true, force: true }); } catch { /* ignore */ }
  }
  function removeRule(ruleId) { clear(ruleId); }

  return { begin, list, read, clear, removeRule };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/proxy-capture.test.js`
Expected: PASS（5 个 test）

- [ ] **Step 5: 提交**

```bash
git add server/proxy-capture.js server/test/proxy-capture.test.js
git commit -m "feat(nginx): 抓包落盘存储"
```

---

### Task 4: 转发引擎 `server/proxy-engine.js`

**Files:**
- Create: `server/proxy-engine.js`
- Test: `server/test/proxy-engine.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/proxy-engine.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildForwardPath, forwardHeaders, matchPrefix } from '../proxy-engine.js';

const RULE = {
  id: 'r1', name: 'r', mode: 'path', listenHost: '127.0.0.1', listenPort: 0,
  pathPrefix: '/app1', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: 9 },
  tlsInsecure: true, headers: [{ name: 'X-Custom', value: 'v' }], capture: false, enabled: true,
};

test('buildForwardPath：去前缀', () => {
  assert.equal(buildForwardPath(RULE, '/app1/foo?x=1'), '/foo?x=1');
  assert.equal(buildForwardPath(RULE, '/app1'), '/');
  assert.equal(buildForwardPath({ ...RULE, stripPrefix: false }, '/app1/foo'), '/app1/foo');
  assert.equal(buildForwardPath({ ...RULE, mode: 'port' }, '/foo'), '/foo');
});

test('forwardHeaders：加 X-Forwarded-* 且应用自定义头', () => {
  const req = { headers: { host: 'me:2222', 'x-forwarded-for': '1.1.1.1' }, socket: { remoteAddress: '2.2.2.2' } };
  const h = forwardHeaders(RULE, req);
  assert.equal(h['x-forwarded-for'], '1.1.1.1, 2.2.2.2');
  assert.equal(h['x-forwarded-proto'], 'http');
  assert.equal(h['x-forwarded-host'], 'me:2222');
  assert.equal(h['x-custom'], 'v');
  assert.equal(h.host, undefined);
});

test('matchPrefix', () => {
  assert.equal(matchPrefix('/app1', '/app1/foo'), true);
  assert.equal(matchPrefix('/app1', '/app1'), true);
  assert.equal(matchPrefix('/app1', '/app10'), false);
});
```

Then end-to-end tests appended in the same file (a separate `test(...)`):

```js
import { createProxyEngine } from '../proxy-engine.js';

function listen(server) { return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))); }

async function startUpstream(handler) {
  const srv = http.createServer(handler);
  const port = await listen(srv);
  return { srv, port };
}

test('端到端：端口规则 HTTP 转发 + 去前缀 + 头改写', async () => {
  const up = await startUpstream((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(JSON.stringify({ url: req.url, host: req.headers.host, xf: req.headers['x-forwarded-for'], custom: req.headers['x-custom'] }));
  });
  const rule = {
    id: 'e2e1', name: 'e2e', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [{ name: 'X-Custom', value: 'z' }], capture: false, enabled: true,
  };
  const store = { list: () => [rule], get: (id) => (id === rule.id ? rule : (() => { throw new Error('nf'); })()) };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  const addr = engine._instanceServer(rule.id).address();
  const body = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: addr.port, path: '/x/y' }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve(s));
    });
  });
  const j = JSON.parse(body);
  assert.equal(j.url, '/x/y');
  assert.equal(j.xf.includes('127.0.0.1'), true);
  assert.equal(j.custom, 'z');
  engine.stop(rule.id);
  up.srv.close();
});

test('端口被占 → 状态 error（不崩）', async () => {
  const up = await startUpstream(() => {});
  const rule = {
    id: 'e2e2', name: 'busy', mode: 'port', listenHost: '127.0.0.1', listenPort: up.port,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [], capture: false, enabled: true,
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  assert.equal(engine.status()[rule.id].status, 'error');
  up.srv.close();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/proxy-engine.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `server/proxy-engine.js`**

```js
import http from 'node:http';
import https from 'node:https';
import { WsFrameParser } from './proxy-ws-frames.js';

const LOG_LIMIT = 500;

export function matchPrefix(prefix, pathname) {
  if (!prefix) return false;
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

export function buildForwardPath(rule, reqUrl) {
  const url = reqUrl || '/';
  if (rule.mode !== 'path' || !rule.stripPrefix || !rule.pathPrefix) return url;
  const qi = url.indexOf('?');
  const pathPart = qi >= 0 ? url.slice(0, qi) : url;
  const search = qi >= 0 ? url.slice(qi) : '';
  let rest = pathPart.slice(rule.pathPrefix.length);
  if (!rest.startsWith('/')) rest = '/' + rest;
  if (rest === '') rest = '/';
  return rest + search;
}

export function forwardHeaders(rule, req) {
  const out = { ...req.headers };
  delete out.host;
  const xff = req.headers['x-forwarded-for'];
  const ip = (req.socket && req.socket.remoteAddress) || '';
  out['x-forwarded-for'] = xff ? `${xff}, ${ip}` : ip;
  out['x-forwarded-proto'] = rule.target.protocol === 'https' ? 'https' : 'http';
  out['x-forwarded-host'] = req.headers.host || '';
  for (const h of rule.headers || []) if (h.name) out[h.name.toLowerCase()] = h.value;
  return out;
}

export function proxyHttp({ rule, req, res, capture, emit = () => {} }) {
  const target = rule.target;
  const isHttps = target.protocol === 'https';
  const mod = isHttps ? https : http;
  const start = Date.now();
  const cap = rule.capture && capture ? capture.begin(rule.id, { method: req.method, url: req.url, headers: req.headers, kind: 'http' }) : null;

  const headers = forwardHeaders(rule, req);
  headers.host = `${target.host}:${target.port}`;
  const opts = { method: req.method, host: target.host, port: target.port, path: buildForwardPath(rule, req.url), headers };
  if (isHttps) opts.rejectUnauthorized = !rule.tlsInsecure;

  const upstreamReq = mod.request(opts, (up) => {
    let kind = 'http';
    if (cap) cap.resHeaders(up.headers);
    if (String(up.headers['content-type'] || '').includes('text/event-stream')) kind = 'sse';
    res.writeHead(up.statusCode || 502, up.headers);
    up.on('data', (chunk) => {
      if (cap) cap.resBody(chunk);
      if (!res.writableEnded) res.write(chunk);
    });
    up.on('end', () => {
      const durationMs = Date.now() - start;
      if (cap) cap.finish({ status: up.statusCode || 502, durationMs });
      emit({ method: req.method, url: req.url, status: up.statusCode || 502, durationMs, kind });
      if (!res.writableEnded) res.end();
    });
    up.on('error', () => {
      const durationMs = Date.now() - start;
      if (cap) cap.finish({ status: up.statusCode || 502, durationMs });
      emit({ method: req.method, url: req.url, status: up.statusCode || 502, durationMs, kind });
      if (!res.writableEnded) res.end();
    });
  });

  upstreamReq.on('error', (e) => {
    const durationMs = Date.now() - start;
    if (cap) cap.finish({ status: 502, durationMs });
    emit({ method: req.method, url: req.url, status: 502, durationMs, kind: 'http' });
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'bad-gateway', message: e.message }));
    } else if (!res.writableEnded) res.end();
  });

  req.on('data', (chunk) => { if (cap) cap.reqBody(chunk); upstreamReq.write(chunk); });
  req.on('end', () => upstreamReq.end());
  req.on('error', () => upstreamReq.destroy());
  res.on('close', () => { if (!upstreamReq.destroyed) upstreamReq.destroy(); });
}

export function proxyWs({ rule, req, socket, head, capture }) {
  const target = rule.target;
  const isHttps = target.protocol === 'https';
  const mod = isHttps ? https : http;
  const cap = rule.capture && capture ? capture.begin(rule.id, { method: 'GET', url: req.url, headers: req.headers, kind: 'ws' }) : null;

  const headers = forwardHeaders(rule, req);
  headers.host = `${target.host}:${target.port}`;
  headers.connection = 'Upgrade';
  headers.upgrade = req.headers.upgrade || 'websocket';
  for (const k of ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions']) {
    if (req.headers[k]) headers[k] = req.headers[k];
  }
  const opts = { method: 'GET', host: target.host, port: target.port, path: buildForwardPath(rule, req.url), headers };
  if (isHttps) opts.rejectUnauthorized = !rule.tlsInsecure;

  const upstreamReq = mod.request(opts);
  const start = Date.now();

  upstreamReq.on('upgrade', (upRes, upSocket, upHead) => {
    const lines = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}`];
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (Array.isArray(v)) for (const vv of v) lines.push(`${k}: ${vv}`);
      else lines.push(`${k}: ${v}`);
    }
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    if (upHead && upHead.length) socket.write(upHead);

    const c2s = cap ? new WsFrameParser(true) : null;
    const s2c = cap ? new WsFrameParser(false) : null;
    socket.on('data', (chunk) => {
      if (cap) for (const f of c2s.push(chunk)) cap.frame('c2s', f.opcode, f.payload);
      if (!upSocket.destroyed) upSocket.write(chunk);
    });
    upSocket.on('data', (chunk) => {
      if (cap) for (const f of s2c.push(chunk)) cap.frame('s2c', f.opcode, f.payload);
      if (!socket.destroyed) socket.write(chunk);
    });
    const done = () => {
      if (cap) cap.finish({ status: upRes.statusCode || 101, durationMs: Date.now() - start });
      socket.destroy(); upSocket.destroy();
    };
    socket.on('close', done); socket.on('error', done);
    upSocket.on('close', done); upSocket.on('error', done);
    if (head && head.length) socket.write(head);
  });

  upstreamReq.on('error', () => {
    if (cap) cap.finish({ status: 502, durationMs: Date.now() - start });
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    socket.destroy();
  });
  upstreamReq.end();
}

export function createProxyEngine({ store, capture = null, logger = console, httpServer = null, onEvent = () => {} }) {
  const instances = new Map(); // id -> { rule, server, status, error }
  const logs = new Map();      // id -> entry[]

  function pushLog(ruleId, entry) {
    const arr = logs.get(ruleId) || [];
    arr.push({ ts: Date.now(), ...entry });
    if (arr.length > LOG_LIMIT) arr.splice(0, arr.length - LOG_LIMIT);
    logs.set(ruleId, arr);
    onEvent({ kind: 'log', ruleId, entry: { ts: Date.now(), ...entry } });
  }

  function emitStatus(ruleId) {
    const e = instances.get(ruleId);
    onEvent({ kind: 'status', ruleId, status: e ? e.status : 'stopped', error: e ? e.error : null });
  }

  function findPathRule(pathname) {
    let best = null;
    for (const { rule } of instances.values()) {
      if (rule.mode !== 'path' || !rule.enabled) continue;
      if (matchPrefix(rule.pathPrefix, pathname)) {
        if (!best || rule.pathPrefix.length > best.pathPrefix.length) best = rule;
      }
    }
    return best;
  }

  function matchPath(pathname) { return !!findPathRule(pathname); }

  function handleHttp(req, res, url) {
    const rule = findPathRule(url.pathname);
    if (!rule) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not-found' })); return; }
    proxyHttp({ rule, req, res, capture, emit: (e) => pushLog(rule.id, e) });
  }

  function onUpgrade(req, socket, head) {
    let pathname = '/';
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { /* default */ }
    const rule = findPathRule(pathname);
    if (!rule) return;
    socket.__proxied = true;
    proxyWs({ rule, req, socket, head, capture });
  }

  function listen(rule) {
    const srv = http.createServer((req, res) => proxyHttp({ rule, req, res, capture, emit: (e) => pushLog(rule.id, e) }));
    srv.on('upgrade', (req, socket, head) => proxyWs({ rule, req, socket, head, capture }));
    return new Promise((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(rule.listenPort, rule.listenHost, () => { srv.off('error', reject); resolve(srv); });
    });
  }

  async function start(rule) {
    const entry = { rule, server: null, status: 'stopped', error: null };
    instances.set(rule.id, entry);
    if (!rule.enabled) { emitStatus(rule.id); return; }
    try {
      if (rule.mode === 'port') entry.server = await listen(rule);
      entry.status = 'running';
    } catch (e) {
      entry.status = 'error';
      entry.error = e && e.code === 'EADDRINUSE' ? 'port-in-use' : String((e && e.message) || e);
      logger.warn?.(`proxy rule ${rule.id} failed: ${entry.error}`);
    }
    emitStatus(rule.id);
  }

  function stop(id) {
    const entry = instances.get(id);
    if (!entry) return;
    if (entry.server) { try { entry.server.close(); } catch { /* ignore */ } }
    instances.delete(id);
    emitStatus(id);
  }

  async function apply(rule) { stop(rule.id); await start(rule); }
  function remove(id) { stop(id); logs.delete(id); if (capture) capture.removeRule(id); }

  function status() {
    const out = {};
    for (const [id, e] of instances) out[id] = { status: e.status, error: e.error };
    return out;
  }

  async function startEnabled() {
    for (const rule of store.list()) {
      if (rule.enabled) await start(rule);
    }
  }

  if (httpServer) httpServer.on('upgrade', onUpgrade);

  return {
    start, stop, apply, remove, status, matchPath, handleHttp, onUpgrade, startEnabled,
    logs: (id) => logs.get(id) || [],
    _instanceServer: (id) => (instances.get(id) || {}).server,
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/proxy-engine.test.js`
Expected: PASS（5 个 test）

- [ ] **Step 5: 提交**

```bash
git add server/proxy-engine.js server/test/proxy-engine.test.js
git commit -m "feat(nginx): 反向代理转发引擎（HTTP/WS/SSE）"
```

---

### Task 5: HTTP 面 `server/proxy-mount.js`

**Files:**
- Create: `server/proxy-mount.js`
- Test: `server/test/proxy-http.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/proxy-http.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createProxyMount } from '../proxy-mount.js';

function makeFakes() {
  const rules = [];
  const applied = [];
  const store = {
    list: () => rules.slice(),
    get: (id) => { const r = rules.find((x) => x.id === id); if (!r) { const e = new Error('nf'); e.code = 'not-found'; throw e; } return r; },
    create: (input) => { const r = { id: String(rules.length + 1), mode: 'port', enabled: false, target: { host: 'h', port: 1, protocol: 'http' }, ...input }; rules.push(r); return r; },
    update: (id, patch) => { const r = store.get(id); Object.assign(r, patch); return r; },
    remove: (id) => { const i = rules.findIndex((x) => x.id === id); if (i < 0) return false; rules.splice(i, 1); return true; },
  };
  const engine = { apply: async (r) => applied.push(r.id), remove: () => {}, start: async () => {}, stop: () => {}, status: () => ({}), logs: () => [] };
  const capture = { list: () => [{ id: 'c1' }], read: () => ({ record: { id: 'c1' } }), clear: () => {} };
  return { store, engine, capture, applied };
}

function call(mount, method, url, body) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => mount(req, res, new URL(req.url, 'http://x')));
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      const data = body ? JSON.stringify(body) : null;
      const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: data ? { 'content-type': 'application/json' } : {} }, (res) => {
        let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { srv.close(); resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }); });
      });
      if (data) req.write(data);
      req.end();
    });
  });
}

test('rules GET/POST/PATCH/DELETE', async () => {
  const { store, engine, capture, applied } = makeFakes();
  const mount = createProxyMount({ store, engine, capture });
  const created = await call(mount, 'POST', '/api/nginx/rules', { name: 'a', mode: 'port', listenPort: 18080, target: { protocol: 'http', host: '127.0.0.1', port: 1 } });
  assert.equal(created.status, 200);
  assert.equal(created.body.item.name, 'a');
  assert.deepEqual(applied, [created.body.item.id]);
  const list = await call(mount, 'GET', '/api/nginx/rules');
  assert.equal(list.body.items.length, 1);
  const patched = await call(mount, 'PATCH', '/api/nginx/rules', { id: created.body.item.id, name: 'b' });
  assert.equal(patched.body.item.name, 'b');
  const del = await call(mount, 'DELETE', `/api/nginx/rules?id=${created.body.item.id}`);
  assert.equal(del.body.ok, true);
});

test('start/stop 端点', async () => {
  const { store, engine, capture } = makeFakes();
  const mount = createProxyMount({ store, engine, capture });
  const r = await call(mount, 'POST', '/api/nginx/rules', { name: 'a', mode: 'port', listenPort: 18081, target: { protocol: 'http', host: '127.0.0.1', port: 1 } });
  const started = await call(mount, 'POST', `/api/nginx/rules/start?id=${r.body.item.id}`);
  assert.equal(started.body.ok, true);
});

test('captures 列表/详情/清空', async () => {
  const { store, engine, capture } = makeFakes();
  const mount = createProxyMount({ store, engine, capture });
  const l = await call(mount, 'GET', '/api/nginx/captures?rule=r1');
  assert.equal(l.body.items.length, 1);
  const d = await call(mount, 'GET', '/api/nginx/captures/r1/c1');
  assert.equal(d.body.item.record.id, 'c1');
  const c = await call(mount, 'DELETE', '/api/nginx/captures?rule=r1');
  assert.equal(c.body.ok, true);
});

test('未知路径 404', async () => {
  const { store, engine, capture } = makeFakes();
  const mount = createProxyMount({ store, engine, capture });
  const r = await call(mount, 'GET', '/api/nginx/nope');
  assert.equal(r.status, 404);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/proxy-http.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `server/proxy-mount.js`**

```js
const MAX_BODY = 1 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const STATUS = { 'not-found': 404, 'bad-request': 400, 'port-in-use': 409 };

function sendErr(res, code) {
  const c = code && STATUS[code] ? code : 'bad-request';
  sendJson(res, STATUS[c] || 400, { error: c });
}

export function createProxyMount({ store, engine, capture, logger = console }) {
  async function route(req, res, url) {
    const m = req.method;
    const seg = url.pathname.replace(/^\/api\/nginx\/?/, '').split('/').filter(Boolean);
    const head = seg[0] || '';
    let body = {};
    if (m === 'POST' || m === 'PATCH') {
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
    }

    if (head === 'rules' && seg.length === 1) {
      if (m === 'GET') {
        const list = store.list();
        return sendJson(res, 200, { items: list, status: engine.status() });
      }
      if (m === 'POST') {
        const item = store.create(body);
        await engine.apply(item);
        return sendJson(res, 200, { ok: true, item });
      }
      if (m === 'PATCH') {
        const item = store.update(String(body.id || ''), body);
        await engine.apply(item);
        return sendJson(res, 200, { ok: true, item });
      }
      if (m === 'DELETE') {
        const id = String(url.searchParams.get('id') || '');
        engine.remove(id);
        const ok = store.remove(id);
        return sendJson(res, 200, { ok });
      }
      return sendJson(res, 405, { error: 'method' });
    }

    if (head === 'rules' && seg[1] === 'start' && m === 'POST') {
      const id = String(url.searchParams.get('id') || '');
      const rule = store.get(id);
      await engine.apply({ ...rule, enabled: true });
      const saved = store.update(id, { enabled: true });
      return sendJson(res, 200, { ok: true, status: engine.status(), item: saved });
    }

    if (head === 'rules' && seg[1] === 'stop' && m === 'POST') {
      const id = String(url.searchParams.get('id') || '');
      store.get(id);
      engine.stop(id);
      const saved = store.update(id, { enabled: false });
      return sendJson(res, 200, { ok: true, status: engine.status(), item: saved });
    }

    if (head === 'log' && m === 'GET') {
      const rule = String(url.searchParams.get('rule') || '');
      return sendJson(res, 200, { items: engine.logs(rule) });
    }

    if (head === 'captures' && seg.length === 1 && m === 'GET') {
      const rule = String(url.searchParams.get('rule') || '');
      const limit = Number(url.searchParams.get('limit')) || 200;
      return sendJson(res, 200, { items: capture.list(rule, { limit }) });
    }

    if (head === 'captures' && seg.length === 1 && m === 'DELETE') {
      const rule = String(url.searchParams.get('rule') || '');
      capture.clear(rule);
      return sendJson(res, 200, { ok: true });
    }

    if (head === 'captures' && seg.length === 3 && m === 'GET') {
      const item = capture.read(seg[1], seg[2]);
      return sendJson(res, 200, { item });
    }

    return sendJson(res, 404, { error: 'not-found' });
  }

  return (req, res, url) => {
    const u = url || new URL(req.url, 'http://localhost');
    if (!u.pathname.startsWith('/api/nginx')) return sendJson(res, 404, { error: 'not-found' });
    route(req, res, u).catch((e) => {
      logger?.warn?.('nginx mount error', (e && e.message) || e);
      sendErr(res, (e && e.code) || 'bad-request');
    });
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/proxy-http.test.js`
Expected: PASS（4 个 test）

- [ ] **Step 5: 提交**

```bash
git add server/proxy-mount.js server/test/proxy-http.test.js
git commit -m "feat(nginx): /api/nginx 路由"
```

---

### Task 6: 装配与路径/升级路由

**Files:**
- Modify: `server/port-paths.js`
- Modify: `server/index.js`
- Modify: `server/ws-gateway.js`
- Test: `server/test/proxy-http.test.js`（沿用）+ 手工冒烟

- [ ] **Step 1: `server/port-paths.js` 增加抓包目录**

在 `portPaths` 返回对象里（`navicatDir` 之后）加：

```js
    proxyDir: path.join(dir, 'proxy'),
    proxyCapturesDir: path.join(dir, 'proxy', 'captures'),
```

并把 `ensurePortDirs` 的数组追加 `paths.proxyDir, paths.proxyCapturesDir`。

- [ ] **Step 2: `server/ws-gateway.js` 跳过已被反代接管的升级**

在 `httpServer.on('upgrade', (req, socket, head) => {` 之后**第一行**加：

```js
    if (socket.__proxied) return;   // 已被 nginx 反代引擎接管（见 server/index.js）
```

- [ ] **Step 3: `server/index.js` 装配**

在顶部 import 区（`createNavicatMount` 之后）加：

```js
import { createProxyStore } from './proxy-store.js';
import { createProxyCapture } from './proxy-capture.js';
import { createProxyEngine } from './proxy-engine.js';
import { createProxyMount } from './proxy-mount.js';
```

在模块级广播区（`broadcastSched` 之后）加：

```js
const broadcastNginx = (ev) => {
  if (!gateway) return;
  for (const c of gateway.conns) c.send({ type: 'nginx', ...ev });
};
```

在 `buildWorkspace` 里、`navicatMount` 创建之后加：

```js
  const proxyStore = createProxyStore({ file: path.join(paths.proxyDir, 'rules.json') });
  const proxyCapture = createProxyCapture({ rootDir: paths.proxyCapturesDir, onEvent: broadcastNginx });
  const proxyEngine = createProxyEngine({ store: proxyStore, capture: proxyCapture, httpServer: server, onEvent: broadcastNginx, logger: log });
  const proxyMount = createProxyMount({ store: proxyStore, engine: proxyEngine, capture: proxyCapture, logger: log });
```

在 `buildWorkspace` 的 `return { ... }` 对象里追加：

```js
proxyStore, proxyEngine, proxyMount,
```

在 `initWorkspace` 里、`gateway = createGateway(...)`（`if (!gateway) { ... }`）之后加：

```js
  void ws.proxyEngine.startEnabled().catch((e) => log.warn('proxy start failed', (e && e.message) || e));
```

- [ ] **Step 4: `server/index.js` 请求分发接路径规则**

在请求处理函数里、静态托管 `createStaticServer(...)` **之前**、`if (url.pathname.startsWith('/api/llm'))` 那组 `if` 之前插入：

```js
  if (ws && ws.proxyEngine && ws.proxyEngine.matchPath(url.pathname)) {
    ws.proxyEngine.handleHttp(req, res, url);
    return;
  }
```

并在同组 `if` 里、`navicatMount` 一行之后加：

```js
  if (url.pathname.startsWith('/api/nginx')) { await ws.proxyMount(req, res, url); return; }
```

- [ ] **Step 5: 冒烟（手工）**

Run（另开终端，dev 端口 33333）:

```powershell
Start-Process -FilePath "node" -ArgumentList "server/index.js" -WorkingDirectory "D:\root\devflow\devflow" -RedirectStandardOutput "logs\proxy-smoke.log" -RedirectStandardError "logs\proxy-smoke.err.log" -Environment @{ DEVFLOW_PORT = "33333" } -WindowStyle Hidden
Start-Sleep -Seconds 2
Invoke-RestMethod "http://127.0.0.1:33333/api/nginx/rules"
```

Expected: 返回 `{ items: [], status: {} }`（无异常、无 `Cannot find module`）。

- [ ] **Step 6: 提交**

```bash
git add server/port-paths.js server/index.js server/ws-gateway.js
git commit -m "feat(nginx): 装配反代引擎与路径/升级路由"
```

---

### Task 7: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 在 `shared/i18n/zh-CN.js` 新增键**

在 `tools` 命名区加 `nginx` 与 `desc.nginx`，并新增 `nginx` 命名区（放在 `nv` 区块附近，保持文件已有扁平结构）：

```js
  'tools.nginx': 'Nginx 反代',
  'tools.desc.nginx': '内置反向代理：按端口或路径转发到上游',

  'nginx.new': '新建规则',
  'nginx.name': '名称',
  'nginx.mode': '接入模式',
  'nginx.mode_port': '独立端口',
  'nginx.mode_path': 'devflow 路径',
  'nginx.listen_host': '监听地址',
  'nginx.listen_port': '监听端口',
  'nginx.path_prefix': '路径前缀',
  'nginx.strip_prefix': '去掉前缀后再转发',
  'nginx.target': '上游',
  'nginx.protocol': '协议',
  'nginx.host': '主机',
  'nginx.port': '端口',
  'nginx.tls_insecure': '忽略上游证书校验',
  'nginx.capture': '抓包',
  'nginx.headers': '自定义请求头',
  'nginx.header_name': '头名',
  'nginx.header_value': '头值',
  'nginx.add_header': '添加请求头',
  'nginx.access_url': '访问地址',
  'nginx.copy': '复制',
  'nginx.copied': '已复制',
  'nginx.start': '启用',
  'nginx.stop': '停用',
  'nginx.running': '运行中',
  'nginx.stopped': '已停用',
  'nginx.error': '错误',
  'nginx.saved': '已保存',
  'nginx.delete': '删除',
  'nginx.delete_confirm': '确定删除该规则？',
  'nginx.clear_captures': '清空抓包',
  'nginx.tab_log': '访问日志',
  'nginx.tab_capture': '抓包',
  'nginx.empty': '暂无规则',
  'nginx.empty_log': '暂无访问记录',
  'nginx.empty_capture': '暂无抓包记录',
  'nginx.time': '时间',
  'nginx.method': '方法',
  'nginx.path': '路径',
  'nginx.status': '状态',
  'nginx.duration': '耗时',
  'nginx.kind': '类型',
  'nginx.state_active': '进行中',
  'nginx.state_done': '完成',
  'nginx.truncated': '已截断',
  'nginx.req_headers': '请求头',
  'nginx.res_headers': '响应头',
  'nginx.req_body': '请求体',
  'nginx.res_body': '响应体',
  'nginx.frames': 'WS 帧',
  'nginx.dir_c2s': '客户端→上游',
  'nginx.dir_s2c': '上游→客户端',
  'nginx.binary': '二进制(base64)',
  'nginx.streaming': '流式（进行中）',
  'nginx.required_name': '请填写名称',
  'nginx.err_port_in_use': '监听端口被占用',
  'nginx.err_bad_prefix': '路径前缀非法或冲突',
  'nginx.err_not_found': '规则不存在',
```

- [ ] **Step 2: 在 `shared/i18n/en.js` 新增同名键的英文值**

```js
  'tools.nginx': 'Nginx Proxy',
  'tools.desc.nginx': 'Built-in reverse proxy: forward by port or path',

  'nginx.new': 'New rule',
  'nginx.name': 'Name',
  'nginx.mode': 'Mode',
  'nginx.mode_port': 'Standalone port',
  'nginx.mode_path': 'devflow path',
  'nginx.listen_host': 'Listen host',
  'nginx.listen_port': 'Listen port',
  'nginx.path_prefix': 'Path prefix',
  'nginx.strip_prefix': 'Strip prefix before forwarding',
  'nginx.target': 'Upstream',
  'nginx.protocol': 'Protocol',
  'nginx.host': 'Host',
  'nginx.port': 'Port',
  'nginx.tls_insecure': 'Skip upstream certificate check',
  'nginx.capture': 'Capture',
  'nginx.headers': 'Custom request headers',
  'nginx.header_name': 'Name',
  'nginx.header_value': 'Value',
  'nginx.add_header': 'Add header',
  'nginx.access_url': 'Access URL',
  'nginx.copy': 'Copy',
  'nginx.copied': 'Copied',
  'nginx.start': 'Enable',
  'nginx.stop': 'Disable',
  'nginx.running': 'Running',
  'nginx.stopped': 'Stopped',
  'nginx.error': 'Error',
  'nginx.saved': 'Saved',
  'nginx.delete': 'Delete',
  'nginx.delete_confirm': 'Delete this rule?',
  'nginx.clear_captures': 'Clear captures',
  'nginx.tab_log': 'Access log',
  'nginx.tab_capture': 'Captures',
  'nginx.empty': 'No rules',
  'nginx.empty_log': 'No requests',
  'nginx.empty_capture': 'No captures',
  'nginx.time': 'Time',
  'nginx.method': 'Method',
  'nginx.path': 'Path',
  'nginx.status': 'Status',
  'nginx.duration': 'Duration',
  'nginx.kind': 'Kind',
  'nginx.state_active': 'Active',
  'nginx.state_done': 'Done',
  'nginx.truncated': 'Truncated',
  'nginx.req_headers': 'Request headers',
  'nginx.res_headers': 'Response headers',
  'nginx.req_body': 'Request body',
  'nginx.res_body': 'Response body',
  'nginx.frames': 'WS frames',
  'nginx.dir_c2s': 'Client→Upstream',
  'nginx.dir_s2c': 'Upstream→Client',
  'nginx.binary': 'binary(base64)',
  'nginx.streaming': 'streaming (active)',
  'nginx.required_name': 'Name required',
  'nginx.err_port_in_use': 'Listen port in use',
  'nginx.err_bad_prefix': 'Invalid or conflicting path prefix',
  'nginx.err_not_found': 'Rule not found',
```

- [ ] **Step 3: 校验 i18n 对称**

Run: `npm.cmd run check:i18n`
Expected: PASS（无缺失键）

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(nginx): i18n 词条（中/英）"
```

---

### Task 8: 前端数据层 `web/src/tools/nginx/useNginx.ts`

**Files:**
- Create: `web/src/tools/nginx/useNginx.ts`
- Test: `web/src/tools/nginx/useNginx.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/src/tools/nginx/useNginx.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useNginx, type NginxRule } from './useNginx';

function okJson(body: unknown) { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response); }

beforeEach(() => vi.restoreAllMocks());

describe('useNginx', () => {
  it('load 读取规则与状态', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((u: string) => { calls.push(String(u)); return okJson({ items: [{ id: '1', name: 'a' }], status: { '1': { status: 'running' } } }); }));
    const api = useNginx();
    await api.load();
    expect(calls[0]).toBe('/api/nginx/rules');
    expect(api.rules.value.length).toBe(1);
    expect(api.status.value['1'].status).toBe('running');
  });

  it('save：无 id 用 POST，有 id 用 PATCH', async () => {
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => { methods.push(String(init?.method)); return okJson({ ok: true, item: { id: '1' } }); }));
    const api = useNginx();
    await api.save({ name: 'a' } as NginxRule);
    await api.save({ id: '1', name: 'a' } as NginxRule);
    expect(methods).toEqual(['POST', 'PATCH']);
  });

  it('capture 详情读取', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((u: string) => { urls.push(String(u)); return okJson({ item: { record: { id: 'c1' } } }); }));
    const api = useNginx();
    const rec = await api.capture('r1', 'c1');
    expect(urls[0]).toBe('/api/nginx/captures/r1/c1');
    expect(rec.record.id).toBe('c1');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm --prefix web run test -- src/tools/nginx/useNginx.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `web/src/tools/nginx/useNginx.ts`**

```ts
import { ref, type Ref } from 'vue';

export type NginxMode = 'port' | 'path';
export interface NginxHeader { name: string; value: string }
export interface NginxRule {
  id?: string;
  name: string;
  mode: NginxMode;
  enabled: boolean;
  listenHost: '127.0.0.1' | '0.0.0.0';
  listenPort: number;
  pathPrefix: string;
  stripPrefix: boolean;
  target: { protocol: 'http' | 'https'; host: string; port: number };
  tlsInsecure: boolean;
  headers: NginxHeader[];
  capture: boolean;
}
export interface NginxStatus { status: 'running' | 'stopped' | 'error'; error: string | null }
export interface NginxLogEntry { ts: number; method: string; url: string; status: number; durationMs: number; kind: string }
export interface CaptureSummary {
  id: string; ts: string; method: string; url: string; status: number; durationMs: number;
  kind: string; state: string; reqBodySize: number; resBodySize: number; frameCount: number; truncated: boolean;
}
export interface CaptureDetail {
  record: CaptureSummary & { reqHeaders: Record<string, string>; resHeaders: Record<string, string> | null };
  reqBody: string; resBody: string;
  frames: Array<{ dir: string; opcode: number; ts: number; data: string }>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function jfetch(url: string, opt: RequestInit = {}): Promise<any> {
  const res = await fetch(url, opt);
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(j?.error || `HTTP ${res.status}`));
  return j;
}

export function emptyRule(): NginxRule {
  return {
    name: '', mode: 'port', enabled: false, listenHost: '127.0.0.1', listenPort: 8081,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: 5173 },
    tlsInsecure: true, headers: [], capture: false,
  };
}

export function useNginx(): {
  rules: Ref<NginxRule[]>;
  status: Ref<Record<string, NginxStatus>>;
  load: () => Promise<void>;
  save: (r: NginxRule) => Promise<NginxRule>;
  remove: (id: string) => Promise<void>;
  start: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  log: (id: string) => Promise<NginxLogEntry[]>;
  captures: (id: string) => Promise<CaptureSummary[]>;
  capture: (ruleId: string, id: string) => Promise<CaptureDetail>;
  clearCaptures: (id: string) => Promise<void>;
} {
  const rules = ref<NginxRule[]>([]);
  const status = ref<Record<string, NginxStatus>>({});

  async function load(): Promise<void> {
    try {
      const j = await jfetch('/api/nginx/rules');
      rules.value = Array.isArray(j.items) ? j.items : [];
      status.value = j.status || {};
    } catch { /* ignore */ }
  }

  async function save(r: NginxRule): Promise<NginxRule> {
    const j = await jfetch('/api/nginx/rules', { method: r.id ? 'PATCH' : 'POST', headers: JSON_HEADERS, body: JSON.stringify(r) });
    await load();
    return j.item as NginxRule;
  }

  async function remove(id: string): Promise<void> {
    await jfetch(`/api/nginx/rules?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  }

  async function start(id: string): Promise<void> {
    await jfetch(`/api/nginx/rules/start?id=${encodeURIComponent(id)}`, { method: 'POST' });
    await load();
  }

  async function stop(id: string): Promise<void> {
    await jfetch(`/api/nginx/rules/stop?id=${encodeURIComponent(id)}`, { method: 'POST' });
    await load();
  }

  async function log(id: string): Promise<NginxLogEntry[]> {
    const j = await jfetch(`/api/nginx/log?rule=${encodeURIComponent(id)}`);
    return Array.isArray(j.items) ? j.items : [];
  }

  async function captures(id: string): Promise<CaptureSummary[]> {
    const j = await jfetch(`/api/nginx/captures?rule=${encodeURIComponent(id)}`);
    return Array.isArray(j.items) ? j.items : [];
  }

  async function capture(ruleId: string, id: string): Promise<CaptureDetail> {
    const j = await jfetch(`/api/nginx/captures/${encodeURIComponent(ruleId)}/${encodeURIComponent(id)}`);
    return j.item as CaptureDetail;
  }

  async function clearCaptures(id: string): Promise<void> {
    await jfetch(`/api/nginx/captures?rule=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  return { rules, status, load, save, remove, start, stop, log, captures, capture, clearCaptures };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm --prefix web run test -- src/tools/nginx/useNginx.test.ts`
Expected: PASS（3 个 test）

- [ ] **Step 5: 提交**

```bash
git add web/src/tools/nginx/useNginx.ts web/src/tools/nginx/useNginx.test.ts
git commit -m "feat(nginx): 前端数据层 useNginx"
```

---

### Task 9: 工具界面 `web/src/tools/nginx/NginxTool.vue`

**Files:**
- Create: `web/src/tools/nginx/NginxTool.vue`
- Test: `web/src/tools/nginx/NginxTool.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/src/tools/nginx/NginxTool.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import NginxTool from './NginxTool.vue';

function okJson(body: unknown) { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response); }
const RULE = { id: '1', name: 'web', mode: 'port', enabled: true, listenHost: '127.0.0.1', listenPort: 8081, pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: 5173 }, tlsInsecure: true, headers: [], capture: false };
const mocks = { t: (k: string) => k };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn((u: string) => {
    const s = String(u);
    if (s === '/api/nginx/rules') return okJson({ items: [RULE], status: { '1': { status: 'running', error: null } } });
    if (s.startsWith('/api/nginx/log')) return okJson({ items: [] });
    if (s.startsWith('/api/nginx/captures')) return okJson({ items: [] });
    return okJson({});
  }));
});

describe('NginxTool', () => {
  it('渲染规则并显示访问地址', async () => {
    const w = mount(NginxTool, { global: { mocks: { $t: (k: string) => k } } });
    await new Promise((r) => setTimeout(r, 0));
    expect(w.text()).toContain('web');
    expect(w.text()).toContain('127.0.0.1:8081');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm --prefix web run test -- src/tools/nginx/NginxTool.test.ts`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现 `web/src/tools/nginx/NginxTool.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { t } from '../../i18n';
import { copyText } from '../../clipboard';
import { useNginx, emptyRule, type CaptureDetail, type CaptureSummary, type NginxLogEntry, type NginxRule } from './useNginx';

const api = useNginx();
const activeId = ref('');
const form = ref<NginxRule>(emptyRule());
const tab = ref<'log' | 'capture'>('log');
const log = ref<NginxLogEntry[]>([]);
const captures = ref<CaptureSummary[]>([]);
const detail = ref<CaptureDetail | null>(null);
const busy = ref(false);
const msg = ref('');
let timer: ReturnType<typeof setInterval> | null = null;

const activeRule = computed(() => api.rules.value.find((r) => r.id === activeId.value) || null);
const activeStatus = computed(() => (activeId.value ? api.status.value[activeId.value] : null));
const accessUrl = computed(() => {
  if (!activeRule.value) return '';
  const r = activeRule.value;
  if (r.mode === 'port') return `http://${r.listenHost === '0.0.0.0' ? location.hostname : r.listenHost}:${r.listenPort}/`;
  return `${location.origin}${r.pathPrefix}/`;
});

function selectRule(r: NginxRule) {
  activeId.value = r.id || '';
  form.value = JSON.parse(JSON.stringify(r));
  detail.value = null;
}
function blankNew() {
  activeId.value = '';
  form.value = emptyRule();
  detail.value = null;
}

async function refresh() {
  if (activeId.value) {
    if (tab.value === 'log') log.value = await api.log(activeId.value).catch(() => []);
    else captures.value = await api.captures(activeId.value).catch(() => []);
  }
}

async function doSave() {
  if (!form.value.name.trim()) { msg.value = t('nginx.required_name'); return; }
  busy.value = true; msg.value = '';
  try {
    const saved = await api.save(form.value);
    activeId.value = saved.id || '';
    form.value = JSON.parse(JSON.stringify(saved));
    msg.value = t('nginx.saved');
  } catch (e) { msg.value = (e as Error).message; } finally { busy.value = false; }
}

async function doDelete() {
  if (!activeId.value) return;
  try { await ElMessageBox.confirm(t('nginx.delete_confirm'), t('nginx.delete'), { type: 'warning' }); } catch { return; }
  await api.remove(activeId.value);
  blankNew();
}

async function toggle() {
  if (!activeId.value) return;
  const running = activeStatus.value?.status === 'running';
  if (running) await api.stop(activeId.value); else await api.start(activeId.value);
  const r = api.rules.value.find((x) => x.id === activeId.value);
  if (r) form.value = JSON.parse(JSON.stringify(r));
}

async function openCapture(c: CaptureSummary) {
  detail.value = await api.capture(activeId.value, c.id).catch(() => null);
}

async function clearCaptures() {
  if (!activeId.value) return;
  await api.clearCaptures(activeId.value);
  captures.value = [];
  detail.value = null;
}

function addHeader() { form.value = { ...form.value, headers: [...form.value.headers, { name: '', value: '' }] }; }
function removeHeader(i: number) { form.value = { ...form.value, headers: form.value.headers.filter((_, j) => j !== i) }; }

async function copyUrl() { if (accessUrl.value) { await copyText(accessUrl.value); msg.value = t('nginx.copied'); } }

function tsText(ts: number | string) { return new Date(ts).toLocaleTimeString(); }

onMounted(async () => {
  await api.load();
  if (api.rules.value[0]) selectRule(api.rules.value[0]);
  await refresh();
  timer = setInterval(() => { void api.load().then(refresh); }, 2000);
});
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="ngbody">
    <aside class="nglist">
      <div class="nglisthead">
        <span>{{ $t('tools.nginx') }}</span>
        <button class="ngbtn" @click="blankNew">{{ $t('nginx.new') }}</button>
      </div>
      <div class="ngitems">
        <button v-for="r in api.rules.value" :key="r.id" class="ngitem" :class="{ on: r.id === activeId }" @click="selectRule(r)">
          <span class="ngdot" :class="(api.status.value[r.id!]?.status) || 'stopped'" />
          <span class="ngname">{{ r.name }}</span>
          <span class="ngmode">{{ r.mode === 'port' ? ':' + r.listenPort : r.pathPrefix }}</span>
        </button>
        <div v-if="!api.rules.value.length" class="ngempty">{{ $t('nginx.empty') }}</div>
      </div>
    </aside>

    <section class="ngmain">
      <div class="ngform">
        <label>{{ $t('nginx.name') }}<input v-model="form.name" class="ngin" /></label>
        <div class="ngrow">
          <label>{{ $t('nginx.mode') }}
            <select v-model="form.mode" class="ngin">
              <option value="port">{{ $t('nginx.mode_port') }}</option>
              <option value="path">{{ $t('nginx.mode_path') }}</option>
            </select>
          </label>
          <label>{{ $t('nginx.listen_host') }}
            <select v-model="form.listenHost" class="ngin">
              <option value="127.0.0.1">127.0.0.1</option>
              <option value="0.0.0.0">0.0.0.0</option>
            </select>
          </label>
          <label v-if="form.mode === 'port'">{{ $t('nginx.listen_port') }}<input v-model.number="form.listenPort" type="number" class="ngin" /></label>
          <label v-else>{{ $t('nginx.path_prefix') }}<input v-model="form.pathPrefix" class="ngin" placeholder="/app1" /></label>
        </div>
        <label v-if="form.mode === 'path'" class="ngchk"><input v-model="form.stripPrefix" type="checkbox" />{{ $t('nginx.strip_prefix') }}</label>

        <div class="ngrow">
          <label>{{ $t('nginx.protocol') }}
            <select v-model="form.target.protocol" class="ngin">
              <option value="http">http</option>
              <option value="https">https</option>
            </select>
          </label>
          <label>{{ $t('nginx.host') }}<input v-model="form.target.host" class="ngin" /></label>
          <label>{{ $t('nginx.port') }}<input v-model.number="form.target.port" type="number" class="ngin" /></label>
        </div>
        <label class="ngchk"><input v-model="form.tlsInsecure" type="checkbox" />{{ $t('nginx.tls_insecure') }}</label>
        <label class="ngchk"><input v-model="form.capture" type="checkbox" />{{ $t('nginx.capture') }}</label>

        <div class="ngheaders">
          <div class="nghd">{{ $t('nginx.headers') }}</div>
          <div v-for="(h, i) in form.headers" :key="i" class="ngrow">
            <input v-model="h.name" class="ngin" :placeholder="$t('nginx.header_name')" />
            <input v-model="h.value" class="ngin" :placeholder="$t('nginx.header_value')" />
            <button class="ngbtn" @click="removeHeader(i)">×</button>
          </div>
          <button class="ngbtn" @click="addHeader">{{ $t('nginx.add_header') }}</button>
        </div>

        <div class="ngactions">
          <button class="ngbtn primary" :disabled="busy" @click="doSave">{{ $t('nginx.saved') }}</button>
          <button v-if="activeId" class="ngbtn" @click="toggle">{{ activeStatus?.status === 'running' ? $t('nginx.stop') : $t('nginx.start') }}</button>
          <button v-if="activeId" class="ngbtn" @click="doDelete">{{ $t('nginx.delete') }}</button>
          <span v-if="msg" class="ngmsg">{{ msg }}</span>
        </div>

        <div v-if="activeId" class="ngurl">
          <span>{{ $t('nginx.access_url') }}: <code>{{ accessUrl }}</code></span>
          <button class="ngbtn" @click="copyUrl">{{ $t('nginx.copy') }}</button>
          <span v-if="activeStatus" class="ngstat" :class="activeStatus.status">{{ activeStatus.status === 'error' ? (activeStatus.error || $t('nginx.error')) : activeStatus.status }}</span>
        </div>
      </div>

      <div v-if="activeId" class="ngpanels">
        <div class="ngtabs">
          <button class="ngtab" :class="{ on: tab === 'log' }" @click="tab = 'log'; refresh()">{{ $t('nginx.tab_log') }}</button>
          <button class="ngtab" :class="{ on: tab === 'capture' }" @click="tab = 'capture'; refresh()">{{ $t('nginx.tab_capture') }}</button>
          <button v-if="tab === 'capture'" class="ngbtn" style="margin-left:auto" @click="clearCaptures">{{ $t('nginx.clear_captures') }}</button>
        </div>

        <div v-if="tab === 'log'" class="nglog">
          <div v-if="!log.length" class="ngempty">{{ $t('nginx.empty_log') }}</div>
          <div v-for="(e, i) in log" :key="i" class="nglogrow">
            <span class="c-time">{{ tsText(e.ts) }}</span>
            <span class="c-method">{{ e.method }}</span>
            <span class="c-path">{{ e.url }}</span>
            <span class="c-status" :class="{ bad: e.status >= 400 }">{{ e.status }}</span>
            <span class="c-dur">{{ e.durationMs }}ms</span>
          </div>
        </div>

        <div v-else class="ngcap">
          <div class="ngcaplist">
            <div v-if="!captures.length" class="ngempty">{{ $t('nginx.empty_capture') }}</div>
            <button v-for="c in captures" :key="c.id" class="ngcaprow" :class="{ on: detail?.record.id === c.id }" @click="openCapture(c)">
              <span>{{ tsText(c.ts) }}</span>
              <span>{{ c.method }}</span>
              <span class="c-path">{{ c.url }}</span>
              <span>{{ c.status }}</span>
              <span class="c-kind">{{ c.kind }}</span>
              <span v-if="c.state === 'active'" class="c-active">{{ $t('nginx.state_active') }}</span>
              <span v-if="c.truncated" class="c-trunc">{{ $t('nginx.truncated') }}</span>
            </button>
          </div>
          <div v-if="detail" class="ngdet">
            <div class="nghd">{{ $t('nginx.req_headers') }}</div>
            <pre>{{ JSON.stringify(detail.record.reqHeaders, null, 2) }}</pre>
            <div class="nghd">{{ $t('nginx.res_headers') }}</div>
            <pre>{{ JSON.stringify(detail.record.resHeaders, null, 2) }}</pre>
            <template v-if="detail.reqBody"><div class="nghd">{{ $t('nginx.req_body') }}</div><pre>{{ detail.reqBody }}</pre></template>
            <template v-if="detail.resBody">
              <div class="nghd">{{ $t('nginx.res_body') }}<span v-if="detail.record.state === 'active'"> · {{ $t('nginx.streaming') }}</span></div>
              <pre>{{ detail.resBody }}</pre>
            </template>
            <template v-if="detail.frames.length">
              <div class="nghd">{{ $t('nginx.frames') }}</div>
              <div v-for="(f, i) in detail.frames" :key="i" class="ngframe">
                <span>{{ f.dir === 'c2s' ? $t('nginx.dir_c2s') : $t('nginx.dir_s2c') }}</span>
                <code>{{ f.data }}</code>
              </div>
            </template>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ngbody { display: flex; height: calc(100vh - 150px); gap: 10px; }
.nglist { width: 220px; flex: none; border-right: 1px solid var(--bd); display: flex; flex-direction: column; }
.nglisthead { display: flex; align-items: center; justify-content: space-between; padding: 6px; }
.ngitems { overflow: auto; }
.ngitem { display: flex; align-items: center; gap: 6px; width: 100%; background: transparent; border: 0; color: var(--tx2); padding: 6px 8px; cursor: pointer; text-align: left; }
.ngitem.on { background: var(--bg2); color: var(--ac2); }
.ngdot { width: 8px; height: 8px; border-radius: 50%; background: #888; flex: none; }
.ngdot.running { background: #2ecc71; }
.ngdot.error { background: #e74c3c; }
.ngname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ngmode { opacity: .6; font-size: 12px; }
.ngempty { padding: 12px; opacity: .6; }
.ngmain { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.ngrow { display: flex; gap: 10px; align-items: flex-end; }
.ngform label, .ngchk { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--tx2); }
.ngchk { flex-direction: row; align-items: center; gap: 6px; }
.ngin { background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 6px; padding: 4px 6px; }
.ngbtn { background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.ngbtn.primary { border-color: var(--ac2); color: var(--ac2); }
.ngactions { display: flex; gap: 8px; align-items: center; }
.ngmsg { color: var(--ac2); }
.ngurl { display: flex; gap: 8px; align-items: center; }
.ngstat.running { color: #2ecc71; }
.ngstat.error { color: #e74c3c; }
.ngtabs { display: flex; gap: 8px; align-items: center; }
.ngtab { background: transparent; border: 0; color: var(--tx2); cursor: pointer; padding: 4px 8px; border-bottom: 2px solid transparent; }
.ngtab.on { color: var(--ac2); border-bottom-color: var(--ac2); }
.nglogrow, .ngcaprow { display: flex; gap: 10px; padding: 3px 6px; font-size: 12px; border-bottom: 1px solid var(--bd); }
.ngcaprow { width: 100%; background: transparent; border: 0; border-bottom: 1px solid var(--bd); color: var(--tx2); cursor: pointer; text-align: left; }
.ngcaprow.on { background: var(--bg2); }
.c-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-status.bad { color: #e74c3c; }
.c-active { color: #f1c40f; }
.c-trunc { color: #e67e22; }
.ngcap { display: flex; gap: 10px; }
.ngcaplist { width: 50%; max-height: 340px; overflow: auto; }
.ngdet { width: 50%; max-height: 340px; overflow: auto; }
.ngdet pre { background: var(--bg2); padding: 6px; border-radius: 6px; white-space: pre-wrap; word-break: break-all; }
.nghd { font-weight: 600; margin-top: 6px; }
.ngframe { display: flex; gap: 8px; font-size: 12px; }
</style>
```

- [ ] **Step 4: 运行确认通过**

Run: `npm --prefix web run test -- src/tools/nginx/NginxTool.test.ts`
Expected: PASS（1 个 test）

- [ ] **Step 5: 提交**

```bash
git add web/src/tools/nginx/NginxTool.vue web/src/tools/nginx/NginxTool.test.ts
git commit -m "feat(nginx): 反代工具界面"
```

---

### Task 10: 注册工具页签

**Files:**
- Modify: `web/src/tools/catalog.ts`
- Modify: `web/src/components/ToolSidebar.vue`
- Modify: `web/src/components/TerminalView.vue`
- Modify: `web/src/components/MiniTools.test.ts`

- [ ] **Step 1: `web/src/tools/catalog.ts`**

把 `ToolId` 改为包含 `'nginx'`：

```ts
export type ToolId = 'translate' | 'yaml' | 'notepad' | 'postman' | 'navicat' | 'nginx' | 'markdown' | 'base64';
```

在 `MINI_TOOLS` 数组里 `navicat` 之后加（**注意图标用 🌉，🔀 已被 LLM 中转站占用**）：

```ts
  { id: 'nginx', icon: '🌉', labelKey: 'tools.nginx', descKey: 'tools.desc.nginx' },
```

- [ ] **Step 2: `web/src/components/ToolSidebar.vue` 让 nginx 走空侧栏**

把第一行判断改为：

```ts
  if (props.tool === 'base64' || props.tool === 'nginx') return null;
```

- [ ] **Step 3: `web/src/components/TerminalView.vue` 渲染 nginx 内容**

在 import 区（`NavicatTool` 之后）加：

```ts
import NginxTool from '../tools/nginx/NginxTool.vue';
```

在模板 `<NavicatTool v-else-if="activeToolName === 'navicat'" />` 之后加：

```html
      <NginxTool v-else-if="activeToolName === 'nginx'" />
```

- [ ] **Step 4: `web/src/components/MiniTools.test.ts` 更新 IDS**

把 `IDS` 数组改为（在 `navicat` 后插 `nginx`）：

```ts
const IDS = ['notepad', 'postman', 'navicat', 'nginx', 'translate', 'yaml', 'markdown', 'base64'];
```

- [ ] **Step 5: 运行相关测试**

Run: `npm --prefix web run test -- src/components/MiniTools.test.ts src/components/ToolSidebar.test.ts src/tools/nginx`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add web/src/tools/catalog.ts web/src/components/ToolSidebar.vue web/src/components/TerminalView.vue web/src/components/MiniTools.test.ts
git commit -m "feat(nginx): 注册反代工具页签入口"
```

---

### Task 11: 全量校验与文档

**Files:**
- Modify: `AGENTS.md`（目录速览补一行）
- Modify: `README.md`（工具列表补充，可选）

- [ ] **Step 1: 全量测试**

Run: `npm.cmd test`
Expected: server 全部 PASS + web 全部 PASS

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误

- [ ] **Step 3: i18n 校验**

Run: `npm.cmd run check:i18n`
Expected: PASS

- [ ] **Step 4: 手工端到端（dev:server + dev:web）**

1. `npm.cmd run dev:server`（:33333，写 `logs\`）。
2. 本地起一个测试上游：`node -e "require('http').createServer((q,s)=>s.end('upstream-ok')).listen(19000)"`。
3. 打开 http://localhost:5173 → 市场找「Nginx 反代」→ 新建规则：`独立端口 18081 → 127.0.0.1:19000` → 启用。
4. 浏览器访问 `http://127.0.0.1:18081/` → 显示 `upstream-ok`；访问日志出现一条 200。
5. 勾选「抓包」保存 → 再访问 → 抓包页签出现记录，点开可见请求/响应头与正文。
6. 再建一条「devflow 路径」规则 `/app1 → 127.0.0.1:19000` → 访问 `http://127.0.0.1:33333/app1/` → 显示 `upstream-ok`。

- [ ] **Step 5: `AGENTS.md` 目录速览补一行**

在「小工具统一壳子」相关说明附近加：

```
- Nginx 反代（内置反向代理）：`server/proxy-store.js`（规则 `<端口数据目录>/proxy/rules.json`）+ `server/proxy-capture.js`（抓包 `<端口数据目录>/proxy/captures/<ruleId>/`）+ `server/proxy-engine.js`（HTTP/WS/SSE 转发引擎，路径规则接入主 server 分发与 `upgrade`）+ `server/proxy-mount.js`（`/api/nginx/*`）；前端 `web/src/tools/nginx/`（`NginxTool.vue` 自包含左规则列表 + 右表单/访问日志/抓包，空侧栏）。两种接入：独立监听端口 / 挂 devflow 路径；上游 https 默认不校验证书；抓包默认关、手动开、落盘不设条数上限。
```

- [ ] **Step 6: 提交**

```bash
git add AGENTS.md README.md
git commit -m "docs(nginx): 补反代工具说明"
```

---

## 交付清单

- 新增后端 4 模块 + 5 个测试文件；前端 1 组工具 + 1 个测试文件。
- 改端口路径、装配、WS 升级跳过、i18n、工具注册、AGENTS.md。
- 全量 `npm.cmd test` / `typecheck` / `check:i18n` 通过 + 手工端到端通过。
