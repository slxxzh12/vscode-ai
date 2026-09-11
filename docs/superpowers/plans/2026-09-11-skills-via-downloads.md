# 技能包改 master 发布 / slave 拉取 实施计划（P3 / 3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把技能/command/agent 分发从「push 到每个成员」改为「master 发布到 `downloads/skills/`，slave 点击同步后自行安装」。

**Architecture:** 复用既有 `buildPackage` 产出的捆绑 zip；master 新增 `publishPackage()` 写入 `downloads/skills/` 并登记 `groupSkills`；slave 经 P2 的 `pullDownloads()` 拿到 zip，用新增 `installBundleZip()` 解包安装。

**Tech Stack:** Node ESM、node:test、Vue3。

**前置：** P1、P2 已完成（单例群组、`downloads/`、点击拉取、`manifest.json`）。spec §6.4。

---

## 文件结构

**新建：**
- `server/collaboration/bundle-installer.js`
- `server/test/collab-bundle-installer.test.js`

**改：**
- `server/collaboration/engine.js` — `publishPackage` / `installDownload`
- `server/collaboration/http-mount.js` — `packages/:id/publish`、`downloads/install`
- `web/src/collaboration/{useCollab.ts,SkillDistributor.vue,GroupView.vue}`
- `shared/i18n/{zh-CN,en}.js`

---

## Task 1: bundle-installer 解包安装

**Files:**
- Create: `server/collaboration/bundle-installer.js`
- Test: `server/test/collab-bundle-installer.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildZip } from '../collaboration/zip.js';
import { installBundleZip } from '../collaboration/bundle-installer.js';

test('installBundleZip 解包 skills/command/agent 到各自根', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  const skillRoot = path.join(dir, 'skills');
  const configRoot = path.join(dir, 'cfg');
  const zip = buildZip([
    { name: 'skills/foo/SKILL.md', data: 'skill' },
    { name: 'skills/foo/lib/a.txt', data: 'lib' },
    { name: 'command/c.md', data: 'cmd' },
    { name: 'agent/ag.md', data: 'ag' },
  ]);
  const r = installBundleZip({ zip, skillRoot, configRoot });
  assert.ok(fs.existsSync(path.join(skillRoot, 'foo', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(skillRoot, 'foo', 'lib', 'a.txt')));
  assert.ok(fs.existsSync(path.join(configRoot, 'command', 'c.md')));
  assert.ok(fs.existsSync(path.join(configRoot, 'agent', 'ag.md')));
  assert.equal(r.counts.skills, 2);
  assert.equal(r.counts.command, 1);
  assert.equal(r.counts.agent, 1);
});

test('installBundleZip 拒绝越界条目', () => {
  // buildZip 本身拒绝 ..；此处测空/无效 zip
  assert.throws(() => installBundleZip({ zip: Buffer.from('nope'), skillRoot: 'x', configRoot: 'y' }));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/collab-bundle-installer.test.js"`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```js
import fs from 'node:fs';
import path from 'node:path';
import { readZip } from './zip.js';

function writeAtomic(dest, data) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, dest);
}

// 解包 assets 捆绑 zip：skills/<name>/... → skillRoot/<name>/...；command|agent/... → configRoot/<kind>/...
export function installBundleZip({ zip, skillRoot, configRoot }) {
  const entries = readZip(zip);   // 非法 zip 直接抛错
  const counts = { skills: 0, command: 0, agent: 0 };
  for (const e of entries) {
    const seg = e.name.split('/');
    const top = seg[0];
    if (top === 'skills') {
      if (seg.length < 3) continue;
      writeAtomic(path.join(skillRoot, ...seg.slice(1)), e.data);
      counts.skills++;
    } else if (top === 'command' || top === 'agent') {
      if (!configRoot || seg.length < 2) continue;
      writeAtomic(path.join(configRoot, top, ...seg.slice(1)), e.data);
      counts[top]++;
    }
  }
  return { counts, files: counts.skills + counts.command + counts.agent };
}
```

- [ ] **Step 4: 运行通过 + Commit**

