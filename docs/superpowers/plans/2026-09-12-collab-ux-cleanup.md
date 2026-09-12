# 协作页清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除协作页「本机免确认命令（白名单）」整条功能；把 master 共享文件列表移到底部并默认折叠。

**Architecture:** 服务端移除白名单存储/引擎分支/HTTP 路由，远程命令一律 pending；前端移除白名单 UI，master 文件区块改为底部 `<details>`。

**Tech Stack:** Node ESM、`node:test`、Vue3+TS、i18n 中英对称。

**Spec:** `docs/superpowers/specs/2026-09-12-collab-ux-cleanup-design.md`

**约定:** 仓库根执行；`npm.cmd`；每 Task 一提交。

---

### Task 1: 服务端删除白名单（store / engine / http-mount）

**Files:**
- Modify: `server/collaboration/store.js`
- Modify: `server/collaboration/engine.js`
- Modify: `server/collaboration/http-mount.js`
- Test: `server/test/collab-store.test.js`、`server/test/collab-chat.test.js`、`server/test/collab-http.test.js`

- [ ] **Step 1: 改测试（先让它们反映新行为）**

`server/test/collab-store.test.js`：把 `pendingCmds 与 allowlist` 用例替换为：

```js
test('pendingCmds', () => {
  const s = new CollabStore({ file: tmpFile() });
  s.addPendingCmd({ id: 'r1', groupId: 'g', fromId: 'a', text: 'ls', receivedAt: 1 });
  assert.equal(s.listPendingCmds().length, 1);
  assert.ok(s.findPendingCmd('r1'));
  s.removePendingCmd('r1');
  assert.equal(s.listPendingCmds().length, 0);
});
```

`server/test/collab-chat.test.js`：删除「白名单命中自动执行并回结果」整个用例，并把 `未命中白名单 → B 产生 pending，approve 后执行` 改名为 `远程命令 → B 产生 pending，approve 后执行`（用例体内删除 `B.store.addAllowEntry(...)` 若有；当前该用例无白名单调用，仅改名即可）。

`server/test/collab-http.test.js`：把「群聊与远程执行 REST 冒烟」用例中白名单相关段落替换。删除：

```js
    // B 白名单加入，A 发普通聊天
    await post(`http://127.0.0.1:${B.port}/api/collab/allowlist`, { prefix: '安全命令' });
    const allow = await fetch(`http://127.0.0.1:${B.port}/api/collab/allowlist`).then((r) => r.json());
    assert.deepEqual(allow.allowlist, ['安全命令']);
```

并把后半段「远程执行」改为先 pending 再 approve：

```js
    // A @B 远程执行 → B 产生 pending → approve 后回结果
    const cmd = await post(`http://127.0.0.1:${A.port}/api/collab/groups/${g.id}/cmd`, { text: '安全命令 go', toId: B.engine.pub.machineId });
    assert.equal(cmd.body.code, 'sent');
    await new Promise((r) => setTimeout(r, 120));
    const pending = await fetch(`http://127.0.0.1:${B.port}/api/collab/cmds`).then((r) => r.json());
    assert.equal(pending.pending.length, 1, 'B 有待确认命令');
    await post(`http://127.0.0.1:${B.port}/api/collab/cmds/${pending.pending[0].id}/approve`, { approve: true });
    await new Promise((r) => setTimeout(r, 120));
    const chat2 = await fetch(`http://127.0.0.1:${A.port}/api/collab/groups/${g.id}/chat`).then((r) => r.json());
    const results = chat2.messages.filter((m) => m.kind === 'cmd-result');
    assert.ok(results.length >= 1, 'A 群内有 cmd-result');
    assert.equal(results[0].text, 'OK');
    const pending2 = await fetch(`http://127.0.0.1:${B.port}/api/collab/cmds`).then((r) => r.json());
    assert.equal(pending2.pending.length, 0, '确认后 pending 清空');
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/collab-store.test.js" "server/test/collab-chat.test.js" "server/test/collab-http.test.js"`
Expected: FAIL（白名单仍存在；`collab-store` 用例已不再调用白名单，需实现后其他用例表现变化）

- [ ] **Step 3: 改 `server/collaboration/store.js`**

`defaultData()` 删除该行：

```js
    commandAllowlist: [], // string[] 前缀
```

删除文件末尾整段（含注释）：

```js
  // ---- allowlist ----
  listAllowlist() { return this.data.commandAllowlist; }
  addAllowEntry(prefix) {
    if (!this.data.commandAllowlist.includes(prefix)) this.data.commandAllowlist.push(prefix);
    this.save();
  }
  removeAllowEntry(prefix) {
    this.data.commandAllowlist = this.data.commandAllowlist.filter((p) => p !== prefix);
    this.save();
  }
  isAllowed(text) { return this.data.commandAllowlist.some((p) => typeof text === 'string' && text.startsWith(p)); }
```

- [ ] **Step 4: 改 `server/collaboration/engine.js`**

`_inCmdReq` 中删除自动执行分支：

