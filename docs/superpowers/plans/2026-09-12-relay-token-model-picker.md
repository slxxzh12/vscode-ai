# Token 列表展开式模型筛选 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** token 列表改为可展开行；点行内选 provider + 勾模型，生成只含所选模型的 `opencode.json`。

**Architecture:** 服务端 `opencode-config` 接口加可选 `models` 过滤；前端把 token 列表改为展开式，行内选 provider/模型并生成，移除原独立生成区。

**Tech Stack:** Node ESM、`node:test`、Vue3+TS、i18n 中英对称。

**Spec:** `docs/superpowers/specs/2026-09-12-relay-plugins-cache-design.md`（§17）

**约定:** 仓库根执行；`npm.cmd`；每 Task 一提交。

---

### Task 1: 服务端 models 过滤 `server/llm-mount.js`

**Files:**
- Modify: `server/llm-mount.js`
- Test: `server/test/llm-mount.test.js`

- [ ] **Step 1: 追加失败测试** — `server/test/llm-mount.test.js` 末尾追加：

```js
test('opencode-config 支持 models 过滤（未提供则全量）', async (t) => {
  const oc = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  fs.writeFileSync(path.join(oc, 'opencode.json'), JSON.stringify({
    provider: { corp: { options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: { a: {}, b: {}, c: {} } } },
  }));
  const prev = process.env.DEVFLOW_OPENCODE_CONFIG;
  process.env.DEVFLOW_OPENCODE_CONFIG = oc;
  t.after(() => { if (prev === undefined) delete process.env.DEVFLOW_OPENCODE_CONFIG; else process.env.DEVFLOW_OPENCODE_CONFIG = prev; });

  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234 });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());

  const tok = JSON.parse((await jpost(server, '/api/llm-admin/tokens', { employeeId: 'E1', days: 1 })).body).token;

  const filtered = JSON.parse((await jget(server, `/api/llm-admin/opencode-config?provider=corp&token=${tok.id}&models=a&models=c`)).body);
  assert.deepEqual(Object.keys(JSON.parse(filtered.config).provider['devflow-corp'].models), ['a', 'c']);

  const all = JSON.parse((await jget(server, `/api/llm-admin/opencode-config?provider=corp&token=${tok.id}`)).body);
  assert.deepEqual(Object.keys(JSON.parse(all.config).provider['devflow-corp'].models), ['a', 'b', 'c']);

  const manual = JSON.parse((await jget(server, `/api/llm-admin/opencode-config?provider=corp&token=${tok.id}&models=x,y`)).body);
  assert.deepEqual(Object.keys(JSON.parse(manual.config).provider['devflow-corp'].models), ['x', 'y']);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: FAIL（`models` 过滤未生效：过滤请求仍含 a/b/c）

- [ ] **Step 3: 实现** — `server/llm-mount.js` 的 `opencode-config` 分支替换为：

```js
      if (seg[0] === 'opencode-config' && method === 'GET') {
        const providerId = url.searchParams.get('provider') || '';
        const tokenId = url.searchParams.get('token') || '';
        const asked = url.searchParams.getAll('models').flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);
        const d = vault.getData();
        const rec = d.tokens.find((t) => t.id === tokenId);
        if (!rec) return sendJson(res, 404, { error: 'token not found' });
        const p = getProvider(providerId);
        if (!p || !p.baseURL) return sendJson(res, 404, { error: 'provider not found' });
        let models = p.models;
        if (asked.length) {
          const filtered = p.models.filter((m) => asked.includes(m));
          models = filtered.length ? filtered : asked;
        }
        const config = JSON.stringify(buildOpencodeConfig({ host, port, providerId, baseURL: p.baseURL, token: rec.jwt, models }), null, 2);
        return sendJson(res, 200, { config });
      }
```

> 说明：`opencode-config` 在 `locked()` 之后，测试需先 `vault.init('pw')`（已解锁）。`startMount`/`tmpVault`/`jpost`/`jget` 为测试文件既有 helper。

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```
git add server/llm-mount.js server/test/llm-mount.test.js
git commit -m "feat(server): opencode-config 支持按 models 过滤"
```

---

### Task 2: 前端 token 展开式生成 `ProxyView.vue` / `useLlm.ts` / i18n

**Files:**
- Modify: `web/src/useLlm.ts`
- Modify: `web/src/components/ProxyView.vue`
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

- [ ] **Step 1: 改 `useLlm.ts` 的 `config` 签名**

```ts
    config: (provider: string, token: string, models?: string[]) => {
      const q = new URLSearchParams({ provider, token });
      for (const m of models || []) q.append('models', m);
      return json<{ config: string }>(`/api/llm-admin/opencode-config?${q.toString()}`);
    },
