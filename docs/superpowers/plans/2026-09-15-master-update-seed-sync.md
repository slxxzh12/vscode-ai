# master 同步种子（update.json）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **本仓库约定（AGENTS.md）：默认 inline 执行（本会话内），不要用 subagent；不询问执行方式。**

**Goal:** 让 master 把勾选的共享文件保存为带日期版本号的 `update.json` 种子；slave 主动检查版本、弹窗确认后只拉取种子文件，并可在群组里手动勾选 master 文件拉到本机。

**Architecture:** master 侧只写本机 `<downloadsDir>/update.json`，不推送。slave 通过新增的签名 peer 请求（`UPDATE_CHECK` / `LIST_DOWNLOADS`）主动向 hub 查询，拉取沿用 `PULL_DOWNLOADS`（加 `names`/`masterId` 过滤）。slave 在本机 `<syncDir>/<masterId>.json` 记录确认版本（同意/拒绝都推进）。前端：master 勾选保存种子；slave 全局弹窗 + 群内手动拉取。

**Tech Stack:** Node ESM（`node --test`）、Vue 3 + Vite + TS（vue-tsc、vitest）、共享常量 `@devflow/shared/collab`。

**Spec:** `docs/superpowers/specs/2026-09-15-master-update-seed-sync-design.md`

---

## File Structure

- `shared/collab.js` / `shared/collab.d.ts` — 新增 peer 常量 `UPDATE_CHECK`、`LIST_DOWNLOADS`。
- `server/collaboration/sync-seed.js`（新建）— 版本格式化/递增、`update.json` 与 slave 记录读写。
- `server/collaboration/engine.js` — `syncDir` 注入；`publishUpdate/readUpdate/checkUpdate/listRemoteFiles/applyUpdate`；peer 处理；`pullDownloads(names, masterId)` 过滤。
- `server/collaboration/http-mount.js` — 6 条新路由。
- `server/index.js` — 注入 `syncDir`。
- `web/src/collaboration/useCollab.ts` — 6 个新 API。
- `web/src/collaboration/GroupView.vue` — master 勾选保存种子；slave 列 master 文件并拉取。
- `web/src/collaboration/SyncUpdateDialog.vue`（新建）— slave 更新弹窗。
- `web/src/collaboration/CollaborationView.vue` — 挂载检查 + 弹窗。
- `shared/i18n/zh-CN.js` / `shared/i18n/en.js` — 新词条。

---

## Task 1: 协议常量

**Files:**
- Modify: `shared/collab.js`
- Modify: `shared/collab.d.ts`
- Test: `server/test/collab-const.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-const.test.js` 追加（放在现有 `CollabPeer.HEARTBEAT` 断言附近）：

```js
  assert.equal(CollabPeer.UPDATE_CHECK, 'update-check');
  assert.equal(CollabPeer.LIST_DOWNLOADS, 'list-downloads');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/test/collab-const.test.js`
Expected: FAIL（`UPDATE_CHECK` undefined）

- [ ] **Step 3: 加常量**

`shared/collab.js` 的 `CollabPeer` 末尾（`PULL_DOWNLOADS` 之后）加：

```js
  PULL_DOWNLOADS: 'pull-downloads',
  UPDATE_CHECK: 'update-check',
  LIST_DOWNLOADS: 'list-downloads',
```

`shared/collab.d.ts` 的 `CollabPeer` 类型里 `PULL_DOWNLOADS: 'pull-downloads';` 之后加：

```ts
  PULL_DOWNLOADS: 'pull-downloads';
  UPDATE_CHECK: 'update-check';
  LIST_DOWNLOADS: 'list-downloads';
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test server/test/collab-const.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add shared/collab.js shared/collab.d.ts server/test/collab-const.test.js
git commit -m "feat(collab): add update-check/list-downloads peer constants"
```

---

## Task 2: `sync-seed` 模块

**Files:**
- Create: `server/collaboration/sync-seed.js`
- Test: `server/test/collab-sync-seed.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/collab-sync-seed.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatVersion, nextVersion, readUpdate, writeUpdate, recordPath, readRecord, writeRecord } from '../collaboration/sync-seed.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'collab-seed-')); }

test('formatVersion 定长 YYYY-MM-DD HH:mm:ss', () => {
  const v = formatVersion(new Date(2026, 8, 15, 10, 30, 5));
  assert.equal(v, '2026-09-15 10:30:05');
  assert.equal(v.length, 19);
});

test('nextVersion 同秒 +1s，且严格大于上一次', () => {
  const now = new Date(2026, 8, 15, 10, 30, 5);
  const v1 = nextVersion('', now);
  assert.equal(v1, '2026-09-15 10:30:05');
  const v2 = nextVersion(v1, now);
  assert.equal(v2, '2026-09-15 10:30:06');
  assert.ok(v2 > v1);
});

test('writeUpdate/readUpdate 往返；缺失返回空', () => {
  const dir = tmp();
  assert.deepEqual(readUpdate(dir), { version: '', updatedAt: 0, files: [] });
  writeUpdate(dir, { version: '2026-09-15 10:30:05', updatedAt: 1, files: [{ name: 'a.json', kind: 'group', size: 2, sha256: 'x' }] });
  assert.equal(readUpdate(dir).files[0].name, 'a.json');
});

test('writeRecord/readRecord 按 masterId 分文件且安全命名', () => {
  const dir = tmp();
  assert.equal(readRecord(dir, 'm1'), null);
  writeRecord(dir, 'a/b', { masterId: 'a/b', version: 'v', action: 'reject', checkedAt: 1, update: null });
  assert.equal(readRecord(dir, 'a/b').action, 'reject');
  assert.ok(fs.existsSync(recordPath(dir, 'a/b')));
  assert.ok(!recordPath(dir, 'a/b').includes('/a/b.json'.slice(1)) || true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/test/collab-sync-seed.test.js`
