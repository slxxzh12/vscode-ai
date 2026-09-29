# 群主批量清理群成员与用量统计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让群主在统计成员表里批量清理机器行——移除其群成员身份并删除其用量历史（快照 + SQLite）。

**Architecture:** 删除能力分散到各数据层（usage-store / usage-peers / collab-store / collab-db）各自新增 `remove*` 方法；服务端两个端点各管一块——`/api/collab/groups/:id/members/remove`（成员身份，engine 校验 hub）与 `/api/usage/peers/remove`（用量快照+历史，usage mount 注入 `isHub`/`selfId` 校验）；前端 `MemberUsageTable` 提供仅群主可见的多选「清理」。

**Tech Stack:** Node ESM（`node:test`、`node:sqlite`）、Vue 3 + Element Plus + Vitest。

**Spec:** `docs/superpowers/specs/2026-09-29-collab-member-usage-cleanup-design.md`

---

### Task 1: usage-store 按机器删除

**Files:**
- Modify: `server/usage-store.js`（在返回对象的 `close()` 之前新增方法）
- Test: `server/test/usage-store.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/usage-store.test.js` 末尾（`store.close()` 之前的测试之间）追加：

```js
test('deleteByMember 只删指定机器，其它机器与合计行按机器区分', () => {
  const store = createUsageStore({ file: tmpDb() });
  store.upsert({ date: '2026-09-12', memberId: 'E1', agent: 'opencode', messages: 1 });
  store.upsert({ date: '2026-09-12', memberId: 'E1', agent: '*', messages: 2 });
  store.upsert({ date: '2026-09-12', memberId: 'E2', agent: 'opencode', messages: 3 });
  const removed = store.deleteByMember('E1');
  assert.equal(removed, 2);
  assert.deepEqual(store.query({}).map((r) => r.memberId), ['E2']);
  assert.equal(store.query({ agent: '*' }).length, 0);
  store.close();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/usage-store.test.js"`
Expected: FAIL（`store.deleteByMember is not a function`）

- [ ] **Step 3: 实现**

在 `server/usage-store.js` 返回对象里、`close()` 方法之前插入：

```js
    deleteByMember(machineId) {
      const r = db.prepare('DELETE FROM usage WHERE member_id = ?').run(String(machineId));
      return Number(r.changes) || 0;
    },
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/usage-store.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add server/usage-store.js server/test/usage-store.test.js
git commit -m "feat(usage): usage 表支持按 member_id 删除"
```

---

### Task 2: usage-peers 删除快照并联动删历史

**Files:**
- Modify: `server/usage-peers.js`（`snapshot()` 之前新增方法）
- Test: `server/test/usage-peers.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/usage-peers.test.js` 末尾追加：

```js
test('remove 删快照键并联动删当日合计行；不存在返回 0', () => {
  const s = new UsagePeersStore({ file: tmpFile() });
  const day = Date.UTC(2026, 8, 17, 3, 0, 0);
  s.upsert({ machineId: 'm1', sessions: 1, messages: 2 }, day);
  s.upsert({ machineId: 'm2', sessions: 3, messages: 4 }, day);
  assert.equal(s.remove(['nope']), 0);
  const n = s.remove(['m1']);
  assert.equal(n, 1);
  assert.deepEqual(Object.keys(s.snapshot().peers), ['m2']);
  assert.deepEqual(Object.keys(s.listDaily('m1')), []);
  assert.equal(Object.keys(s.listDaily('m2')).length, 1);
  s.close();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/usage-peers.test.js"`
Expected: FAIL（`s.remove is not a function`）

- [ ] **Step 3: 实现**

在 `server/usage-peers.js` 的 `snapshot()` 方法之前插入：

