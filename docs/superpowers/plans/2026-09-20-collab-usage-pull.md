# 群用量按需向群主拉取 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 成员机查看群用量时，通过签名 peer 通道向群主实时拉一次汇总；去掉用量触发的广播，本地不再保存别人机器的用量副本。

**Architecture:** 在既有协作签名通道（`/api/collab/peer` + `CollabPeer` 操作）上新增 `USAGE_PULL`：成员后端 `engine.pullUsageFrom()` 向 hub 拉 `peers.list()`，`GET /api/usage/peers?fresh=1` 暴露给前端并带进程内缓存/离线回退。采集与上报（每 60–90 分钟 `POST /api/usage/report`）完全不变。

**Tech Stack:** Node ESM（`node --test`）、Vue3 + Vite + TS（vitest / vue-tsc）、`@devflow/shared` 常量、SQLite usage 表（不变）。

参考 spec：`docs/superpowers/specs/2026-09-20-collab-usage-pull-design.md`

**执行方式：** 按 AGENTS.md，本计划用 **inline（本会话内）** 执行，不用 subagent。

---

## File Structure

- `shared/collab.js` — 新增 `CollabPeer.USAGE_PULL` 常量。
- `server/collaboration/engine.js` — 新增 `_inUsagePull` / `pullUsageFrom` 与 switch 分支；移除 `pullDownloads` / `_inPullDownloads` 的 usage 透传。
- `server/usage-mount.js` — `GET /api/usage/peers` 支持 `?fresh=1`，注入 `pullFromHub`，进程内缓存。
- `server/index.js` — 删除 `syncUsageSnapshot`，改装配（不再广播；注入 `pullFromHub`）。
- `server/collaboration/http-mount.js` — `downloads` GET 去掉 `usage`。
- `web/src/collaboration/GroupView.vue` — `loadPeers` 改 `fresh=1`，触发时机与 `stale` 提示。
- `shared/i18n/zh-CN.js` / `shared/i18n/en.js` — 新增 `usage.pull_failed` 词条。
- 测试：新增 `server/test/collab-usage-pull.test.js`；改 `server/test/usage-report-http.test.js`。

---

## Task 1: 协议常量 USAGE_PULL

**Files:**
- Modify: `shared/collab.js:25`

- [ ] **Step 1: 新增常量**

在 `CollabPeer` 对象里 `PKG_UPLOAD: 'pkg-upload',` 之后追加一行：

```js
  PKG_UPLOAD: 'pkg-upload',
  USAGE_PULL: 'usage-pull',
```

- [ ] **Step 2: 提交**

```bash
git add shared/collab.js
git commit -m "feat(collab): 新增 USAGE_PULL 协作协议常量"
```

---

## Task 2: engine 支持 USAGE_PULL 拉取/应答

**Files:**
- Modify: `server/collaboration/engine.js:450`（switch）与 `:743`（`pullDownloads` 之后）
- Test: `server/test/collab-usage-pull.test.js`（新建）

- [ ] **Step 1: 写失败测试**

新建 `server/test/collab-usage-pull.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPairHarness } from '../collaboration/engine.js';

test('USAGE_PULL：成员向群主拉取用量汇总', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    const jr = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    assert.equal(jr.code, 'joined');

    A.peers = { list: () => ({ m1: { machineId: 'm1', messages: 5 }, m2: { machineId: 'm2', messages: 8 } }) };
    const r = await B.pullUsageFrom();
    assert.equal(r.code, 'ok');
    assert.equal(r.members.m2.messages, 8);
  } finally { await h.stop(); }
});

test('USAGE_PULL：非成员被拒', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A] = h.nodes;
    A.ensureGroup();
    const r = A._inUsagePull({ from: { machineId: 'ghost' } });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'not-member');
  } finally { await h.stop(); }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/collab-usage-pull.test.js"`
Expected: FAIL —— `B.pullUsageFrom is not a function` / `A._inUsagePull is not a function`。

- [ ] **Step 3: 实现 `pullUsageFrom` 与 `_inUsagePull`**

在 `server/collaboration/engine.js` 的 `pullDownloads(...)` 方法（约 `:743` 结束的 `});` 之后）插入：

