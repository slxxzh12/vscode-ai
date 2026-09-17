# 手机遥控「软件交付」（打包 + 下载）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在手机遥控页加一个「打包」按钮，点一下让本机跑 release 打包，手机能看到结果并把产物 zip 下载走。

**Architecture:** 复用现有手机遥控链路——手机写 `remote_coder/messages.jsonc`（新增 `kind: 'deliver'`），桌面端轮询 `/inbox` 后派发 `df-remote-deliver`，`TerminalView` 把 workflow 里 `package` 阶段的提示语经现有 `sendToActive()` 打进当前会话。结果由手机直接查两个新增只读端点（`/artifacts` 列产物、`/artifact` 下载），`messages.jsonc` 保持单向。

**Tech Stack:** Node ESM（`node --test`）、Vue 3 + TypeScript（vitest + vue-tsc）、现有 `remote-coder-store.js` / `remote-coder-mount.js` / `PhoneView.vue`。

**Spec:** `docs/superpowers/specs/2026-09-17-remote-coder-delivery-design.md`

**约定：** 本仓库 Windows + PowerShell 5.1，无 bash；`npm` 一律写 `npm.cmd`。单测命令：
- 服务端：`npm.cmd run test:server`（或单文件 `node --test server/test/remote-coder-store.test.js`）
- 前端：`npm.cmd run test:web`（或单文件 `npm.cmd --prefix web run test -- src/remote-coder/useRemoteCoder.test.ts`）

---

## 文件结构

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `server/remote-coder-store.js` | 改 | 新增 `deliver` 种类；新增产物目录三个纯函数 |
| `server/remote-coder-mount.js` | 改 | 新增 `/artifacts`、`/artifact` 两个只读端点 + 错误映射 |
| `web/src/remote-coder/useDesktopRemoteCoder.ts` | 改 | `deliver` 条目 → 派发 `df-remote-deliver` |
| `web/src/remote-coder/deliverPrompt.ts` | 建 | 从工作流阶段里取 `package` 阶段提示语（纯函数） |
| `web/src/remote-coder/useRemoteCoder.ts` | 改 | 手机侧 `requestDeliver` / `fetchArtifacts` / `waitForNewArtifact` / `artifactUrl` |
| `web/src/remote-coder/PhoneView.vue` | 改 | 「打包」按钮 + 结果行 + 下载链接 |
| `web/src/components/TerminalView.vue` | 改 | 监听 `df-remote-deliver` → 发 `package` 提示语 |
| `shared/i18n/zh-CN.js` / `en.js` | 改 | 6 条新词条 |

---

### Task 1: store 支持 `deliver` 条目

**Files:**
- Modify: `server/remote-coder-store.js:58-72`
- Test: `server/test/remote-coder-store.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/remote-coder-store.test.js` 末尾追加：

```js
test('deliver 条目：无 text、id 前缀 d-', () => {
  const now = 1758000000000;
  const rand = () => 0.5;
  const d = makeEntry({ kind: 'deliver' }, now, rand);
  assert.deepEqual(d, { id: 'd-1758000000000-8000', ts: now, kind: 'deliver', handled: false });
  assert.equal(newId('deliver', 1, () => 0), 'd-1-0000');
  assert.equal(newId('message', 1, () => 0), 'm-1-0000');
  assert.equal(newId('screenshot', 1, () => 0), 'c-1-0000');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/remote-coder-store.test.js`
Expected: FAIL（`deliver` 落成 `message` 且 `bad-message` 抛错 / id 前缀是 `m-`）

- [ ] **Step 3: 改实现**

把 `server/remote-coder-store.js` 里的 `newId` 与 `makeEntry` 整体替换为：

```js
const ID_PREFIX = { screenshot: 'c', deliver: 'd' };
const KINDS = new Set(['screenshot', 'deliver', 'message']);

export function newId(kind, now = Date.now(), rand = Math.random) {
  const prefix = ID_PREFIX[kind] || 'm';
  const suffix = Math.floor(rand() * 0x10000).toString(16).padStart(4, '0');
  return `${prefix}-${now}-${suffix}`;
}

export function makeEntry(input, now = Date.now(), rand = Math.random) {
  const raw = input && input.kind;
  const kind = KINDS.has(raw) ? raw : 'message';
  const text = kind === 'message' ? String((input && input.text) ?? '').trim() : '';
  if (kind === 'message' && !text) throw err('bad-message', 'text is required');
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw err('too-large', 'text too large');
  const entry = { id: newId(kind, now, rand), ts: now, kind, handled: false };
  if (text) entry.text = text;
  return entry;
}
```

