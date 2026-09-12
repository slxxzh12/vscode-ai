# 本机 LLM 代理（JWT + 信封加密 Vault）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 左侧「代理」页把本机 opencode 的 LLM provider 反向代理出去，JWT 鉴权，签名密钥/记录用信封加密落盘，生成 `opencode.json`。

**Architecture:** 复用现有 HTTP 服务：`/api/llm/<pid>/*` 透明透传上游；`/api/llm-admin/*` 管理（vault/token/config）。信封加密 vault（scrypt KEK 包裹 DEK，AES-256-GCM 加密数据）。JWT 用 Node crypto 自实现。

**Tech Stack:** Node ESM + `node:crypto`、Vue 3 + TS、node:test / Vitest。

**Spec:** `docs/superpowers/specs/2026-09-12-llm-proxy-jwt-vault-design.md`

**约定：** 命令在仓库根执行；npm 用 `npm.cmd`。只 `git add` 本任务文件。用户可见文案走 i18n。

**实现细化（与 spec 的差异，行为一致）：** `opencode.json` 生成放在服务端 `server/llm-config.js` 的 `buildOpencodeConfig`（路由返回字符串，前端只展示），不再单列 `web/src/llm.ts`。

---

## Task 1: 信封加密密钥库 `server/llm-vault.js`

**Files:**
- Create: `server/llm-vault.js`
- Test: `server/test/llm-vault.test.js`

- [ ] **Step 1: 写失败测试**

新建 `server/test/llm-vault.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVault } from '../llm-vault.js';

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfvault-')), 'llm.vault.json'); }

test('init/unlock/lock 往返，数据可读写', () => {
  const file = tmpFile();
  const v = createVault({ file });
  assert.deepEqual(v.status(), { initialized: false, unlocked: false });
  v.init('pw1');
  assert.equal(v.status().unlocked, true);
  v.update((d) => { d.jwtSecret = 'S'; d.tokens = [{ id: 'a' }]; });
  v.lock();
  assert.equal(v.status().unlocked, false);
  assert.throws(() => v.getData(), (e) => e.code === 'locked');
  v.unlock('pw1');
  assert.equal(v.getData().jwtSecret, 'S');
  assert.equal(v.getData().tokens.length, 1);
});

test('错口令解锁失败', () => {
  const file = tmpFile();
  const v = createVault({ file });
  v.init('right');
  v.lock();
  assert.throws(() => v.unlock('wrong'), (e) => e.code === 'bad-passphrase');
});

test('密文被篡改则解锁失败', () => {
  const file = tmpFile();
  const v = createVault({ file });
  v.init('pw');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ct = Buffer.from(raw.data.ct, 'base64');
  ct[0] ^= 0xff;
  raw.data.ct = ct.toString('base64');
  fs.writeFileSync(file, JSON.stringify(raw));
  const v2 = createVault({ file });
  assert.throws(() => v2.unlock('pw'), (e) => e.code === 'bad-passphrase');
});

test('改口令后旧口令失效、新口令可解锁', () => {
  const file = tmpFile();
  const v = createVault({ file });
  v.init('old');
  v.update((d) => { d.jwtSecret = 'K'; });
  v.changePassphrase('old', 'new');
  v.lock();
  assert.throws(() => v.unlock('old'), (e) => e.code === 'bad-passphrase');
  v.unlock('new');
  assert.equal(v.getData().jwtSecret, 'K');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/llm-vault.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

新建 `server/llm-vault.js`：

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const KDF = { name: 'scrypt', N: 32768, r: 8, p: 1 };
const MAXMEM = 64 * 1024 * 1024;

function b64(buf) { return Buffer.from(buf).toString('base64'); }
function unb64(s) { return Buffer.from(s, 'base64'); }
function deriveKek(passphrase, salt) {
  return crypto.scryptSync(Buffer.from(passphrase, 'utf8'), salt, 32, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: MAXMEM });
}
function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { iv: b64(iv), tag: b64(c.getAuthTag()), ct: b64(ct) };
}
function decrypt(key, box) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, unb64(box.iv));
  d.setAuthTag(unb64(box.tag));
  return Buffer.concat([d.update(unb64(box.ct)), d.final()]);
}
function badErr(code, message) { const e = new Error(message || code); e.code = code; return e; }

export function createVault({ file }) {
  let dek = null;
  let data = null;
  function read() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
  function write(obj) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
    fs.renameSync(tmp, file);
  }
  function persist() { const raw = read(); raw.data = encrypt(dek, Buffer.from(JSON.stringify(data), 'utf8')); write(raw); }
  return {
    status() { const raw = read(); return { initialized: !!raw, unlocked: !!dek }; },
    init(passphrase) {
      if (read()) throw badErr('exists', 'vault already initialized');
      const salt = crypto.randomBytes(16);
      const kek = deriveKek(passphrase, salt);
      dek = crypto.randomBytes(32);
      data = { enabled: false, jwtSecret: '', tokens: [] };
      const raw = { v: 1, salt: b64(salt), kdf: { ...KDF }, wrappedDek: encrypt(kek, dek), data: null };
      raw.data = encrypt(dek, Buffer.from(JSON.stringify(data), 'utf8'));
      write(raw);
      return this.status();
    },
    unlock(passphrase) {
      const raw = read();
      if (!raw) throw badErr('not-init', 'vault not initialized');
      const d = decrypt(deriveKek(passphrase, unb64(raw.salt)), raw.wrappedDek).length ? null : null; // scrypt 解包失败会在下面抛
      void d;
      let dekBuf;
      try { dekBuf = decrypt(deriveKek(passphrase, unb64(raw.salt)), raw.wrappedDek); } catch { throw badErr('bad-passphrase', 'bad passphrase'); }
      try { data = JSON.parse(decrypt(dekBuf, raw.data).toString('utf8')); } catch { throw badErr('bad-passphrase', 'bad passphrase'); }
      dek = dekBuf;
      return this.status();
    },
    lock() { dek = null; data = null; return this.status(); },
    getData() { if (!data) throw badErr('locked', 'vault locked'); return data; },
    update(fn) { if (!data) throw badErr('locked', 'vault locked'); fn(data); persist(); return data; },
    changePassphrase(oldP, newP) {
      const raw = read();
      if (!raw) throw badErr('not-init', 'vault not initialized');
      let dekBuf;
      try { dekBuf = decrypt(deriveKek(oldP, unb64(raw.salt)), raw.wrappedDek); } catch { throw badErr('bad-passphrase', 'bad passphrase'); }
      const salt = crypto.randomBytes(16);
      raw.salt = b64(salt);
      raw.wrappedDek = encrypt(deriveKek(newP, salt), dekBuf);
      write(raw);
      if (dek) dek = dekBuf;
      return this.status();
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/llm-vault.test.js`
Expected: PASS（4 用例）。

