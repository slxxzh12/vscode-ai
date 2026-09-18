# 成员上传配置给群主审核 + 群主一键打包生成种子 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 群主在分发弹窗一步「打包并生成种子」；非群主打包后把 zip 上传到群主 `upload/`，并在群里发通知消息，群主据此生成本机审核任务，可接受（发布到群）或拒绝（丢弃）。

**Architecture:** 复用现有 outbox/seed/publishPackage 与 task/chat 机制。新增 peer 类型 `PKG_UPLOAD` 用于成员→群主传文件；新增聊天消息 `kind:'pkg-upload'` 作为任务来源，对称于现有 `kind:'dist'`（群主→成员）。群主 `acceptTask` 对 `kind:'upload'` 分支调用 `publishPackage`；`ignoreTask` 删除 upload 文件。

**Tech Stack:** Node ESM（server，node:test）、Vue3 + TS（web，vitest）、shared 常量 + i18n。

---

## File Structure

- `shared/collab.js` / `shared/collab.d.ts` — 新增 `CollabPeer.PKG_UPLOAD`
- `server/collaboration/engine.js` — 上传/接收/任务生成/接受拒绝分支
- `server/collaboration/http-mount.js` — `POST /api/collab/packages/:id/upload`
- `server/test/collab-upload-review.test.js` — 新测试
- `web/src/collaboration/useCollab.ts` — `uploadPackage`
- `web/src/collaboration/distTasks.ts` — `kindKeyOf('upload')`
- `web/src/collaboration/SkillDistributor.vue` — 角色化一步提交
- `web/src/collaboration/SkillDistributor.test.ts` — 补测
- `shared/i18n/zh-CN.js` / `shared/i18n/en.js` — 词条
- 已完成：`web/src/collaboration/GroupView.vue` 去掉「我的群组」「从 master 同步」「同步配置到 Slave 群成员」

---

### Task 1: shared 协议常量

**Files:**
- Modify: `shared/collab.js:10-25`
- Modify: `shared/collab.d.ts`

- [ ] **Step 1: 加常量**

`shared/collab.js` 的 `CollabPeer` 增加一行：

```js
  LIST_DOWNLOADS: 'list-downloads',
  PKG_UPLOAD: 'pkg-upload',
```

`shared/collab.d.ts` 同步增加 `PKG_UPLOAD: 'pkg-upload';`。

- [ ] **Step 2: 验证**

Run: `node -e "import('@devflow/shared/collab').then(m=>console.log(m.CollabPeer.PKG_UPLOAD))"`
Expected: `pkg-upload`

---

### Task 2: 服务端上传与审核（TDD）