Run: `node --test "server/test/collab-bundle-installer.test.js"`
```bash
git add server/collaboration/bundle-installer.js server/test/collab-bundle-installer.test.js
git commit -m "feat(collab): 捆绑 zip 解包安装"
```

---

## Task 2: 引擎 publish / installDownload + 路由

**Files:**
- Modify: `server/collaboration/engine.js`
- Modify: `server/collaboration/http-mount.js`
- Test: `server/test/collab-skills.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-skills.test.js` 增（沿用该文件 harness）：

```js
test('master 发布捆绑包 → downloads/skills 出现且 manifest 记录', async () => {
  const h = await createPairHarness();   // 需技能根
  try {
    const [A, B] = h.nodes;
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    // A 的技能根放一个 foo/SKILL.md
    const fs = await import('node:fs'); const path = await import('node:path');
    fs.mkdirSync(path.join(A.skillsRoot, 'foo'), { recursive: true });
    fs.writeFileSync(path.join(A.skillsRoot, 'foo', 'SKILL.md'), '# foo');
    const rec = await A.buildPackage({ skills: ['foo'] });
    const pub = A.publishPackage(rec.id);
    assert.equal(pub.code, 'ok');
    assert.ok(fs.existsSync(path.join(A.downloadsDir, pub.name)));
    assert.ok(A.readManifest().files.some((f) => f.name === pub.name));
  } finally { await h.stop(); }
});

test('slave 拉取后可安装到本机技能根', async () => {
  // 在上一用例基础上：B.pullDownloads() 后 B.installDownload(pub.name)，断言 B.skillsRoot/foo/SKILL.md 存在
});
```

（第二个用例写全：需要跨用例共享 `pub.name` 时不复用；在同测试内完成 master 发布 + slave 拉取 + 安装）

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/collab-skills.test.js"`
Expected: FAIL

- [ ] **Step 3: 引擎实现**

import `installBundleZip`。新增：

```js
publishPackage(packageId) {
  const g = this.store.getGroup();
  if (!g || g.hubId !== this.pub.machineId) return { code: 'not-master' };
  const rec = this.store.listOutbox().find((r) => r.id === packageId);
  if (!rec || !rec.storedFile || !this.uploadDir) return { code: 'not-found' };
  const abs = path.join(this.uploadDir, path.basename(rec.storedFile));
  if (!fs.existsSync(abs)) return { code: 'file-missing' };
  const buf = fs.readFileSync(abs);
  const name = `skills/${crypto.randomUUID()}-${rec.fileName}`;
  this.writeDownload(name, buf, 'skill');
  const pkg = rec.package || {};
  for (const skillName of (pkg.skills || [])) {
    this.store.upsertGroupSkill({ groupId: g.id, skillName, hash: rec.hash, distributedBy: this.pub.machineId, installed: true });
  }
  this._emit('synced', {});
  return { code: 'ok', name, size: buf.length };
}
installDownload(name) {
  if (!name || name.includes('..') || name.includes('\\')) return { code: 'bad-name' };
  const abs = path.join(this.downloadsDir, name);
  if (!fs.existsSync(abs)) return { code: 'not-found' };
  try {
    const r = installBundleZip({ zip: fs.readFileSync(abs), skillRoot: this.skillRoot(), configRoot: this.configRoot() });
    this._emit('synced', {});
    return { code: 'ok', ...r };
  } catch (e) { return { code: 'invalid', error: String((e && e.message) || e) }; }
}
```

- [ ] **Step 4: 路由**

`http-mount.js` 增：
```js
if (seg[0] === 'packages' && seg.length === 3 && seg[2] === 'publish' && m === 'POST') {
  return ok(res, engine.publishPackage(seg[1]));
}
if (seg[0] === 'downloads' && seg.length === 2 && seg[1] === 'install' && m === 'POST') {
  return ok(res, engine.installDownload(body.name));
}
```
（确保 `downloads/install` 在通用 `downloads` GET 分支之前或 seg 长度区分，互不冲突。）

- [ ] **Step 5: 运行通过**

Run: `node --test "server/test/collab-skills.test.js"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/collaboration/engine.js server/collaboration/http-mount.js server/test/collab-skills.test.js
git commit -m "feat(collab): master 发布捆绑包 + slave 拉取安装"
```

