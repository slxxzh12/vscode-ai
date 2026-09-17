# 英文翻译右栏自动发送 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. **本仓库强制 inline 执行**（AGENTS.md「计划执行方式」），不要用 subagent 驱动，也不要再就执行方式提问。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把终端底部输入框的英文翻译模式改成「回车只翻译并填入右栏 → 右栏可勾选 3 秒后自动送入会话」，并加一条纯 ASCII 免翻译快捷路径。

**Architecture:** 服务端新增一个与 `code-prefs.js` 同构的 `composer-prefs.js`（JSON 落在端口数据目录），并通过可选 `C2S.INPUT.sessionId` 支持向非当前活动会话静默写入；前端把翻译模式的状态机从 `TerminalView.vue` 抽成 `useEnglishComposer.ts`（含倒计时、跳过翻译、偏好同步），组件只做模板与接线。

**Tech Stack:** Node ESM + `node --test`（服务端）；Vue 3 `<script setup>` + vitest（前端）；Node 20+，Windows PowerShell 5.1（命令一律用 `npm.cmd`）。

**Spec:** `docs/superpowers/specs/2026-09-17-english-translation-auto-send-design.md`

---

## 提交前必做（每个 Task 的 commit 步骤都适用）

按 `docs/learn/git仓库提交检查和提交事项.md`：只 `git add <本任务明确列出的文件>`（禁止 `git add -A`），提交前执行敏感信息自查：

```powershell
git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat-|-----BEGIN [A-Z ]*PRIVATE KEY-----"
git ls-files env
```

第一条只允许命中 `docs/learn/`、`AGENTS.md`、`skills/` 里的检查清单/正则文本；`git ls-files env` 必须为空。不通过一律不得 commit。

## 文件结构（先看这里，再按 Task 动手）

**新建**
- `server/composer-prefs.js` — `autoSend` 偏好的归一化 + JSON 存储（复用 `createJsonStore`）
- `server/test/composer-prefs.test.js` — 上述模块的单测
- `web/src/useEnglishComposer.ts` — 翻译模式状态机（跳译判定、倒计时、偏好读写）
- `web/src/useEnglishComposer.test.ts` — 上述状态机单测

**修改**
- `server/port-paths.js` — 新增 `composerPrefsFile`
- `server/index.js` — 实例化 `composerPrefs` 并传入 `createHttpApi`
- `server/http-api.js` — `GET/POST /api/composer/prefs`
- `server/ws-gateway.js` — `C2S.INPUT` 支持可选 `sessionId`
- `server/test/port-paths.test.js`、`server/test/http-api.test.js`、`server/test/ws-gateway.test.js`
- `web/src/useTerminal.ts`、`web/src/useTerminal.test.ts`
- `shared/i18n/zh-CN.js`、`shared/i18n/en.js`
- `web/src/components/TerminalView.vue`

**不改**：`shared/index.js` / `shared/index.d.ts`（`C2S.INPUT` 常量不变，只加可选字段）、协作子系统、打包脚本。

---

## Task 1: 服务端 composer-prefs 存储模块

**Files:**
- Create: `server/composer-prefs.js`
- Test: `server/test/composer-prefs.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/composer-prefs.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeComposerPrefs, createComposerPrefs, emptyPrefs } from '../composer-prefs.js';

test('normalizeComposerPrefs 只留 autoSend 且仅接受布尔', () => {
  assert.deepEqual(normalizeComposerPrefs({ autoSend: false }), { autoSend: false });
  assert.deepEqual(normalizeComposerPrefs({ autoSend: true, nope: 1 }), { autoSend: true });
  assert.deepEqual(normalizeComposerPrefs({ autoSend: 'yes' }), {});
});

test('normalizeComposerPrefs 非法输入 → 空对象', () => {
  assert.deepEqual(normalizeComposerPrefs(null), emptyPrefs());
  assert.deepEqual(normalizeComposerPrefs('x'), emptyPrefs());
  assert.deepEqual(normalizeComposerPrefs([]), emptyPrefs());
});

test('createComposerPrefs 读写往返 + 坏文件回退空', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfcprefs-')), 'composer-prefs.json');
  const store = createComposerPrefs({ file });
  assert.deepEqual(store.read(), {});

  store.write({ autoSend: false });
  assert.deepEqual(createComposerPrefs({ file }).read(), { autoSend: false });

  fs.writeFileSync(file, '{ bad json');
  assert.deepEqual(createComposerPrefs({ file }).read(), emptyPrefs());
});

test('createComposerPrefs 无 file 时纯内存', () => {
  const store = createComposerPrefs({});
  store.write({ autoSend: false });
  assert.deepEqual(store.read(), { autoSend: false });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/composer-prefs.test.js"`
Expected: FAIL — `Cannot find module .../composer-prefs.js`

- [ ] **Step 3: 实现模块**