**Files:**
- Modify: `server/collaboration/engine.js`
- Create: `server/test/collab-upload-review.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/collab-upload-review.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPairHarness } from '../collaboration/engine.js';
import { createTaskStore } from '../task-store.js';
import { buildZip } from '../collaboration/zip.js';

function tmpDir(name) { return fs.mkdtempSync(path.join(os.tmpdir(), name)); }

async function joinedPair() {
  const h = await createPairHarness({ skipSkills: true });
  const [A, B] = h.nodes;
  const dir = tmpDir('df-upload-');
  A.taskStore = createTaskStore({ file: path.join(dir, 'a.db'), logger: { warn() {} } });
  B.taskStore = createTaskStore({ file: path.join(dir, 'b.db'), logger: { warn() {} } });
  A.verifyAccessToken = (tk) => tk === 'good';
  A.ensureGroup();
  const r = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
  return { h, A, B, group: r.group, dir };
}

test('成员上传：文件落到群主 upload/，群主据聊天消息建 upload 任务', async () => {
  const { h, A, B, group, dir } = await joinedPair();
  try {
    // 成员本机先打包（直接造 outbox + upload 文件，等价 buildPackage 产物）
    B.uploadDir = path.join(dir, 'b-upload');
    fs.mkdirSync(B.uploadDir, { recursive: true });
    const zip = buildZip([{ name: 'skills/demo/SKILL.md', data: Buffer.from('# demo') }]);
    fs.writeFileSync(path.join(B.uploadDir, 'assets-1.zip'), zip);
    B.store.addOutbox({ id: 'pkg-b1', kind: 'file', fileName: 'assets-1.zip', storedFile: 'assets-1.zip', size: zip.length, hash: 'h1', createdAt: 1, package: { skills: ['demo'], command: [], agent: [], workflow: [] } });

    const up = await B.uploadPackageToMaster('pkg-b1', group.id);
    assert.equal(up.code, 'ok');
    assert.ok(up.packageId, '群主返回 packageId');
    assert.ok(fs.readdirSync(A.uploadDir).some((f) => f.endsWith('.zip')), '群主 upload/ 有 zip');
    assert.equal(A.taskStore.list({ status: 'pending' }).length, 1, '群主生成待审核任务');
    assert.equal(A.taskStore.list()[0].kind, 'upload');
  } finally { await h.stop(); }
});

test('群主接受 upload 任务：发布到群 → done + 广播 dist', async () => {
  const { h, A, B, group, dir } = await joinedPair();
  try {
    B.uploadDir = path.join(dir, 'b-upload2');
    fs.mkdirSync(B.uploadDir, { recursive: true });
    const zip = buildZip([{ name: 'skills/demo/SKILL.md', data: Buffer.from('# demo') }]);
    fs.writeFileSync(path.join(B.uploadDir, 'assets-2.zip'), zip);
    B.store.addOutbox({ id: 'pkg-b2', kind: 'file', fileName: 'assets-2.zip', storedFile: 'assets-2.zip', size: zip.length, hash: 'h2', createdAt: 1, package: { skills: ['demo'], command: [], agent: [], workflow: [] } });
    await B.uploadPackageToMaster('pkg-b2', group.id);

    const task = A.taskStore.list({ status: 'pending' })[0];
    const res = await A.acceptTask(task.id);
    assert.equal(res.code, 'ok');
    assert.equal(A.taskStore.get(task.id).status, 'done');
    assert.ok(A.readUpdate().version, '生成升级种子');
    assert.ok(A.store.listChatMessages(group.id).some((m) => m.kind === 'dist'), '广播 dist');
  } finally { await h.stop(); }
});

test('群主拒绝 upload 任务：任务 ignored + 删除 upload/ 文件', async () => {
  const { h, A, B, group, dir } = await joinedPair();
  try {
    B.uploadDir = path.join(dir, 'b-upload3');
    fs.mkdirSync(B.uploadDir, { recursive: true });
    const zip = buildZip([{ name: 'skills/demo/SKILL.md', data: Buffer.from('# demo') }]);
    fs.writeFileSync(path.join(B.uploadDir, 'assets-3.zip'), zip);
    B.store.addOutbox({ id: 'pkg-b3', kind: 'file', fileName: 'assets-3.zip', storedFile: 'assets-3.zip', size: zip.length, hash: 'h3', createdAt: 1, package: { skills: ['demo'], command: [], agent: [], workflow: [] } });
    await B.uploadPackageToMaster('pkg-b3', group.id);

    const task = A.taskStore.list({ status: 'pending' })[0];
    const res = A.ignoreTask(task.id);
    assert.equal(res.code, 'ignored');
    assert.equal(A.taskStore.get(task.id).status, 'ignored');
    assert.equal(fs.readdirSync(A.uploadDir).filter((f) => f.endsWith('.zip')).length, 0, 'upload/ 文件被删');
  } finally { await h.stop(); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-upload-review.test.js"`
Expected: FAIL（`uploadPackageToMaster is not a function`）

- [ ] **Step 3: 实现 engine**

在 `server/collaboration/engine.js` 的 `publishPackage` 方法后（约 `engine.js:776` 后）新增：

