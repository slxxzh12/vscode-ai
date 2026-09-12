# token 测试示例（curl 流式/非流式 + 一键 bat）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** token 展开行展示流式/非流式 curl 示例；点「测试」写 `.bat`、在文件预览打开并弹控制台执行。

**Architecture:** 服务端出 `test-example`（命令文本）与 `test-script`（写临时 bat）；前端展示并调用 `/api/open-file` + `/api/run-script`。

**Tech Stack:** Node ESM、`node:test`、Vue3+TS、i18n 中英对称。

**Spec:** `docs/superpowers/specs/2026-09-12-relay-plugins-cache-design.md`（§21）

**约定:** 仓库根执行；`npm.cmd`；每 Task 一提交。

---

### Task 1: 服务端示例与 bat

**Files:**
- Modify: `server/llm-mount.js`
- Test: `server/test/llm-mount.test.js`

- [ ] **Step 1: 追加失败测试** — `server/test/llm-mount.test.js` 末尾追加：

```js
test('test-example 返回流式/非流式 curl；test-script 写 bat', async (t) => {
  const oc = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  fs.writeFileSync(path.join(oc, 'opencode.json'), JSON.stringify({
    provider: { corp: { options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: { a: {}, b: {} } } },
  }));
  const prev = process.env.DEVFLOW_OPENCODE_CONFIG;
  process.env.DEVFLOW_OPENCODE_CONFIG = oc;
  const prevHome = process.env.DEVFLOW_DATA_HOME;
  process.env.DEVFLOW_DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dfhome-'));
  t.after(() => {
    if (prev === undefined) delete process.env.DEVFLOW_OPENCODE_CONFIG; else process.env.DEVFLOW_OPENCODE_CONFIG = prev;
    if (prevHome === undefined) delete process.env.DEVFLOW_DATA_HOME; else process.env.DEVFLOW_DATA_HOME = prevHome;
  });

  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234 });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());
  await jpost(server, '/api/llm-admin/secret', { secret: 'S' });
  const tok = JSON.parse((await jpost(server, '/api/llm-admin/tokens', { employeeId: 'E1', days: 1 })).body).token;

  const ex = JSON.parse((await jget(server, `/api/llm-admin/test-example?token=${tok.id}&pid=corp&model=a`)).body);
  assert.match(ex.nonStream, /chat\/completions/);
  assert.match(ex.nonStream, /Authorization: Bearer/);
  assert.match(ex.stream, /"stream":true/);

  const r = await jpost(server, '/api/llm-admin/test-script', { token: tok.id, pid: 'corp', model: 'a', stream: true });
  assert.equal(r.status, 200);
  const p = JSON.parse(r.body).path;
  assert.ok(fs.existsSync(p));
  const bat = fs.readFileSync(p, 'utf8');
  assert.match(bat, /curl/);
  assert.match(bat, /pause/);

  assert.equal((await jget(server, '/api/llm-admin/test-example?token=nope&pid=corp&model=a')).status, 404);
  assert.equal((await jget(server, `/api/llm-admin/test-example?token=${tok.id}&pid=nope&model=a`)).status, 404);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: FAIL（接口 404）

- [ ] **Step 3: 实现** — `server/llm-mount.js`

顶部 import 增加：

```js
import path from 'node:path';
import { downloadsDir } from './data-home.js';
```

`pickModels`/`selectionsToProviders` 之后新增：

```js
function relayUrl(host, port, pid, suffix = '/chat/completions') {
  return `http://${host}:${port}/api/llm/${encodeURIComponent(pid)}${suffix}`;
}

function curlCommand({ host, port, pid, jwt, model, stream }) {
  const url = relayUrl(host, port, pid);
  const payload = JSON.stringify(stream
    ? { model, messages: [{ role: 'user', content: 'hi' }], stream: true }
    : { model, messages: [{ role: 'user', content: 'hi' }] });
  return `curl ${stream ? '-N -s' : '-s'} "${url}" -H "Authorization: Bearer ${jwt}" -H "Content-Type: application/json" -d '${payload}'`;
}