（`MAX_TEXT_BYTES`、`err` 已在文件里定义，不要重复声明。）

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test server/test/remote-coder-store.test.js`
Expected: PASS（含原有 `makeEntry`/`newId` 用例）

- [ ] **Step 5: 提交**

```powershell
git add server/remote-coder-store.js server/test/remote-coder-store.test.js
git commit -m "feat(remote-coder): messages.jsonc 支持 deliver 条目"
```

---

### Task 2: store 新增产物目录三个纯函数

**Files:**
- Modify: `server/remote-coder-store.js`（文件末尾追加）
- Test: `server/test/remote-coder-store.test.js`

- [ ] **Step 1: 写失败测试**

把 `server/test/remote-coder-store.test.js` 顶部的 store 导入补成：

```js
import {
  REMOTE_DIR, SCREEN_FILE, MESSAGES_FILE, dirOf, decodePng, parseJsonc,
  readMessages, writeMessages, newId, makeEntry, appendMessage, inbox, markHandled,
  saveScreen, screenRev, commitScreen,
  artifactsDir, listArtifacts, resolveArtifact,
} from '../remote-coder-store.js';
```

在文件末尾追加（注意 `tmp()` 已定义在文件顶部）：

```js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('listArtifacts：按 mtime 倒序、忽略目录、目录不存在返回 []', async () => {
  const root = tmp();
  const dir = artifactsDir(root);
  assert.equal(dir, path.join(root, 'dist-portable'));
  assert.deepEqual(listArtifacts(dir), []);

  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'old.zip'), 'a');
  await sleep(12);
  fs.writeFileSync(path.join(dir, 'new.zip'), 'bb');

  const items = listArtifacts(dir);
  assert.deepEqual(items.map((x) => x.name), ['new.zip', 'old.zip']);
  assert.equal(items[0].size, 2);
  assert.ok(items[0].mtime > items[1].mtime);
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolveArtifact：拒绝穿越/多段名/空名，缺失抛 not-found', () => {
  const root = tmp();
  const dir = artifactsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.zip'), 'x');

  assert.equal(resolveArtifact(dir, 'a.zip'), path.join(path.resolve(dir), 'a.zip'));
  for (const bad of ['../a.zip', '..', '.', '', 'sub/a.zip', null, undefined]) {
    assert.throws(() => resolveArtifact(dir, bad), (e) => e.code === 'bad-name');
  }
  assert.throws(() => resolveArtifact(dir, 'nope.zip'), (e) => e.code === 'not-found');
  fs.rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/remote-coder-store.test.js`
Expected: FAIL（`artifactsDir is not a function`）

- [ ] **Step 3: 写实现**

在 `server/remote-coder-store.js` 末尾追加：

```js
// —— 交付产物：dist-portable/ 下的文件列表与安全解析 ——
export const ARTIFACTS_DIR = 'dist-portable';

export function artifactsDir(root) {
  return path.join(root, ARTIFACTS_DIR);
}