```js
  // 成员把已打包的 zip 上传给群主，并在群里发一条审核通知
  async uploadPackageToMaster(packageId, groupId) {
    const g = this.store.findGroup(groupId);
    if (!g) return { code: 'no-group' };
    if (g.hubId === this.pub.machineId) return { code: 'is-master' };
    if (!g.members.find((m) => m.machineId === this.pub.machineId)) return { code: 'not-member' };
    const rec = this.store.listOutbox().find((r) => r.id === packageId);
    if (!rec || !rec.storedFile || !this.uploadDir) return { code: 'not-found' };
    const abs = path.join(this.uploadDir, path.basename(rec.storedFile));
    if (!fs.existsSync(abs)) return { code: 'file-missing' };
    const buf = fs.readFileSync(abs);
    const hub = g.members.find((m) => m.machineId === g.hubId);
    if (!hub) return { code: 'no-master' };
    const pkg = rec.package || {};
    const env = this._sign(CollabPeer.PKG_UPLOAD, {
      groupId, name: rec.fileName, hash: rec.hash, size: buf.length,
      b64: buf.toString('base64'), package: pkg,
    });
    const res = await this._post(hub.host, hub.port, env);
    if (!res.ok) return { code: 'unreachable', error: res.error };
    const masterPackageId = (res.data && res.data.packageId) || '';
    this._sendPkgUploadNotice(g, rec, pkg, masterPackageId);
    return { code: 'ok', packageId: masterPackageId };
  }
  _sendPkgUploadNotice(g, rec, pkg, masterPackageId) {
    const count = (pkg.skills || []).length + (pkg.command || []).length + (pkg.agent || []).length + (pkg.workflow || []).length;
    const master = g.members.find((m) => m.machineId === g.hubId);
    const text = t('collab.dist.upload_notice', { name: rec.fileName || '', count, master: master ? profileLabel(master) : '' });
    const msg = {
      id: crypto.randomUUID(), groupId: g.id, kind: 'pkg-upload', fromId: this.pub.machineId,
      text, toId: g.hubId, ts: Date.now(), seq: this.store.nextChatSeq(),
      meta: { type: distTypeOf(pkg), name: rec.fileName || '', hash: rec.hash || '', size: Number(rec.size) || 0, count, packageId: masterPackageId, ...pkg },
    };
    this.store.addChatMessage(msg);
    this._broadcastChat(g.id, msg);
    this._emit('chat', { groupId: g.id, msg });
    return msg;
  }
  // 群主收到上传通知消息：给自己建审核任务（对称于 ingestDist）
  ingestUploadRequest(msg) {
    if (!msg || msg.kind !== 'pkg-upload' || !msg.groupId || !msg.meta) return { code: 'skip' };
    const g = this.store.findGroup(msg.groupId);
    if (!g) return { code: 'no-group' };
    if (g.hubId !== this.pub.machineId) return { code: 'not-master' };
    if (msg.fromId === this.pub.machineId) return { code: 'self' };
    if (!g.members.find((m) => m.machineId === msg.fromId)) return { code: 'not-member' };
    const meta = msg.meta;
    if (!meta.hash || !meta.packageId) return { code: 'bad-meta' };
    const payload = {
      skills: meta.skills || [], command: meta.command || [], agent: meta.agent || [], workflow: meta.workflow || [],
      count: Number(meta.count) || 0, size: Number(meta.size) || 0,
      packageId: String(meta.packageId), submittedBy: msg.fromId,
    };
    const r = this.taskStore?.upsert?.({
      id: crypto.randomUUID(), groupId: msg.groupId, hubId: g.hubId, kind: 'upload',
      hash: String(meta.hash), name: String(meta.name || ''), url: String(meta.url || ''),
      payload, status: 'pending', messageId: msg.id, createdAt: Date.now(), updatedAt: Date.now(),
    });
    this._emit('tasks', { groupId: msg.groupId, created: r?.created ? ['upload'] : [], msgId: msg.id });
    return { code: 'ok' };
  }
  async _inPkgUpload(env) {
    const p = env.from;
    const { groupId, name, hash, size, b64, package: pkg = {} } = env.payload || {};
    if (!groupId || !name || !hash || typeof b64 !== 'string') return { ok: false, error: 'bad-payload' };
    const g = this.store.findGroup(groupId);
    if (!g || !g.members.find((m) => m.machineId === p.machineId)) return { ok: false, error: 'not-member' };
    if (g.hubId !== this.pub.machineId) return { ok: false, error: 'not-hub' };
    const data = Buffer.from(b64, 'base64');
    if (data.length === 0 || (size != null && size !== data.length)) return { ok: false, error: 'size-mismatch' };
    if (crypto.createHash('sha256').update(data).digest('hex') !== hash) return { ok: false, error: 'hash-mismatch' };
    if (!this.uploadDir) return { ok: false, error: 'no-upload-dir' };
    fs.mkdirSync(this.uploadDir, { recursive: true });
    const label = `assets-${String(p.machineId).slice(0, 8)}-${Date.now().toString(36)}.zip`;
    fs.writeFileSync(path.join(this.uploadDir, label), data);
    const rec = this.store.addOutbox({
      id: crypto.randomUUID(), kind: 'file', groupId, skillName: null, fileName: name,
      storedFile: label, size: data.length, hash, createdAt: Date.now(),
      package: { sent: false, skills: pkg.skills || [], command: pkg.command || [], agent: pkg.agent || [], workflow: pkg.workflow || [] },
    });
    this._emit('synced', {});
    return { ok: true, data: { packageId: rec.id } };
  }
```