创建 `server/composer-prefs.js`：

```js
import { createJsonStore } from './json-store.js';

const BOOL_KEYS = ['autoSend'];

export function emptyPrefs() { return {}; }

// 只保留已知键；布尔键仅接受布尔值；缺键 = 用前端默认值
export function normalizeComposerPrefs(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  for (const key of BOOL_KEYS) {
    if (typeof src[key] === 'boolean') out[key] = src[key];
  }
  return out;
}

export function createComposerPrefs({ file = null, logger = console } = {}) {
  return createJsonStore({ file, logger, normalize: normalizeComposerPrefs, defaults: emptyPrefs });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/composer-prefs.test.js"`
Expected: PASS（4 tests）

- [ ] **Step 5: 提交**

```powershell
git add server/composer-prefs.js server/test/composer-prefs.test.js
git commit -m "feat(server): composer 偏好存储模块（autoSend）"
```

---

## Task 2: 端口路径 + 服务端装配 + HTTP API

**Files:**
- Modify: `server/port-paths.js:32`（在 `codePrefsFile` 后加一行）
- Modify: `server/index.js:16`（import）、`server/index.js:183`（实例化）、`server/index.js:263`（传入）
- Modify: `server/http-api.js:7`（import）、`server/http-api.js:42`（参数）、`server/http-api.js:248` 之后（路由）
- Test: `server/test/port-paths.test.js:32`、`server/test/http-api.test.js:458` 之后

- [ ] **Step 1: 写失败测试（端口路径）**

在 `server/test/port-paths.test.js` 第 32 行 `codePrefsFile` 断言之后补一行：

```js
  assert.equal(p.composerPrefsFile, path.join(base, 'composer-prefs.json'));
```

- [ ] **Step 2: 写失败测试（HTTP）**

在 `server/test/http-api.test.js` 的 `/api/code/prefs` 测试（结束于第 458 行 `});`）之后追加：

```js
test('/api/composer/prefs GET 默认空、POST 只存 autoSend 且读回', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const empty = await request(server, '/api/composer/prefs');
  assert.equal(empty.status, 200);
  assert.deepEqual(JSON.parse(empty.body), {});

  const r = await post(server, '/api/composer/prefs', { autoSend: false, nope: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { autoSend: false });

  const again = await request(server, '/api/composer/prefs');
  assert.deepEqual(JSON.parse(again.body), { autoSend: false });

  const bad = await post(server, '/api/composer/prefs', { autoSend: 'yes' });
  assert.equal(bad.status, 200);
  assert.deepEqual(JSON.parse(bad.body), {});
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test "server/test/port-paths.test.js" "server/test/http-api.test.js"`
Expected: FAIL — `p.composerPrefsFile` 为 `undefined`；`/api/composer/prefs` 返回 404

- [ ] **Step 4: 加端口路径**

`server/port-paths.js` 中 `codePrefsFile: path.join(dir, 'code-prefs.json'),` 之后加：

```js
    composerPrefsFile: path.join(dir, 'composer-prefs.json'),
```

- [ ] **Step 5: 加 HTTP 路由**

`server/http-api.js` 顶部 `import { createCodePrefs } from './code-prefs.js';` 之后加：

```js
import { createComposerPrefs } from './composer-prefs.js';
```

`createHttpApi` 签名里把 `codePrefs = createCodePrefs({}),` 改成：

```js
codePrefs = createCodePrefs({}), composerPrefs = createComposerPrefs({}),
```

在 `/api/code/prefs` 的 POST 分支之后（`if (url.pathname === '/api/code/stats' ...)` 之前）加：

```js
      if (url.pathname === '/api/composer/prefs' && req.method === 'GET') {
        sendJson(res, 200, composerPrefs.read());
        return;
      }
      if (url.pathname === '/api/composer/prefs' && req.method === 'POST') {
        const body = await readJsonBody(req);
        sendJson(res, 200, composerPrefs.write(body));
        return;
      }
```

- [ ] **Step 6: 装配服务端**

`server/index.js` 第 16 行 import 之后加：

```js
import { createComposerPrefs } from './composer-prefs.js';
```

第 183 行 `const codePrefs = createCodePrefs(...);` 之后加：

```js
  const composerPrefs = createComposerPrefs({ file: paths.composerPrefsFile, logger: log });
```

第 263 行改为：

```js
  const httpApi = createHttpApi({ projects, saveProjects, logger: log, repoRoot: path.join(__dirname, '..'), codeGroups, codePrefs, composerPrefs });
```

- [ ] **Step 7: 跑测试确认通过**

Run: `node --test "server/test/port-paths.test.js" "server/test/http-api.test.js"`
Expected: PASS

- [ ] **Step 8: 提交**

```powershell
git add server/port-paths.js server/index.js server/http-api.js server/test/port-paths.test.js server/test/http-api.test.js
git commit -m "feat(server): composer 偏好 API 与端口路径接线"
```