- [ ] **Step 5: Commit**

```bash
git add server/llm-vault.js server/test/llm-vault.test.js
git commit -m "feat(server): LLM 信封加密密钥库 vault"
```

---

## Task 2: JWT `server/llm-jwt.js`

**Files:**
- Create: `server/llm-jwt.js`
- Test: `server/test/llm-jwt.test.js`

- [ ] **Step 1: 写失败测试**

新建 `server/test/llm-jwt.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signJwt, verifyJwt } from '../llm-jwt.js';

test('签验往返', () => {
  const t = signJwt({ sub: 'E001', jti: 'x' }, 'secret', { now: 1000 * 1000 });
  const p = verifyJwt(t, 'secret', { now: 1000 * 1000 + 1000 });
  assert.equal(p.sub, 'E001');
  assert.equal(p.jti, 'x');
});

test('错密钥验签失败', () => {
  const t = signJwt({ sub: 'a', jti: 'x' }, 'k1', { now: 0 });
  assert.throws(() => verifyJwt(t, 'k2', { now: 0 }), (e) => e.code === 'bad-signature');
});

test('过期失败', () => {
  const t = signJwt({ sub: 'a', jti: 'x', exp: 100 }, 'k', { now: 0 });
  assert.throws(() => verifyJwt(t, 'k', { now: 200 * 1000 }), (e) => e.code === 'expired');
});

test('篡改 payload 失败', () => {
  const t = signJwt({ sub: 'a', jti: 'x' }, 'k', { now: 0 });
  const parts = t.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'b', jti: 'y' })).toString('base64url');
  assert.throws(() => verifyJwt(`${parts[0]}.${forged}.${parts[2]}`, 'k', { now: 0 }), (e) => e.code === 'bad-signature');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/llm-jwt.test.js`
Expected: FAIL。

- [ ] **Step 3: 实现**

新建 `server/llm-jwt.js`：

```js
import crypto from 'node:crypto';

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function fromB64url(s) { return Buffer.from(s, 'base64url'); }
function err(code, message) { const e = new Error(message || code); e.code = code; return e; }

export function signJwt(payload, secret, { now = Date.now() } = {}) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: payload.iat ?? Math.floor(now / 1000) };
  const h = b64url(JSON.stringify(header));
  const b = b64url(JSON.stringify(body));
  const sig = b64url(crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest());
  return `${h}.${b}.${sig}`;
}

export function verifyJwt(token, secret, { now = Date.now() } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw err('bad-token');
  const [h, b, s] = parts;
  const expect = b64url(crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest());
  const a = Buffer.from(s);
  const e = Buffer.from(expect);
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) throw err('bad-signature');
  let payload;
  try { payload = JSON.parse(fromB64url(b).toString('utf8')); } catch { throw err('bad-payload'); }
  if (typeof payload.exp === 'number' && Math.floor(now / 1000) >= payload.exp) throw err('expired');
  return payload;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/llm-jwt.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/llm-jwt.js server/test/llm-jwt.test.js
git commit -m "feat(server): HS256 JWT 签验"
```

---

## Task 3: 上游读取与配置生成 `server/llm-config.js`

**Files:**
- Create: `server/llm-config.js`
- Test: `server/test/llm-config.test.js`

- [ ] **Step 1: 写失败测试**

新建 `server/test/llm-config.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOpencodeProviders, resolveApiKey, listProviders, getProvider, buildOpencodeConfig } from '../llm-config.js';

function dirWith(obj, name = 'opencode.json') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  fs.writeFileSync(path.join(d, name), typeof obj === 'string' ? obj : JSON.stringify(obj));
  return d;
}

test('解析 provider 列表与默认 provider', () => {
  const dir = dirWith({
    model: 'corp/gpt-4o',
    provider: { corp: { name: 'Corp', options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: { 'gpt-4o': {}, 'gpt-4o-mini': {} } }, openai: { options: { baseURL: 'https://api.openai.com/v1', apiKey: '{env:OPENAI_API_KEY}' } } },
  });
  const { providers, defaultProvider } = loadOpencodeProviders({ dir });
  assert.equal(defaultProvider, 'corp');
  assert.equal(providers.length, 2);
  assert.deepEqual(providers[0].models, ['gpt-4o', 'gpt-4o-mini']);
});

test('resolveApiKey 支持 {env:}', () => {
  assert.equal(resolveApiKey('{env:FOO}', { FOO: 'bar' }), 'bar');
  assert.equal(resolveApiKey('plain', {}), 'plain');
});

test('listProviders 不泄露 key，只给 hasKey', () => {
  const dir = dirWith({ provider: { corp: { options: { baseURL: 'https://gw/v1', apiKey: 'SECRET' } } } });
  const { providers } = listProviders({ dir });
  assert.equal(providers[0].hasKey, true);
  assert.equal(providers[0].apiKey, undefined);
});

test('getProvider 解析出 key', () => {
  const dir = dirWith({ provider: { corp: { options: { baseURL: 'https://gw/v1', apiKey: 'S' } } } });
  const p = getProvider('corp', { dir });
  assert.equal(p.apiKey, 'S');
});

test('jsonc 去注释 + 缺文件降级', () => {
  const dir = dirWith('{ // c\n "provider": { "a": { "options": { "baseURL": "https://x/v1" } } } }');
  const { providers } = loadOpencodeProviders({ dir });
  assert.equal(providers[0].id, 'a');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  assert.deepEqual(loadOpencodeProviders({ dir: empty }), { providers: [], defaultProvider: null });
});

test('buildOpencodeConfig 生成 opencode.json 结构', () => {
  const c = buildOpencodeConfig({ host: '192.168.1.5', port: 22222, providerId: 'corp', baseURL: 'https://gw/v1', token: 'JWT', models: ['gpt-4o'] });
  const p = c.provider['devflow-corp'];
  assert.equal(p.options.baseURL, 'http://192.168.1.5:22222/api/llm/corp/v1');
  assert.equal(p.options.apiKey, 'JWT');
  assert.deepEqual(p.models, { 'gpt-4o': {} });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/llm-config.test.js`