在 `handleIncoming` 的 switch 里加：

```js
      case CollabPeer.PKG_UPLOAD: return this._inPkgUpload(env);
```

在 `_extendChat` 的 `_inChatSend` 中，把 `if (msg.kind === 'dist') this.ingestDist(msg);` 改为：

```js
    if (msg.kind === 'dist') this.ingestDist(msg);
    else if (msg.kind === 'pkg-upload') this.ingestUploadRequest(msg);
```

在 `applyChatPull` 的循环里，`if (m.kind === 'dist' && ...) this.ingestDist(m);` 后补：

```js
      if (m.kind === 'pkg-upload') this.ingestUploadRequest(m);
```

`acceptTask` 在 `if (!task) return { code: 'not-found' };` 后加分支：

```js
    if (task.kind === 'upload') return this._acceptUploadTask(task);
```

新增方法（放在 `acceptTask` 后）：

```js
  _acceptUploadTask(task) {
    if (task.status !== 'pending' && task.status !== 'failed') return { code: 'not-pending' };
    const r = this.publishPackage(task.payload && task.payload.packageId);
    if (r.code !== 'ok') {
      this.taskStore.setStatus(task.id, 'failed', { payload: { ...task.payload, lastError: r.code } });
      return { code: r.code };
    }
    this.taskStore.setStatus(task.id, 'done');
    this._addSystemMessage(task.groupId, t('collab.sys.upload_accepted', { name: task.name || '' }));
    this._emit('tasks', { groupId: task.groupId, created: [], accepted: task.id });
    return { code: 'ok', version: r.version };
  }
```

`ignoreTask` 改为：

```js
  ignoreTask(id) {
    const task = this.taskStore?.get?.(id);
    if (!task) return { code: 'not-found' };
    if (task.kind === 'upload') {
      const packageId = task.payload && task.payload.packageId;
      if (packageId) this.removeOutbox(packageId);
      this.taskStore.setStatus(id, 'ignored');
      this._addSystemMessage(task.groupId, t('collab.sys.upload_rejected', { name: task.name || '' }));
      this._emit('tasks', { groupId: task.groupId, created: [], ignored: id });
      return { code: 'ignored' };
    }
    this.taskStore.setStatus(id, 'ignored');
    this._emit('tasks', { groupId: task.groupId, created: [], ignored: id });
    return { code: 'ignored' };
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-upload-review.test.js"`
Expected: PASS（3 tests）

- [ ] **Step 5: 回归**

Run: `node --test "server/test/collab-*.test.js" "server/test/dist-task.test.js"`
Expected: PASS

---

### Task 3: HTTP 路由

**Files:**
- Modify: `server/collaboration/http-mount.js:128-130`
- Test: `server/test/collab-tasks-http.test.js`

- [ ] **Step 1: 加路由**

在 `packages/:id/publish` 分支后加：

```js
      if (seg[0] === 'packages' && seg.length === 3 && seg[2] === 'upload' && m === 'POST') {
        const r = await engine.uploadPackageToMaster(seg[1], body.groupId);
        if (r.code !== 'ok') return sendJson(res, 400, { error: r.code });
        return ok(res, r);
      }
```