```js
  pullUsageFrom(masterId = null) {
    const hit = this._hubFor(masterId);
    if (!hit) return Promise.resolve({ code: 'no-master' });
    return this._post(hit.hub.host, hit.hub.port, this._sign(CollabPeer.USAGE_PULL, {})).then((res) => {
      if (!res.ok) return { code: 'unreachable', error: res.error };
      const data = res.data || {};
      return { code: 'ok', updatedAt: data.updatedAt || 0, members: data.members || {} };
    });
  }
  _inUsagePull(env) {
    const g = this.store.ownedGroup(this.pub.machineId) || this.store.getGroup();
    if (!g || !g.members.find((m) => m.machineId === env.from.machineId)) return { ok: false, error: 'not-member' };
    return { ok: true, data: { updatedAt: Date.now(), members: (this.peers && this.peers.list) ? this.peers.list() : {} } };
  }
```

在 `handleIncoming` 的 `switch` 里，`case CollabPeer.PKG_UPLOAD: ...` 之前或之后加一行：

```js
      case CollabPeer.USAGE_PULL: return this._inUsagePull(env);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/collab-usage-pull.test.js"`
Expected: PASS（2 项）。

- [ ] **Step 5: 提交**

```bash
git add shared/collab.js server/collaboration/engine.js server/test/collab-usage-pull.test.js
git commit -m "feat(collab): engine 支持 USAGE_PULL 按需拉取群主用量"
```

---

## Task 3: 移除 pullDownloads 的 usage 透传

**Files:**
- Modify: `server/collaboration/engine.js:736-738`（`pullDownloads` 内）与 `:757`（`_inPullDownloads` 返回体）
- Test: `server/test/collab-usage-pull.test.js`（追加）

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-usage-pull.test.js` 追加：

```js
test('pullDownloads / _inPullDownloads 不再透传 usage，也不改本地 peers', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    A.peers = { list: () => ({ m1: { machineId: 'm1', messages: 5 } }) };
    let upserted = 0;
    B.peers = { upsert: () => { upserted += 1; }, list: () => ({}) };

    const r = await B.pullDownloads();
    assert.equal(r.code, 'ok');
    assert.equal(upserted, 0, '不应把群主用量合并进本地 peers');

    const incoming = await A.handleIncoming(B._sign('pull-downloads', {}));
    assert.equal(incoming.ok, true);
    assert.equal(incoming.data.usage, undefined);
  } finally { await h.stop(); }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/collab-usage-pull.test.js"`
Expected: FAIL —— `upserted` 为 1；`incoming.data.usage` 非 undefined。

- [ ] **Step 3: 移除 usage 合并与返回**

在 `server/collaboration/engine.js` 的 `pullDownloads` 中删除这三行：

```js
      if (data.usage && data.usage.members) {
        for (const [mid, u] of Object.entries(data.usage.members)) this.peers?.upsert?.({ ...u, machineId: mid });
      }
```

并把 `_inPullDownloads` 的返回改成不含 usage：

```js
      return { ok: true, data: { manifest, files, group: g } };
```

（原为 `return { ok: true, data: { manifest, files, group: g, usage: { updatedAt: Date.now(), members: ... } } };`）

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/collab-usage-pull.test.js"`
Expected: PASS（3 项）。

- [ ] **Step 5: 回归协作测试**

Run: `node --test "server/test/collab-*.test.js"`
Expected: 全 PASS。

- [ ] **Step 6: 提交**

```bash
git add server/collaboration/engine.js server/test/collab-usage-pull.test.js
git commit -m "refactor(collab): pullDownloads 不再透传/合并群主用量"
```

---

## Task 4: usage-mount 支持 fresh 拉取与离线回退

**Files:**
- Modify: `server/usage-mount.js:25`（`createUsageMount` 签名）与 `:50`（`peers` GET）
- Test: `server/test/usage-report-http.test.js`

- [ ] **Step 1: 写失败测试**

改 `server/test/usage-report-http.test.js` 的 `start` helper，透传 `pullFromHub`：

```js
async function start({ token = 'good', peers, reporter, onReport, pullFromHub } = {}) {
  const p = peers || new UsagePeersStore({ file: tmp('usage-peers.json') });
  const r = reporter || createUsageReporter({
    file: tmp('usage-report.json'), identity: () => ({ machineId: 'm1' }),
    collect: async () => ({ sessions: 1 }), fetchFn: async () => ({ ok: true, json: async () => ({ ok: true }) }),
  });
  const mount = createUsageMount({ peers: p, reporter: r, checkToken: (tk) => tk === token, onReport, pullFromHub });
  const server = http.createServer((req, res) => mount(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  return { peers: p, reporter: r, port: server.address().port, server };
}
```