---

## Task 3: C2S.INPUT 支持可选 sessionId

**Files:**
- Modify: `server/ws-gateway.js:97-99`
- Test: `server/test/ws-gateway.test.js`（在 `input 转发到绑定会话 pty` 测试之后，即第 55 行 `});` 之后）

- [ ] **Step 1: 写失败测试**

在 `server/test/ws-gateway.test.js` 第 55 行后追加：

```js
test('input 带 sessionId 时写入指定会话而非当前活动会话', async () => {
  const { t, instances } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.CREATE, {});
  const a = await c.wait((m) => m.type === S2C.SESSION_CREATED);
  c.send(C2S.CREATE, {});
  await c.wait((m) => m.type === S2C.SESSION_CREATED && m.session.id !== a.session.id);
  const ptyA = instances[0].pty;
  const ptyB = instances[1].pty;
  ptyA.writes.length = 0;
  ptyB.writes.length = 0;
  // 当前活动会话是 b（后建的），但仍定向写入 a
  c.send(C2S.INPUT, { data: 'to-a\r', sessionId: a.session.id });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(ptyA.writes, ['to-a\r']);
  assert.deepEqual(ptyB.writes, []);
  await t.stop();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/ws-gateway.test.js"`
Expected: FAIL — `a` 的 pty 没收到 `to-a\r`

- [ ] **Step 3: 实现**

`server/ws-gateway.js` 第 97-99 行整段替换为：

```js
      case C2S.INPUT: {
        const sid = msg.sessionId || conn.sessionId;
        if (sid) sessionManager.write(sid, msg.data);
        break;
      }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/ws-gateway.test.js"`
Expected: PASS（含原有的 `input 转发到绑定会话 pty`）

- [ ] **Step 5: 提交**

```powershell
git add server/ws-gateway.js server/test/ws-gateway.test.js
git commit -m "feat(server): C2S.INPUT 支持可选 sessionId 定向写入"
```

---

## Task 4: useTerminal.input 支持指定会话

**Files:**
- Modify: `web/src/useTerminal.ts:114`
- Test: `web/src/useTerminal.test.ts`（`input/resize 转发到当前连接` 测试内追加断言，或新增一条测试）

- [ ] **Step 1: 写失败测试**

在 `web/src/useTerminal.test.ts` 的 `input/resize 转发到当前连接` 测试中，`hook.term.input('ls\r');` 断言之后追加：

```ts
    hook.term.input('other\r', 's2');
    expect(ws.sent.at(-1)).toMatchObject({ type: C2S.INPUT, data: 'other\r', sessionId: 's2' });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/useTerminal.test.ts`
Expected: FAIL — 收到的对象没有 `sessionId`

- [ ] **Step 3: 实现**

`web/src/useTerminal.ts` 第 114 行改为：

```ts
    input(data: string, sessionId: string | null = null) { send(C2S.INPUT, { data, sessionId }); },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/useTerminal.test.ts`
Expected: PASS（原 `toMatchObject({ type, data })` 断言不受多余字段影响）

- [ ] **Step 5: 提交**

```powershell
git add web/src/useTerminal.ts web/src/useTerminal.test.ts
git commit -m "feat(web): useTerminal.input 支持指定目标会话"
```

---

## Task 5: i18n 词条（中英同步）

**Files:**
- Modify: `shared/i18n/zh-CN.js:596`（`term.translated_ph` 那行附近）
- Modify: `shared/i18n/en.js:596`

- [ ] **Step 1: 中文词条**

`shared/i18n/zh-CN.js` 第 596 行 `'term.translated_ph': ...` 替换为下面 5 行：

```js
  'term.translated_ph': '英文译文（可编辑；自动发送或按回车送入）',
  'term.auto_send': '自动发送',
  'term.auto_send_hint': '译文进入右栏后 3 秒自动送入会话（改右栏重新计时；改左栏取消）',
  'term.auto_send_countdown': '{n} 秒后自动发送',
  'term.send_countdown': '发送 ({n})',
```

- [ ] **Step 2: 英文词条**

`shared/i18n/en.js` 第 596 行 `'term.translated_ph': ...` 替换为下面 5 行：

```js
  'term.translated_ph': 'English translation (editable; auto-sent or press Enter)',
  'term.auto_send': 'Auto-send',
  'term.auto_send_hint': 'Send the translation 3s after it lands in the right box (editing it restarts; editing the left box cancels)',
  'term.auto_send_countdown': 'Auto-sending in {n}s',
  'term.send_countdown': 'Send ({n})',
```

- [ ] **Step 3: 校验**