Expected: FAIL。

- [ ] **Step 3: 实现**

新建 `server/llm-config.js`：

```js
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function opencodeConfigDir() {
  return process.env.DEVFLOW_OPENCODE_CONFIG || path.join(os.homedir(), '.config', 'opencode');
}

function stripJsonc(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readConfigFile(dir) {
  for (const name of ['opencode.json', 'opencode.jsonc']) {
    const f = path.join(dir, name);
    try { return fs.readFileSync(f, 'utf8'); } catch { /* next */ }
  }
  return null;
}

export function loadOpencodeProviders({ dir = opencodeConfigDir() } = {}) {
  const raw = readConfigFile(dir);
  if (raw == null) return { providers: [], defaultProvider: null };
  let json;
  try { json = JSON.parse(raw); } catch { try { json = JSON.parse(stripJsonc(raw)); } catch { return { providers: [], defaultProvider: null }; } }
  const providers = [];
  for (const [id, p] of Object.entries(json.provider || {})) {
    const o = (p && p.options) || {};
    providers.push({ id, name: (p && p.name) || id, baseURL: o.baseURL || '', apiKeyRaw: o.apiKey || '', models: Object.keys((p && p.models) || {}) });
  }
  const model = typeof json.model === 'string' ? json.model : '';
  const defaultProvider = model.includes('/') ? model.split('/')[0] : (providers[0] ? providers[0].id : null);
  return { providers, defaultProvider };
}

export function resolveApiKey(raw, env = process.env) {
  if (typeof raw !== 'string') return '';
  const m = raw.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/);
  return m ? (env[m[1]] || '') : raw;
}

export function listProviders(opts) {
  const { providers, defaultProvider } = loadOpencodeProviders(opts);
  return {
    defaultProvider,
    providers: providers.map((p) => ({ id: p.id, name: p.name, baseURL: p.baseURL, hasKey: !!resolveApiKey(p.apiKeyRaw), models: p.models })),
  };
}

export function getProvider(id, opts) {
  const { providers } = loadOpencodeProviders(opts);
  const p = providers.find((x) => x.id === id);
  if (!p) return null;
  return { id: p.id, baseURL: p.baseURL, apiKey: resolveApiKey(p.apiKeyRaw), models: p.models };
}

export function buildOpencodeConfig({ host, port, providerId, baseURL, token, models = [] }) {
  let basePath = '';
  try { basePath = new URL(baseURL).pathname.replace(/\/+$/, ''); } catch { basePath = ''; }
  const clientBase = `http://${host}:${port}/api/llm/${encodeURIComponent(providerId)}${basePath}`;
  const modelMap = {};
  for (const m of models) modelMap[m] = {};
  return {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      [`devflow-${providerId}`]: {
        npm: '@ai-sdk/openai-compatible',
        name: `DevFlow ${providerId}`,
        options: { baseURL: clientBase, apiKey: token },
        models: modelMap,
      },
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/llm-config.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/llm-config.js server/test/llm-config.test.js
git commit -m "feat(server): 读 opencode provider 与生成 opencode.json"
```

---

## Task 4: 代理转发 `server/llm-proxy.js`

**Files:**
- Create: `server/llm-proxy.js`
- Test: `server/test/llm-proxy.test.js`

- [ ] **Step 1: 写失败测试**

新建 `server/test/llm-proxy.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { resolveTarget, extractToken, injectUpstreamAuth, createProxyHandler } from '../llm-proxy.js';

test('resolveTarget 拼接 basePath（缺失则补、已含则用）', () => {
  assert.equal(resolveTarget('https://gw/v1', '/chat', '?a=1').toString(), 'https://gw/v1/chat?a=1');
  assert.equal(resolveTarget('https://gw/v1', '/v1/chat', '').toString(), 'https://gw/v1/chat');
  assert.equal(resolveTarget('https://gw', '/chat', '').toString(), 'https://gw/chat');
});

test('extractToken 支持 Bearer 与 x-api-key', () => {
  assert.equal(extractToken({ authorization: 'Bearer abc' }), 'abc');
  assert.equal(extractToken({ 'x-api-key': 'k' }), 'k');
  assert.equal(extractToken({}), '');
});

test('injectUpstreamAuth 覆盖鉴权头', () => {
  const h = injectUpstreamAuth({ authorization: 'Bearer client', 'x-api-key': 'client', 'content-type': 'application/json', host: 'x' }, 'UP');
  assert.equal(h.authorization, 'Bearer UP');
  assert.equal(h['x-api-key'], 'UP');
  assert.equal(h['content-type'], 'application/json');
  assert.equal(h.host, undefined);
});

test('createProxyHandler 校验 JWT 并透传上游', async (t) => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ got: req.headers['x-api-key'], path: req.url }));
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  t.after(() => upstream.close());
  const baseURL = `http://127.0.0.1:${upstream.address().port}/v1`;

  const vault = { getData: () => ({ jwtSecret: 'S', tokens: [{ jti: 'j1', revoked: false }] }) };
  const handler = createProxyHandler({ vault, getProvider: () => ({ baseURL, apiKey: 'UPKEY' }), isEnabled: () => true });

  const fakeRes = { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b; } };
  const fakeReq = { method: 'POST', headers: { 'authorization': 'Bearer TOK' }, pipe(dest) { dest.end(); } };
  await handler(fakeReq, fakeRes, { providerId: 'corp', rest: '/chat/completions', query: '' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fakeRes.code, 200);
  const j = JSON.parse(fakeRes.body);
  assert.equal(j.got, 'UPKEY');
  assert.equal(j.path, '/v1/chat/completions');
});

test('createProxyHandler 停用时 404', async () => {
  const handler = createProxyHandler({ vault: { getData: () => ({ jwtSecret: 'S', tokens: [] }) }, getProvider: () => ({ baseURL: 'http://x/v1', apiKey: '' }), isEnabled: () => false });
  const fakeRes = { code: 0, writeHead(c) { this.code = c; }, end() {} };
  await handler({ method: 'GET', headers: {}, pipe() {} }, fakeRes, { providerId: 'corp', rest: '/x', query: '' });
  assert.equal(fakeRes.code, 404);
});
```

`createProxyHandler` 的鉴权依赖 JWT 验签：集成用例里可用真实 `signJwt` 生成 token。为简化，把测试改为使用真实签名（导入 `signJwt`）：

```js
import { signJwt } from '../llm-jwt.js';
// ...
const vault = { getData: () => ({ jwtSecret: 'S', tokens: [{ jti: 'j1', revoked: false }] }) };
const token = signJwt({ sub: 'e', jti: 'j1' }, 'S');
const fakeReq = { method: 'POST', headers: { authorization: `Bearer ${token}` }, pipe(dest) { dest.end(); } };
```

（`fakeReq.headers` 同时用于 `injectUpstreamAuth`，因此上面的 `got` 断言成立。）

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/llm-proxy.test.js`
Expected: FAIL。