在文件末尾追加三个测试：

```js
test('GET /api/usage/peers?fresh=1：成功返回群主汇总', async (t) => {
  const A = await start({ pullFromHub: async () => ({ code: 'ok', updatedAt: 123, members: { m2: { machineId: 'm2', messages: 9 } } }) });
  t.after(() => A.server.close());
  const r = await call(A.port, 'GET', '/api/usage/peers?fresh=1');
  assert.equal(r.status, 200);
  assert.equal(r.body.peers.m2.messages, 9);
  assert.equal(r.body.stale, undefined);
});

test('GET /api/usage/peers?fresh=1：群主不可达回退本地并带 stale', async (t) => {
  const p = new UsagePeersStore({ file: tmp('usage-peers.json') });
  p.upsert({ machineId: 'm1', messages: 2 });
  const A = await start({ peers: p, pullFromHub: async () => ({ code: 'unreachable' }) });
  t.after(() => A.server.close());
  const r = await call(A.port, 'GET', '/api/usage/peers?fresh=1&masterId=M');
  assert.equal(r.body.peers.m1.messages, 2);
  assert.equal(r.body.stale, true);
});

test('GET /api/usage/peers?fresh=1：成功后缓存，失败回退缓存', async (t) => {
  let ok = true;
  const pull = async () => (ok ? { code: 'ok', updatedAt: 1, members: { m2: { machineId: 'm2', messages: 9 } } } : { code: 'unreachable' });
  const A = await start({ pullFromHub: pull });
  t.after(() => A.server.close());
  const a = await call(A.port, 'GET', '/api/usage/peers?fresh=1&masterId=M');
  assert.equal(a.body.peers.m2.messages, 9);
  ok = false;
  const b = await call(A.port, 'GET', '/api/usage/peers?fresh=1&masterId=M');
  assert.equal(b.body.peers.m2.messages, 9);
  assert.equal(b.body.stale, true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/usage-report-http.test.js"`
Expected: FAIL —— 前两个新测试的 `peers.m2` / `stale` 相关断言失败（`fresh` 未实现，返回本地快照）。

- [ ] **Step 3: 实现 fresh 分支**

在 `server/usage-mount.js` 的 `createUsageMount({ peers, reporter, checkToken, onReport, logger = console })` 签名加 `pullFromHub = null`：

```js
export function createUsageMount({ peers, reporter, checkToken, onReport, pullFromHub = null, logger = console }) {
  const freshCache = new Map();   // masterId -> 最近一次成功拉到的 members
```

把 `peers` GET 那一行：

```js
    if (seg[0] === 'peers' && seg.length === 1 && m === 'GET') return sendJson(res, 200, peers.snapshot());
```

替换为：

```js
    if (seg[0] === 'peers' && seg.length === 1 && m === 'GET') {
      const fresh = ['1', 'true', 'yes'].includes(String(url.searchParams.get('fresh') || '').toLowerCase());
      if (!fresh) return sendJson(res, 200, peers.snapshot());
      const masterId = url.searchParams.get('masterId') || undefined;
      const key = masterId || '*';
      if (typeof pullFromHub === 'function') {
        try {
          const r = await pullFromHub(masterId);
          if (r && r.code === 'ok') {
            freshCache.set(key, r.members || {});
            return sendJson(res, 200, { updatedAt: r.updatedAt || Date.now(), peers: r.members || {} });
          }
        } catch (e) { logger?.warn?.('usage fresh pull failed', (e && e.message) || e); }
      }
      const cached = freshCache.get(key);
      if (cached) return sendJson(res, 200, { updatedAt: Date.now(), peers: cached, stale: true });
      return sendJson(res, 200, { ...peers.snapshot(), stale: true });
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/usage-report-http.test.js"`
Expected: PASS（原有 + 新增全部）。

- [ ] **Step 5: 提交**

```bash
git add server/usage-mount.js server/test/usage-report-http.test.js
git commit -m "feat(usage): /api/usage/peers 支持 fresh 按需拉群主汇总与离线回退"
```

---

## Task 5: 装配改造——去掉用量广播并注入 pullFromHub