Run: `node -e "const {translate}=require('@devflow/shared/i18n');for(const l of ['zh-CN','en'])for(const k of ['term.auto_send','term.auto_send_hint','term.auto_send_countdown','term.send_countdown'])console.log(l,k,translate(l,k,{n:3}))"`
Expected: 4 个 key × 2 语言全部打印出实际文案（不是 key 本身）

> 若 `require` 解析 `@devflow/shared/i18n` 失败，改用 `node --input-type=module -e "import { translate } from '@devflow/shared/i18n'; ..."`。

- [ ] **Step 4: 提交**

```powershell
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n: 英文翻译自动发送中英词条"
```

---

## Task 6: useEnglishComposer 纯函数（跳译判定 + 偏好合并）

**Files:**
- Create: `web/src/useEnglishComposer.ts`
- Test: `web/src/useEnglishComposer.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/useEnglishComposer.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { isAsciiOnly, mergeComposerPrefs } from './useEnglishComposer';

describe('isAsciiOnly', () => {
  it('字母/数字/空白/ASCII 标点 → true', () => {
    expect(isAsciiOnly('npm run dev')).toBe(true);
    expect(isAsciiOnly('/compact')).toBe(true);
    expect(isAsciiOnly('123  ')).toBe(true);
    expect(isAsciiOnly('git commit -m "x"')).toBe(true);
  });
  it('含中文/其它非 ASCII → false', () => {
    expect(isAsciiOnly('你好')).toBe(false);
    expect(isAsciiOnly('hello 世界')).toBe(false);
    expect(isAsciiOnly('😀')).toBe(false);
  });
});

describe('mergeComposerPrefs', () => {
  it('缺键/类型不符 → 默认 true', () => {
    expect(mergeComposerPrefs(null)).toBe(true);
    expect(mergeComposerPrefs({})).toBe(true);
    expect(mergeComposerPrefs([])).toBe(true);
    expect(mergeComposerPrefs({ autoSend: 'yes' })).toBe(true);
  });
  it('服务端已存值覆盖默认', () => {
    expect(mergeComposerPrefs({ autoSend: false })).toBe(false);
    expect(mergeComposerPrefs({ autoSend: true })).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/useEnglishComposer.test.ts`
Expected: FAIL — 找不到模块 `./useEnglishComposer`

- [ ] **Step 3: 实现（本任务只写纯函数部分）**

创建 `web/src/useEnglishComposer.ts`：

```ts
import { ref, watch, nextTick } from 'vue';
import { t } from './i18n';

export const COUNTDOWN_SECONDS = 3;
const COUNTDOWN_TICK_MS = 1000;
const SAVE_DEBOUNCE_MS = 500;

const TRANSLATE_ERR_KEY: Record<string, string> = {
  'empty-input': 'et.empty',
  'too-long': 'et.too_long',
  'no-provider': 'et.no_provider',
  'no-key': 'et.no_key',
  'image-too-large': 'et.image_too_large',
  'too-many-images': 'et.too_many_images',
  timeout: 'et.timeout',
};

// 全 ASCII（字母/数字/空白/ASCII 标点）无需翻译
export function isAsciiOnly(text: string): boolean {
  return !/[^\x00-\x7F]/.test(text);
}

// 服务端缺键/类型不符 → 回退默认值 true
export function mergeComposerPrefs(saved: unknown, dflt = true): boolean {
  const s = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Record<string, unknown> : {};
  return typeof s.autoSend === 'boolean' ? s.autoSend : dflt;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/useEnglishComposer.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add web/src/useEnglishComposer.ts web/src/useEnglishComposer.test.ts
git commit -m "feat(web): 英文翻译跳译判定与偏好合并纯函数"
```

---

## Task 7: useEnglishComposer 状态机（翻译 / 倒计时 / 发送）

**Files:**
- Modify: `web/src/useEnglishComposer.ts`（在 Task 6 文件末尾追加）
- Test: `web/src/useEnglishComposer.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

在 `web/src/useEnglishComposer.test.ts` 顶部把 import 改为：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { isAsciiOnly, mergeComposerPrefs, useEnglishComposer, type EnglishComposerDeps } from './useEnglishComposer';
```

并在文件末尾追加：