```js
    if (this.store.isAllowed(text)) {
      this._runCmd({ reqId, groupId, fromId: p.machineId, text, auto: true });
      return { ok: true };
    }
```

保留其余（`addPendingCmd` + `_emit('cmd-pending')`）。

删除：

```js
  engine.listAllowlist = function listAllowlist() { return this.store.listAllowlist(); };
  engine.allowCmd = function allowCmd(prefix) { if (typeof prefix === 'string' && prefix) { this.store.addAllowEntry(prefix.trim()); return { code: 'ok' }; } return { code: 'bad' }; };
  engine.disallowCmd = function disallowCmd(prefix) { this.store.removeAllowEntry(prefix); return { code: 'ok' }; };
```

- [ ] **Step 5: 改 `server/collaboration/http-mount.js`**

删除：

```js
      // ---- allowlist ----
      if (seg[0] === 'allowlist' && m === 'GET') return ok(res, { allowlist: engine.listAllowlist() });
      if (seg[0] === 'allowlist' && seg.length === 1 && m === 'POST') { const r = engine.allowCmd(body.prefix); return ok(res, r); }
      if (seg[0] === 'allowlist' && seg.length === 2 && m === 'DELETE') { const r = engine.disallowCmd(decodeURIComponent(seg[1])); return ok(res, r); }
```

- [ ] **Step 6: 运行确认通过**

Run: `node --test "server/test/collab-store.test.js" "server/test/collab-chat.test.js" "server/test/collab-http.test.js"`
Expected: PASS

- [ ] **Step 7: 全量后端回归**

Run: `npm.cmd run test:server`
Expected: 全绿（原 334 减去删除的用例数）。

- [ ] **Step 8: 提交**

```
git add server/collaboration/store.js server/collaboration/engine.js server/collaboration/http-mount.js server/test/collab-store.test.js server/test/collab-chat.test.js server/test/collab-http.test.js
git commit -m "refactor(collab): 删除本机免确认命令白名单（远程命令一律待确认）"
```

---

### Task 2: 前端移除白名单 + master 列表移到底部折叠

**Files:**
- Modify: `web/src/collaboration/useCollab.ts`
- Modify: `web/src/collaboration/GroupView.vue`
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

- [ ] **Step 1: 改 `useCollab.ts`**

删除 `const allowlistState = ref<string[]>([]);`；删除：

```ts
  async function loadAllowlist() {
    const r = await http<{ allowlist: string[] }>('/api/collab/allowlist');
    allowlistState.value = r.allowlist;
    return r.allowlist;
  }
  async function addAllow(prefix: string) { await post('/api/collab/allowlist', { prefix }); return loadAllowlist(); }
  async function removeAllow(prefix: string) { await http(`/api/collab/allowlist/${encodeURIComponent(prefix)}`, { method: 'DELETE' }); return loadAllowlist(); }
```

返回对象：把

```ts
    chatState, pendingCmdState, allowlistState,
    chat, sendChat, sendCmd, pullChat, loadPendingCmds, approveCmd,
    loadAllowlist, addAllow, removeAllow, handleS2C,
```

改为

```ts
    chatState, pendingCmdState,
    chat, sendChat, sendCmd, pullChat, loadPendingCmds, approveCmd,
    handleS2C,
```

- [ ] **Step 2: 改 `GroupView.vue` script**

删除：

```ts
// —— 命令白名单 ——
const newPrefix = ref('');
const myAllow = computed(() => props.collab.allowlistState.value);
async function addAllowPrefix() { if (newPrefix.value.trim()) { await props.collab.addAllow(newPrefix.value.trim()); newPrefix.value = ''; } }
async function delAllowPrefix(p: string) { await props.collab.removeAllow(p); }
```

`onMounted` 中删除 `await props.collab.loadAllowlist().catch(() => {});`。

- [ ] **Step 3: 改 `GroupView.vue` 模板**

删除白名单区块：

```html
      <div class="sec allow">
        <h4>{{ $t('collab.allow.title') }}</h4>
        <div class="addrow">
          <input v-model="newPrefix" :placeholder="$t('collab.allow.placeholder')" @keyup.enter="addAllowPrefix" />
          <button @click="addAllowPrefix">＋</button>
        </div>
        <div v-if="myAllow.length === 0" class="empty">{{ $t('collab.allow.empty') }}</div>
        <div v-for="p in myAllow" :key="p" class="rowline">
          <span class="txt"><code>{{ p }}</code></span>
          <button class="ghost del" @click="delAllowPrefix(p)">{{ $t('common.delete') }}</button>
        </div>
      </div>
```

删除原「共享目录（master）」区块（从 `<div class="sec">` 到其闭合）：