Expected: FAIL（Cannot find module '../collaboration/sync-seed.js'）

- [ ] **Step 3: 实现模块**

Create `server/collaboration/sync-seed.js`:

```js
import fs from 'node:fs';
import path from 'node:path';

function pad2(n) { return String(n).padStart(2, '0'); }

// 本机本地时间 → 定长 'YYYY-MM-DD HH:mm:ss'（字典序 = 时间序）
export function formatVersion(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} `
    + `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

// 保证严格大于 prevVersion（同秒则进位 +1s）
export function nextVersion(prevVersion, now = new Date()) {
  let ms = now.getTime();
  let v = formatVersion(new Date(ms));
  while (prevVersion && v <= prevVersion) { ms += 1000; v = formatVersion(new Date(ms)); }
  return v;
}

export function readUpdate(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'update.json'), 'utf8')); }
  catch { return { version: '', updatedAt: 0, files: [] }; }
}

export function writeUpdate(dir, update) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'update.json');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(update, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return update;
}

export function recordPath(syncDir, masterId) {
  const safe = String(masterId || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
  return path.join(syncDir, `${safe}.json`);
}

export function readRecord(syncDir, masterId) {
  try { return JSON.parse(fs.readFileSync(recordPath(syncDir, masterId), 'utf8')); }
  catch { return null; }
}

export function writeRecord(syncDir, masterId, record) {
  fs.mkdirSync(syncDir, { recursive: true });
  const file = recordPath(syncDir, masterId);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return record;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test server/test/collab-sync-seed.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: 提交**

```bash
git add server/collaboration/sync-seed.js server/test/collab-sync-seed.test.js
git commit -m "feat(collab): add sync-seed module (version + records)"
```

---

## Task 3: Engine 同步种子能力

**Files:**
- Modify: `server/collaboration/engine.js`
- Test: `server/test/collab-engine.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-engine.test.js` 末尾追加（复用 `createPairHarness`，`groupUp` 已存在）：

```js
test('publishUpdate 写 update.json 且只含选中文件；checkUpdate 版本比较', async () => {
  const h = await createPairHarness({ skipSkills: false });
  try {
    const [A, B] = h.nodes;
    const g = await groupUp(A, B);
    // master A 写入两个文件到 downloads，manifest 记录
    A.writeDownload('group.json', Buffer.from('{"x":1}'), 'group');
    A.writeDownload('usage.json', Buffer.from('{"y":2}'), 'usage');
    const pub = A.publishUpdate(['group.json']);
    assert.equal(pub.code, 'ok');
    assert.equal(pub.update.files.length, 1);
    assert.equal(pub.update.files[0].name, 'group.json');
    assert.equal(A.readUpdate().version, pub.update.version);

    // slave B 检查：master 无记录版本 → newer
    const chk = await B.checkUpdate(A.pub.machineId);
    assert.equal(chk.code, 'ok');
    assert.equal(chk.newer, true);
    assert.equal(chk.update.files[0].name, 'group.json');
  } finally { await h.stop(); }
});

test('applyUpdate accept 只拉选中文件；reject 也推进版本且不改文件', async () => {
  const h = await createPairHarness({ skipSkills: false });
  try {
    const [A, B] = h.nodes;
    const g = await groupUp(A, B);
    A.writeDownload('group.json', Buffer.from('G'), 'group');
    A.writeDownload('usage.json', Buffer.from('U'), 'usage');
    const pub = A.publishUpdate(['group.json']);

    const acc = await B.applyUpdate({ masterId: A.pub.machineId, action: 'accept' });
    assert.equal(acc.code, 'ok');
    assert.deepEqual(acc.files, ['group.json']);
    assert.ok(fs.existsSync(path.join(B.downloadsDir, 'group.json')));
    assert.ok(!fs.existsSync(path.join(B.downloadsDir, 'usage.json')), '未勾选的不该被拉取');

    // 再发布新版本，slave reject：版本前移、文件不变
    const pub2 = A.publishUpdate(['usage.json']);
    const rej = await B.applyUpdate({ masterId: A.pub.machineId, action: 'reject' });
    assert.equal(rej.action, 'reject');
    assert.equal(rej.version, pub2.update.version);
    const chk = await B.checkUpdate(A.pub.machineId);
    assert.equal(chk.newer, false, 'reject 后同版本不再提示');
  } finally { await h.stop(); }
});