```ts
function setup(overrides: Partial<EnglishComposerDeps> = {}) {
  const sent: Array<{ text: string; sid: string | null }> = [];
  const history: Array<{ text: string; sid: string | null }> = [];
  let active: string | null = 's1';
  const ec = useEnglishComposer({
    translate: async (text: string) => 'EN:' + text,
    getActiveSessionId: () => active,
    send: (text, sid) => { sent.push({ text, sid }); },
    recordHistory: (text, sid) => { history.push({ text, sid }); },
    onError: () => { /* ignore */ },
    ...overrides,
  });
  return { ec, sent, history, setActive: (v: string | null) => { active = v; } };
}

describe('useEnglishComposer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('含中文：调翻译接口 → 填右栏 → 3 秒后自动发送', async () => {
    const { ec, sent } = setup();
    ec.source.value = '跑测试';
    await ec.translateNow();
    expect(ec.translated.value).toBe('EN:跑测试');
    expect(ec.countdown.value).toBe(3);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toEqual([{ text: 'EN:跑测试', sid: 's1' }]);
    expect(ec.source.value).toBe('');
    expect(ec.translated.value).toBe('');
    expect(ec.countdown.value).toBeNull();
  });

  it('纯 ASCII：不调翻译接口，原样填右栏后自动发送', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(String(url)); return { ok: true, json: async () => ({}) }; }));
    const { ec, sent } = setup({ translate: undefined });
    ec.source.value = '/compact';
    await ec.translateNow();
    expect(calls.filter((u) => u.includes('/api/translate'))).toHaveLength(0);
    expect(ec.translated.value).toBe('/compact');
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toEqual([{ text: '/compact', sid: 's1' }]);
  });

  it('历史记录中文原文，终端收到英文', async () => {
    const { ec, history, sent } = setup();
    ec.source.value = '你好';
    await ec.translateNow();
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent[0].text).toBe('EN:你好');
    expect(history).toEqual([{ text: '你好', sid: 's1' }]);
  });

  it('未勾选自动发送：不启动倒计时，手动发送才送出', async () => {
    const { ec, sent } = setup();
    ec.autoSend.value = false;
    ec.source.value = '你好';
    await ec.translateNow();
    expect(ec.countdown.value).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(0);
    await ec.sendAction();
    expect(sent).toEqual([{ text: 'EN:你好', sid: 's1' }]);
  });

  it('倒计时期间改左栏 → 取消发送且不重译', async () => {
    const { ec, sent } = setup();
    ec.source.value = '你好';
    await ec.translateNow();
    ec.source.value = '你好啊';
    await nextTick();
    expect(ec.countdown.value).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(0);
  });

  it('倒计时期间改右栏 → 保留编辑并重置 3 秒', async () => {
    const { ec, sent } = setup();
    ec.source.value = '你好';
    await ec.translateNow();
    await vi.advanceTimersByTimeAsync(2000);
    ec.translated.value = 'HELLO';
    await nextTick();
    expect(ec.countdown.value).toBe(3);
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toEqual([{ text: 'HELLO', sid: 's1' }]);
  });

  it('倒计时期间活动会话变了 → 仍发到填译文时的会话', async () => {
    const { ec, sent, setActive } = setup();
    ec.source.value = '你好';
    await ec.translateNow();
    setActive('s2');
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toEqual([{ text: 'EN:你好', sid: 's1' }]);
  });

  it('两栏都空：发送按钮/左栏回车都直接发 ok', async () => {
    const a = setup();
    await a.ec.sendAction();
    expect(a.sent).toEqual([{ text: 'ok', sid: 's1' }]);
    const b = setup();
    await b.ec.onLeftEnter();
    expect(b.sent).toEqual([{ text: 'ok', sid: 's1' }]);
  });

  it('右栏空、左栏有内容：发送按钮先翻译再立即发送（不等 3 秒）', async () => {
    const { ec, sent } = setup();
    ec.source.value = '你好';
    await ec.sendAction();
    expect(sent).toEqual([{ text: 'EN:你好', sid: 's1' }]);
    expect(ec.countdown.value).toBeNull();
  });

  it('倒计时中右栏回车 → 立即发送并清计时', async () => {
    const { ec, sent } = setup();
    ec.source.value = '你好';
    await ec.translateNow();
    await ec.sendAction();
    expect(sent).toEqual([{ text: 'EN:你好', sid: 's1' }]);
    expect(ec.countdown.value).toBeNull();
  });

  it('翻译失败：走 onError、不发送、不倒计时', async () => {
    const errs: string[] = [];
    const { ec, sent } = setup({
      translate: async () => { const e = new Error('boom') as Error & { code?: string }; e.code = 'no-key'; throw e; },
      onError: (key: string) => { errs.push(key); },
    });
    ec.source.value = '你好';
    expect(await ec.translateNow()).toBe(false);
    expect(errs).toEqual(['et.no_key']);
    expect(ec.countdown.value).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('load 读服务端 autoSend；改动去抖 POST', async () => {
    const posts: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return { ok: true, json: async () => posts.at(-1) }; }
      return { ok: true, json: async () => ({ autoSend: false }) };
    }));
    const { ec } = setup();
    await ec.load();
    expect(ec.autoSend.value).toBe(false);
    ec.autoSend.value = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(600);
    expect(posts.at(-1)).toEqual({ autoSend: true });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/useEnglishComposer.test.ts`
Expected: FAIL — `useEnglishComposer` 未导出

- [ ] **Step 3: 实现状态机**

在 `web/src/useEnglishComposer.ts` 末尾追加：

