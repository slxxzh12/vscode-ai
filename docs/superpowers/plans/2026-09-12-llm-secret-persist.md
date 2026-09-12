# JWT 签名密钥一次配置持久复用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 密钥配置一次即保存复用；面板已配置时隐藏输入，更换走「重新生成」二次确认。

**Architecture:** `status` 暴露 `hasSecret`；`POST /secret` 空保存不再覆盖已有密钥；新增 `secret/regenerate` 轮换；前端按 `hasSecret` 切换输入/已配置。

**Tech Stack:** Node ESM、`node:test`、Vue3+TS、i18n 中英对称。

**Spec:** `docs/superpowers/specs/2026-09-12-relay-plugins-cache-design.md`（§18）

**约定:** 仓库根执行；`npm.cmd`；每 Task 一提交。

---

### Task 1: 服务端密钥语义

**Files:**
- Modify: `server/llm-mount.js`
- Test: `server/test/llm-mount.test.js`

- [ ] **Step 1: 追加失败测试** — `server/test/llm-mount.test.js` 末尾追加：

```js
test('签名密钥一次配置后持久、空保存不覆盖、可重新生成', async (t) => {
  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234 });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());

  let st = JSON.parse((await jget(server, '/api/llm-admin/status')).body);
  assert.equal(st.hasSecret, false);

  const r1 = await jpost(server, '/api/llm-admin/secret', {});
  assert.equal(r1.status, 200);
  const first = vault.getData().jwtSecret;
  assert.ok(first);
  assert.equal(JSON.parse(r1.body).changed, true);

  st = JSON.parse((await jget(server, '/api/llm-admin/status')).body);
  assert.equal(st.hasSecret, true);

  const r2 = await jpost(server, '/api/llm-admin/secret', {});
  assert.equal(JSON.parse(r2.body).changed, false);
  assert.equal(vault.getData().jwtSecret, first);

  await jpost(server, '/api/llm-admin/secret', { secret: 'MYKEY' });
  assert.equal(vault.getData().jwtSecret, 'MYKEY');

  const r3 = await jpost(server, '/api/llm-admin/secret/regenerate', {});
  assert.equal(r3.status, 200);
  assert.notEqual(vault.getData().jwtSecret, 'MYKEY');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: FAIL（`hasSecret` undefined；空保存覆盖密钥）

- [ ] **Step 3: 实现** — `server/llm-mount.js`

`status` 分支改为：

```js
      if (seg[0] === 'status' && method === 'GET') {
        const s = vault.status();
        const lp = listProviders();
        const hasSecret = s.unlocked ? !!vault.getData().jwtSecret : false;
        return sendJson(res, 200, { vault: s, enabled: s.unlocked ? !!vault.getData().enabled : false, hasSecret, host, port, defaultProvider: lp.defaultProvider, providers: lp.providers });
      }
```

把原 `secret` 分支替换为以下两段（regenerate 在前）：

```js
      if (seg[0] === 'secret' && seg[1] === 'regenerate' && method === 'POST') {
        const secret = crypto.randomBytes(32).toString('base64url');
        vault.update((d) => { d.jwtSecret = secret; });
        return sendJson(res, 200, { ok: true });
      }
      if (seg[0] === 'secret' && !seg[1] && method === 'POST') {
        const b = await readJson(req);
        if (typeof b.secret === 'string' && b.secret) {
          vault.update((d) => { d.jwtSecret = b.secret; });
          return sendJson(res, 200, { ok: true, changed: true });
        }
        if (vault.getData().jwtSecret) return sendJson(res, 200, { ok: true, changed: false });
        const secret = crypto.randomBytes(32).toString('base64url');
        vault.update((d) => { d.jwtSecret = secret; });
        return sendJson(res, 200, { ok: true, changed: true });
      }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```
git add server/llm-mount.js server/test/llm-mount.test.js
git commit -m "feat(server): JWT 签名密钥一次配置持久、空保存不覆盖、可重生成"
```

---

### Task 2: 前端密钥区

**Files:**
- Modify: `web/src/useLlm.ts`
- Modify: `web/src/components/ProxyView.vue`
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

- [ ] **Step 1: 改 `useLlm.ts`**

`LlmStatus` 增加字段（放在 `enabled` 之后）：

```ts
  hasSecret: boolean;
```

返回对象 `setSecret` 之后新增：

