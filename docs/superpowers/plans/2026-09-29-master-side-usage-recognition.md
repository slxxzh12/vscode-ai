# 统计截图交群主识别（通用多模态接口） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 成员把统计截图交群主识别：群主暴露通用多模态接口（`X-DF-Token` 鉴权），成员服务器带提示词调用、解析指标后上报群主落库；成员本机只回显。

**Architecture:** `usage-vision.js` 抽出 `callChat` 复用 provider 调用；群主 `usage-mount` 新增 `/api/usage/multimodal`；成员侧新模块 `usage-recognize.js` 组装 messages → 调群主接口 → `parseMetrics` → 上报 `/api/usage/report`；`index.js` 的 `onImage` 按是否配置上报目标分支。

**Tech Stack:** Node ESM（`node:test`）、Vue 3 + Element Plus。

**Spec:** `docs/superpowers/specs/2026-09-29-master-side-usage-recognition-design.md`

---

### Task 1: usage-vision 抽出 callChat

**Files:**
- Modify: `server/usage-vision.js`
- Test: `server/test/usage-vision.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/usage-vision.test.js` 顶部 import 加 `callChat`：

```js
import { parseMetrics, pickModel, createUsageVision, callChat, VISION_SYSTEM } from '../usage-vision.js';
```

在文件末尾追加：

```js
test('callChat：哨兵 image 走多模态模型，显式模型名直接用；空 messages 报 bad-messages', async () => {
  const seen = [];
  const fetchFn = async (url, init) => { seen.push(JSON.parse(init.body)); return okJson({ choices: [{ message: { content: 'hi' } }] }); };
  const resolveProvider = () => ({ id: 'deepseek', baseURL: 'https://gw/v1', apiKey: 'K', models: ['deepseek-v4-pro', 'deepseek-v4-flash-vision-exp'] });
  const a = await callChat({ resolveProvider, messages: [{ role: 'user', content: 'x' }], fetchFn });
  assert.equal(a.model, 'deepseek-v4-flash-vision-exp');
  assert.equal(a.content, 'hi');
  const b = await callChat({ resolveProvider, messages: [{ role: 'user', content: 'x' }], model: 'deepseek-v4-pro', fetchFn });
  assert.equal(b.model, 'deepseek-v4-pro');
  assert.equal(seen[0].model, 'deepseek-v4-flash-vision-exp');
  assert.equal(seen[1].model, 'deepseek-v4-pro');
  const codeOf = async () => { try { await callChat({ resolveProvider, messages: [], fetchFn }); return 'ok'; } catch (e) { return e.code; } };
  assert.equal(await codeOf(), 'bad-messages');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/usage-vision.test.js"`
Expected: FAIL（`callChat is not a function`）

- [ ] **Step 3: 实现 callChat 并重构 recognize**

在 `server/usage-vision.js` 的 `export function createUsageVision(...)` 之前插入：

```js
// 通用 chat/completions 调用：model 缺省或哨兵名 'image' → 从 provider 模型清单挑多模态模型
export async function callChat({ resolveProvider, messages, model = 'image', fetchFn = fetch, timeoutMs = 60000 }) {
  if (!Array.isArray(messages) || !messages.length) throw fail('bad-messages');
  const p = (await resolveProvider()) || null;
  if (!p || !p.baseURL) throw fail('no-provider');
  if (!p.apiKey) throw fail('no-key');
  const chosen = (!model || model === 'image') ? pickModel(p).model : model;
  if (!chosen) throw fail('bad-model');
  const url = `${String(p.baseURL).replace(/\/+$/, '')}/chat/completions`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify({ model: chosen, stream: false, messages }),
      signal: ctl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) throw fail('timeout');
    throw fail('upstream', (e && e.message) || String(e));
  }
  clearTimeout(timer);
  if (!res || !res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = (j && (j.error?.message || j.message || j.error)) || ''; } catch { /* keep empty */ }
    throw fail('upstream', `HTTP ${res ? res.status : '?'}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`);
  }
  let json;
  try { json = await res.json(); } catch { throw fail('upstream', 'invalid JSON response'); }
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw fail('empty-result');
  return { content, model: chosen };
}
```