- [ ] **Step 3: 实现**

新建 `server/llm-proxy.js`：

```js
import http from 'node:http';
import https from 'node:https';
import { verifyJwt } from './llm-jwt.js';

export function resolveTarget(baseURL, rest, query = '') {
  const u = new URL(baseURL);
  const basePath = u.pathname.replace(/\/+$/, '');
  let p = rest.startsWith('/') ? rest : '/' + rest;
  if (basePath && p !== basePath && !p.startsWith(basePath + '/')) p = basePath + p;
  const out = new URL(u.origin + p);
  out.search = query || '';
  return out;
}

export function extractToken(headers) {
  const auth = headers['authorization'] || '';
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const k = headers['x-api-key'];
  return typeof k === 'string' ? k : '';
}

export function injectUpstreamAuth(headers, apiKey) {
  const out = { ...headers };
  delete out.host;
  delete out['content-length'];
  if (apiKey) { out.authorization = `Bearer ${apiKey}`; out['x-api-key'] = apiKey; }
  else { delete out.authorization; delete out['x-api-key']; }
  return out;
}

function deny(res, code, error) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error }));
}

export function createProxyHandler({ vault, getProvider, isEnabled }) {
  return async function handle(req, res, { providerId, rest, query }) {
    if (!isEnabled()) return deny(res, 404, 'proxy disabled');
    const provider = getProvider(providerId);
    if (!provider || !provider.baseURL) return deny(res, 404, 'provider not found');
    let data;
    try { data = vault.getData(); } catch { return deny(res, 401, 'locked'); }
    if (!data.jwtSecret) return deny(res, 401, 'no secret');
    const token = extractToken(req.headers);
    if (!token) return deny(res, 401, 'no token');
    let payload;
    try { payload = verifyJwt(token, data.jwtSecret); } catch { return deny(res, 401, 'invalid token'); }
    const rec = (data.tokens || []).find((t) => t.jti === payload.jti && !t.revoked);
    if (!rec) return deny(res, 401, 'revoked');
    let target;
    try { target = resolveTarget(provider.baseURL, rest, query); } catch { return deny(res, 502, 'bad upstream'); }
    const mod = target.protocol === 'https:' ? https : http;
    const headers = injectUpstreamAuth(req.headers, provider.apiKey);
    const preq = mod.request({
      protocol: target.protocol, hostname: target.hostname, port: target.port,
      method: req.method, path: target.pathname + target.search, headers,
    }, (pres) => {
      res.writeHead(pres.statusCode || 502, pres.headers);
      pres.pipe(res);
    });
    preq.on('error', () => { try { deny(res, 502, 'upstream error'); } catch { /* ignore */ } });
    req.pipe(preq);
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/llm-proxy.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/llm-proxy.js server/test/llm-proxy.test.js
git commit -m "feat(server): LLM 透明代理转发"
```

---

## Task 5: 管理路由与接线 `server/llm-mount.js` + index.js

**Files:**
- Create: `server/llm-mount.js`
- Modify: `server/index.js`
- Test: `server/test/llm-mount.test.js`

- [ ] **Step 1: 写失败测试**

新建 `server/test/llm-mount.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVault } from '../llm-vault.js';
import { createLlmMount } from '../llm-mount.js';

function tmpVault() { return createVault({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfm-')), 'llm.vault.json') }); }

async function start(vault) {
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234 });
  const server = http.createServer((req, res) => { const url = new URL(req.url, 'http://x'); mount(req, res, url); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}
function jpost(server, url, obj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(obj);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    req.on('error', reject); req.end(data);
  });
}
function jget(server, url) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: url }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b })); }).on('error', reject);
  });
}

test('init/unlock/secret/token/config 流程', async (t) => {
  const vault = tmpVault();
  const server = await start(vault);
  t.after(() => server.close());
  assert.equal((await jpost(server, '/api/llm-admin/vault/init', { passphrase: 'pw' })).status, 200);
  assert.equal((await jpost(server, '/api/llm-admin/secret', {})).status, 200);
  const tok = await jpost(server, '/api/llm-admin/tokens', { employeeId: 'E1', days: 30 });
  assert.equal(tok.status, 200);
  const rec = JSON.parse(tok.body).token;
  assert.ok(rec.jwt.split('.').length === 3);
  const st = await jget(server, '/api/llm-admin/tokens');
  assert.equal(JSON.parse(st.body).tokens.length, 1);
});

test('未解锁时受保护接口 423，status 可读', async (t) => {
  const vault = tmpVault();
  vault.init('pw');
  vault.lock();
  const server = await start(vault);
  t.after(() => server.close());
  assert.equal((await jget(server, '/api/llm-admin/status')).status, 200);
  assert.equal((await jget(server, '/api/llm-admin/tokens')).status, 423);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/llm-mount.test.js`
Expected: FAIL。

- [ ] **Step 3: 实现 `server/llm-mount.js`**