function buildTestBat({ host, port, pid, jwt, model, stream }) {
  const url = relayUrl(host, port, pid);
  const payload = JSON.stringify(stream
    ? { model, messages: [{ role: 'user', content: 'hi' }], stream: true }
    : { model, messages: [{ role: 'user', content: 'hi' }] });
  return [
    '@echo off',
    'setlocal',
    `set "URL=${url}"`,
    `set "TOKEN=${jwt}"`,
    `>"%TEMP%\\devflow-payload.json" echo ${payload}`,
    `curl ${stream ? '-N ' : ''}-s "%URL%" -H "Authorization: Bearer %TOKEN%" -H "Content-Type: application/json" -d @"%TEMP%\\devflow-payload.json"`,
    'echo.',
    'pause',
    '',
  ].join('\r\n');
}
```

在 `opencode-bundle` 分支之后（`return sendJson(res, 404...)` 之前）新增：

```js
      if (seg[0] === 'test-example' && method === 'GET') {
        const tokenId = url.searchParams.get('token') || '';
        const pid = url.searchParams.get('pid') || '';
        const model = url.searchParams.get('model') || '';
        const rec = vault.getData().tokens.find((t) => t.id === tokenId);
        if (!rec) return sendJson(res, 404, { error: 'token not found' });
        const p = getProvider(pid);
        if (!p || !p.baseURL) return sendJson(res, 404, { error: 'provider not found' });
        const m = model || p.models[0] || '';
        return sendJson(res, 200, {
          nonStream: curlCommand({ host, port, pid, jwt: rec.jwt, model: m, stream: false }),
          stream: curlCommand({ host, port, pid, jwt: rec.jwt, model: m, stream: true }),
        });
      }
      if (seg[0] === 'test-script' && method === 'POST') {
        const b = await readJson(req);
        const rec = vault.getData().tokens.find((t) => t.id === String(b.token || ''));
        if (!rec) return sendJson(res, 404, { error: 'token not found' });
        const pid = String(b.pid || '');
        const p = getProvider(pid);
        if (!p || !p.baseURL) return sendJson(res, 404, { error: 'provider not found' });
        const stream = !!b.stream;
        const model = String(b.model || '') || p.models[0] || '';
        const bat = buildTestBat({ host, port, pid, jwt: rec.jwt, model, stream });
        const dir = path.join(downloadsDir(), 'relay-tests');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `test-${pid}-${stream ? 'stream' : 'plain'}.bat`);
        fs.writeFileSync(file, bat, 'utf8');
        return sendJson(res, 200, { path: file });
      }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```
git add server/llm-mount.js server/test/llm-mount.test.js
git commit -m "feat(server): 中转 token 测试示例与一键 bat"
```

---

### Task 2: 前端示例与执行

**Files:**
- Modify: `web/src/components/ProxyView.vue`
- Modify: `web/src/App.vue`
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

- [ ] **Step 1: 改 `ProxyView.vue` script**

import 增加 `watch`：

```ts
import { ref, onMounted, watch } from 'vue';
```

在 `<script setup>` 顶部加 emit：

```ts
const emit = defineEmits<{ (e: 'open-file', projectId: string, rel: string): void }>();
```

在 `bundleUrl` 之后新增：

```ts
const examples = ref<{ nonStream: string; stream: string } | null>(null);
function primarySel() {
  const s = selectedProviders()[0];
  return s ? { id: s.id, model: s.models[0] } : null;
}
async function loadExamples(tk: LlmToken) {
  examples.value = null;
  const p = primarySel();
  if (!p) return;
  const q = new URLSearchParams({ token: tk.id, pid: p.id, model: p.model });
  try { examples.value = await fetch(`/api/llm-admin/test-example?${q}`).then((x) => x.json()); } catch { /* ignore */ }
}
async function runTest(tk: LlmToken, stream: boolean) {
  err.value = '';
  const p = primarySel();
  if (!p) { err.value = t('llm.test.need_selection'); return; }
  try {
    const r = await fetch('/api/llm-admin/test-script', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tk.id, pid: p.id, model: p.model, stream }),
    }).then((x) => x.json());
    if (!r.path) throw new Error(r.error || 'test-script failed');
    const o = await fetch('/api/open-file', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: r.path }),
    }).then((x) => x.json());
    if (!o.project?.id) throw new Error(o.error || 'open-file failed');
    emit('open-file', o.project.id, o.rel);
    await fetch(`/api/run-script?project=${encodeURIComponent(o.project.id)}&path=${encodeURIComponent(o.rel)}`, { method: 'POST' });
  } catch (e: any) {
    err.value = t('llm.failed', { msg: e?.message || e });
  }
}
watch(() => rowKeys.value.join('|'), () => {
  const tk = tokens.value.find((x) => x.id === expanded.value);
  if (expanded.value && tk) loadExamples(tk);
});
```