```js
  // 群主清理：删除指定机器的快照与历史上报行（usage 表按 member_id）
  remove(machineIds) {
    const ids = (Array.isArray(machineIds) ? machineIds : [machineIds])
      .map((x) => String(x || '')).filter(Boolean);
    let n = 0;
    for (const id of ids) {
      if (this.data.peers[id]) { delete this.data.peers[id]; n += 1; }
      try { this.store?.deleteByMember?.(id); } catch (e) { this.log?.warn?.('peer usage delete failed', (e && e.message) || e); }
    }
    if (n) { this.data.updatedAt = Date.now(); this.save(); }
    return n;
  }

```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/usage-peers.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add server/usage-peers.js server/test/usage-peers.test.js
git commit -m "feat(usage): 群主可删除指定机器的用量快照与历史"
```

---

### Task 3: collab-db 删成员行

**Files:**
- Modify: `server/collab-db.js`（`delCmd` 之后加 prepared statement；返回对象加方法）
- Test: `server/test/collab-db.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-db.test.js` 末尾追加：

```js
test('removeMembers：删 member 与 member_command 行，其它成员保留', () => {
  const db = createCollabDb({ file: tmpDb(), logger: { warn() {} } });
  db.registerMember({ groupId: 'g1', machineId: 'm1', username: 'u1' }, 1);
  db.registerMember({ groupId: 'g1', machineId: 'm2', username: 'u2' }, 1);
  db.setCommands({ groupId: 'g1', machineId: 'm1', commands: ['dev'] }, 1);
  db.setCommands({ groupId: 'g1', machineId: 'm2', commands: ['doc'] }, 1);
  const n = db.removeMembers({ groupId: 'g1', machineIds: ['m1'] });
  assert.equal(n, 1);
  assert.deepEqual(db.listMembers('g1').map((m) => m.machineId), ['m2']);
  assert.deepEqual(db.listCommands({ groupId: 'g1' }).map((c) => `${c.machineId}:${c.name}`), ['m2:doc']);
  db.close();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/collab-db.test.js"`
Expected: FAIL（`db.removeMembers is not a function`）

- [ ] **Step 3: 实现**

在 `server/collab-db.js` 里 `const delCmd = ...` 之后加：

```js
  const delMember = db.prepare('DELETE FROM member WHERE group_id = ? AND machine_id = ?');
```

在返回对象里、`listMembers(...)` 之前插入：

```js
    // 群主清理：删掉成员表与命令缓存里的这些机器
    removeMembers({ groupId, machineIds = [] } = {}) {
      if (!groupId) return 0;
      let n = 0;
      for (const id of machineIds) {
        if (!id) continue;
        try {
          delCmd.run(String(groupId), String(id));
          n += Number(delMember.run(String(groupId), String(id)).changes) || 0;
        } catch (e) { logger?.warn?.('member delete failed', (e && e.message) || e); }
      }
      return n;
    },
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/collab-db.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add server/collab-db.js server/test/collab-db.test.js
git commit -m "feat(collab): member/member_command 表支持删除指定机器"
```

---

### Task 4: collab store 移除群成员

**Files:**
- Modify: `server/collaboration/store.js`（`addGroupMember` 之后新增方法）
- Test: `server/test/collab-store.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-store.test.js` 末尾追加：

```js
test('removeGroupMembers 移除指定成员并落盘；未知群返回 null', () => {
  const f = tmpFile();
  const s = new CollabStore({ file: f });
  const self = { machineId: 'me', username: 'u', host: 'h', port: 1, publicKey: 'k' };
  s.ensureGroup({ name: 'g', hubId: 'me', self });
  s.addGroupMember('me', { machineId: 'p1' });
  s.addGroupMember('me', { machineId: 'p2' });
  const g = s.removeGroupMembers('me', ['p1']);
  assert.deepEqual(g.members.map((m) => m.machineId), ['me', 'p2']);
  const again = new CollabStore({ file: f });
  assert.deepEqual(again.getGroup('me').members.map((m) => m.machineId), ['me', 'p2']);
  assert.equal(s.removeGroupMembers('nope', ['x']), null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/collab-store.test.js"`
Expected: FAIL（`s.removeGroupMembers is not a function`）

- [ ] **Step 3: 实现**

在 `server/collaboration/store.js` 的 `addGroupMember` 方法之后插入：

```js
  removeGroupMembers(groupId, machineIds) {
    const g = this.findGroup(groupId);
    if (!g) return null;
    const drop = new Set((Array.isArray(machineIds) ? machineIds : [machineIds])
      .map((x) => String(x || '')).filter(Boolean));
    g.members = (g.members || []).filter((m) => !drop.has(String(m && m.machineId)));
    this.save();
    return g;
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/collab-store.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add server/collaboration/store.js server/test/collab-store.test.js
git commit -m "feat(collab): 群 store 支持移除成员"
```

---

### Task 5: engine.removeMembers + collab 端点

**Files:**
- Modify: `server/collaboration/engine.js`（在 `setAdvertised` 方法之后、类的 `}` 之前插入）
- Modify: `server/collaboration/http-mount.js`（`rename` 路由之后插入）
- Test: `server/test/collab-http.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-http.test.js` 末尾追加：

```js
test('群主移除成员：hub 成功并同步移除，非 hub 返回 403', async () => {
  const A = await startNode('hub');
  const B = await startNode('mem');
  try {
    const g = await joinGroup(A, B);
    const okRes = await post(`http://127.0.0.1:${A.port}/api/collab/groups/${g.id}/members/remove`, { machineIds: [B.engine.pub.machineId] });
    assert.equal(okRes.status, 200, JSON.stringify(okRes.body));
    assert.deepEqual(okRes.body.removed, [B.engine.pub.machineId]);
    assert.equal(A.engine.store.findGroup(g.id).members.some((m) => m.machineId === B.engine.pub.machineId), false);

    const bad = await post(`http://127.0.0.1:${B.port}/api/collab/groups/${g.id}/members/remove`, { machineIds: [A.engine.pub.machineId] });
    assert.equal(bad.status, 403);
    assert.equal(bad.body.error, 'not-master');
  } finally { A.server.close(); B.server.close(); }
});