export function listArtifacts(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const st = fs.statSync(path.join(dir, e.name));
    out.push({ name: e.name, size: st.size, mtime: st.mtimeMs });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

export function resolveArtifact(dir, name) {
  const n = String(name ?? '');
  if (!n || n === '.' || n === '..' || n !== path.basename(n)) throw err('bad-name', 'bad artifact name');
  const base = path.resolve(dir);
  const abs = path.resolve(base, n);
  if (path.dirname(abs) !== base) throw err('bad-name', 'bad artifact name');
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    throw err('not-found', 'artifact not found');
  }
  if (!st.isFile()) throw err('not-found', 'artifact not found');
  return abs;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test server/test/remote-coder-store.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add server/remote-coder-store.js server/test/remote-coder-store.test.js
git commit -m "feat(remote-coder): 产物目录列表与安全解析"
```

---

### Task 3: 服务端新增 `/artifacts` 与 `/artifact` 端点

**Files:**
- Modify: `server/remote-coder-mount.js:34-59`
- Test: `server/test/remote-coder-mount.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/remote-coder-mount.test.js` 末尾追加：

```js
test('artifacts 端点：列产物；artifact 端点：下载、404、非法名 400', async (t) => {
  const root = tmpDir();
  const server = await start(root, { remoteCoderGit: async () => '' });
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });

  assert.deepEqual(json(await req(server, '/api/remote-coder/artifacts')), { items: [] });

  const dir = path.join(root, 'dist-portable');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.zip'), 'ZIPDATA');

  const items = json(await req(server, '/api/remote-coder/artifacts')).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'a.zip');
  assert.equal(items[0].size, 7);

  const dl = await req(server, '/api/remote-coder/artifact?name=a.zip');
  assert.equal(dl.status, 200);
  assert.equal(dl.type, 'application/zip');
  assert.equal(dl.text, 'ZIPDATA');

  assert.equal((await req(server, '/api/remote-coder/artifact?name=nope.zip')).status, 404);
  assert.equal((await req(server, '/api/remote-coder/artifact?name=..%2Fa.zip')).status, 400);
  assert.equal((await req(server, '/api/remote-coder/artifact')).status, 400);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/remote-coder-mount.test.js`
Expected: FAIL（`/artifacts` 落到 `bad-request` 400）

- [ ] **Step 3: 写实现**

在 `server/remote-coder-mount.js` 里，把 `screen` 分支之后、`sendJson(res, 400, { error: 'bad-request' })` 之前插入两个分支：

```js
      if (pathname === `${PREFIX}/artifacts` && req.method === 'GET') {
        sendJson(res, 200, { items: store.listArtifacts(store.artifactsDir(repoRoot)) });
        return true;
      }
      if (pathname === `${PREFIX}/artifact` && req.method === 'GET') {
        const name = new URL(req.url, 'http://127.0.0.1').searchParams.get('name');
        const file = store.resolveArtifact(store.artifactsDir(repoRoot), name);
        const size = fs.statSync(file).size;
        const type = path.extname(file).toLowerCase() === '.zip' ? 'application/zip' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res);
        return true;
      }
```

把 catch 块改成（新增 `bad-name` → 400、`not-found` → 404）：

```js
    } catch (err) {
      if (err.code === 'bad-image' || err.code === 'bad-message' || err.code === 'bad-jsonc' || err.code === 'bad-name') {
        sendJson(res, 400, { error: err.code, message: String(err.message) });
        return true;
      }
      if (err.code === 'too-large') { sendJson(res, 413, { error: 'too-large' }); return true; }
      if (err.code === 'not-found') { sendJson(res, 404, { error: 'not-found' }); return true; }
      sendJson(res, 500, { error: 'internal', message: String((err && err.message) || err) });
      return true;
    }
```

（`fs` / `path` 已在文件顶部导入，不要重复导入。）

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test server/test/remote-coder-mount.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add server/remote-coder-mount.js server/test/remote-coder-mount.test.js
git commit -m "feat(remote-coder): 新增产物列表与下载端点"
```

---

### Task 4: i18n 词条（中英同时补齐）

**Files:**
- Modify: `shared/i18n/zh-CN.js:42` 之后
- Modify: `shared/i18n/en.js:42` 之后

- [ ] **Step 1: 加中文词条**

在 `shared/i18n/zh-CN.js` 的 `'remote.send_failed': '发送失败：{msg}',` 下一行插入：

```js
  'remote.deliver': '打包',
  'remote.deliver_sent': '已下发打包，等待产物…',
  'remote.deliver_done': '已完成：{name}',
  'remote.deliver_timeout': '未检测到新产物（请点「截图」查看终端）',
  'remote.deliver_failed': '下发失败：{msg}',
  'remote.download': '下载',
```

- [ ] **Step 2: 加英文词条**

在 `shared/i18n/en.js` 的 `'remote.send_failed': 'Send failed: {msg}',` 下一行插入：

```js
  'remote.deliver': 'Build',
  'remote.deliver_sent': 'Build requested, waiting for artifact…',
  'remote.deliver_done': 'Done: {name}',
  'remote.deliver_timeout': 'No new artifact detected (tap "Capture" to check the terminal)',
  'remote.deliver_failed': 'Request failed: {msg}',
  'remote.download': 'Download',
```

- [ ] **Step 3: 跑 i18n 校验**

Run: `npm.cmd run check:i18n`
Expected: 通过（中英键集合对称）

- [ ] **Step 4: 提交**

```powershell
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 手机遥控打包与下载词条"
```

---

### Task 5: 桌面端把 `deliver` 条目派发出去