```

- [ ] **Step 2: 改 `ProxyView.vue` script**

删除 `const cfgProvider = ref('');`、`const cfgToken = ref('');` 两行，替换为：

```ts
const expanded = ref<string | null>(null);
const rowProvider = ref('');
const rowModels = ref<string[]>([]);
const rowManual = ref('');
const providerById = (id: string) => st.value?.providers.find((p) => p.id === id) || null;
function toggleToken(tk: LlmToken) {
  if (expanded.value === tk.id) { expanded.value = null; return; }
  expanded.value = tk.id;
  rowProvider.value = st.value?.defaultProvider || st.value?.providers[0]?.id || '';
  rowModels.value = (providerById(rowProvider.value)?.models || []).slice();
  rowManual.value = '';
  configText.value = '';
}
function onProviderChange() {
  rowModels.value = (providerById(rowProvider.value)?.models || []).slice();
}
```

删除既有 `async function genConfig() {...}`，替换为：

```ts
async function genConfig(tk: LlmToken) {
  await run(async () => {
    const p = providerById(rowProvider.value);
    const models = p && p.models.length ? rowModels.value : rowManual.value.split(',').map((s) => s.trim()).filter(Boolean);
    const r = await api.config(rowProvider.value, tk.id, models);
    configText.value = r.config;
  });
}
```

> `refresh()` 里删除 `if (... ) cfgProvider.value = ...` 那一行（`cfgProvider` 已移除）。

- [ ] **Step 3: 改 `ProxyView.vue` 模板**

把 token `<section>` 与紧随其后的 config `<section>`（两个 section）整体替换为：

```html
    <section v-if="st?.vault.unlocked" class="card">
      <div class="ch">{{ $t('llm.token.title') }}</div>
      <div class="row">
        <input v-model="employeeId" :placeholder="$t('llm.token.employee')" />
        <input v-model.number="days" type="number" min="1" class="days" :placeholder="$t('llm.token.days')" />
        <button @click="issue">{{ $t('llm.token.issue') }}</button>
      </div>
      <div v-if="!tokens.length" class="muted">{{ $t('llm.token.none') }}</div>
      <div v-for="tk in tokens" :key="tk.id" class="tok">
        <div class="trow trow-click" @click="toggleToken(tk)">
          <b>{{ tk.employeeId }}</b>
          <span class="muted">{{ new Date(tk.exp * 1000).toLocaleDateString() }}{{ tk.revoked ? ' · ' + $t('llm.token.revoked') : '' }}</span>
          <button class="ghost" :disabled="tk.revoked" @click.stop="revoke(tk.id)">×</button>
        </div>
        <div v-if="expanded === tk.id" class="tok-body">
          <div class="row">
            <select v-model="rowProvider" @change="onProviderChange">
              <option v-for="p in st?.providers || []" :key="p.id" :value="p.id">{{ p.id }}</option>
            </select>
            <button @click="genConfig(tk)">{{ $t('llm.config.generate') }}</button>
            <button :disabled="!configText" @click="copyConfig">{{ copied ? $t('llm.config.copied') : $t('llm.config.copy') }}</button>
          </div>
          <div v-if="(providerById(rowProvider)?.models || []).length" class="models">
            <span class="muted">{{ $t('llm.config.models') }}</span>
            <label v-for="m in providerById(rowProvider)?.models || []" :key="m" class="mchk">
              <input type="checkbox" :value="m" v-model="rowModels" /> {{ m }}
            </label>
            <button class="ghost" @click="rowModels = (providerById(rowProvider)?.models || []).slice()">{{ $t('llm.config.all') }}</button>
            <button class="ghost" @click="rowModels = []">{{ $t('llm.config.none') }}</button>
          </div>
          <div v-else class="row">
            <input v-model="rowManual" :placeholder="$t('llm.config.manual')" />
          </div>
          <pre v-if="configText" class="cfg">{{ configText }}</pre>
        </div>
      </div>
    </section>
```

- [ ] **Step 4: 追加样式**

在 `<style scoped>` 的 `.cfg` 行之前追加：

```css
.tok { border: 1px solid var(--bd); border-radius: 6px; overflow: hidden; }
.trow-click { cursor: pointer; padding: 6px 8px; }
.tok-body { padding: 8px; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--bd); background: var(--bg1); }
.models { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; }
.mchk { display: flex; gap: 4px; align-items: center; color: var(--tx2); }
```

- [ ] **Step 5: 加 i18n 词条**

`shared/i18n/zh-CN.js` 在 `'llm.config.copied'` 之后插入：

```js
  'llm.config.models': '模型',
  'llm.config.all': '全选',
  'llm.config.none': '全不选',
  'llm.config.manual': '手填模型（逗号分隔）',
```

`shared/i18n/en.js` 在 `'llm.config.copied'` 之后插入：

```js
  'llm.config.models': 'Models',
  'llm.config.all': 'All',
  'llm.config.none': 'None',
  'llm.config.manual': 'Model ids (comma-separated)',
```

- [ ] **Step 6: 类型检查 + i18n**

Run: `npm.cmd run typecheck`
Run: `npm.cmd run check:i18n`
Expected: 均通过。

- [ ] **Step 7: 提交**

```
git add web/src/useLlm.ts web/src/components/ProxyView.vue shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(web): token 展开行内筛选模型生成配置"
```

---

### Task 3: 全量验证

- [ ] **Step 1:** `npm.cmd run test:server` → 全绿。
- [ ] **Step 2:** `npm.cmd run test:web` → 全绿。
- [ ] **Step 3:** `npm.cmd run typecheck` → 无错误。
- [ ] **Step 4:** `npm.cmd run check:i18n` → 零命中。
- [ ] **Step 5:** `npm.cmd run build:web` → 构建成功。
- [ ] **Step 6: 人工验收**：解锁 → 签发 token → 点 token 行展开 → 选 provider、取消勾选部分模型 → 生成 → JSON 的 `models` 仅含所选。

---

## 自查记录

- **Spec 覆盖**：§17.1 → Task 1；§17.2 → Task 2；§17.3 → Task 1/3。
- **占位符扫描**：无 TBD；每步含完整代码。
- **类型一致性**：`api.config(provider, token, models?)` 与 `opencode-config` 的重复 `models` 参数对齐；`providerById`/`rowModels`/`rowManual` 在 script 与模板一致。
- **默认行为**：`models` 缺省 → 全量；provider 无模型 → 手填列表原样。