把 `createUsageVision` 内的 `recognize` 替换为（其余不变）：

```js
  async function recognize({ data, mime = 'image/png' }) {
    if (!Buffer.isBuffer(data) || data.length === 0) throw fail('empty-image');
    if (data.length > MAX_IMAGE_BYTES) throw fail('image-too-large');
    const dataUrl = `data:${mime};base64,${data.toString('base64')}`;
    const messages = [
      { role: 'system', content: VISION_SYSTEM },
      { role: 'user', content: [
        { type: 'text', text: 'Extract the stats from this screenshot.' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] },
    ];
    const r = await callChat({ resolveProvider, messages, model: 'image', fetchFn, timeoutMs });
    return { metrics: parseMetrics(r.content), model: r.model };
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/usage-vision.test.js"`
Expected: PASS（含原有 recognize 用例）

- [ ] **Step 5: 提交**

```powershell
git add server/usage-vision.js server/test/usage-vision.test.js
git commit -m "refactor(usage): 抽出 callChat 复用多模态调用，支持 image 哨兵模型"
```

---

### Task 2: 成员侧 usage-recognize 模块

**Files:**
- Create: `server/usage-recognize.js`
- Test: `server/test/usage-recognize.test.js`

- [ ] **Step 1: 写失败测试**

新建 `server/test/usage-recognize.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVisionMessages, recognizeViaMaster } from '../usage-recognize.js';

test('buildVisionMessages：带系统提示词与图片 dataURL', () => {
  const msgs = buildVisionMessages({ mime: 'image/png', data: Buffer.from('abcd') });
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /sessions/);
  assert.equal(msgs[1].content[1].type, 'image_url');
  assert.match(msgs[1].content[1].image_url.url, /^data:image\/png;base64,/);
});

test('recognizeViaMaster：调 multimodal + report，返回 via=master', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    if (url.endsWith('/api/usage/multimodal')) return { ok: true, status: 200, json: async () => ({ content: '{"sessions":21,"messages":3986}', model: 'glm-4v-plus' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const r = await recognizeViaMaster({
    masterUrl: 'http://h:22222/', token: 'tk', data: Buffer.from('x'), mime: 'image/png',
    identity: { machineId: 'm1', username: 'u1', host: 'h', port: 22222 }, days: 7, fetchFn,
  });
  assert.equal(r.via, 'master');
  assert.equal(r.model, 'glm-4v-plus');
  assert.equal(r.metrics.sessions, 21);
  assert.equal(calls[0].url, 'http://h:22222/api/usage/multimodal');
  assert.equal(calls[0].headers['X-DF-Token'], 'tk');
  assert.equal(calls[0].body.model, 'image');
  assert.equal(calls[1].url, 'http://h:22222/api/usage/report');
  assert.equal(calls[1].body.machineId, 'm1');
  assert.equal(calls[1].body.usage.source, 'image');
  assert.equal(calls[1].body.usage.sessions, 21);
  assert.equal(calls[1].body.usage.days, 7);
});

test('recognizeViaMaster：403 → bad-token；网络异常 → upstream', async () => {
  const bad = async () => ({ ok: false, status: 403, json: async () => ({ error: 'bad-token' }) });
  await assert.rejects(
    () => recognizeViaMaster({ masterUrl: 'http://h', token: 'x', data: Buffer.from('x'), identity: { machineId: 'm' }, fetchFn: bad }),
    (e) => e.code === 'bad-token',
  );
  const boom = async () => { throw new Error('net'); };
  await assert.rejects(
    () => recognizeViaMaster({ masterUrl: 'http://h', token: 'x', data: Buffer.from('x'), identity: { machineId: 'm' }, fetchFn: boom }),
    (e) => e.code === 'upstream',
  );
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/usage-recognize.test.js"`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