```js
import crypto from 'node:crypto';
import { signJwt } from './llm-jwt.js';
import { listProviders, getProvider, buildOpencodeConfig } from './llm-config.js';
import { createProxyHandler } from './llm-proxy.js';

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

export function createLlmMount({ vault, host, port, logger = console }) {
  const proxy = createProxyHandler({
    vault,
    getProvider: (id) => getProvider(id),
    isEnabled: () => { try { return !!vault.getData().enabled; } catch { return false; } },
  });
  return async function mount(req, res, url) {
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/llm-admin')) {
      const m = pathname.match(/^\/api\/llm\/([^/]+)(\/.*)?$/);
      if (m) {
        return proxy(req, res, { providerId: decodeURIComponent(m[1]), rest: m[2] || '/', query: url.search.replace(/^\?/, '') });
      }
      return sendJson(res, 404, { error: 'not found' });
    }
    const seg = pathname.replace(/^\/api\/llm-admin\/?/, '').split('/').filter(Boolean);
    const method = req.method;
    const locked = () => { const s = vault.status(); return s.initialized && !s.unlocked; };
    try {
      if (seg[0] === 'status' && method === 'GET') {
        const s = vault.status();
        const lp = listProviders();
        return sendJson(res, 200, { vault: s, enabled: s.unlocked ? !!vault.getData().enabled : false, host, port, defaultProvider: lp.defaultProvider, providers: lp.providers });
      }
      if (seg[0] === 'vault' && seg[1] === 'init' && method === 'POST') { const b = await readJson(req); vault.init(String(b.passphrase || '')); return sendJson(res, 200, { ok: true, vault: vault.status() }); }
      if (seg[0] === 'vault' && seg[1] === 'unlock' && method === 'POST') { const b = await readJson(req); vault.unlock(String(b.passphrase || '')); return sendJson(res, 200, { ok: true, vault: vault.status() }); }
      if (seg[0] === 'vault' && seg[1] === 'lock' && method === 'POST') { vault.lock(); return sendJson(res, 200, { ok: true, vault: vault.status() }); }
      if (seg[0] === 'vault' && seg[1] === 'passphrase' && method === 'POST') { const b = await readJson(req); vault.changePassphrase(String(b.old || ''), String(b.new || '')); return sendJson(res, 200, { ok: true }); }
      if (locked()) return sendJson(res, 423, { error: 'locked' });
      if (seg[0] === 'enabled' && method === 'POST') { const b = await readJson(req); vault.update((d) => { d.enabled = !!b.enabled; }); return sendJson(res, 200, { ok: true, enabled: !!b.enabled }); }
      if (seg[0] === 'secret' && method === 'POST') {
        const b = await readJson(req);
        const secret = (typeof b.secret === 'string' && b.secret) ? b.secret : crypto.randomBytes(32).toString('base64url');
        vault.update((d) => { d.jwtSecret = secret; });
        return sendJson(res, 200, { ok: true, secret });
      }
      if (seg[0] === 'tokens' && method === 'GET') return sendJson(res, 200, { tokens: vault.getData().tokens });
      if (seg[0] === 'tokens' && method === 'POST') {
        const b = await readJson(req);
        const d = vault.getData();
        if (!d.jwtSecret) return sendJson(res, 400, { error: 'no-secret' });
        const employeeId = String(b.employeeId || '').trim();
        const days = Number(b.days) || 0;
        if (!employeeId || days <= 0) return sendJson(res, 400, { error: 'bad-input' });
        const now = Date.now();
        const exp = Math.floor(now / 1000) + days * 86400;
        const jti = crypto.randomUUID();
        const jwt = signJwt({ sub: employeeId, jti, exp }, d.jwtSecret);
        const rec = { id: crypto.randomUUID(), employeeId, jwt, iat: Math.floor(now / 1000), exp, jti, revoked: false };
        vault.update((x) => { x.tokens.push(rec); });
        return sendJson(res, 200, { ok: true, token: rec });
      }
      if (seg[0] === 'tokens' && seg[1] && method === 'DELETE') {
        const id = decodeURIComponent(seg[1]);
        vault.update((d) => { const t = d.tokens.find((x) => x.id === id); if (t) t.revoked = true; });
        return sendJson(res, 200, { ok: true });
      }
      if (seg[0] === 'opencode-config' && method === 'GET') {
        const providerId = url.searchParams.get('provider') || '';
        const tokenId = url.searchParams.get('token') || '';
        const d = vault.getData();
        const rec = d.tokens.find((t) => t.id === tokenId);
        if (!rec) return sendJson(res, 404, { error: 'token not found' });
        const p = getProvider(providerId);
        if (!p || !p.baseURL) return sendJson(res, 404, { error: 'provider not found' });
        const config = JSON.stringify(buildOpencodeConfig({ host, port, providerId, baseURL: p.baseURL, token: rec.jwt, models: p.models }), null, 2);
        return sendJson(res, 200, { config });
      }
      return sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      if (e.code === 'bad-passphrase') return sendJson(res, 400, { error: 'bad-passphrase' });
      if (e.code === 'exists') return sendJson(res, 409, { error: 'exists' });
      if (e.code === 'not-init') return sendJson(res, 400, { error: 'not-init' });
      logger?.warn?.('llm mount error', e && e.message);
      return sendJson(res, 500, { error: 'internal', message: String((e && e.message) || e) });
    }
  };
}
```

- [ ] **Step 4: 接线 `server/index.js`**

在 `server/index.js` 顶部 import 区加入：

```js
import { createVault } from './llm-vault.js';
import { createLlmMount } from './llm-mount.js';
import { detectHost } from './collaboration/identity.js';
import { downloadsDir } from './data-home.js';
```

在 `buildWorkspace` 内 `const httpApi = createHttpApi({...});` 之前插入（**固定位置**，与 `devflow.xml` 同目录，不随档案变化）：

```js
  const llmVault = createVault({ file: path.join(downloadsDir(), 'llm.vault.json') });
  const llmMount = createLlmMount({ vault: llmVault, host: detectHost(), port, logger: log });
```

把 `return { projects, ... }` 改为包含 `llmMount, llmVault`：

```js
  return { projects, saveProjects, workflows, sessionManager, workflowRunner, engine, collabMount, scheduler, httpApi, llmMount, llmVault, historyFile: paths.historyFile, paths, heartbeat: null };
```

在 `server/index.js:449` 的 `if (url.pathname.startsWith('/api/collab'))` 之前插入：

```js
  if (url.pathname.startsWith('/api/llm')) { await ws.llmMount(req, res, url); return; }
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test server/test/llm-mount.test.js`
Expected: PASS。

Run: `node --test "server/test/*.test.js"`
Expected: 全部 PASS（无回归）。

- [ ] **Step 6: Commit**

```bash
git add server/llm-mount.js server/index.js server/test/llm-mount.test.js
git commit -m "feat(server): LLM 代理管理路由与接线"
```

---

## Task 6: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 中文词条**

在 `shared/i18n/zh-CN.js` 末尾（最后一个 `};` 之前）加入：