**Files:**
- Modify: `server/index.js:337-340`（删 `syncUsageSnapshot`）、`:347-363`（改装配）

- [ ] **Step 1: 删除 syncUsageSnapshot**

删除：

```js
  const syncUsageSnapshot = () => {
    broadcastCollab(CollabS2C.COLLAB_HEARTBEAT, {});
  };
```

（保留其上的 `const usagePeers = engine.peers;` 与注释。）

- [ ] **Step 2: reporter 不再传 onLocal**

`createUsageReporter({...})` 里删除 `onLocal: syncUsageSnapshot,` 一行。

- [ ] **Step 3: usageMount 不再传 onReport，改传 pullFromHub**

把 `createUsageMount({ peers: usagePeers, reporter: usageReporter, checkToken, onReport: syncUsageSnapshot, logger: log })` 改为：

```js
  const usageMount = createUsageMount({
    peers: usagePeers,
    reporter: usageReporter,
    checkToken: (tk) => { const inv = activeInvite(); return !!inv && safeEqual(tk, inv.token); },
    pullFromHub: async (masterId) => {
      const owned = engine.store.ownedGroup(engine.pub.machineId);
      if (owned && (!masterId || owned.hubId === masterId)) {
        return { code: 'ok', updatedAt: Date.now(), members: usagePeers.list() };
      }
      return engine.pullUsageFrom(masterId);
    },
    logger: log,
  });
```

- [ ] **Step 4: 确认心跳事件仍保留**

确认文件中仍有 `eventBus.on('heartbeat', () => broadcastCollab(CollabS2C.COLLAB_HEARTBEAT, {}));`（供群聊刷新用，勿删）。

- [ ] **Step 5: 语法自检**

Run: `node --check server/index.js`
Expected: 无输出（成功）。

- [ ] **Step 6: 提交**

```bash
git add server/index.js
git commit -m "refactor(usage): 去掉用量广播，装配改为按需向群主拉取"
```

---

## Task 6: http-mount downloads 去掉 usage

**Files:**
- Modify: `server/collaboration/http-mount.js:189`

- [ ] **Step 1: 修改返回体**

把：

```js
        return ok(res, { manifest: engine.readManifest(), usage: { members: (engine.peers && engine.peers.list) ? engine.peers.list() : {} }, group: engine.store.getGroup(), groups: engine.store.listGroups() });
```

改为：

```js
        return ok(res, { manifest: engine.readManifest(), group: engine.store.getGroup(), groups: engine.store.listGroups() });
```

- [ ] **Step 2: 回归该文件相关测试**

Run: `node --test "server/test/collab-http.test.js"`
Expected: 全 PASS。

- [ ] **Step 3: 提交**

```bash
git add server/collaboration/http-mount.js
git commit -m "refactor(collab): downloads 接口不再携带 usage"
```

---

## Task 7: 前端按需拉取 + 离线提示词条

**Files:**
- Modify: `web/src/collaboration/GroupView.vue:120-126`、`:319-322`
- Modify: `shared/i18n/zh-CN.js`（usage.* 区块）、`shared/i18n/en.js`

- [ ] **Step 1: 新增 i18n 词条（中英同步）**

`shared/i18n/zh-CN.js` 在 `'usage.not_configured'` 附近加：

```js
  'usage.pull_failed': '未能从群主获取最新用量，当前显示的是缓存数据',
```

`shared/i18n/en.js` 对应位置加：

```js
  'usage.pull_failed': 'Could not fetch the latest usage from the group owner; showing cached data',
```

- [ ] **Step 2: 改 loadPeers 与触发时机**

`web/src/collaboration/GroupView.vue` 把：

```js
const peers = ref<Record<string, import('./types').CollabUsage>>({});
async function loadPeers() {
  try { const r = await fetch('/api/usage/peers').then((x) => x.json()); peers.value = r.peers || {}; } catch { /* ignore */ }
}
onMounted(loadPeers);
watch(() => snap.value, loadPeers);
```

改为：

```js
const peers = ref<Record<string, import('./types').CollabUsage>>({});
const peersStale = ref(false);
async function loadPeers() {
  const mid = group.value?.hubId || '';
  const q = mid ? `?fresh=1&masterId=${encodeURIComponent(mid)}` : '?fresh=1';
  try {
    const r = await fetch(`/api/usage/peers${q}`).then((x) => x.json());
    peers.value = r.peers || {};
    peersStale.value = !!r.stale;
  } catch { /* ignore */ }
}
onMounted(loadPeers);
watch(() => group.value?.id, loadPeers);
watch(mtab, loadPeers);
```