**Files:**
- Modify: `web/src/remote-coder/useDesktopRemoteCoder.ts:2,37-40`
- Test: `web/src/remote-coder/useDesktopRemoteCoder.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/remote-coder/useDesktopRemoteCoder.test.ts` 的 `describe` 内追加：

```ts
  it('deliver 条目派发 df-remote-deliver 并被 ack', async () => {
    const { fetchFn, calls } = mkFetch([{ entries: [{ id: 'd1', kind: 'deliver' }] }]);
    const events: Array<{ name: string; detail?: unknown }> = [];
    const stop = startDesktopRemoteCoder({
      fetch: fetchFn as never,
      visibility: () => 'visible',
      dispatch: (name, detail) => events.push({ name, detail }),
      intervalMs: 5,
    });
    await tick(20);
    stop();
    expect(events).toEqual([{ name: 'df-remote-deliver', detail: undefined }]);
    expect(JSON.parse(String(calls.find((c) => c.url === '/api/remote-coder/ack')?.init?.body))).toEqual({ ids: ['d1'] });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/remote-coder/useDesktopRemoteCoder.test.ts`
Expected: FAIL（`events` 为空数组，`deliver` 未派发）

- [ ] **Step 3: 写实现**

`web/src/remote-coder/useDesktopRemoteCoder.ts` 第 2 行的接口改为：

```ts
export interface RemoteEntry { id: string; kind: 'screenshot' | 'message' | 'deliver'; text?: string }
```

派发分支改为：

```ts
      for (const e of entries) {
        if (e.kind === 'screenshot') deps.dispatch('df-remote-screen');
        else if (e.kind === 'deliver') deps.dispatch('df-remote-deliver');
        else if (e.kind === 'message' && e.text) deps.dispatch('df-remote-send', { text: e.text });
      }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/remote-coder/useDesktopRemoteCoder.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add web/src/remote-coder/useDesktopRemoteCoder.ts web/src/remote-coder/useDesktopRemoteCoder.test.ts
git commit -m "feat(web): 桌面端派发手机打包指令"
```

---

### Task 6: `package` 阶段提示语取值函数

**Files:**
- Create: `web/src/remote-coder/deliverPrompt.ts`
- Test: `web/src/remote-coder/deliverPrompt.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `web/src/remote-coder/deliverPrompt.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { packagePrompt } from './deliverPrompt';