```ts
    regenerateSecret: () => post('/api/llm-admin/secret/regenerate', {}),
```

- [ ] **Step 2: 改 `ProxyView.vue` script**

`saveSecret` 改为成功后清空输入：

```ts
const saveSecret = () => run(async () => { await api.setSecret(secret.value); secret.value = ''; });
```

其后新增：

```ts
async function regenerateSecret() {
  if (!window.confirm(t('llm.secret.regenerate_confirm'))) return;
  await run(() => api.regenerateSecret());
}
```

- [ ] **Step 3: 改 `ProxyView.vue` 模板密钥区**

把密钥 `<section>`（`llm.secret.title`）整段替换为：

```html
    <section v-if="st?.vault.unlocked" class="card">
      <div class="ch">{{ $t('llm.secret.title') }}
        <span class="badge" :class="{ ok: st?.hasSecret }">{{ st?.hasSecret ? $t('llm.secret.configured') : $t('llm.secret.not_set') }}</span>
      </div>
      <div class="muted">{{ $t('llm.secret.hint') }}</div>
      <div v-if="!st?.hasSecret" class="row">
        <input v-model="secret" :placeholder="$t('llm.secret.placeholder')" />
        <button @click="saveSecret">{{ $t('llm.secret.set') }}</button>
      </div>
      <div v-else class="row">
        <button class="danger" @click="regenerateSecret">{{ $t('llm.secret.regenerate') }}</button>
      </div>
    </section>
```

- [ ] **Step 4: 加 i18n 词条**

`shared/i18n/zh-CN.js`：更新 `llm.secret.hint`，并新增：

```js
  'llm.secret.hint': '用于给外部机器签发/校验 JWT 的签名密钥：配置一次即加密保存，后续无需再配；重新生成会使所有已签发 token 失效。留空保存则自动生成。',
  'llm.secret.configured': '已配置',
  'llm.secret.not_set': '未配置',
  'llm.secret.regenerate': '重新生成',
  'llm.secret.regenerate_confirm': '重新生成会更换签名密钥，所有已签发 token 立即失效，需重新签发。确定继续？',
```

`shared/i18n/en.js`：更新 `llm.secret.hint`，并新增：

```js
  'llm.secret.hint': 'JWT signing key for issuing/verifying tokens: it is saved (encrypted) once and reused; regenerating invalidates all issued tokens. Saving empty generates one automatically.',
  'llm.secret.configured': 'Configured',
  'llm.secret.not_set': 'Not set',
  'llm.secret.regenerate': 'Regenerate',
  'llm.secret.regenerate_confirm': 'Regenerating changes the signing key; all issued tokens become invalid and must be re-issued. Continue?',
```

> 注意：两文件的 `llm.secret.hint` 原值需分别替换（zh 原文含「签发后请把生成的 opencode.json 交给使用方」；en 为对应英文）。

- [ ] **Step 5: 类型 + i18n**

Run: `npm.cmd run typecheck`
Run: `npm.cmd run check:i18n`
Expected: 均通过。

- [ ] **Step 6: 提交**

```
git add web/src/useLlm.ts web/src/components/ProxyView.vue shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(web): 密钥一次配置后隐藏输入并可重新生成"
```

---

### Task 3: 全量验证

- [ ] **Step 1:** `npm.cmd run test:server` → 全绿。
- [ ] **Step 2:** `npm.cmd run test:web` → 全绿。
- [ ] **Step 3:** `npm.cmd run typecheck` → 无错误。
- [ ] **Step 4:** `npm.cmd run check:i18n` → 零命中。
- [ ] **Step 5:** `npm.cmd run build:web` → 构建成功。
- [ ] **Step 6: 人工验收**：解锁后密钥区显示「未配置」→ 保存（可空）→ 变「已配置」且输入框消失；签发 token 正常；点「重新生成」二次确认后旧 token 失效。

---

## 自查记录

- **Spec 覆盖**：§18.1 → Task 1；§18.2 → Task 2；§18.3 → Task 1/3。
- **占位符扫描**：无 TBD。
- **一致性**：`LlmStatus.hasSecret` 与 `status` 返回一致；`regenerateSecret` 前端调用与 `secret/regenerate` 路由一致。
- **兼容**：旧测试 `init/secret/token 流程` 中 `/secret {}` 首次仍生成（`changed:true`），签发不受影响。