```ts
async function defaultTranslate(text: string): Promise<string> {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(j.message || j.error || `HTTP ${res.status}`) as Error & { code?: string };
    err.code = j.error;
    throw err;
  }
  return j.text || '';
}

export interface EnglishComposerDeps {
  translate?: (text: string) => Promise<string>;
  getActiveSessionId?: () => string | null;
  send?: (text: string, sessionId: string | null) => void;
  recordHistory?: (text: string, sessionId: string | null) => void;
  onError?: (key: string, params?: Record<string, unknown>) => void;
  onSent?: () => void;
}

export function useEnglishComposer(deps: EnglishComposerDeps = {}) {
  const translate = deps.translate || defaultTranslate;
  const getActiveSessionId = deps.getActiveSessionId || (() => null);
  const send = deps.send || (() => { /* noop */ });
  const recordHistory = deps.recordHistory || (() => { /* noop */ });
  const onError = deps.onError || ((key: string, params?: Record<string, unknown>) => alert(t(key, params)));
  const onSent = deps.onSent || (() => { /* noop */ });

  const translateMode = ref(false);
  const source = ref('');
  const translated = ref('');
  const translating = ref(false);
  const autoSend = ref(true);
  const countdown = ref<number | null>(null);

  let settingTranslated = false;
  let pendingSid: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  // 程序写入译文：不触发“编辑右栏重启计时”
  function setTranslated(v: string) {
    settingTranslated = true;
    translated.value = v;
    void nextTick(() => { settingTranslated = false; });
  }

  function disarm() {
    if (timer) { clearInterval(timer); timer = null; }
    countdown.value = null;
    pendingSid = null;
  }

  function startTick() {
    if (timer) clearInterval(timer);
    countdown.value = COUNTDOWN_SECONDS;
    timer = setInterval(() => {
      countdown.value = (countdown.value ?? 1) - 1;
      if ((countdown.value ?? 0) <= 0) firePending();
    }, COUNTDOWN_TICK_MS);
  }

  function arm() {
    if (!autoSend.value) return;
    if (!translated.value.trim()) return;
    if (timer) return;                       // 已在倒计时：交给 restartCountdown
    pendingSid = getActiveSessionId();
    startTick();
  }

  function restartCountdown() {
    if (timer) startTick();                  // 保留 pendingSid（仍是填译文时的会话）
  }

  function doSend(text: string, sid: string | null) {
    disarm();
    send(text, sid);
    recordHistory(source.value.trim() || text, sid);
    source.value = '';
    setTranslated('');
    onSent();
  }

  function firePending() {
    const sid = pendingSid;
    const text = translated.value.trim();
    disarm();
    if (!text) return;
    doSend(text, sid);
  }

  async function translateNow(): Promise<boolean> {
    const text = source.value.trim();
    if (!text) return false;
    translating.value = true;
    try {
      const out = isAsciiOnly(text) ? text : await translate(text);
      setTranslated(out);
      arm();
      return true;
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      const key = (code && TRANSLATE_ERR_KEY[code]) || 'et.failed';
      onError(key, key === 'et.failed' ? { msg: (e as Error)?.message || String(e) } : undefined);
      return false;
    } finally {
      translating.value = false;
    }
  }

  async function sendAction(): Promise<void> {
    const cur = translated.value.trim();
    if (cur) { doSend(cur, pendingSid ?? getActiveSessionId()); return; }
    if (source.value.trim()) {
      if (!(await translateNow())) return;
      doSend(translated.value.trim() || 'ok', getActiveSessionId());
      return;
    }
    doSend('ok', getActiveSessionId());
  }

  async function onLeftEnter(): Promise<void> {
    if (source.value.trim()) { await translateNow(); return; }
    doSend('ok', getActiveSessionId());
  }

  function toggleTranslate() { translateMode.value = !translateMode.value; }

  watch(source, () => { disarm(); });
  watch(translated, () => {
    if (settingTranslated) return;
    if (!translated.value.trim()) { disarm(); return; }
    restartCountdown();
  });
  watch(autoSend, (v) => { if (v) arm(); else disarm(); });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  watch(autoSend, () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void fetch('/api/composer/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSend: autoSend.value }),
      }).catch(() => { /* ignore */ });
    }, SAVE_DEBOUNCE_MS);
  });

  let loaded = false;
  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const res = await fetch('/api/composer/prefs');
      if (res.ok) autoSend.value = mergeComposerPrefs(await res.json());
    } catch { /* 用默认值 */ }
  }

  return {
    translateMode, source, translated, translating, autoSend, countdown,
    load, toggleTranslate, translateNow, sendAction, onLeftEnter,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/useEnglishComposer.test.ts`
Expected: PASS（Task 6 的 4 条 + Task 7 的 12 条）

- [ ] **Step 5: 提交**