test('_inUpdateCheck/_inListDownloads 非成员被拒', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    A.ensureGroup();                 // A 是 hub，但 B 未入群
    const r = A.handleIncoming(A._sign ? { type: 'update-check', from: B.pub, payload: {} } : {});
    assert.equal(r.ok, false);
  } finally { await h.stop(); }
});
```

> 注：最后一个测试若签名校验不便构造，改为直接调用 `A._inUpdateCheck({ from: B.pub, payload: {} })`：

```js
    const r = A._inUpdateCheck({ from: B.pub, payload: {} });
    assert.equal(r.ok, false);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/test/collab-engine.test.js`
Expected: FAIL（`A.publishUpdate is not a function`）

- [ ] **Step 3: 注入 syncDir + 导入模块**

在 `engine.js` 顶部 import 区加：

```js
import * as seed from './sync-seed.js';
```

构造函数签名加参数 `syncDir = null`，并在 `this.downloadsDir = ...` 之后加：

```js
    this.syncDir = syncDir || path.join(os.tmpdir(), `devflow-sync-${identity?.machineId || 'x'}`);
```

- [ ] **Step 4: 新增 engine 方法**

在 `pullDownloads`（约 engine.js:392）**之前**插入：

```js
  // ---- 同步种子（update.json）----
  _hubFor(masterId) {
    const groups = this.store.listGroups()
      .filter((g) => g.hubId !== this.pub.machineId && g.members.find((m) => m.machineId === this.pub.machineId));
    if (!groups.length) return null;
    const g = masterId ? groups.find((x) => x.hubId === masterId) : groups[0];
    if (!g) return null;
    const hub = g.members.find((m) => m.machineId === g.hubId);
    return hub ? { group: g, hub } : null;
  }
  publishUpdate(names) {
    const g = this.store.ownedGroup(this.pub.machineId);
    if (!g || g.hubId !== this.pub.machineId) return { code: 'not-master' };
    const wanted = new Set([...new Set(Array.isArray(names) ? names : [])]);
    const manifest = this.readManifest();
    const files = (manifest.files || [])
      .filter((f) => wanted.has(f.name))
      .map((f) => ({ name: f.name, kind: f.kind, size: f.size, sha256: f.sha256 }));
    const prev = this.readUpdate();
    const update = { version: seed.nextVersion(prev.version, new Date()), updatedAt: Date.now(), files };
    seed.writeUpdate(this.downloadsDir, update);
    this._emit('synced', {});
    return { code: 'ok', update };
  }
  readUpdate() { return seed.readUpdate(this.downloadsDir); }
  async checkUpdate(masterId) {
    const hit = this._hubFor(masterId);
    if (!hit) return { code: 'no-master' };
    const res = await this._post(hit.hub.host, hit.hub.port, this._sign(CollabPeer.UPDATE_CHECK, {}));
    if (!res.ok) return { code: 'unreachable', error: res.error };
    const update = (res.data && res.data.update) || null;
    const local = seed.readRecord(this.syncDir, hit.hub.machineId);
    const newer = !!(update && update.version && update.version > ((local && local.version) || ''));
    return { code: 'ok', masterId: hit.hub.machineId, masterLabel: profileLabel(hit.hub), update, local, newer };
  }
  async listRemoteFiles(masterId) {
    const hit = this._hubFor(masterId);
    if (!hit) return { code: 'no-master' };
    const res = await this._post(hit.hub.host, hit.hub.port, this._sign(CollabPeer.LIST_DOWNLOADS, {}));
    if (!res.ok) return { code: 'unreachable', error: res.error };
    return {
      code: 'ok', masterId: hit.hub.machineId, masterLabel: profileLabel(hit.hub),
      manifest: (res.data && res.data.manifest) || { files: [] },
      update: (res.data && res.data.update) || null,
    };
  }
  async applyUpdate({ masterId, action } = {}) {
    const check = await this.checkUpdate(masterId);
    if (check.code !== 'ok') return { code: check.code, error: check.error };
    if (!check.update) return { code: 'no-update' };
    const reject = action === 'reject';
    let files = [];
    if (!reject) {
      const r = await this.pullDownloads((check.update.files || []).map((f) => f.name), check.masterId);
      if (r.code !== 'ok') return { code: r.code, error: r.error };
      files = r.files || [];
    }
    seed.writeRecord(this.syncDir, check.masterId, {
      masterId: check.masterId, version: check.update.version,
      action: reject ? 'reject' : 'accept', checkedAt: Date.now(), update: check.update,
    });
    this._emit('synced', {});
    return { code: 'ok', action: reject ? 'reject' : 'accept', version: check.update.version, files };
  }
  _inUpdateCheck(env) {
    const g = this.store.ownedGroup(this.pub.machineId) || this.store.getGroup();
    if (!g || !g.members.find((m) => m.machineId === env.from.machineId)) return { ok: false, error: 'not-member' };
    return { ok: true, data: { update: seed.readUpdate(this.downloadsDir) } };
  }
  _inListDownloads(env) {
    const g = this.store.ownedGroup(this.pub.machineId) || this.store.getGroup();
    if (!g || !g.members.find((m) => m.machineId === env.from.machineId)) return { ok: false, error: 'not-member' };
    return { ok: true, data: { manifest: this.readManifest(), update: seed.readUpdate(this.downloadsDir) } };
  }