```js
  'nav.proxy': '代理',
  'llm.title': '本机 LLM 代理',
  'llm.vault.title': '密钥库',
  'llm.vault.not_init': '未初始化',
  'llm.vault.locked': '已锁定',
  'llm.vault.unlocked': '已解锁',
  'llm.vault.passphrase': '口令',
  'llm.vault.init': '初始化',
  'llm.vault.unlock': '解锁',
  'llm.vault.lock': '锁定',
  'llm.vault.old': '原口令',
  'llm.vault.new': '新口令',
  'llm.vault.change': '改口令',
  'llm.secret.title': 'JWT 签名密钥',
  'llm.secret.placeholder': '留空则随机生成',
  'llm.secret.set': '保存密钥',
  'llm.provider.title': '上游 provider',
  'llm.provider.none': '未读到 opencode provider',
  'llm.provider.nokey': '未读到密钥',
  'llm.proxy.title': '代理开关',
  'llm.proxy.enable': '启用代理',
  'llm.proxy.listen': '监听：{host}:{port}',
  'llm.proxy.warn': '无 TLS，明文传输，仅在可信内网使用',
  'llm.token.title': '访问 token',
  'llm.token.employee': '工号',
  'llm.token.days': '有效天数',
  'llm.token.issue': '签发',
  'llm.token.revoke': '吊销',
  'llm.token.revoked': '已吊销',
  'llm.token.expires': '过期',
  'llm.token.none': '暂无 token',
  'llm.config.title': '生成 opencode.json',
  'llm.config.provider': 'Provider',
  'llm.config.token': 'Token',
  'llm.config.generate': '生成',
  'llm.config.copy': '复制',
  'llm.config.copied': '已复制',
  'llm.failed': '操作失败：{msg}',
```

- [ ] **Step 2: 英文词条（同键）**

在 `shared/i18n/en.js` 末尾（最后一个 `};` 之前）加入：

```js
  'nav.proxy': 'Proxy',
  'llm.title': 'Local LLM proxy',
  'llm.vault.title': 'Key vault',
  'llm.vault.not_init': 'Not initialized',
  'llm.vault.locked': 'Locked',
  'llm.vault.unlocked': 'Unlocked',
  'llm.vault.passphrase': 'Passphrase',
  'llm.vault.init': 'Initialize',
  'llm.vault.unlock': 'Unlock',
  'llm.vault.lock': 'Lock',
  'llm.vault.old': 'Old passphrase',
  'llm.vault.new': 'New passphrase',
  'llm.vault.change': 'Change',
  'llm.secret.title': 'JWT signing secret',
  'llm.secret.placeholder': 'Leave empty to generate randomly',
  'llm.secret.set': 'Save secret',
  'llm.provider.title': 'Upstream providers',
  'llm.provider.none': 'No opencode provider found',
  'llm.provider.nokey': 'No key found',
  'llm.proxy.title': 'Proxy switch',
  'llm.proxy.enable': 'Enable proxy',
  'llm.proxy.listen': 'Listening: {host}:{port}',
  'llm.proxy.warn': 'No TLS; plaintext. Use only on a trusted LAN',
  'llm.token.title': 'Access tokens',
  'llm.token.employee': 'Employee ID',
  'llm.token.days': 'Valid days',
  'llm.token.issue': 'Issue',
  'llm.token.revoke': 'Revoke',
  'llm.token.revoked': 'Revoked',
  'llm.token.expires': 'Expires',
  'llm.token.none': 'No tokens',
  'llm.config.title': 'Generate opencode.json',
  'llm.config.provider': 'Provider',
  'llm.config.token': 'Token',
  'llm.config.generate': 'Generate',
  'llm.config.copy': 'Copy',
  'llm.config.copied': 'Copied',
  'llm.failed': 'Failed: {msg}',
```

- [ ] **Step 3: 校验**

Run: `npm.cmd run check:i18n`
Expected: exit 0（键对称、无中文命中）。

- [ ] **Step 4: Commit**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n: LLM 代理词条"
```

---

## Task 7: 前端 API 封装 `web/src/useLlm.ts`

**Files:**
- Create: `web/src/useLlm.ts`

- [ ] **Step 1: 实现**

新建 `web/src/useLlm.ts`：

```ts
export interface LlmToken { id: string; employeeId: string; jwt: string; iat: number; exp: number; jti: string; revoked: boolean; }
export interface LlmProvider { id: string; name: string; baseURL: string; hasKey: boolean; models: string[]; }
export interface LlmStatus { vault: { initialized: boolean; unlocked: boolean }; enabled: boolean; host: string; port: number; defaultProvider: string | null; providers: LlmProvider[]; }

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).message || (body as any).error || `HTTP ${res.status}`);
  return body as T;
}
const post = <T>(url: string, obj: unknown) => json<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