describe('packagePrompt', () => {
  it('取 package 阶段的首个非空提示语', () => {
    expect(packagePrompt([
      { id: 'code', prompts: ['写代码'] },
      { id: 'package', prompts: ['打包 release', '压缩'] },
    ], 'fb')).toBe('打包 release');
    expect(packagePrompt([{ id: 'package', prompts: ['  ', '打包'] }], 'fb')).toBe('打包');
  });

  it('无 package 阶段或提示语为空时用兜底', () => {
    expect(packagePrompt([], 'fb')).toBe('fb');
    expect(packagePrompt([{ id: 'package' }], 'fb')).toBe('fb');
    expect(packagePrompt([{ id: 'package', prompts: [] }], 'fb')).toBe('fb');
    expect(packagePrompt(undefined as never, 'fb')).toBe('fb');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/remote-coder/deliverPrompt.test.ts`
Expected: FAIL（找不到 `./deliverPrompt`）

- [ ] **Step 3: 写实现**

新建 `web/src/remote-coder/deliverPrompt.ts`：

```ts
// 交付（打包）指令：从工作流阶段里取 package 阶段的首个非空提示语，缺失时用兜底文案。
export interface PromptStage { id: string; prompts?: string[] }

export function packagePrompt(stages: PromptStage[] | undefined, fallback: string): string {
  const stage = (stages || []).find((s) => s && s.id === 'package');
  const text = (stage?.prompts || []).find((p) => p && p.trim());
  return text || fallback;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/remote-coder/deliverPrompt.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add web/src/remote-coder/deliverPrompt.ts web/src/remote-coder/deliverPrompt.test.ts
git commit -m "feat(web): 交付指令取 package 阶段提示语"
```

---

### Task 7: `TerminalView` 监听 `df-remote-deliver`

**Files:**
- Modify: `web/src/components/TerminalView.vue:18`（导入区）、`:473`（`onRemoteScreen` 之后）、`:823`、`:844`

> `TerminalView.vue` 没有单测文件，本任务靠 `vue-tsc` 类型检查 + 人工验收（Task 9）验证。

- [ ] **Step 1: 加导入**

在 `web/src/components/TerminalView.vue` 第 18 行 `import { useEnglishComposer } from '../useEnglishComposer';` 之后加：

```ts
import { packagePrompt } from '../remote-coder/deliverPrompt';
```

- [ ] **Step 2: 加处理函数**

在 `onRemoteScreen` 函数（`web/src/components/TerminalView.vue:452-473`）结束后加：

```ts
// 手机点「打包」：把当前工作流 package 阶段的提示语打进活动会话（复用 sendToActive）
function onRemoteDeliver() {
  sendToActive(packagePrompt(curWf.value.stages, t('termwf.package.prompt')));
}
```

- [ ] **Step 3: 注册与注销监听**

`onMounted` 里 `window.addEventListener('df-remote-screen', onRemoteScreen);` 之后加：

```ts
  window.addEventListener('df-remote-deliver', onRemoteDeliver);
```

`onBeforeUnmount` 里 `window.removeEventListener('df-remote-screen', onRemoteScreen);` 之后加：

```ts
  window.removeEventListener('df-remote-deliver', onRemoteDeliver);
```

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过（无新增报错）

- [ ] **Step 5: 提交**

```powershell
git add web/src/components/TerminalView.vue
git commit -m "feat(web): 终端响应手机打包指令"
```

---

### Task 8: 手机侧交付与产物客户端

**Files:**
- Modify: `web/src/remote-coder/useRemoteCoder.ts`（末尾追加）
- Test: `web/src/remote-coder/useRemoteCoder.test.ts`

- [ ] **Step 1: 写失败测试**

把 `web/src/remote-coder/useRemoteCoder.test.ts` 第 2 行的导入改为：

```ts
import {
  requestShot, fetchScreenRev, sendRemoteMessage, waitForNewScreen, screenUrl,
  requestDeliver, fetchArtifacts, waitForNewArtifact, artifactUrl,
} from './useRemoteCoder';
```

在 `describe` 内追加：

```ts
  it('requestDeliver 发交付命令', async () => {
    const { fetchFn, calls } = mkFetch({ ok: true });
    await requestDeliver({ fetch: fetchFn as never });
    expect(calls[0].url).toBe('/api/remote-coder/message');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ kind: 'deliver' });
  });

  it('fetchArtifacts 取列表，缺字段或异常返回空数组', async () => {
    const { fetchFn } = mkFetch({ items: [{ name: 'a.zip', size: 1, mtime: 2 }] });
    expect(await fetchArtifacts({ fetch: fetchFn as never })).toEqual([{ name: 'a.zip', size: 1, mtime: 2 }]);

    const bad = mkFetch({});
    expect(await fetchArtifacts({ fetch: bad.fetchFn as never })).toEqual([]);
    const boom = vi.fn(async () => { throw new Error('offline'); });
    expect(await fetchArtifacts({ fetch: boom as never })).toEqual([]);
  });

  it('waitForNewArtifact：出现比 sinceTs 新的产物即返回；超时返回 null', async () => {
    const { fetchFn } = mkFetch((n: number) => (n <= 1
      ? { items: [{ name: 'old.zip', size: 1, mtime: 100 }] }
      : { items: [{ name: 'new.zip', size: 2, mtime: 200 }] }));
    expect(await waitForNewArtifact(150, { fetch: fetchFn as never, timeoutMs: 300, intervalMs: 5 }))
      .toEqual({ name: 'new.zip', size: 2, mtime: 200 });

    const stuck = mkFetch({ items: [{ name: 'old.zip', size: 1, mtime: 100 }] });
    expect(await waitForNewArtifact(150, { fetch: stuck.fetchFn as never, timeoutMs: 60, intervalMs: 5 })).toBeNull();
  });

  it('artifactUrl 转义文件名', () => {
    expect(artifactUrl('a b.zip')).toBe('/api/remote-coder/artifact?name=a%20b.zip');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/remote-coder/useRemoteCoder.test.ts`
Expected: FAIL（`requestDeliver is not a function`）

- [ ] **Step 3: 写实现**

在 `web/src/remote-coder/useRemoteCoder.ts` 末尾追加：

```ts
export interface ArtifactItem { name: string; size: number; mtime: number }

export async function requestDeliver(deps: RemoteDeps = { fetch: realFetch }): Promise<void> {
  await postJson('/api/remote-coder/message', { kind: 'deliver' }, deps);
}

export async function fetchArtifacts(deps: RemoteDeps = { fetch: realFetch }): Promise<ArtifactItem[]> {
  try {
    const res = await deps.fetch('/api/remote-coder/artifacts');
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}

export function artifactUrl(name: string): string {
  return `/api/remote-coder/artifact?name=${encodeURIComponent(name)}`;
}

export interface WaitArtifactOptions extends Partial<RemoteDeps> {
  timeoutMs?: number;
  intervalMs?: number;
}

export async function waitForNewArtifact(sinceTs: number, opts: WaitArtifactOptions = {}): Promise<ArtifactItem | null> {
  const deps: RemoteDeps = { fetch: opts.fetch ?? realFetch };
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
  const intervalMs = opts.intervalMs ?? 3000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const items = await fetchArtifacts(deps);
    const hit = items.find((x) => x && typeof x.mtime === 'number' && x.mtime > sinceTs);
    if (hit) return hit;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/remote-coder/useRemoteCoder.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add web/src/remote-coder/useRemoteCoder.ts web/src/remote-coder/useRemoteCoder.test.ts
git commit -m "feat(web): 手机侧交付与产物客户端"
```

---

### Task 9: 手机页「打包」按钮与结果行

**Files:**
- Modify: `web/src/remote-coder/PhoneView.vue`
- Test: `web/src/remote-coder/PhoneView.test.ts`

- [ ] **Step 1: 写失败测试**

把 `web/src/remote-coder/PhoneView.test.ts` 的 `stubFetch` 换成（新增 `items` 状态与 `/artifacts` 分支）：

```ts
function stubFetch(state = { rev: 'r1', items: [] as Array<{ name: string; size: number; mtime: number }> }) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit): Promise<any> => {
    calls.push({ url, init });
    if (url.startsWith('/api/remote-coder/state')) {
      return { ok: true, status: 200, json: async () => ({ rev: state.rev }) };
    }
    if (url.startsWith('/api/remote-coder/artifacts')) {
      return { ok: true, status: 200, json: async () => ({ items: state.items }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, rev: state.rev, uploaded: true, reason: '' }) };
  });
  vi.stubGlobal('fetch', fetchFn);
  return { fetchFn, calls, state };
}
```

在 `describe` 内追加：

```ts
  it('点「打包」：发交付命令，出现新产物后显示下载链接', async () => {
    const s = stubFetch({ rev: 'r1', items: [] });
    const w = mountC(PhoneView);
    await flushPromises();

    s.state.items = [{ name: 'new.zip', size: 9, mtime: Date.now() + 60000 }];
    await w.find('.deliver').trigger('click');
    await flushPromises();

    const call = s.calls.find((c) => c.url === '/api/remote-coder/message');
    expect(JSON.parse(String(call?.init?.body))).toEqual({ kind: 'deliver' });
    expect(w.find('.dl').attributes('href')).toBe('/api/remote-coder/artifact?name=new.zip');
    expect(w.find('.st').text()).toBe(t('remote.deliver_done', { name: 'new.zip' }));
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/remote-coder/PhoneView.test.ts`
Expected: FAIL（找不到 `.deliver`）

- [ ] **Step 3: 写实现**

把 `web/src/remote-coder/PhoneView.vue` 的 `<script setup>` 整体替换为：

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  artifactUrl, fetchScreenRev, requestDeliver, requestShot, screenUrl,
  sendRemoteMessage, waitForNewArtifact, waitForNewScreen,
} from './useRemoteCoder';
import { t } from '../i18n';

const rev = ref('');
const pending = ref(false);
const status = ref('');
const text = ref('');
const sending = ref(false);
const delivering = ref(false);
const artifact = ref<{ name: string; url: string } | null>(null);
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

async function onDeliver() {
  if (delivering.value) return;
  delivering.value = true;
  artifact.value = null;
  const since = Date.now();
  showStatus(t('remote.deliver_sent'), 0);
  try {
    await requestDeliver();
    const hit = await waitForNewArtifact(since);
    if (!hit) { showStatus(t('remote.deliver_timeout')); return; }
    artifact.value = { name: hit.name, url: artifactUrl(hit.name) };
    showStatus(t('remote.deliver_done', { name: hit.name }));
  } catch (e) {
    showStatus(t('remote.deliver_failed', { msg: (e as Error).message || String(e) }));
  } finally {
    delivering.value = false;
  }
}

onMounted(async () => { rev.value = await fetchScreenRev(); });
</script>
```

把 `<template>` 整体替换为：

```vue
<template>
  <div class="phone">
    <header class="ph">
      <span class="ttl">{{ $t('remote.title') }}</span>
      <button class="shot" :disabled="pending" @click="onShot">{{ $t('remote.shot') }}</button>
      <button class="deliver" :disabled="delivering" @click="onDeliver">{{ $t('remote.deliver') }}</button>
      <span class="st" :title="status">{{ status }}</span>
    </header>
    <div class="screen">
      <img v-if="rev" class="img" :src="screenUrl(rev)" alt="opencode" />
      <div v-else class="empty">{{ $t('remote.no_screen') }}</div>
    </div>
    <div v-if="artifact" class="art">
      <a class="dl" :href="artifact.url" download>{{ $t('remote.download') }}</a>
      <span class="aname" :title="artifact.name">{{ artifact.name }}</span>
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
```

在 `<style scoped>` 里，把 `.shot { ... }` 与 `.shot:disabled { ... }` 两条规则改为共用选择器，并追加产物行样式：

```css
.shot, .deliver { background: var(--ac); color: var(--onac); border: none; border-radius: 6px; padding: 5px 14px; cursor: pointer; font-size: 13px; font-weight: 600; }
.shot:disabled, .deliver:disabled { opacity: .6; cursor: default; }
.art { flex: none; display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--bg2); border-top: 1px solid var(--bd2); font-size: 13px; }
.dl { background: var(--ac); color: var(--onac); border-radius: 6px; padding: 4px 12px; text-decoration: none; font-weight: 600; }
.aname { flex: 1; min-width: 0; color: var(--tx3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/remote-coder/PhoneView.test.ts`
Expected: PASS（含原有截图/发送用例）

- [ ] **Step 5: 提交**

```powershell
git add web/src/remote-coder/PhoneView.vue web/src/remote-coder/PhoneView.test.ts
git commit -m "feat(web): 手机页打包按钮与产物下载"
```

---

### Task 10: 全量校验与人工验收

- [ ] **Step 1: 全量测试与静态检查**

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run check:i18n
```
Expected: 全部通过。

- [ ] **Step 2: 人工验收（dev，端口 33333）**

1. 后台起服务（异步，日志落 `logs\`）：
   ```powershell
   Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev" -RedirectStandardOutput "logs\dev-server.log" -RedirectStandardError "logs\dev-server.err.log" -WindowStyle Hidden
   ```
2. 打开 `http://localhost:5173`，桌面端打开一个项目并进入一个会话（opencode 或 cmd 均可）。
3. 顶栏点 `📱` 新标签打开手机页。
4. 手机页点「截图」→ 中间出现终端截图。
5. 手机页点「打包」→ 状态显示「已下发打包，等待产物…」；桌面端当前会话里出现 workflow `package` 阶段的提示语并回车发出。
6. 让打包真的产出 zip（或在 `dist-portable/` 里手动放一个新 `.zip` 并确认 `mtime` 更新）→ 手机页出现「已完成：<名字>」与「下载」按钮，点击能下载到该文件。
7. 反例：不产出任何新产物 → 超时后显示「未检测到新产物（请点「截图」查看终端）」。
8. 检查 `remote_coder/messages.jsonc`：新增的 `deliver` 条目 `handled` 已回填为 `true`。

- [ ] **Step 3: 提交收尾（如有验收中修的小问题）**

```powershell
git add <本次实际改动的文件>
git commit -m "fix(remote-coder): 手机打包验收修正"
```

---

## 自查记录

- **Spec 覆盖**：`deliver` 协议（Task 1）、产物列表/下载端点（Task 2/3）、i18n（Task 4）、桌面派发（Task 5）、`package` 提示语（Task 6）、终端接线（Task 7）、手机客户端（Task 8）、手机 UI（Task 9）、验收（Task 10）—— spec 第 2/3/4/5/6 节均有对应任务。
- **占位符扫描**：无 TBD/TODO；每个代码步骤都给了完整代码与预期输出。
- **类型一致性**：`ArtifactItem`（`useRemoteCoder.ts`）与 store 的 `{ name, size, mtime }` 一致；`df-remote-deliver` 在 Task 5 派发、Task 7 监听，字符串一致；`packagePrompt(stages, fallback)` 在 Task 6 定义、Task 7 调用，签名一致。