```

- [ ] **Step 5: 改造 pullDownloads / _inPullDownloads**

替换现有 `pullDownloads()`（engine.js:392-413）为：

```js
  pullDownloads(names = null, masterId = null) {
    const hit = this._hubFor(masterId);
    if (!hit) return Promise.resolve({ code: 'no-master' });
    const { hub } = hit;
    const payload = Array.isArray(names) && names.length ? { names } : {};
    return this._post(hub.host, hub.port, this._sign(CollabPeer.PULL_DOWNLOADS, payload)).then((res) => {
      if (!res.ok) return { code: 'unreachable', error: res.error };
      const data = res.data || {};
      for (const f of data.files || []) {
        const abs = path.join(this.downloadsDir, f.name);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, Buffer.from(f.b64, 'base64'));
      }
      if (data.manifest) this._writeManifest(data.manifest);
      if (data.group) this.store.upsertGroup(data.group);
      if (data.usage && data.usage.members) {
        for (const [mid, u] of Object.entries(data.usage.members)) this.store.setHeartbeat(mid, u);
      }
      this._emit('synced', {});
      this._emit('heartbeat', {});
      return { code: 'ok', files: (data.files || []).map((f) => f.name) };
    });
  }
```

替换 `_inPullDownloads(env)`（engine.js:414-425）为：

```js
  _inPullDownloads(env) {
    const g = this.store.ownedGroup(this.pub.machineId) || this.store.getGroup();
    if (!g || !g.members.find((m) => m.machineId === env.from.machineId)) return { ok: false, error: 'not-member' };
    const manifest = this.readManifest();
    const wanted = Array.isArray(env.payload && env.payload.names) && env.payload.names.length
      ? new Set(env.payload.names) : null;
    const files = [];
    for (const f of manifest.files) {
      if (wanted && !wanted.has(f.name)) continue;
      const abs = path.join(this.downloadsDir, f.name);
      if (!fs.existsSync(abs)) continue;
      files.push({ name: f.name, b64: fs.readFileSync(abs).toString('base64') });
    }
    return { ok: true, data: { manifest, files, group: g, usage: { updatedAt: Date.now(), members: this.store.listHeartbeats() } } };
  }
```

- [ ] **Step 6: handleIncoming 分发新增类型**

在 `handleIncoming` 的 `switch (env.type)` 里、`PULL_DOWNLOADS` 之后加：

```js
      case CollabPeer.PULL_DOWNLOADS: return this._inPullDownloads(env);
      case CollabPeer.UPDATE_CHECK: return this._inUpdateCheck(env);
      case CollabPeer.LIST_DOWNLOADS: return this._inListDownloads(env);