---

## Task 3: 前端发布/拉取/安装

**Files:**
- Modify: `web/src/collaboration/useCollab.ts`
- Modify: `web/src/collaboration/SkillDistributor.vue`
- Modify: `web/src/collaboration/GroupView.vue`
- Modify: `shared/i18n/{zh-CN,en.js}`

- [ ] **Step 1: `useCollab.ts`**

新增：
```ts
publishPackage: (id: string) => post<{ code: string; name?: string }>(`/api/collab/packages/${id}/publish`),
installDownload: (name: string) => post<{ code: string }>('/api/collab/downloads/install', { name }),
```
返回对象增 `publishPackage, installDownload`。

- [ ] **Step 2: `SkillDistributor.vue`**

- `group` 计算改为单例（`snap.value.group`）。
- 增 `const isMaster = computed(() => !!snap.value.group && snap.value.group.hubId === snap.value.identity.machineId);`
- 把 `doSend` 改为 `doPublish`：
```ts
async function doPublish() {
  if (!pkg.value) return;
  msg.value = ''; msgErr.value = ''; working.value = true;
  try {
    const r = await props.collab.publishPackage(pkg.value.id);
    if (r.code !== 'ok') { msgErr.value = t('common.send_failed', { msg: r.code }); return; }
    sent.value = true;
    msg.value = t('collab.dist.published');
  } catch (e: any) { msgErr.value = String(e?.message || e); }
  finally { working.value = false; }
}
```
- 模板按钮：`v-if="isMaster"` 显示「发布到 downloads」调用 `doPublish`；非 master 显示提示 `collab.dist.master_only`。`sendPackage` 调用删除。

- [ ] **Step 3: `GroupView.vue` downloads 列表**

在 P2 的 downloads 区块内渲染文件列表，`kind === 'skill'` 的行给「安装」与「下载」：
```vue
<div v-for="f in downloads.manifest?.files || []" :key="f.name" class="linkrow">
  <span class="txt">{{ f.name }}</span>
  <a v-if="f.kind === 'skill'" :href="`/api/collab/downloads/file/${encodeURIComponent(f.name)}`" class="ghost" download>{{ $t('collab.downloads.download') }}</a>
  <button v-if="f.kind === 'skill'" @click="install(f.name)">{{ $t('collab.downloads.install') }}</button>
</div>
```
脚本：
```ts
const installMsg = ref('');
async function install(name: string) {
  try { const r = await props.collab.installDownload(name); installMsg.value = r.code === 'ok' ? t('collab.downloads.installed') : t('common.send_failed', { msg: r.code }); }
  catch (e) { installMsg.value = String((e as Error).message); }
}
```

- [ ] **Step 4: i18n**

新增 `collab.dist.publish`、`collab.dist.published`、`collab.dist.master_only`、`collab.downloads.download`、`collab.downloads.install`、`collab.downloads.installed`（中英同步）。

- [ ] **Step 5: 验证 + Commit**

Run: `npm.cmd run typecheck`
Run: `npm.cmd run test:web`
Run: `npm.cmd run check:i18n`
```bash
git add web/src/collaboration shared/i18n
git commit -m "feat(web): master 发布技能包 / slave 拉取安装"
```

---

## Task 4: 全量验证

- [ ] **Step 1:** `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n` 全 PASS。
- [ ] **Step 2: 手动**：A（master）选技能打包并「发布到 downloads」；B 群组页签点「同步 master」后看到 skill 包，点「安装」后本机技能根出现该技能。非 master 不显示发布按钮。

---

## Self-Review 记录

- **Spec 覆盖**：§6.4 master 发布→Task 2；slave 拉取/安装→Task 2/3；§7 无推送→沿用 P2 点击拉取。
- **类型一致**：`publishPackage`、`installDownload`、`installBundleZip`、`downloadsDir`、`kind:'skill'` 前后一致。
- **占位扫描**：Task 2 Step 1 第二个用例要求写全（同测试内闭环），无 TBD。
- **依赖**：`groupSkills` 仍以单例 `groupId='shared'` 记录（P1 store 保留该方法）。