- [ ] **Step 2: 验证**

Run: `node --test "server/test/collab-tasks-http.test.js"`
Expected: PASS

---

### Task 4: 前端 API + 任务类型文案

**Files:**
- Modify: `web/src/collaboration/useCollab.ts:135`
- Modify: `web/src/collaboration/distTasks.ts:46-48`
- Test: `web/src/collaboration/distTasks.test.ts`

- [ ] **Step 1: useCollab**

在 `publishPackage` 后加：

```ts
    uploadPackage: (id: string, groupId: string) => post<{ code: string; packageId?: string }>(`/api/collab/packages/${id}/upload`, { groupId }),
```

- [ ] **Step 2: distTasks**

`kindKeyOf` 改为：

```ts
export function kindKeyOf(kind: string): string {
  if (kind === 'workflow') return 'collab.task.workflow';
  if (kind === 'upload') return 'collab.task.upload';
  return 'collab.task.skills';
}
```

- [ ] **Step 3: 补测试**

`distTasks.test.ts` 增加断言：`expect(kindKeyOf('upload')).toBe('collab.task.upload');`

Run: `npm.cmd --prefix web run test -- --run distTasks`
Expected: PASS

---

### Task 5: SkillDistributor 角色化一步提交

**Files:**
- Modify: `web/src/collaboration/SkillDistributor.vue`
- Test: `web/src/collaboration/SkillDistributor.test.ts`

- [ ] **Step 1: 写失败测试**

在 `SkillDistributor.test.ts` 的 `mockCollab` 返回值里加 `uploadPackage: vi.fn()`；`state.value.groups` 造一个本机为 hub 的群与一个非 hub 的群；新增两条用例：

```ts
it('群主一步打包并生成种子', async () => {
  const collab: any = mockCollab();
  collab.state.value = { ...EMPTY_SNAPSHOT, identity: { ...EMPTY_SNAPSHOT.identity, machineId: 'me' }, groups: [{ id: 'g1', hubId: 'me', name: 'G', members: [] }] };
  collab.buildPackage.mockResolvedValue({ package: { id: 'p1', fileName: 'a.zip', size: 1 } });
  collab.publishPackage.mockResolvedValue({ code: 'ok', version: 'v1' });
  const w = mount(collab);
  await flushPromises();
  await w.find('input[type="checkbox"]').setValue(true);
  await w.find('button.go').trigger('click');
  await flushPromises();
  expect(collab.buildPackage).toHaveBeenCalled();
  expect(collab.publishPackage).toHaveBeenCalledWith('p1');
});

it('非群主一步打包并上传', async () => {
  const collab: any = mockCollab();
  collab.state.value = { ...EMPTY_SNAPSHOT, identity: { ...EMPTY_SNAPSHOT.identity, machineId: 'me' }, groups: [{ id: 'g1', hubId: 'other', name: 'G', members: [] }] };
  collab.buildPackage.mockResolvedValue({ package: { id: 'p1', fileName: 'a.zip', size: 1 } });
  collab.uploadPackage.mockResolvedValue({ code: 'ok', packageId: 'mp1' });
  const w = mount(collab);
  await flushPromises();
  await w.find('input[type="checkbox"]').setValue(true);
  await w.find('button.go').trigger('click');
  await flushPromises();
  expect(collab.uploadPackage).toHaveBeenCalledWith('p1', 'g1');
  expect(collab.publishPackage).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- --run SkillDistributor`
Expected: FAIL（`uploadPackage is not a function` / 无 `button.go` 一步逻辑）

- [ ] **Step 3: 改组件**

把 `doPack`/`doPublish` 合并为：