```powershell
git add web/src/useEnglishComposer.ts web/src/useEnglishComposer.test.ts
git commit -m "feat(web): 英文翻译状态机（跳译/倒计时自动发送/发送 ok）"
```

---

## Task 8: TerminalView 接入

**Files:**
- Modify: `web/src/components/TerminalView.vue`
  - import 区（第 13 行附近）
  - `const composerText = ref('')` → 组合器解构（第 403 行）
  - 删除翻译状态块（第 432-476 行整段）
  - `submitComposer` / `onComposerKey`（第 604-627 行）
  - `onMounted`（第 771 行）
  - 模板左栏工具条与右栏（第 955-979 行）
  - `<style scoped>` 末尾

> 注意：本文件当前有未提交改动，且行号可能随后续编辑漂移；按「查找锚点文本」定位，不要只信行号。

- [ ] **Step 1: 引入组合器并替换 composerText**

第 16 行 `import WorkflowEditor from './WorkflowEditor.vue';` 之后加：

```ts
import { useEnglishComposer } from '../useEnglishComposer';
```

第 403 行 `const composerText = ref('');` 整行删除，改第 404 行 `function fillPrompt` 之前插入：

```ts
const {
  translateMode,
  source: composerText,
  translated: translatedText,
  translating,
  autoSend,
  countdown,
  load: loadComposerPrefs,
  toggleTranslate,
  translateNow,
  sendAction,
  onLeftEnter,
} = useEnglishComposer({
  getActiveSessionId: () => props.terminal.state.activeSessionId,
  send: (text, sid) => sendPromptTo(text, sid),
  recordHistory: (text, sid) => { void msgHistory.push(text, sid ? { sessionId: sid, tabName: tabLabel(sid) } : {}); },
  onSent: () => notePromptSent(),
});
```

- [ ] **Step 2: 删除旧翻译状态块**

删除第 432-476 行整段（从 `// —— 英文翻译模式：底部输入框分中/英两栏，发送默认发英文译文 ——` 到 `runTranslate` 结束的 `}`，含 `TRANSLATE_ERR_KEY`、`toggleTranslate`、`runTranslate`）。

- [ ] **Step 3: 加定向发送函数**

在 `function sendToActive(text: string) { ... }`（原第 558 行）之后插入：

```ts
// 定向发送：sid 明确时直接写入该会话，不受当前活动标签影响；无 sid 时沿用 sendToActive
function sendPromptTo(text: string, sid: string | null) {
  if (!sid) { sendToActive(text); return; }
  props.terminal.input(text, sid);
  setTimeout(() => { props.terminal.input('\r', sid); }, 150);
}
```

- [ ] **Step 4: 改 submitComposer / 键处理 / 发送按钮**

把第 604-627 行（`submitComposer` + `onComposerKey`）整段替换为：

```ts
// 非翻译模式：回车直接把输入框内容送入当前会话
async function submitComposer() {
  const text = composerText.value.trim() || 'ok';
  composerText.value = '';
  const sid = props.terminal.state.activeSessionId;
  void msgHistory.push(text, sid ? { sessionId: sid, tabName: tabLabel(sid) } : {});
  sendToActive(text);
  notePromptSent();
}
function onComposerKey(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  if (translateMode.value) void onLeftEnter();
  else void submitComposer();
}
function onOutKey(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  void sendAction();
}
function onSendClick() {
  if (translateMode.value) void sendAction();
  else void submitComposer();
}
```

- [ ] **Step 5: 加载偏好**

第 780 行 `loadAgentSids();` 之后加：

```ts
  void loadComposerPrefs();
```

- [ ] **Step 6: 模板**

第 964 行「翻译」按钮的 `@click="runTranslate"` 改为 `@click="translateNow"`（其余不变）。

第 969-976 行的右栏整块替换为：

```html
          <div v-if="translateMode" class="cinputwrap">
            <textarea
              v-model="translatedText"
              class="cinput out"
              :placeholder="$t('term.translated_ph')"
              @keydown="onOutKey"
            />
            <div class="cauto">
              <label :title="$t('term.auto_send_hint')">
                <input type="checkbox" v-model="autoSend" />{{ $t('term.auto_send') }}
              </label>
              <span v-if="countdown !== null" class="cnt">{{ $t('term.auto_send_countdown', { n: countdown }) }}</span>
            </div>
            <div v-if="countdown !== null" class="cprog" :style="{ width: ((countdown ?? 0) / 3) * 100 + '%' }" />
          </div>
```

第 978 行发送按钮改为：

```html
          <button class="csend" @click="onSendClick">{{ countdown !== null ? $t('term.send_countdown', { n: countdown }) : $t('common.send') }}</button>
```

- [ ] **Step 7: 样式**

先改左栏输入框：`<style scoped>` 中 `.cinput { flex: 1; ... padding: 10px 210px 10px 14px; ... }` 那行的 padding 改成 `padding: 30px 210px 10px 14px;`（工具按钮独占第一行，正文从第二行开始，按钮不再压住输入文字）。