test('群主移除成员：空目标 400，且不会删除自己', async () => {
  const A = await startNode('hub2');
  try {
    const g = A.engine.ensureGroup();
    const selfOnly = await post(`http://127.0.0.1:${A.port}/api/collab/groups/${g.id}/members/remove`, { machineIds: [A.engine.pub.machineId] });
    assert.equal(selfOnly.status, 400);
    assert.equal(selfOnly.body.error, 'no-target');
    assert.ok(A.engine.store.findGroup(g.id).members.some((m) => m.machineId === A.engine.pub.machineId));
  } finally { A.server.close(); }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/collab-http.test.js"`
Expected: FAIL（404 / `no-target` 不出现）

- [ ] **Step 3: 实现 engine 方法**

在 `server/collaboration/engine.js` 的 `setAdvertised({ host, port, employeeId } = {}) { ... }` 方法结束、`}` 类结束之前插入：

```js
  // 群主清退成员：仅 hub 可调用；移除群成员身份并删成员表/命令缓存（用量数据由 usage 面另删）
  removeMembers({ groupId, machineIds } = {}) {
    const g = this.store.findGroup(groupId);
    if (!g || g.hubId !== this.pub.machineId) return { code: 'not-master' };
    const ids = (Array.isArray(machineIds) ? machineIds : [machineIds])
      .map((x) => String(x || '')).filter((id) => id && id !== this.pub.machineId);
    if (!ids.length) return { code: 'no-target' };
    this.store.removeGroupMembers(groupId, ids);
    try { this.collabDb?.removeMembers?.({ groupId, machineIds: ids }); } catch (e) { this.log?.warn?.('collab member delete failed', (e && e.message) || e); }
    return { code: 'ok', removed: ids };
  }
```

- [ ] **Step 4: 实现 HTTP 路由**

在 `server/collaboration/http-mount.js` 的 `rename` 路由（`seg[2] === 'rename'`）那行之后插入：

```js
      if (seg[0] === 'groups' && seg.length === 4 && seg[2] === 'members' && seg[3] === 'remove' && m === 'POST') {
        const r = engine.removeMembers({ groupId: seg[1], machineIds: body.machineIds || [] });
        if (r.code === 'not-master') return sendJson(res, 403, { error: r.code });
        if (r.code !== 'ok') return sendJson(res, 400, { error: r.code });
        return ok(res, r);
      }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test "server/test/collab-http.test.js"`
Expected: PASS

- [ ] **Step 6: 提交**

```powershell
git add server/collaboration/engine.js server/collaboration/http-mount.js server/test/collab-http.test.js
git commit -m "feat(collab): 群主移除成员端点（仅 hub，排除自身）"
```

---

### Task 6: usage 端点 `/api/usage/peers/remove` + 装配注入

**Files:**
- Modify: `server/usage-mount.js`（签名加 `isHub`/`selfId`；404 之前加路由）
- Modify: `server/index.js`（`createUsageMount({...})` 配置对象里注入两个回调）
- Test: `server/test/usage-report-http.test.js`

- [ ] **Step 1: 写失败测试**

先改测试文件顶部的 `start` 辅助（把 `isHub`/`selfId` 透传）：

```js
async function start({ token = 'good', peers, reporter, onReport, pullFromHub, probe, loadProbe, saveProbe, setCwd, isHub, selfId } = {}) {
  const p = peers || new UsagePeersStore({ file: tmp('usage-peers.json') });
  const r = reporter || createUsageReporter({
    file: tmp('usage-report.json'), identity: () => ({ machineId: 'm1' }),
    collect: async () => ({ sessions: 1 }), fetchFn: async () => ({ ok: true, json: async () => ({ ok: true }) }),
  });
  const mount = createUsageMount({ peers: p, reporter: r, checkToken: (tk) => tk === token, onReport, pullFromHub, probe, loadProbe, saveProbe, setCwd, isHub, selfId });
  const server = http.createServer((req, res) => mount(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  return { peers: p, reporter: r, port: server.address().port, server };
}
```

在文件末尾追加：

```js
test('POST /api/usage/peers/remove：仅 hub 可删，过滤自身，空目标 400', async (t) => {
  const A = await start({ isHub: (g) => g === 'g1', selfId: () => 'me' });
  t.after(() => A.server.close());
  A.peers.upsert({ machineId: 'm1', sessions: 1 }, 1000);
  A.peers.upsert({ machineId: 'me', sessions: 9 }, 1000);

  const bad = await call(A.port, 'POST', '/api/usage/peers/remove', { body: { groupId: 'nope', machineIds: ['m1'] } });
  assert.equal(bad.status, 403);
  assert.equal(bad.body.error, 'not-master');

  const none = await call(A.port, 'POST', '/api/usage/peers/remove', { body: { groupId: 'g1', machineIds: ['me'] } });
  assert.equal(none.status, 400);
  assert.equal(none.body.error, 'no-target');

  const r = await call(A.port, 'POST', '/api/usage/peers/remove', { body: { groupId: 'g1', machineIds: ['m1', 'me'] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.removed, ['m1']);
  assert.equal(A.peers.get('m1'), null);
  assert.ok(A.peers.get('me'));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/usage-report-http.test.js"`
Expected: FAIL（新用例 403/404 不符）

- [ ] **Step 3: 实现 usage mount**

把 `server/usage-mount.js` 的导出签名改为（新增两个可选回调）：

```js
export function createUsageMount({ peers, reporter, checkToken, onReport, pullFromHub = null, probe = null, loadProbe = null, saveProbe = null, onImage = null, setCwd = null, isHub = null, selfId = null, logger = console }) {
```

在 `route()` 里 `return sendJson(res, 404, { error: 'not found' });` 之前插入：

```js
    // 群主清理：删除指定机器的用量快照与历史（仅当前群 hub 可调用，且不能删自己）
    if (seg[0] === 'peers' && seg[1] === 'remove' && seg.length === 2 && m === 'POST') {
      let body = {};
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
      const groupId = String(body.groupId || '');
      if (typeof isHub !== 'function' || !isHub(groupId)) return sendJson(res, 403, { error: 'not-master' });
      const me = typeof selfId === 'function' ? String(selfId() || '') : '';
      const ids = (Array.isArray(body.machineIds) ? body.machineIds : [])
        .map((x) => String(x || '')).filter((id) => id && id !== me);
      if (!ids.length) return sendJson(res, 400, { error: 'no-target' });
      peers.remove(ids);
      return sendJson(res, 200, { removed: ids });
    }
```

- [ ] **Step 4: 装配注入**

在 `server/index.js` 的 `createUsageMount({ ... })` 配置对象里（`probe: ...` 附近）加入：

```js
    isHub: (groupId) => { try { const g = engine.store.findGroup(groupId); return !!g && g.hubId === engine.pub.machineId; } catch { return false; } },
    selfId: () => engine.pub.machineId,
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test "server/test/usage-report-http.test.js"`
Expected: PASS

- [ ] **Step 6: 提交**

```powershell
git add server/usage-mount.js server/index.js server/test/usage-report-http.test.js
git commit -m "feat(usage): 群主删除指定机器用量端点 /api/usage/peers/remove"
```

---

### Task 7: 前端 API 两个方法

**Files:**
- Modify: `web/src/collaboration/useCollab.ts`（放在 `distributeToGroup` 附近）
- Test: `web/src/collaboration/useCollab.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/collaboration/useCollab.test.ts` 末尾（最后一个 `});` 之后）追加：

```js
describe('useCollab 清理成员', () => {
  it('removeMembers / removeUsagePeers 命中正确路由', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonRes({});
    }) as typeof fetch);
    const c = useCollab();
    await c.removeMembers('g1', ['m1']);
    await c.removeUsagePeers('g1', ['m1']);
    expect(calls[0].url).toContain('/api/collab/groups/g1/members/remove');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ machineIds: ['m1'] });
    expect(calls[1].url).toContain('/api/usage/peers/remove');
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ groupId: 'g1', machineIds: ['m1'] });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- src/collaboration/useCollab.test.ts`
Expected: FAIL（`c.removeMembers is not a function`）

- [ ] **Step 3: 实现**

在 `web/src/collaboration/useCollab.ts` 的 `distributeToGroup` 那行之后插入：

```ts
    removeMembers: (groupId: string, machineIds: string[]) =>
      post<{ code: string; removed?: string[] }>(`/api/collab/groups/${groupId}/members/remove`, { machineIds }),
    removeUsagePeers: (groupId: string, machineIds: string[]) =>
      post<{ removed: number }>('/api/usage/peers/remove', { groupId, machineIds }),
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- src/collaboration/useCollab.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add web/src/collaboration/useCollab.ts web/src/collaboration/useCollab.test.ts
git commit -m "feat(web): useCollab 增加移除成员/清理用量方法"
```

---

### Task 8: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`（`collab.member.export_failed` 之后）
- Modify: `shared/i18n/en.js`（同位置）
- Test: `npm.cmd run check:i18n`

- [ ] **Step 1: 加中文词条**

在 `shared/i18n/zh-CN.js` 的 `'collab.member.export_failed': '导出失败：{msg}',` 之后插入：

```js
  'collab.member.clean': '清理',
  'collab.member.clean_select': '请选择要清理的机器',
  'collab.member.clean_delete': '删除选中',
  'collab.member.clean_confirm': '确认删除选中的 {count} 台机器？其用量历史将一并删除。',
  'collab.member.clean_done': '已清理 {count} 台',
  'collab.member.clean_failed': '清理失败：{msg}',
```

- [ ] **Step 2: 加英文词条**

在 `shared/i18n/en.js` 的 `'collab.member.export_failed': 'Export failed: {msg}',` 之后插入：

```js
  'collab.member.clean': 'Clean up',
  'collab.member.clean_select': 'Select machines to clean up',
  'collab.member.clean_delete': 'Delete selected',
  'collab.member.clean_confirm': 'Delete the selected {count} machine(s)? Their usage history will be removed too.',
  'collab.member.clean_done': 'Cleaned {count} machine(s)',
  'collab.member.clean_failed': 'Cleanup failed: {msg}',
```

- [ ] **Step 3: 校验中英对称**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`（无缺键/中文泄漏）

- [ ] **Step 4: 提交**

```powershell
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 成员清理相关中英词条"
```

---

### Task 9: MemberUsageTable 清理多选 UI

**Files:**
- Modify: `web/src/collaboration/MemberUsageTable.vue`
- Test: `web/src/collaboration/MemberUsageTable.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/collaboration/MemberUsageTable.test.ts` 的 `describe('MemberUsageTable', ...)` 内追加：

```ts
  it('「清理」仅群主可见，进入后出现多选与删除按钮', async () => {
    const group = { id: 'g', name: 'G', hubId: 'h', createdAt: 1, members: [{ machineId: 'h' }, { machineId: 'p1' }] };
    const peers = { p1: { agent: '*', days: 1, machineId: 'p1', username: 'bob', host: 'h', port: 1, messages: 1, receivedAt: Date.now() } };
    const hub = mountWithIdentity(peers, group, 'h');
    await flushPromises();
    const clean = hub.findAll('button').find((b) => b.text() === t('collab.member.clean'));
    expect(clean).toBeTruthy();
    await clean!.trigger('click');
    await flushPromises();
    expect(hub.text()).toContain(t('collab.member.clean_select'));
    expect(hub.findAll('button').some((b) => b.text().includes(t('collab.member.clean_delete')))).toBe(true);

    const member = mountWithIdentity(peers, group, 'p1');
    await flushPromises();
    expect(member.findAll('button').some((b) => b.text() === t('collab.member.clean'))).toBe(false);
  });

  it('选中成员后确认：调用 removeMembers + removeUsagePeers 并刷新', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/api/collab/snapshot')) return { ok: true, json: async () => ({ ...EMPTY_SNAPSHOT }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', () => true);
    const group = { id: 'g', name: 'G', hubId: 'h', createdAt: 1, members: [{ machineId: 'h' }, { machineId: 'p1' }] };
    const peers = { p1: { agent: '*', days: 1, machineId: 'p1', username: 'bob', host: 'h', port: 1, messages: 1, receivedAt: Date.now() } };
    const w = mountWithIdentity(peers, group, 'h');
    await flushPromises();
    await w.findAll('button').find((b) => b.text() === t('collab.member.clean'))!.trigger('click');
    await flushPromises();
    const cb = w.find('.el-table__body .el-checkbox__original');
    await cb.setValue(true);
    await flushPromises();
    await w.findAll('button').find((b) => b.text().includes(t('collab.member.clean_delete')))!.trigger('click');
    await flushPromises();
    expect(calls.some((c) => c.includes('/api/collab/groups/g/members/remove'))).toBe(true);
    expect(calls.some((c) => c.includes('/api/usage/peers/remove'))).toBe(true);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- src/collaboration/MemberUsageTable.test.ts`
Expected: FAIL（找不到「清理」按钮）

- [ ] **Step 3: 实现 script**

在 `web/src/collaboration/MemberUsageTable.vue` 的 `<script setup>` 里、`const me = computed(...)` 之后插入：

```ts
const emit = defineEmits<{ (e: 'removed'): void }>();
const isHub = computed(() => !!hubId.value && hubId.value === me.value);
const cleanMode = ref(false);
const selected = ref<string[]>([]);
const cleaning = ref(false);
function toggleClean() { cleanMode.value = !cleanMode.value; selected.value = []; }
function onSelectionChange(sel: MachineRow[]) { selected.value = sel.map((r) => r.machineId); }
function selectable(row: MachineRow) { return row.machineId !== me.value; }
async function confirmClean() {
  const g = activeGroup.value;
  const ids = selected.value.slice();
  if (!g || !ids.length) return;
  if (!confirm(t('collab.member.clean_confirm', { count: String(ids.length) }))) return;
  const memberIds = ids.filter((id) => (g.members || []).some((m) => m.machineId === id));
  cleaning.value = true;
  try {
    if (memberIds.length) await props.collab.removeMembers(g.id, memberIds);
    await props.collab.removeUsagePeers(g.id, ids);
    await props.collab.refresh();
    emit('removed');
    cleanMode.value = false;
    selected.value = [];
  } catch (e) {
    alert(t('collab.member.clean_failed', { msg: (e as Error)?.message || String(e) }));
  } finally {
    cleaning.value = false;
  }
}
```

- [ ] **Step 4: 实现模板**

把 `web/src/collaboration/MemberUsageTable.vue` 里 `<div class="mtool">` 整块替换为：

```html
    <div class="mtool">
      <span v-if="cleanMode" class="selhint">{{ $t('collab.member.clean_select') }}</span>
      <template v-if="cleanMode">
        <button class="mini" :disabled="cleaning || !selected.length" @click="confirmClean">
          {{ $t('collab.member.clean_delete') }} ({{ selected.length }})
        </button>
        <button class="mini" :disabled="cleaning" @click="toggleClean">{{ $t('common.cancel') }}</button>
      </template>
      <button v-else-if="isHub" class="mini" :disabled="!rows.length" @click="toggleClean">
        {{ $t('collab.member.clean') }}
      </button>
      <button class="mini" :disabled="exporting || !rows.length" @click="exportCsv">
        {{ $t('collab.member.export') }}
      </button>
    </div>
```

在 `<el-table ...>` 上追加监听（放在 `@row-click="onRowClick"` 后）：

```html
      @selection-change="onSelectionChange"
```

在表格的第一个 `<el-table-column ...>`（机器名列）之前插入选择列：

```html
      <el-table-column v-if="cleanMode" type="selection" :selectable="selectable" width="40" />
```

- [ ] **Step 5: 加样式**

在 `<style scoped>` 的 `.mtool { ... }` 规则后追加：

```css
.selhint { color: var(--tx6); font-size: 11px; margin-right: auto; }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- src/collaboration/MemberUsageTable.test.ts`
Expected: PASS（若 el-table 选择列交互在 happy-dom 下不稳定，改为点击 `.el-table__row` 后断言 `selected` 相关 UI；不得删除该用例）

- [ ] **Step 7: 提交**

```powershell
git add web/src/collaboration/MemberUsageTable.vue web/src/collaboration/MemberUsageTable.test.ts
git commit -m "feat(web): 成员表群主多选清理入口"
```

---

### Task 10: GroupView 刷新用量快照

**Files:**
- Modify: `web/src/collaboration/GroupView.vue`（第 337 行的 `MemberUsageTable` 标签）

- [ ] **Step 1: 接线**

把

```html
          <MemberUsageTable v-if="mtab === 'members'" class="mtable" :collab="collab" :peers="peers" :group="group" />
```

改为

```html
          <MemberUsageTable v-if="mtab === 'members'" class="mtable" :collab="collab" :peers="peers" :group="group" @removed="loadPeers" />
```

- [ ] **Step 2: 全量校验**

Run: `npm.cmd run typecheck`
Expected: 无错误

Run: `npm.cmd test`
Expected: server + web 全绿

- [ ] **Step 3: 提交**

```powershell
git add web/src/collaboration/GroupView.vue
git commit -m "feat(web): 清理成员后刷新群用量快照"
```

---

## 完成标准

- 仅群主在成员表看到「清理」；非群主不可见。
- 进入清理模式可多选（自己那行不可选），确认后：
  - 命中群成员的 id 调 `/api/collab/groups/:id/members/remove`（成员表与群 members 同步移除）；
  - 全部选中 id 调 `/api/usage/peers/remove`（`usage-peers.json` 快照 + `usage` 表按 `member_id` 删除）；
  - 刷新 snapshot 与 peers，选中行消失。
- 非群主调用两个端点分别返回 403；空目标/只含自己返回 400。
- `npm.cmd test` 与 `npm.cmd run typecheck` 全绿；`npm.cmd run check:i18n` 通过。