新建 `server/usage-recognize.js`：

```js
import { VISION_SYSTEM, parseMetrics } from './usage-vision.js';

// 组装多模态识别消息：系统提示词（只返回 JSON 指标）+ 用户文本 + 截图 dataURL
export function buildVisionMessages({ mime = 'image/png', data }) {
  const dataUrl = `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
  return [
    { role: 'system', content: VISION_SYSTEM },
    { role: 'user', content: [
      { type: 'text', text: 'Extract the stats from this screenshot.' },
      { type: 'image_url', image_url: { url: dataUrl } },
    ] },
  ];
}

async function postJson(fetchFn, url, token, body, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DF-Token': token }, body: JSON.stringify(body), signal: ctl.signal });
  } catch (e) {
    clearTimeout(timer);
    const x = new Error('timeout');
    x.code = (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) ? 'timeout' : 'upstream';
    throw x;
  }
  clearTimeout(timer);
  if (!res || !res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = (j && (j.message || j.error)) || ''; } catch { /* keep */ }
    const x = new Error(detail || `HTTP ${res ? res.status : '?'}`);
    x.code = (res && res.status === 403) ? 'bad-token' : 'upstream';
    throw x;
  }
  return res.json();
}

// 成员侧：把截图交给群主多模态接口识别 → 解析指标 → 上报群主落库（不写成员本机）
export async function recognizeViaMaster({ masterUrl, token, data, mime, identity, days, fetchFn = fetch, timeoutMs = 60000 }) {
  const base = String(masterUrl || '').replace(/\/+$/, '');
  const messages = buildVisionMessages({ mime, data });
  const r = await postJson(fetchFn, `${base}/api/usage/multimodal`, token, { messages, model: 'image' }, timeoutMs);
  const metrics = parseMetrics(r.content);
  await postJson(fetchFn, `${base}/api/usage/report`, token, {
    machineId: identity.machineId, username: identity.username || '',
    host: identity.host || '', port: Number(identity.port) || 0,
    usage: { ...metrics, source: 'image', days },
  }, timeoutMs);
  return { metrics, model: r.model, reported: true, via: 'master' };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/usage-recognize.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add server/usage-recognize.js server/test/usage-recognize.test.js
git commit -m "feat(usage): 成员侧经群主多模态接口识别并上报"
```

---

### Task 3: usage-mount 新增 /api/usage/multimodal

**Files:**
- Modify: `server/usage-mount.js`
- Test: `server/test/usage-report-http.test.js`

- [ ] **Step 1: 写失败测试**

把 `server/test/usage-report-http.test.js` 的 `start` 辅助签名与 `createUsageMount` 调用改为带上 `onMultimodal`：

```js
async function start({ token = 'good', peers, reporter, onReport, pullFromHub, probe, loadProbe, saveProbe, setCwd, isHub, selfId, onMultimodal } = {}) {
  const p = peers || new UsagePeersStore({ file: tmp('usage-peers.json') });
  const r = reporter || createUsageReporter({
    file: tmp('usage-report.json'), identity: () => ({ machineId: 'm1' }),
    collect: async () => ({ sessions: 1 }), fetchFn: async () => ({ ok: true, json: async () => ({ ok: true }) }),
  });
  const mount = createUsageMount({ peers: p, reporter: r, checkToken: (tk) => tk === token, onReport, pullFromHub, probe, loadProbe, saveProbe, setCwd, isHub, selfId, onMultimodal });
  const server = http.createServer((req, res) => mount(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  return { peers: p, reporter: r, port: server.address().port, server };
}
```

在文件末尾追加：

```js
test('POST /api/usage/multimodal：令牌校验、bad-body、成功转发（model 缺省 image）', async (t) => {
  let seen = null;
  const A = await start({ onMultimodal: async ({ messages, model }) => { seen = { messages, model }; return { content: 'ok', model: 'glm-4v-plus' }; } });
  t.after(() => A.server.close());

  const bad = await call(A.port, 'POST', '/api/usage/multimodal', { headers: { 'X-DF-Token': 'bad' }, body: { messages: [{ role: 'user', content: 'x' }] } });
  assert.equal(bad.status, 403);
  assert.equal(bad.body.error, 'bad-token');

  const nob = await call(A.port, 'POST', '/api/usage/multimodal', { headers: { 'X-DF-Token': 'good' }, body: {} });
  assert.equal(nob.status, 400);
  assert.equal(nob.body.error, 'bad-body');

  const ok = await call(A.port, 'POST', '/api/usage/multimodal', { headers: { 'X-DF-Token': 'good' }, body: { messages: [{ role: 'user', content: 'x' }] } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.content, 'ok');
  assert.equal(ok.body.model, 'glm-4v-plus');
  assert.equal(seen.model, 'image');
});

test('POST /api/usage/multimodal：上游错误码映射', async (t) => {
  const A = await start({ onMultimodal: async () => { const e = new Error('x'); e.code = 'no-key'; throw e; } });
  t.after(() => A.server.close());
  const r = await call(A.port, 'POST', '/api/usage/multimodal', { headers: { 'X-DF-Token': 'good' }, body: { messages: [{ role: 'user', content: 'x' }] } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'no-key');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/usage-report-http.test.js"`
Expected: FAIL（新用例 404）

- [ ] **Step 3: 实现**

把 `server/usage-mount.js` 的 `readBody` 改为可传上限：

```js
function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > max) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
```

导出签名加 `onMultimodal = null`（放在 `onImage = null` 之后）：

```js
export function createUsageMount({ peers, reporter, checkToken, onReport, pullFromHub = null, probe = null, loadProbe = null, saveProbe = null, onImage = null, onMultimodal = null, setCwd = null, isHub = null, selfId = null, logger = console }) {
```

在 `route()` 里 `POST /api/usage/image` 分支之后插入：

```js
    // 群主通用多模态接口：成员带令牌调用，转发给群主配置的多模态模型
    if (seg[0] === 'multimodal' && seg.length === 1 && m === 'POST') {
      const tk = String(req.headers['x-df-token'] || '');
      if (!checkToken || !checkToken(tk)) return sendJson(res, 403, { error: 'bad-token' });
      if (typeof onMultimodal !== 'function') return sendJson(res, 500, { error: 'unavailable' });
      let body = {};
      try { body = JSON.parse((await readBody(req, MAX_IMAGE_BODY)) || '{}'); } catch { body = {}; }
      if (!Array.isArray(body.messages) || !body.messages.length) return sendJson(res, 400, { error: 'bad-body' });
      const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'image';
      try {
        return sendJson(res, 200, await onMultimodal({ messages: body.messages, model }));
      } catch (e) {
        const code = (e && e.code) || 'internal';
        const status = ['no-provider', 'no-key', 'bad-model', 'bad-messages', 'empty-result'].includes(code)
          ? 400 : code === 'timeout' ? 504 : code === 'upstream' ? 502 : 500;
        return sendJson(res, status, { error: code, message: (e && e.message) || '' });
      }
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/usage-report-http.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add server/usage-mount.js server/test/usage-report-http.test.js
git commit -m "feat(usage): 群主通用多模态接口 /api/usage/multimodal"
```

---

### Task 4: llm-config 模型路由 resolveRelayModel

**Files:**
- Modify: `server/llm-config.js`
- Test: `server/test/llm-config.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/llm-config.test.js` 末尾追加：

```js
test('resolveRelayModel：image → 默认 provider（model 空）', async () => {
  const { resolveRelayModel } = await import('../llm-config.js');
  const opts = {
    loadProviders: () => ({ defaultProvider: 'a', providers: [{ id: 'a' }, { id: 'b' }] }),
    resolveProvider: (id) => ({ id, baseURL: 'https://' + id, apiKey: 'k', models: ['va', 'v1'] }),
  };
  assert.deepEqual(resolveRelayModel('image', opts), { provider: { id: 'a', baseURL: 'https://a', apiKey: 'k', models: ['va', 'v1'] }, model: '' });
});

test('resolveRelayModel：pid/model 用对应 provider + 裸名；裸名命中 provider；无命中回退默认', async () => {
  const { resolveRelayModel } = await import('../llm-config.js');
  const opts = {
    loadProviders: () => ({ defaultProvider: 'a', providers: [{ id: 'a' }, { id: 'b' }] }),
    resolveProvider: (id) => (id === 'b' ? { id: 'b', baseURL: 'https://b', apiKey: 'k', models: ['glm-4v-plus'] } : { id: 'a', baseURL: 'https://a', apiKey: 'k', models: ['x'] }),
  };
  assert.equal(resolveRelayModel('b/glm-4v-plus', opts).provider.id, 'b');
  assert.equal(resolveRelayModel('b/glm-4v-plus', opts).model, 'glm-4v-plus');
  assert.equal(resolveRelayModel('glm-4v-plus', opts).provider.id, 'b');
  assert.equal(resolveRelayModel('unknown-model', opts).provider.id, 'a');
  assert.equal(resolveRelayModel('unknown-model', opts).model, 'unknown-model');
});

test('resolveRelayModel：无 provider 返回 null', async () => {
  const { resolveRelayModel } = await import('../llm-config.js');
  const opts = { loadProviders: () => ({ defaultProvider: null, providers: [] }), resolveProvider: () => null };
  assert.equal(resolveRelayModel('x', opts), null);
  assert.equal(resolveRelayModel('image', opts), null);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/llm-config.test.js"`
Expected: FAIL（`resolveRelayModel is not a function`）

- [ ] **Step 3: 实现**

在 `server/llm-config.js` 末尾追加：

```js
// 把请求 model 解析到 LLM 中转站 provider：
//   '' / 'image' → 默认 provider（model 留空，由调用方挑多模态）
//   'pid/model'  → 该 provider + 裸 model
//   裸 model     → 命中某 provider 的模型清单即用；否则默认 provider + 该 model
// 返回 { provider, model }（provider 为 getProvider 结果）；解析不到返回 null
export function resolveRelayModel(model, { loadProviders = loadOpencodeProviders, resolveProvider = getProvider } = {}) {
  const all = loadProviders();
  const ids = all.providers.map((p) => p.id);
  const defaultId = all.defaultProvider || ids[0] || null;
  const raw = String(model || '').trim();
  if (!raw || raw === 'image') {
    const p = defaultId ? resolveProvider(defaultId) : null;
    return p ? { provider: p, model: '' } : null;
  }
  if (raw.includes('/')) {
    const i = raw.indexOf('/');
    const p = resolveProvider(raw.slice(0, i));
    return p ? { provider: p, model: raw.slice(i + 1) } : null;
  }
  const hitId = ids.find((id) => { const p = resolveProvider(id); return p && (p.models || []).includes(raw); });
  const p = resolveProvider(hitId || defaultId);
  return p ? { provider: p, model: raw } : null;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/llm-config.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add server/llm-config.js server/test/llm-config.test.js
git commit -m "feat(llm): resolveRelayModel 把模型名解析到中转站 provider"
```

---

### Task 5: index.js 装配与 onImage 分支

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 改 import**

把 `server/index.js` 的

```js
import { createUsageVision } from './usage-vision.js';
```

改为

```js
import { createUsageVision, callChat } from './usage-vision.js';
import { recognizeViaMaster } from './usage-recognize.js';
```

把

```js
import { detectEmployeeId } from './llm-config.js';
```

改为

```js
import { detectEmployeeId, resolveRelayModel } from './llm-config.js';
```

- [ ] **Step 2: 改 onImage 并加 onMultimodal**

在 `createUsageMount({ ... })` 配置里，把原 `onImage` 替换为下面两块（`onImage` 分支 + `onMultimodal`）：

```js
    onImage: async ({ data, mime }) => {
      const cfg = usageReporter.config();
      if (cfg && cfg.masterUrl && cfg.token) {
        return recognizeViaMaster({ masterUrl: cfg.masterUrl, token: cfg.token, data, mime, identity: engine.pub, days: usageReporter.config().days });
      }
      const vision = createUsageVision({ resolveProvider: defaultProviderResolver() });
      const { metrics, model } = await vision.recognize({ data, mime });
      const a = defaultAgent();
      const usage = { agent: a.cmd, ...metrics, days: usageReporter.config().days };
      const rep = await usageReporter.reportImage(usage);
      return { metrics, model, reported: !!rep.ok, reportError: rep.error || '' };
    },
    onMultimodal: async ({ messages, model }) => {
      const r = resolveRelayModel(model);
      if (!r) { const e = new Error('bad-model'); e.code = 'bad-model'; throw e; }
      return callChat({ resolveProvider: async () => r.provider, messages, model: r.model || 'image' });
    },
```

- [ ] **Step 3: 冒烟校验**

Run: `node --test "server/test/collab-index.test.js"`
Expected: PASS（index 装配可加载）

Run: `node --check server/index.js`
Expected: 无输出（语法正确）

- [ ] **Step 4: 提交**

```powershell
git add server/index.js
git commit -m "feat(usage): 截图识别按上报目标走群主多模态接口"
```

---

### Task 6: i18n 与识别来源提示

**Files:**
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`
- Modify: `web/src/collaboration/UsageProbeDialog.vue`

- [ ] **Step 1: 加词条**

在 `shared/i18n/zh-CN.js` 的 `usage.probe.image_success` 一行之后插入（若不存在该 key，则放在 `usage.probe.image_loading` 附近）：

```js
  'usage.probe.image_via_master': '识别来源：群主',
```

在 `shared/i18n/en.js` 对应位置插入：

```js
  'usage.probe.image_via_master': 'Recognized by master',
```

- [ ] **Step 2: 结果类型加 via**

在 `web/src/collaboration/UsageProbeDialog.vue` 的 `imageResult` 类型里加 `via?: string`：

```ts
const imageResult = ref<{ metrics: Record<string, number | null>; model: string; reported: boolean; via?: string } | null>(null);
```

- [ ] **Step 3: 模板加提示**

在 `UsageProbeDialog.vue` 的结果块里、`<div class="hint">{{ imageResult.reported ? ... }}</div>` 之后插入：

```html
          <div v-if="imageResult.via === 'master'" class="hint">{{ $t('usage.probe.image_via_master') }}</div>
```

- [ ] **Step 4: 校验**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`

Run: `npm.cmd run typecheck`
Expected: 无错误

- [ ] **Step 5: 提交**

```powershell
git add shared/i18n/zh-CN.js shared/i18n/en.js web/src/collaboration/UsageProbeDialog.vue
git commit -m "feat(web): 截图识别来源提示（群主）"
```

---

### Task 7: 全量验证

- [ ] **Step 1: 跑全量测试**

Run: `npm.cmd run test:server`
Expected: 全绿

Run: `npm.cmd run test:web`
Expected: 全绿

- [ ] **Step 2: 类型与 i18n**

Run: `npm.cmd run typecheck`
Expected: 无错误

Run: `npm.cmd run check:i18n`
Expected: 通过

- [ ] **Step 3: 无新提交则结束**

若前几步无改动，无需提交；若修了测试/文案，按对应 scope 提交。

---

## 完成标准

- 群主 `/api/usage/multimodal`：令牌校验、`{ messages, model? }` 转发、`model` 缺省 `image`、错误码映射齐全。
- 成员配置了上报目标时，`/api/usage/image` 走「群主多模态识别 → 本地解析 → 上报群主」，成员本机不写用量，界面提示来源群主。
- 群主本机（无上报目标）仍走本机识别（原行为）。
- `npm.cmd run test:server` / `test:web` / `typecheck` / `check:i18n` 全绿。