（注意：`mtab` 定义在 `loadPeers` 之前，见 `GroupView.vue:119`，保持不变。）

- [ ] **Step 3: 加 stale 提示**

把模板里：

```html
        <div class="mbody">
          <MemberUsageTable v-if="mtab === 'members'" class="mtable" :collab="collab" :peers="peers" :group="group" />
          <UsageTrendChart v-else :collab="collab" :peers="peers" />
        </div>
```

改为：

```html
        <div class="mbody">
          <div v-if="peersStale" class="cfghint">{{ $t('usage.pull_failed') }}</div>
          <MemberUsageTable v-if="mtab === 'members'" class="mtable" :collab="collab" :peers="peers" :group="group" />
          <UsageTrendChart v-else :collab="collab" :peers="peers" />
        </div>
```

- [ ] **Step 4: i18n 与类型检查**

Run: `npm.cmd run check:i18n`
Expected: PASS（键集合对称、无硬编码中文）。

Run: `npm.cmd run typecheck`
Expected: PASS（vue-tsc 无错误）。

- [ ] **Step 5: 提交**

```bash
git add web/src/collaboration/GroupView.vue shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(web): 群用量改为打开/切换时按需向群主拉取，离线显示缓存提示"
```

---

## Task 8: 全量验证

**Files:** 无（仅验证）

- [ ] **Step 1: 服务端 + 前端测试**

Run: `npm.cmd test`
Expected: server 与 web 全部 PASS。

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 3: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: PASS。

- [ ] **Step 4: 敏感信息自查（提交规范）**

Run:
```powershell
git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat-|-----BEGIN [A-Z ]*PRIVATE KEY-----"
git ls-files env
```
Expected: 仅命中检查清单自身的正则示例；`git ls-files env` 为空。

- [ ] **Step 5: 若前面各任务已分别提交，此步无新提交；否则补一次提交**

---

## Task 9: 重新编译并打包 release

**Files:** 产出到 `dist-portable/`（不入库）

- [ ] **Step 1: 确认依赖产物就绪（仅新克隆需要）**

若 `node_modules` 里 node-pty / esbuild 无原生产物（首次克隆会缺），先跑：

```powershell
npm.cmd approve-scripts node-pty esbuild
```

本机已有 `node_modules` 时可跳过。

- [ ] **Step 2: 一键打包（Windows：先 web，再 opencode 变体 + 标准包）**

Run: `node scripts/build-all.js`
Expected:
- 先输出 `[build-all] === web (web/dist) ===` 并成功；
- 若 `soft/opencode-windows-x64.zip` 存在 → 出 `dist-portable/vscode-ai-windows-x64-<version>-opencode/` + 同名 zip；否则告警跳过；
- 出 `dist-portable/vscode-ai-windows-x64-<version>/` + `vscode-ai-windows-x64-<version>.zip`；
- 末尾 `[build-all] all done -> ...\dist-portable`。

- [ ] **Step 3: 核对产物**

Run:
```powershell
Get-ChildItem dist-portable | Select-Object Name, Length, LastWriteTime
```
Expected: 至少包含标准包目录与 `.zip`；若有 opencode zip 则含 `-opencode` 目录与 `.zip`。

- [ ] **Step 4: 说明（不自动发布）**

打包完成即结束。**不上传 Release**，除非用户明确要求；发布需另行按 `docs/learn/git仓库提交检查和提交事项.md` 走。

---

## Self-Review 结论

- **Spec 覆盖**：协议常量（T1）、engine 拉取/应答（T2）、移除透传（T3）、本机 HTTP fresh/缓存（T4）、去广播+装配（T5）、http-mount 清理（T6）、前端触发+提示+词条（T7）、验证（T8）、打包（T9）——覆盖 spec 全部条目；趋势图 `/api/usage/daily` 按 spec「非目标」保持不动。
- **占位符**：无 TODO/TBD，所有代码步骤含完整代码。
- **命名一致性**：`USAGE_PULL`、`pullUsageFrom`、`_inUsagePull`、`pullFromHub`、`peersStale`、`usage.pull_failed` 在各任务中一致。