`toggleToken` 末尾追加：

```ts
  loadExamples(tk);
```

- [ ] **Step 2: 改 `ProxyView.vue` 模板**

在 provider 分组 `v-for` 之后、`download_hint` 之前插入：

```html
          <div v-if="examples" class="tests">
            <div class="tlabel">{{ $t('llm.test.non_stream') }}</div>
            <pre class="cfg">{{ examples.nonStream }}</pre>
            <button class="ghost" @click="runTest(tk, false)">{{ $t('llm.test.run') }}</button>
            <div class="tlabel">{{ $t('llm.test.stream') }}</div>
            <pre class="cfg">{{ examples.stream }}</pre>
            <button class="ghost" @click="runTest(tk, true)">{{ $t('llm.test.run') }}</button>
          </div>
          <div v-else-if="!selectedProviders().length" class="muted">{{ $t('llm.test.need_selection') }}</div>
```

样式追加：

```css
.tests { display: flex; flex-direction: column; gap: 4px; }
.tlabel { color: var(--tx3); font-size: 12px; margin-top: 4px; }
```

- [ ] **Step 3: 改 `App.vue`**

模板 `rail === 'proxy'` 分支改为：

```html
      <template v-else-if="rail === 'proxy'">
        <section class="center">
          <ProxyView @open-file="onProxyOpenFile" />
        </section>
      </template>
```

script 中 `openFile` 附近新增：

```ts
function onProxyOpenFile(projectId: string, rel: string) {
  rail.value = 'explorer';
  openFile(projectId, rel);
}
```

- [ ] **Step 4: 加 i18n**

`shared/i18n/zh-CN.js` 在 `llm.config.download_hint` 之后插入：

```js
  'llm.test.non_stream': '非流式示例',
  'llm.test.stream': '流式示例',
  'llm.test.run': '测试',
  'llm.test.need_selection': '请先勾选至少一个模型',
```

`shared/i18n/en.js`：

```js
  'llm.test.non_stream': 'Non-streaming example',
  'llm.test.stream': 'Streaming example',
  'llm.test.run': 'Test',
  'llm.test.need_selection': 'Select at least one model first',
```

- [ ] **Step 5: 类型 + i18n**

Run: `npm.cmd run typecheck`
Run: `npm.cmd run check:i18n`
Expected: 均通过。

- [ ] **Step 6: 提交**

```
git add web/src/components/ProxyView.vue web/src/App.vue shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(web): token 流式/非流式测试示例与一键执行"
```

---

### Task 3: 全量验证

- [ ] **Step 1:** `npm.cmd run test:server` → 全绿。
- [ ] **Step 2:** `npm.cmd run test:web` → 全绿。
- [ ] **Step 3:** `npm.cmd run typecheck` → 无错误。
- [ ] **Step 4:** `npm.cmd run check:i18n` → 零命中。
- [ ] **Step 5:** `npm.cmd run build:web` → 构建成功。
- [ ] **Step 6: 人工验收**：展开 token（有勾选）→ 显示两段 curl 示例；点「测试」→ 生成 bat、切到目录页打开该 bat、弹出控制台执行并看到响应；无勾选时提示先选模型。

---

## 自查记录

- **Spec 覆盖**：§21.1 → Task 1；§21.2 → Task 2；§21.3 → Task 1/3。
- **占位符扫描**：无 TBD。
- **一致性**：`test-example` 与 `test-script` 共用 `relayUrl`/payload 规则；`primarySel` 与 `selectedProviders` 对齐。
- **编码**：bat 纯 ASCII、CRLF；JWT 为 base64url（无 cmd 特殊字符）。
