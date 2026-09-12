# 重新生成密钥强确认与吊销 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 点「重新生成」必须 prompt 输入 `REGENERATE` 才执行；执行时换密钥并吊销全部已签发 token。

**Architecture:** 服务端 `secret/regenerate` 同时吊销 `tokens`；前端用 `window.prompt` 校验固定词。

**Tech Stack:** Node ESM、`node:test`、Vue3+TS、i18n 中英对称。

**Spec:** `docs/superpowers/specs/2026-09-12-relay-plugins-cache-design.md`（§18.3/§18.4）

**约定:** 仓库根执行；`npm.cmd`；每 Task 一提交。

---

### Task 1: 服务端重生成吊销全部 token

**Files:**
- Modify: `server/llm-mount.js`
- Test: `server/test/llm-mount.test.js`

- [ ] **Step 1: 追加失败测试** — `server/test/llm-mount.test.js` 末尾追加：

```js
test('重新生成会吊销全部已签发 token', async (t) => {
  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234 });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());

  await jpost(server, '/api/llm-admin/secret', { secret: 'S' });
  const tok = JSON.parse((await jpost(server, '/api/llm-admin/tokens', { employeeId: 'E1', days: 1 })).body).token;
  assert.equal(vault.getData().tokens.find((x) => x.id === tok.id).revoked, false);

  const r = await jpost(server, '/api/llm-admin/secret/regenerate', {});
  assert.equal(r.status, 200);
  assert.notEqual(vault.getData().jwtSecret, 'S');
  assert.equal(vault.getData().tokens.every((x) => x.revoked), true);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: FAIL（token 未标记吊销）

- [ ] **Step 3: 实现** — `server/llm-mount.js` 的 regenerate 分支改为：

```js
      if (seg[0] === 'secret' && seg[1] === 'regenerate' && method === 'POST') {
        const secret = crypto.randomBytes(32).toString('base64url');
        vault.update((d) => { d.jwtSecret = secret; for (const t of d.tokens) t.revoked = true; });
        return sendJson(res, 200, { ok: true });
      }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```
git add server/llm-mount.js server/test/llm-mount.test.js
git commit -m "feat(server): 重新生成密钥时吊销全部已签发 token"
```

---

### Task 2: 前端 prompt 强确认

**Files:**
- Modify: `web/src/components/ProxyView.vue`
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

- [ ] **Step 1: 改 `regenerateSecret()`** — `ProxyView.vue`：

```ts
async function regenerateSecret() {
  const word = window.prompt(t('llm.secret.regenerate_prompt'));
  if (word === null) return;
  if (word.trim().toUpperCase() !== 'REGENERATE') { err.value = t('llm.secret.regenerate_mismatch'); return; }
  await run(() => api.regenerateSecret());
}
```

- [ ] **Step 2: 换 i18n 词条**

`shared/i18n/zh-CN.js`：删除 `llm.secret.regenerate_confirm`，新增：

```js
  'llm.secret.regenerate_prompt': '此操作会更换签名密钥并吊销全部已签发 token，且不可恢复。请输入 REGENERATE 确认：',
  'llm.secret.regenerate_mismatch': '确认词不正确，已取消重新生成。',
```

`shared/i18n/en.js`：删除 `llm.secret.regenerate_confirm`，新增：

```js
  'llm.secret.regenerate_prompt': 'This changes the signing key and revokes all issued tokens, irreversibly. Type REGENERATE to confirm:',
  'llm.secret.regenerate_mismatch': 'Confirmation word incorrect; regeneration cancelled.',
```

- [ ] **Step 3: 类型 + i18n**

Run: `npm.cmd run typecheck`
Run: `npm.cmd run check:i18n`
Expected: 均通过。

- [ ] **Step 4: 提交**

```
git add web/src/components/ProxyView.vue shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(web): 重新生成密钥需输入 REGENERATE 强确认"
```

---

### Task 3: 全量验证

- [ ] **Step 1:** `npm.cmd run test:server` → 全绿。
- [ ] **Step 2:** `npm.cmd run test:web` → 全绿。
- [ ] **Step 3:** `npm.cmd run typecheck` → 无错误。
- [ ] **Step 4:** `npm.cmd run check:i18n` → 零命中。
- [ ] **Step 5:** `npm.cmd run build:web` → 构建成功。
- [ ] **Step 6: 人工验收**：已配置密钥时点「重新生成」→ 弹输入框；输错或不输 → 取消并提示；输入 `REGENERATE` → 换新密钥，token 列表全部显示已吊销，旧 token 请求返回 401。

---

## 自查记录

- **Spec 覆盖**：§18.4 → Task 2；§18.3（吊销）→ Task 1。
- **占位符扫描**：无 TBD。
- **一致性**：前端 prompt 固定词 `REGENERATE` 与服务端行为无耦合；i18n 删除 `regenerate_confirm` 后无模板引用。