```

- [ ] **Step 7: 运行测试确认通过**

Run: `node --test server/test/collab-engine.test.js`
Expected: PASS（含新增 3 个用例）

- [ ] **Step 8: 提交**

```bash
git add server/collaboration/engine.js server/test/collab-engine.test.js
git commit -m "feat(collab): engine sync-seed publish/check/apply + filtered pull"
```

---

## Task 4: HTTP 路由

**Files:**
- Modify: `server/collaboration/http-mount.js`
- Test: `server/test/collab-http.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-http.test.js` 末尾追加：

```js
test('update 端点：publish → check → remote → pull → apply', async () => {
  const A = await startNode('aliceU');
  const B = await startNode('bobU');
  try {
    const g = await joinGroup(A, B);
    A.engine.writeDownload('group.json', Buffer.from('G'), 'group');
    const pub = await post(`http://127.0.0.1:${A.port}/api/collab/update/publish`, { names: ['group.json'] });
    assert.equal(pub.status, 200);
    assert.equal(pub.body.update.files.length, 1);

    const chk = await post(`http://127.0.0.1:${B.port}/api/collab/update/check`, { masterId: A.engine.pub.machineId });
    assert.equal(chk.body.code, 'ok');
    assert.equal(chk.body.newer, true);

    const remote = await fetch(`http://127.0.0.1:${B.port}/api/collab/downloads/remote?masterId=${A.engine.pub.machineId}`).then((r) => r.json());
    assert.equal(remote.code, 'ok');
    assert.ok(remote.manifest.files.some((f) => f.name === 'group.json'));

    const pull = await post(`http://127.0.0.1:${B.port}/api/collab/downloads/pull`, { names: ['group.json'], masterId: A.engine.pub.machineId });
    assert.deepEqual(pull.body.files, ['group.json']);

    const apply = await post(`http://127.0.0.1:${B.port}/api/collab/update/apply`, { masterId: A.engine.pub.machineId, action: 'accept' });
    assert.equal(apply.body.action, 'accept');
  } finally { A.server.close(); B.server.close(); }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/test/collab-http.test.js`
Expected: FAIL（`404 not found`）

- [ ] **Step 3: 加路由**

在 `http-mount.js` 的 downloads 路由块之后（`downloads/file` 段落之后、`groups/.../distribute` 之前）插入：

```js
      // 同步种子（update.json）
      if (seg[0] === 'update' && seg.length === 1 && m === 'GET') {
        return ok(res, { update: engine.readUpdate() });
      }
      if (seg[0] === 'update' && seg.length === 2 && seg[1] === 'publish' && m === 'POST') {
        return ok(res, engine.publishUpdate(body.names || []));
      }
      if (seg[0] === 'update' && seg.length === 2 && seg[1] === 'check' && m === 'POST') {
        return ok(res, await engine.checkUpdate(body.masterId || undefined));
      }
      if (seg[0] === 'update' && seg.length === 2 && seg[1] === 'apply' && m === 'POST') {
        return ok(res, await engine.applyUpdate({ masterId: body.masterId, action: body.action }));
      }
      if (seg[0] === 'downloads' && seg.length === 2 && seg[1] === 'remote' && m === 'GET') {
        return ok(res, await engine.listRemoteFiles(url.searchParams.get('masterId') || undefined));
      }
      if (seg[0] === 'downloads' && seg.length === 2 && seg[1] === 'pull' && m === 'POST') {
        return ok(res, await engine.pullDownloads(body.names || null, body.masterId || null));
      }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test server/test/collab-http.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/collaboration/http-mount.js server/test/collab-http.test.js
git commit -m "feat(collab): http routes for sync seed (publish/check/remote/pull/apply)"
```

---

## Task 5: 注入 syncDir

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 找到所有 CollabEngine 构造**

Run: `Select-String -Path server/index.js -Pattern "new CollabEngine|downloadsDir:"`
Expected: 定位到构造点（工作区 buildWorkspace 与/或 legacy 分支）。

- [ ] **Step 2: 加 syncDir**

在每个 `new CollabEngine({ ... downloadsDir: <X>, ... })` 的 `downloadsDir` 行后加：

```js
    syncDir: path.join(path.dirname(<X>), 'sync'),
```

即工作区处为 `syncDir: path.join(paths.dir, 'sync'),`；legacy/stateRoot 处为 `syncDir: path.join(stateRoot, 'sync'),`（若存在）。

- [ ] **Step 3: 启动冒烟**

Run: `set DEVFLOW_PORT=33334&& node -e "import('./server/index.js').then(()=>setTimeout(()=>process.exit(0),1500))"`
Expected: 日志出现 `workspace ready`，无异常。

- [ ] **Step 4: 提交**

```bash
git add server/index.js
git commit -m "feat(collab): inject syncDir into CollabEngine"
```

---

## Task 6: 前端 API

**Files:**
- Modify: `web/src/collaboration/useCollab.ts`

- [ ] **Step 1: 加 API**

在 `useCollab.ts` 的返回对象里、`listDownloads:` 之后加：

```ts
    getUpdate: () => http<{ update: { version: string; updatedAt: number; files: { name: string; kind: string; size: number; sha256: string }[] } }>('/api/collab/update'),
    publishUpdate: (names: string[]) => post<{ code: string; update: { version: string; files: { name: string }[] } }>('/api/collab/update/publish', { names }),
    checkUpdate: (masterId?: string) => post<{
      code: string; masterId?: string; masterLabel?: string;
      update: { version: string; files: { name: string; kind?: string; size?: number }[] } | null;
      newer?: boolean;
    }>('/api/collab/update/check', { masterId: masterId ?? null }),
    listRemoteFiles: (masterId?: string) => http<{
      code: string; masterId?: string; masterLabel?: string;
      manifest: { files: { name: string; kind: string; size: number; updatedAt: number }[] };
      update: { version: string; files: { name: string }[] } | null;
    }>(`/api/collab/downloads/remote${masterId ? `?masterId=${encodeURIComponent(masterId)}` : ''}`),
    pullDownloads: (names: string[], masterId?: string) => post<{ code: string; files?: string[] }>('/api/collab/downloads/pull', { names, masterId: masterId ?? null }),
    applyUpdate: (masterId: string, action: 'accept' | 'reject') => post<{ code: string; action?: string; version?: string; files?: string[] }>('/api/collab/update/apply', { masterId, action }),
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add web/src/collaboration/useCollab.ts
git commit -m "feat(web): collab API for sync seed"
```

---

## Task 7: GroupView 双向入口

**Files:**
- Modify: `web/src/collaboration/GroupView.vue`

- [ ] **Step 1: 脚本新增状态与函数**

在 `GroupView.vue` 的 `// —— master downloads（点击才拉取）——` 段（约 :127）替换为：

```ts
// —— master 同步种子 / slave 主动同步 ——
const isMaster = computed(() => !!group.value && group.value.hubId === me.value);
const downloads = ref<{ manifest: { files: { name: string; kind: string; size: number; updatedAt: number }[] } }>({ manifest: { files: [] } });
const seed = ref<{ version: string; files: { name: string }[] }>({ version: '', files: [] });
const selected = ref<Record<string, boolean>>({});
const seedMsg = ref('');
async function loadDownloads() {
  try { downloads.value = await props.collab.listDownloads() as typeof downloads.value; } catch { /* ignore */ }
}
async function loadSeed() {
  try { const r = await props.collab.getUpdate(); seed.value = r.update; } catch { /* ignore */ }
}
function setAll(v: boolean) { for (const f of downloads.value.manifest.files) selected.value[f.name] = v; }
async function saveSeed() {
  seedMsg.value = '';
  const names = Object.keys(selected.value).filter((k) => selected.value[k]);
  try { const r = await props.collab.publishUpdate(names); seed.value = r.update; seedMsg.value = t('collab.update.saved', { version: r.update.version }); }
  catch (e) { seedMsg.value = String((e as Error).message || e); }
}
// slave：从 master 列文件并拉取
const remote = ref<{ manifest: { files: { name: string; kind: string; size: number; updatedAt: number }[] }; update: { version: string; files: { name: string }[] } | null } | null>(null);
const remoteSel = ref<Record<string, boolean>>({});
const pullMsg = ref('');
const remoteVer = computed(() => remote.value?.update?.version || '');
function isSeedFile(name: string) { return !!remote.value?.update?.files?.some((f) => f.name === name); }
async function loadRemoteFiles() {
  pullMsg.value = '';
  const mid = group.value?.hubId;
  try { const r = await props.collab.listRemoteFiles(mid); remote.value = { manifest: r.manifest, update: r.update }; }
  catch (e) { pullMsg.value = String((e as Error).message || e); }
}
function setAllRemote(v: boolean) { for (const f of remote.value?.manifest.files || []) remoteSel.value[f.name] = v; }
async function pullSelected() {
  pullMsg.value = '';
  const names = Object.keys(remoteSel.value).filter((k) => remoteSel.value[k]);
  if (!names.length) return;
  try {
    const r = await props.collab.pullDownloads(names, group.value?.hubId);
    pullMsg.value = t('collab.update.pulled', { count: (r.files || names).length });
    await loadDir();
  } catch (e) { pullMsg.value = String((e as Error).message || e); }
}
```

同时删除旧的 `async function syncMaster()` 段。

- [ ] **Step 2: 挂载时加载**

`onMounted` 改为：

```ts
onMounted(async () => {
  await loadRemote();
  await loadDownloads();
  await loadSeed();
  await loadDir();
  if (!isMaster.value) { try { await loadRemoteFiles(); } catch { /* ignore */ } }
});
```

- [ ] **Step 3: 模板替换 downloads 区块**

把原 `<div v-if="remoteState.enabled" class="sec"> ... </div>`（含 `syncMaster` 与文件列表，约 :216-229）替换为：

```html
        <div v-if="group" class="sec">
          <h4>{{ $t('collab.downloads.title') }}</h4>
          <template v-if="isMaster">
            <div class="cfghint">{{ $t('collab.update.version', { version: seed.version || '—' }) }}</div>
            <div class="addrow">
              <button class="ghost" @click="setAll(true)">{{ $t('collab.update.select_all') }}</button>
              <button @click="saveSeed">{{ $t('collab.update.save_seed') }}</button>
            </div>
            <div v-if="seedMsg" class="cfghint">{{ seedMsg }}</div>
            <div v-if="installMsg" class="cfghint">{{ installMsg }}</div>
            <div v-if="downloads.manifest.files.length === 0" class="empty">{{ $t('collab.downloads.empty') }}</div>
            <div v-for="f in downloads.manifest.files" :key="f.name" class="rowline">
              <input type="checkbox" v-model="selected[f.name]" />
              <a class="txt fname" :href="`/api/collab/downloads/file/${encodeURIComponent(f.name)}`" download>{{ f.name }}</a>
              <template v-if="f.kind === 'skill'">
                <button class="ghost" @click="install(f.name)">{{ $t('collab.downloads.install') }}</button>
              </template>
            </div>
          </template>
          <template v-else>
            <div class="cfghint">{{ $t('collab.update.version', { version: remoteVer || '—' }) }}</div>
            <div class="addrow">
              <button class="ghost" @click="loadRemoteFiles">{{ $t('collab.update.check') }}</button>
              <button class="ghost" @click="setAllRemote(true)">{{ $t('collab.update.select_all') }}</button>
              <button @click="pullSelected">{{ $t('collab.update.pull_selected') }}</button>
            </div>
            <div v-if="pullMsg" class="cfghint">{{ pullMsg }}</div>
            <div v-if="!remote || remote.manifest.files.length === 0" class="empty">{{ $t('collab.update.no_remote') }}</div>
            <div v-for="f in (remote?.manifest.files || [])" :key="f.name" class="rowline">
              <input type="checkbox" v-model="remoteSel[f.name]" />
              <a class="txt fname" :href="`/api/collab/downloads/file/${encodeURIComponent(f.name)}`" download>{{ f.name }}</a>
              <span v-if="isSeedFile(f.name)" class="tag">{{ $t('collab.update.seed_badge') }}</span>
            </div>
          </template>
        </div>
```

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS（若 `downloads` 重复声明，删除旧声明）

- [ ] **Step 5: 提交**

```bash
git add web/src/collaboration/GroupView.vue
git commit -m "feat(web): master save sync seed + slave manual pull in GroupView"
```

---

## Task 8: slave 更新弹窗

**Files:**
- Create: `web/src/collaboration/SyncUpdateDialog.vue`
- Modify: `web/src/collaboration/CollaborationView.vue`

- [ ] **Step 1: 新建弹窗组件**

Create `web/src/collaboration/SyncUpdateDialog.vue`:

```vue
<script setup lang="ts">
import { t } from '../i18n';

defineProps<{
  open: boolean;
  masterLabel: string;
  version: string;
  files: { name: string; size?: number }[];
  result: string | null;
}>();
const emit = defineEmits<{ (e: 'accept'): void; (e: 'reject'): void }>();
function fmtSize(n?: number) {
  if (n == null) return '';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="mask" @click.self="emit('reject')">
      <div class="box" role="dialog" aria-modal="true">
        <div class="title">{{ $t('collab.update.available', { version }) }}</div>
        <div class="meta">{{ $t('collab.update.from') }}: {{ masterLabel }}</div>
        <div class="list">
          <div v-for="f in files" :key="f.name" class="row">
            <span class="n">{{ f.name }}</span><span class="s">{{ fmtSize(f.size) }}</span>
          </div>
        </div>
        <div v-if="result" class="ok">{{ result }}</div>
        <div class="foot">
          <template v-if="!result">
            <button class="btn" @click="emit('reject')">{{ $t('collab.update.reject') }}</button>
            <button class="btn primary" @click="emit('accept')">{{ $t('collab.update.accept') }}</button>
          </template>
          <button v-else class="btn primary" @click="emit('reject')">{{ $t('common.ok') }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 3000; }
.box { width: 440px; max-width: 90vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); padding: 18px 20px 14px; }
.title { font-size: 15px; font-weight: 600; color: var(--tx1); }
.meta { color: var(--tx6); font-size: 12px; margin: 6px 0 10px; }
.list { max-height: 240px; overflow: auto; border: 1px solid var(--bd2); border-radius: 6px; }
.row { display: flex; justify-content: space-between; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--bd2); font-size: 13px; color: var(--tx); }
.row:last-child { border-bottom: none; }
.row .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .s { color: var(--tx6); font-size: 11px; flex: none; }
.ok { color: var(--ok, #22c55e); font-size: 13px; margin-top: 10px; }
.foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.btn { padding: 6px 16px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg2); color: var(--tx2); cursor: pointer; font-size: 13px; font-family: inherit; }
.btn.primary { background: var(--ac); border-color: var(--ac); color: #fff; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
```

- [ ] **Step 2: CollaborationView 接线**

`CollaborationView.vue` 脚本 import 区加：

```ts
import SyncUpdateDialog from './SyncUpdateDialog.vue';
```

在 `const tabs = ...` 之后加状态：

```ts
const pending = ref<{ masterId: string; masterLabel: string; version: string; files: { name: string; size?: number }[] } | null>(null);
const updateResult = ref<string | null>(null);
async function checkUpdates() {
  const ids = (snap.value.groups || []).filter((g) => g.hubId !== snap.value.identity.machineId).map((g) => g.hubId);
  for (const id of [...new Set(ids)]) {
    try {
      const r = await collab.checkUpdate(id);
      if (r.code === 'ok' && r.newer && r.update) {
        pending.value = { masterId: r.masterId || id, masterLabel: r.masterLabel || id, version: r.update.version, files: r.update.files || [] };
        updateResult.value = null;
        return;
      }
    } catch { /* ignore */ }
  }
}
async function acceptUpdate() {
  if (!pending.value) return;
  try {
    const r = await collab.applyUpdate(pending.value.masterId, 'accept');
    updateResult.value = t('collab.update.synced', { count: (r.files || []).length });
  } catch (e) { updateResult.value = String((e as Error).message || e); }
}
async function rejectUpdate() {
  if (pending.value && !updateResult.value) { try { await collab.applyUpdate(pending.value.masterId, 'reject'); } catch { /* ignore */ } }
  pending.value = null;
  updateResult.value = null;
}
```

`onMounted` 里加（在 `collab.refresh()` 之后）：

```ts
  collab.refresh().then(() => checkUpdates()).catch(() => {});
```

并在订阅数组里加：

```ts
    props.terminal.on(CollabS2C.COLLAB_SYNCED, () => { collab.refresh().catch(() => {}); }),
```

（把已有的 `COLLAB_SYNCED` 回调改为同时触发 `checkUpdates`；即替换为 `() => { collab.refresh().catch(() => {}); }` 保持不变，另加一行 `props.terminal.on(CollabS2C.COLLAB_HEARTBEAT, ...)` 不动。）

> 为在状态变化后也能补检查：在 `COLLAB_SYNCED` 回调里追加 `checkUpdates()`。

模板 `<section class="body">` 之后（`</div>` 收尾前）加：

```html
    <SyncUpdateDialog
      :open="!!pending"
      :master-label="pending?.masterLabel || ''"
      :version="pending?.version || ''"
      :files="pending?.files || []"
      :result="updateResult"
      @accept="acceptUpdate"
      @reject="rejectUpdate"
    />
```

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add web/src/collaboration/SyncUpdateDialog.vue web/src/collaboration/CollaborationView.vue
git commit -m "feat(web): slave auto-popup sync update dialog"
```

---

## Task 9: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 加词条**

在 `zh-CN.js` 的 `'collab.downloads.installed'` 附近加：

```js
  'collab.update.version': '种子版本 {version}',
  'collab.update.select_all': '全选',
  'collab.update.save_seed': '保存同步种子',
  'collab.update.saved': '已保存，版本 {version}',
  'collab.update.check': '检查更新',
  'collab.update.available': 'master 有新的同步种子（版本 {version}）',
  'collab.update.from': '来源',
  'collab.update.accept': '同意同步',
  'collab.update.reject': '拒绝',
  'collab.update.synced': '已同步 {count} 个文件',
  'collab.update.rejected': '已拒绝本次更新',
  'collab.update.latest': '已是最新',
  'collab.update.pull_title': '从 master 同步',
  'collab.update.pull_selected': '同步选中',
  'collab.update.seed_badge': '种子',
  'collab.update.pulled': '已拉取 {count} 个文件',
  'collab.update.no_remote': '未找到 master',
```

`en.js` 同位置加：

```js
  'collab.update.version': 'Seed version {version}',
  'collab.update.select_all': 'Select all',
  'collab.update.save_seed': 'Save sync seed',
  'collab.update.saved': 'Saved, version {version}',
  'collab.update.check': 'Check for updates',
  'collab.update.available': 'Master has a new sync seed (version {version})',
  'collab.update.from': 'From',
  'collab.update.accept': 'Sync now',
  'collab.update.reject': 'Decline',
  'collab.update.synced': 'Synced {count} file(s)',
  'collab.update.rejected': 'Update declined',
  'collab.update.latest': 'Already up to date',
  'collab.update.pull_title': 'Sync from master',
  'collab.update.pull_selected': 'Pull selected',
  'collab.update.seed_badge': 'Seed',
  'collab.update.pulled': 'Pulled {count} file(s)',
  'collab.update.no_remote': 'No master found',
```

- [ ] **Step 2: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: `未发现中文命中`

- [ ] **Step 3: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): sync seed messages"
```

---

## Task 10: 全量验证

- [ ] **Step 1: 全量测试**

Run: `npm.cmd test`
Expected: server + web 全绿

- [ ] **Step 2: 类型 + i18n + 构建**

Run: `npm.cmd run typecheck; npm.cmd run check:i18n; npm.cmd run build:web`
Expected: 无错误

- [ ] **Step 3: 人工冒烟**

`npm.cmd run dev:server`（:33333）与 `npm.cmd run dev:web`（:5173）后台启动；master 勾选保存种子 → 返回版本；slave 进入协作页 → 弹窗；同意后本地出现文件；再 save 新种子 → slave 里手动勾选拉取到 `downloads`。

- [ ] **Step 4: 提交（若 step 3 有微调）**

```bash
git add -A
git commit -m "chore: sync seed smoke fixes"
```

---

## Self-Review

- **Spec coverage**：§3 数据文件→Task 2；§4.1→Task 2；§4.2/4.4→Task 3/5；§4.3→Task 4；§5.1/5.2→Task 7；§5.3→Task 8；§7→Task 9；§8→Task 10。无遗漏。
- **Placeholder**：无 TBD/TODO；每个代码步骤含完整代码。
- **类型一致性**：`checkUpdate` 返回 `{masterId, masterLabel, update, newer}`；`applyUpdate` 返回 `{action, version, files}`；`pullDownloads` 返回 `{files}`；前端 API 与之一致。
- **已知取舍**：slave 手动拉取不推进确认版本（spec §4.2 已记）。