export function useLlm() {
  return {
    status: () => json<LlmStatus>('/api/llm-admin/status'),
    vaultInit: (passphrase: string) => post('/api/llm-admin/vault/init', { passphrase }),
    vaultUnlock: (passphrase: string) => post('/api/llm-admin/vault/unlock', { passphrase }),
    vaultLock: () => post('/api/llm-admin/vault/lock', {}),
    vaultPassphrase: (oldP: string, newP: string) => post('/api/llm-admin/vault/passphrase', { old: oldP, new: newP }),
    setSecret: (secret: string) => post<{ secret: string }>('/api/llm-admin/secret', { secret }),
    setEnabled: (enabled: boolean) => post<{ enabled: boolean }>('/api/llm-admin/enabled', { enabled }),
    tokens: () => json<{ tokens: LlmToken[] }>('/api/llm-admin/tokens'),
    issue: (employeeId: string, days: number) => post<{ token: LlmToken }>('/api/llm-admin/tokens', { employeeId, days }),
    revoke: (id: string) => json<{ ok: boolean }>(`/api/llm-admin/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    config: (provider: string, token: string) => json<{ config: string }>(`/api/llm-admin/opencode-config?provider=${encodeURIComponent(provider)}&token=${encodeURIComponent(token)}`),
  };
}
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add web/src/useLlm.ts
git commit -m "feat(web): useLlm API 封装"
```

---

## Task 8: `ProxyView.vue` + 左侧入口

**Files:**
- Create: `web/src/components/ProxyView.vue`
- Modify: `web/src/App.vue`

- [ ] **Step 1: 创建 `ProxyView.vue`**

新建 `web/src/components/ProxyView.vue`：

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useLlm, type LlmStatus } from '../useLlm';
import { t } from '../i18n';

const api = useLlm();
const st = ref<LlmStatus | null>(null);
const pass = ref('');
const newPass = ref('');
const secret = ref('');
const employeeId = ref('');
const days = ref(30);
const err = ref('');
const cfgProvider = ref('');
const cfgToken = ref('');
const configText = ref('');
const copied = ref(false);

async function refresh() {
  try { st.value = await api.status(); if (!cfgProvider.value && st.value.providers.length) cfgProvider.value = st.value.defaultProvider || st.value.providers[0].id; }
  catch (e: any) { err.value = t('llm.failed', { msg: e?.message || e }); }
}
onMounted(refresh);
async function run(fn: () => Promise<unknown>) {
  err.value = '';
  try { await fn(); await refresh(); } catch (e: any) { err.value = t('llm.failed', { msg: e?.message || e }); }
}
function initVault() { return run(() => api.vaultInit(pass.value)); }
function unlockVault() { return run(() => api.vaultUnlock(pass.value)); }
function lockVault() { return run(() => api.vaultLock()); }
function changePass() { return run(() => api.vaultPassphrase(pass.value, newPass.value)); }
function saveSecret() { return run(() => api.setSecret(secret.value)); }
function toggleEnabled() { return run(() => api.setEnabled(!st.value?.enabled)); }
function issue() { return run(() => api.issue(employeeId.value, Number(days.value))); }
function revoke(id: string) { return run(() => api.revoke(id)); }
async function genConfig() {
  await run(async () => {
    const r = await api.config(cfgProvider.value, cfgToken.value);
    configText.value = r.config;
  });
}
async function copyConfig() {
  if (!configText.value) return;
  try { await navigator.clipboard.writeText(configText.value); copied.value = true; setTimeout(() => (copied.value = false), 1500); } catch { /* ignore */ }
}
</script>

<template>
  <div class="llm">
    <h3>{{ $t('llm.title') }}</h3>
    <div v-if="err" class="err">{{ err }}</div>

    <section class="card">
      <div class="ch">{{ $t('llm.vault.title') }}
        <span class="badge" :class="{ ok: st?.vault.unlocked }">
          {{ st?.vault.unlocked ? $t('llm.vault.unlocked') : (st?.vault.initialized ? $t('llm.vault.locked') : $t('llm.vault.not_init')) }}
        </span>
      </div>
      <div v-if="!st?.vault.initialized" class="row">
        <input v-model="pass" type="password" :placeholder="$t('llm.vault.passphrase')" />
        <button @click="initVault">{{ $t('llm.vault.init') }}</button>
      </div>
      <template v-else-if="!st?.vault.unlocked">
        <div class="row">
          <input v-model="pass" type="password" :placeholder="$t('llm.vault.passphrase')" @keyup.enter="unlockVault" />
          <button @click="unlockVault">{{ $t('llm.vault.unlock') }}</button>
        </div>
      </template>
      <template v-else>
        <div class="row">
          <input v-model="pass" type="password" :placeholder="$t('llm.vault.old')" />
          <input v-model="newPass" type="password" :placeholder="$t('llm.vault.new')" />
          <button @click="changePass">{{ $t('llm.vault.change') }}</button>
          <button class="ghost" @click="lockVault">{{ $t('llm.vault.lock') }}</button>
        </div>
      </template>
    </section>

    <section v-if="st?.vault.unlocked" class="card">
      <div class="ch">{{ $t('llm.secret.title') }}</div>
      <div class="row">
        <input v-model="secret" :placeholder="$t('llm.secret.placeholder')" />
        <button @click="saveSecret">{{ $t('llm.secret.set') }}</button>
      </div>
    </section>

    <section class="card">
      <div class="ch">{{ $t('llm.provider.title') }}</div>
      <div v-if="!st?.providers.length" class="muted">{{ $t('llm.provider.none') }}</div>
      <div v-for="p in st?.providers || []" :key="p.id" class="prow">
        <b>{{ p.id }}</b><span class="muted">{{ p.baseURL }}</span>
        <span v-if="!p.hasKey" class="warn">{{ $t('llm.provider.nokey') }}</span>
      </div>
    </section>

    <section v-if="st?.vault.unlocked" class="card">
      <div class="ch">{{ $t('llm.proxy.title') }}
        <label class="sw"><input type="checkbox" :checked="st?.enabled" @change="toggleEnabled" /> {{ $t('llm.proxy.enable') }}</label>
      </div>
      <div class="muted">{{ $t('llm.proxy.listen', { host: st?.host, port: st?.port }) }}</div>
      <div class="warn">{{ $t('llm.proxy.warn') }}</div>
    </section>

    <section v-if="st?.vault.unlocked" class="card">
      <div class="ch">{{ $t('llm.token.title') }}</div>
      <div class="row">
        <input v-model="employeeId" :placeholder="$t('llm.token.employee')" />
        <input v-model.number="days" type="number" min="1" class="days" :placeholder="$t('llm.token.days')" />
        <button @click="issue">{{ $t('llm.token.issue') }}</button>
      </div>
      <Tokens :tokens="tokens" @revoke="revoke" />
    </section>

    <section v-if="st?.vault.unlocked" class="card">
      <div class="ch">{{ $t('llm.config.title') }}</div>
      <div class="row">
        <select v-model="cfgProvider">
          <option v-for="p in st?.providers || []" :key="p.id" :value="p.id">{{ p.id }}</option>
        </select>
        <select v-model="cfgToken">
          <option v-for="tk in tokens" :key="tk.id" :value="tk.id">{{ tk.employeeId }}</option>
        </select>
        <button @click="genConfig">{{ $t('llm.config.generate') }}</button>
        <button :disabled="!configText" @click="copyConfig">{{ copied ? $t('llm.config.copied') : $t('llm.config.copy') }}</button>
      </div>
      <pre v-if="configText" class="cfg">{{ configText }}</pre>
    </section>
  </div>
</template>

<script lang="ts">
import { defineComponent, h, type PropType } from 'vue';
const Tokens = defineComponent({
  name: 'LlmTokens',
  props: { tokens: { type: Array as PropType<Array<{ id: string; employeeId: string; exp: number; revoked: boolean; jwt: string }>>, default: () => [] } },
  emits: ['revoke'],
  setup(props, { emit }) {
    return () => h('div', props.tokens.length ? props.tokens.map((tk) => h('div', { class: 'trow', key: tk.id }, [
      h('b', tk.employeeId),
      h('span', { class: 'muted' }, `${new Date(tk.exp * 1000).toLocaleDateString()}${tk.revoked ? ' · ' + 'revoked' : ''}`),
      h('button', { class: 'ghost', disabled: tk.revoked, onClick: () => emit('revoke', tk.id) }, '×'),
    ])) : h('div', { class: 'muted' }, '—'));
  },
});
export default { components: { Tokens } };
</script>

<style scoped>
.llm { padding: 12px; display: flex; flex-direction: column; gap: 10px; overflow: auto; height: 100%; }
.card { border: 1px solid var(--bd); border-radius: 8px; padding: 10px; background: var(--bg2); display: flex; flex-direction: column; gap: 8px; }
.ch { display: flex; align-items: center; justify-content: space-between; font-weight: 700; color: var(--tx1); }
.row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.row input, .row select { background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 12px; }
.row .days { width: 80px; }
button { background: var(--ac); color: var(--onac); border: 1px solid var(--ac); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-family: inherit; }
button.ghost { background: var(--bg5); color: var(--tx2); border-color: var(--bd); }
button:disabled { opacity: .5; cursor: default; }
.badge { font-size: 11px; color: var(--tx3); border: 1px solid var(--bd); border-radius: 10px; padding: 1px 8px; }
.badge.ok { color: var(--ac2); border-color: var(--ac2); }
.muted { color: var(--tx4); font-size: 12px; }
.warn { color: var(--warn); font-size: 12px; }
.err { color: var(--err); font-size: 12px; }
.prow, .trow { display: flex; gap: 8px; align-items: center; font-size: 12px; }
.prow .muted, .trow .muted { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sw { font-weight: 400; font-size: 12px; display: flex; gap: 4px; align-items: center; }
.cfg { background: var(--bg1); border: 1px solid var(--bd); border-radius: 4px; padding: 8px; font-size: 12px; overflow: auto; max-height: 320px; white-space: pre-wrap; }
</style>
```

注意：上面用了一个内联 `Tokens` 子组件（`<script>` 非 setup 段）来渲染列表；若类型/模板报错，改为纯模板 `v-for` 内联渲染（不要子组件）。推荐直接用模板内联，避免双 `<script>` 复杂：

把 `<Tokens ... />` 替换为：

```html
<div v-if="!tokens.length" class="muted">{{ $t('llm.token.none') }}</div>
<div v-for="tk in tokens" :key="tk.id" class="trow">
  <b>{{ tk.employeeId }}</b>
  <span class="muted">{{ new Date(tk.exp * 1000).toLocaleDateString() }}{{ tk.revoked ? ' · ' + $t('llm.token.revoked') : '' }}</span>
  <button class="ghost" :disabled="tk.revoked" @click="revoke(tk.id)">×</button>
</div>
```

并删除 `<script lang="ts">…</script>` 非 setup 段与 `Tokens` 引用，在 setup 顶部加 `const tokens = ref<import('../useLlm').LlmToken[]>([]);`，`refresh()` 里 `tokens.value = (await api.tokens()).tokens;`（未解锁时跳过：`if (st.value.vault.unlocked) ...`）。

- [ ] **Step 2: App.vue 接入**

在 `web/src/App.vue` 的 import 区加入：

```ts
import ProxyView from './components/ProxyView.vue';
```

在 activity rail 的 `stat` 按钮之后加：

```html
<button class="a-btn" :class="{ on: rail === 'stat' }" ...>（已有 stat）
```
在其后插入：

```html
<button class="a-btn" :class="{ on: rail === 'proxy' }" :title="$t('nav.proxy')" @click="rail = 'proxy'">🔌</button>
```

并在 `rail === 'stat'` 的 `<template>` 之后插入：

```html
<template v-else-if="rail === 'proxy'">
  <section class="center">
    <ProxyView />
  </section>
</template>
```

（`rail` 的类型若为联合类型，需把 `'proxy'` 加进去；在 `App.vue` 中搜索 `const rail = ref` 或 `rail` 定义处同步。）

- [ ] **Step 3: 类型检查与测试**

Run: `npm.cmd run typecheck`
Expected: PASS。

Run: `npm.cmd --prefix web run test`
Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ProxyView.vue web/src/App.vue
git commit -m "feat(web): 左侧 LLM 代理页"
```

---

## Task 9: 全量验证

**Files:** 无

- [ ] **Step 1: 全部检查**

Run: `npm.cmd test`
Expected: server + web 全绿。

Run: `npm.cmd run typecheck`
Expected: PASS。

Run: `npm.cmd run check:i18n`
Expected: exit 0。

Run: `npm.cmd run build:web`
Expected: 成功。

- [ ] **Step 2: 人工验收（可选）**

1. 启后端与前端 → 左栏「代理」→ 初始化解锁 → 保存 JWT 密钥。
2. 启用代理；列表显示本机 opencode provider。
3. 签发（工号+天数）→ 生成 `opencode.json` 复制到另一台机器 `~/.config/opencode/opencode.json`。
4. 另一台 `opencode` 走代理可正常对话；停用/吊销/过期 → 401。
5. 重启后端 → vault 为锁定态，需重新解锁。

- [ ] **Step 3: Commit（如验收微调）**

```bash
git add <按实际改动文件>
git commit -m "fix: LLM 代理验收修正"
```

---

## Self-Review 记录

- **Spec 覆盖：** vault（Task 1）、JWT（Task 2）、上游读取+配置生成（Task 3）、代理透传（Task 4）、管理路由+接线（Task 5）、i18n（Task 6）、前端 API（Task 7）、UI+入口（Task 8）、验收（Task 9）。
- **占位符：** 无 TBD；代码/命令完整。
- **类型一致性：** `createVault` 数据 `{enabled,jwtSecret,tokens[]}`（Task 1/5 一致）；JWT `{sub,jti,exp}`（Task 2/5 一致）；`createProxyHandler({vault,getProvider,isEnabled})`（Task 4/5 一致）；`buildOpencodeConfig({host,port,providerId,baseURL,token,models})`（Task 3/5 一致）；前端 `useLlm` 字段与路由响应一致。
- **差异说明：** `opencode.json` 生成在服务端（`server/llm-config.js`），前端只展示；spec §9 提到的 `web/src/llm.ts` 不再需要（行为一致）。
- **风险：** `scrypt N=32768` 需 `maxmem`（已设 64MB）；代理流式透传直接 pipe，不做缓冲；`ProxyView` 若双 `<script>` 段在 vue-tsc 下报错，按 Task 8 Step 1 末尾改用模板内联方案。