```ts
async function doSubmit() {
  if (!selectedCount.value) { msg.value = t('collab.dist.select_first'); return; }
  msg.value = ''; msgErr.value = ''; working.value = true;
  try {
    const r = await props.collab.buildPackage(selected.value);
    pkg.value = r.package;
    if (isMaster.value) {
      const pub = await props.collab.publishPackage(pkg.value.id);
      if (pub.code !== 'ok') { msgErr.value = t('common.send_failed', { msg: pub.code }); return; }
      sent.value = true; publishedVersion.value = pub.version || '';
      msg.value = t('collab.dist.published', { version: pub.version || '—' });
    } else {
      const up = await props.collab.uploadPackage(pkg.value.id, props.groupId);
      if (up.code !== 'ok') { msgErr.value = t('common.send_failed', { msg: up.code }); return; }
      sent.value = true;
      msg.value = t('collab.dist.uploaded');
    }
  } catch (e: any) { msgErr.value = String(e?.message || e); }
  finally { working.value = false; }
}
```

模板 `acts` 改为：

```html
    <div class="acts">
      <template v-if="!pkg">
        <button class="go" :disabled="working || !selectedCount" @click="doSubmit">
          {{ working ? $t('common.sending') : (isMaster ? $t('collab.dist.pack_publish', { count: selectedCount }) : $t('collab.dist.pack_upload', { count: selectedCount })) }}
        </button>
      </template>
      <template v-else>
        <button class="ghostgo" :disabled="working" @click="downloadPkg">{{ $t('collab.dist.download') }}</button>
        <button class="ghostgo" :disabled="working" @click="reset">{{ $t('collab.dist.repack') }}</button>
      </template>
      <div class="msgs">
        <span v-if="pkg" class="pkgname">{{ $t('collab.dist.package') }}{{ pkg.fileName }}（{{ fmtSize(pkg.size) }}）</span>
        <span v-if="msg" class="ok">{{ msg }}</span>
        <span v-if="msgErr" class="err">{{ msgErr }}</span>
      </div>
    </div>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- --run SkillDistributor`
Expected: PASS

---

### Task 6: i18n 词条（中英对称）

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 加词条**

zh-CN（`collab.dist.published` 后）：

```js
  'collab.dist.pack_publish': '打包并生成种子（{count}）',
  'collab.dist.pack_upload': '打包并上传给群主（{count}）',
  'collab.dist.uploaded': '已上传给群主，等待审核',
  'collab.dist.upload_notice': '我上传了 {name}（{count} 项），请群主 {master} 审核',
```

zh-CN（`collab.task.workflow` 后）：

```js
  'collab.task.upload': '成员上传待审核',
```

zh-CN（`collab.dist.msg.mixed_short` 后或系统消息区）：

```js
  'collab.sys.upload_accepted': '群主已接受上传：{name}',
  'collab.sys.upload_rejected': '群主已拒绝上传：{name}',
```

en 对应：

```js
  'collab.dist.pack_publish': 'Pack & create seed ({count})',
  'collab.dist.pack_upload': 'Pack & upload to master ({count})',
  'collab.dist.uploaded': 'Uploaded to master, pending review',
  'collab.dist.upload_notice': 'I uploaded {name} ({count} items), please review, master {master}',
  'collab.task.upload': 'Member upload pending review',
  'collab.sys.upload_accepted': 'Master accepted upload: {name}',
  'collab.sys.upload_rejected': 'Master rejected upload: {name}',
```

- [ ] **Step 2: 校验**

Run: `npm.cmd run check:i18n`
Expected: `未发现中文命中`

---

### Task 7: 全量验证

- [ ] **Step 1: 服务端测试**

Run: `npm.cmd run test:server`
Expected: PASS

- [ ] **Step 2: 前端测试**

Run: `npm.cmd run test:web`
Expected: PASS

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误

- [ ] **Step 4: i18n**

Run: `npm.cmd run check:i18n`
Expected: `未发现中文命中`

---

## Self-Review

- 需求覆盖：群主一键（Task 5）、非群主上传（Task 2/3/4/5）、文件落 upload/（Task 2 `_inPkgUpload`）、群里发消息（Task 2 `_sendPkgUploadNotice`）、群主据消息建任务（Task 2 `ingestUploadRequest`）、接受=发布/拒绝=删除（Task 2）。
- 类型一致性：`uploadPackageToMaster` / `_inPkgUpload` / `ingestUploadRequest` / `_acceptUploadTask` / `_sendPkgUploadNotice` 命名在测试与实现中一致；`uploadPackage`（前端）与路由 `/upload` 一致。
- 无占位符。