再把 `.cinput.out { padding-right: 14px; }` 那行替换为：

```css
.cinput.out { padding-right: 14px; padding-top: 30px; }
.cauto { position: absolute; top: 6px; right: 10px; z-index: 2; display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--tx3); }
.cauto label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.cauto input { margin: 0; cursor: pointer; }
.cauto .cnt { color: var(--ac2); }
.cprog { position: absolute; left: 10px; bottom: 4px; height: 2px; background: var(--ac2); border-radius: 2px; transition: width .95s linear; pointer-events: none; }
```

- [ ] **Step 8: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误（若报 `runTranslate` 未定义，说明 Step 2 的旧块没删干净）

- [ ] **Step 9: 跑前端测试**

Run: `npm.cmd --prefix web run test`
Expected: 全部 PASS

- [ ] **Step 10: 提交**

```powershell
git add web/src/components/TerminalView.vue
git commit -m "feat(web): 译文自动发送接入终端输入框（勾选/倒计时/发送 ok）"
```

---

## Task 9: 全量验证

- [ ] **Step 1: 服务端测试**

Run: `npm.cmd run test:server`
Expected: 全部 PASS（新增 composer-prefs / port-paths / http-api / ws-gateway 用例）

- [ ] **Step 2: 前端测试**

Run: `npm.cmd run test:web`
Expected: 全部 PASS

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误

- [ ] **Step 4: i18n 扫描**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`

- [ ] **Step 5: 手动验收（dev）**

后台启动（AGENTS.md：日志写 `logs\`，禁止前台阻塞）：

```powershell
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev" -WorkingDirectory "D:\root\devflow\devflow"
```

（`npm run dev` 自身会把日志写 `logs\dev-server.log` / `logs\dev-web.log`。验收完成后关掉该后台窗口，或 `Stop-Process -Name node`。）

访问 http://localhost:5173 ，在 Agent 会话底部点「英文翻译」，逐项确认：

1. 输入中文回车 → 右栏出现英文，3 秒后自动送入；发送按钮显示 `发送 (3)`→`发送 (2)`→`发送 (1)`，右栏底部有进度条。
2. 取消勾选自动发送 → 回车只翻译，不自动送；在右栏回车才送出。
3. 倒计时期间改左栏 → 倒计时消失、不发送。
4. 倒计时期间改右栏 → 倒计时回到 3 秒，改后的文本被送出。
5. 输入 `/compact`（纯 ASCII）回车 → 右栏立刻显示 `/compact`（无翻译请求），随后按规则自动发送。
6. 两栏都空点「发送」→ 会话收到 `ok`。
7. 焦点切到别的活动标签后等倒计时结束 → 消息落到原会话（不切换视图）。
8. 刷新页面 → 勾选状态与刷新前一致（服务端 `composer-prefs.json`）。
9. 关掉 translate 模式 → 回车行为与改动前完全一致。

验收后结束后台进程，并确认 `logs/` 已在 `.gitignore`（不入库）。

- [ ] **Step 6: 更新 AGENTS.md 目录速览（仅当新增目录时）**

本计划只在既有 `server/`、`web/src/` 平级新增文件，无需改目录速览。若实施时新增了目录，才在 `AGENTS.md`「目录速览」补一行。

---

## 自查记录（写计划时已核对）

- **Spec 覆盖**：§3.1→Task 1；§3.2→Task 2；§3.3→Task 3（+Task 4 前端）；§4.1→Task 4；§4.2→Task 6/7；§4.3→Task 8；§4.4→Task 5；§5 边界→Task 7 测试用例（空输入 `ok`、倒计时中改左右栏、会话切换、翻译失败）；§6→Task 9。
- **占位符扫描**：无 TBD/TODO；所有代码步骤均给出完整代码。
- **类型/命名一致性**：`isAsciiOnly`、`mergeComposerPrefs`、`useEnglishComposer`、`translateNow`、`sendAction`、`onLeftEnter`、`toggleTranslate`、`load`、`autoSend`、`countdown`、`source`、`translated`、`translateMode` 在 Task 6/7/8 中名称一致；`composerPrefsFile` / `createComposerPrefs` / `normalizeComposerPrefs` / `emptyPrefs` 在 Task 1/2 一致；`input(data, sessionId)` 在 Task 3（服务端字段）/Task 4（前端签名）一致。
- **已知取舍**：不再保留旧的 `lastTranslatedSource` / `lastTranslateResult` 陈旧度状态——新设计用「左栏变化即取消、右栏变化即重启计时」替代，二者语义等价且更简单；CSS 两侧输入框顶部内边距都改 30px（工具按钮/勾选框独占第一行，正文从第二行开始），并新增 `.cauto` / `.cprog`。