```html
      <div class="sec">
        <h4>{{ $t('collab.downloads.title') }}</h4>
        <div class="addrow">
          <button @click="syncMaster">{{ $t('collab.downloads.sync') }}</button>
        </div>
        <div v-if="dlMsg" class="err">{{ dlMsg }}</div>
        <div v-if="installMsg" class="cfghint">{{ installMsg }}</div>
        <div v-if="downloads.manifest.files.length === 0" class="empty">{{ $t('collab.downloads.empty') }}</div>
        <div v-for="f in downloads.manifest.files" :key="f.name" class="rowline">
          <span class="txt">{{ f.name }}</span>
          <template v-if="f.kind === 'skill'">
            <a class="dl" :href="`/api/collab/downloads/file/${encodeURIComponent(f.name)}`" download>{{ $t('collab.downloads.download') }}</a>
            <button class="ghost" @click="install(f.name)">{{ $t('collab.downloads.install') }}</button>
          </template>
        </div>
      </div>
```

在「成员」区块（`{{ $t('collab.member.title', ...) }}` 所在 `<div class="sec">`）之后、`</aside>` 之前，插入折叠版：

```html
      <details class="sec fold">
        <summary>{{ $t('collab.downloads.title') }}</summary>
        <div class="addrow">
          <button @click="syncMaster">{{ $t('collab.downloads.sync') }}</button>
        </div>
        <div v-if="dlMsg" class="err">{{ dlMsg }}</div>
        <div v-if="installMsg" class="cfghint">{{ installMsg }}</div>
        <div v-if="downloads.manifest.files.length === 0" class="empty">{{ $t('collab.downloads.empty') }}</div>
        <div v-for="f in downloads.manifest.files" :key="f.name" class="rowline">
          <span class="txt">{{ f.name }}</span>
          <template v-if="f.kind === 'skill'">
            <a class="dl" :href="`/api/collab/downloads/file/${encodeURIComponent(f.name)}`" download>{{ $t('collab.downloads.download') }}</a>
            <button class="ghost" @click="install(f.name)">{{ $t('collab.downloads.install') }}</button>
          </template>
        </div>
      </details>
```

- [ ] **Step 4: 追加折叠样式**

在 `GroupView.vue` `<style scoped>` 末尾追加：

```css
details.fold > summary { cursor: pointer; color: var(--tx2); text-transform: uppercase; font-size: 11px; margin: 14px 0 6px; list-style: none; }
details.fold > summary::-webkit-details-marker { display: none; }
details.fold > summary::before { content: '▸ '; }
details.fold[open] > summary::before { content: '▾ '; }
```

- [ ] **Step 5: i18n 删词条**

`shared/i18n/zh-CN.js` 删除：

```js
  'collab.allow.title': '本机免确认命令（白名单）',
  'collab.allow.placeholder': '如 deploy / git status',
  'collab.allow.empty': '无，收到的远程执行都会要求确认',
```

`shared/i18n/en.js` 删除：

```js
  'collab.allow.title': 'Auto-approved local commands (allowlist)',
  'collab.allow.placeholder': 'e.g. deploy / git status',
  'collab.allow.empty': 'None. Incoming remote commands will require confirmation',
```

- [ ] **Step 6: 类型 + i18n**

Run: `npm.cmd run typecheck`
Run: `npm.cmd run check:i18n`
Expected: 均通过。

- [ ] **Step 7: 提交**

```
git add web/src/collaboration/useCollab.ts web/src/collaboration/GroupView.vue shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(web): 协作页移除白名单并把 master 文件列表折叠到底部"
```

---

### Task 3: 全量验证

- [ ] **Step 1:** `npm.cmd run test:server` → 全绿。
- [ ] **Step 2:** `npm.cmd run test:web` → 全绿。
- [ ] **Step 3:** `npm.cmd run typecheck` → 无错误。
- [ ] **Step 4:** `npm.cmd run check:i18n` → 零命中。
- [ ] **Step 5:** `npm.cmd run build:web` → 构建成功。
- [ ] **Step 6: 人工验收**：协作页左栏不再有「本机免确认命令」；「共享目录（master）」在最底部且默认收起，点击展开可见列表与同步按钮；他人发来的远程命令一律进入待确认。

---

### Task 4: 终端输入框空白发送 `ok`

**Files:**
- Modify: `web/src/components/TerminalView.vue`

- [ ] **Step 1: 改 `submitComposer()`**（`TerminalView.vue:436-443`）替换为：

```js
function submitComposer() {
  const text = composerText.value.trim() || 'ok';
  composerText.value = '';
  const sid = props.terminal.state.activeSessionId;
  void msgHistory.push(text, sid ? { sessionId: sid, tabName: tabLabel(sid) } : {});
  sendToActive(text);
}
```

> 变量由 `t` 改为 `text`，避免遮蔽 i18n 的 `t` 导入。空白时自动改为 `ok`。

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过。

- [ ] **Step 3: 提交**

```
git add web/src/components/TerminalView.vue
git commit -m "feat(web): 终端输入框空白时自动以 ok 发送"
```

---

## 自查记录

- **Spec 覆盖**：§2.1 → Task 1；§2.2/§2.3 → Task 2；§3 → Task 1/3。
- **占位符扫描**：无 TBD。
- **一致性**：`useCollab` 返回类型自动由 `ReturnType` 推导，删除方法后 `GroupView` 不再引用；`collab.allow.*` 词条删除后无模板引用。
