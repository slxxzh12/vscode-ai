# token 下载安装包（opencode.json + Install.bat）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** token 展开行内按当前 provider+模型下载 zip；解压双击 Install.bat 把 opencode.json 覆盖到 `%USERPROFILE%\.config\opencode`（旧文件备份 .bak）。

**Architecture:** 服务端复用 `collaboration/zip.js` 的 `buildZip` 打包 `opencode.json` 与 `Install.bat`，新接口 `/api/llm-admin/opencode-bundle` 直出 zip；前端展开行加下载链接。

**Tech Stack:** Node ESM、`node:test`、Vue3+TS、i18n 中英对称。

**Spec:** `docs/superpowers/specs/2026-09-12-relay-plugins-cache-design.md`（§19）

**约定:** 仓库根执行；`npm.cmd`；每 Task 一提交。

---

### Task 1: 服务端打包接口

**Files:**
- Modify: `server/llm-mount.js`
- Test: `server/test/llm-mount.test.js`

- [ ] **Step 1: 追加失败测试** — `server/test/llm-mount.test.js`：

顶部 import 增加：

```js
import { readZip } from '../collaboration/zip.js';
```

末尾追加：

```js
function getBuffer(server, url) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: url }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('opencode-bundle 返回含 opencode.json 与 Install.bat 的 zip', async (t) => {
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

  await jpost(server, '/api/llm-admin/secret', { secret: 'S' });
  const tok = JSON.parse((await jpost(server, '/api/llm-admin/tokens', { employeeId: 'E1', days: 1 })).body).token;

  const r = await getBuffer(server, `/api/llm-admin/opencode-bundle?provider=corp&token=${tok.id}&models=a`);
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'application/zip');
  const entries = readZip(r.body);
  const names = entries.map((e) => e.name).sort();
  assert.deepEqual(names, ['Install.bat', 'opencode.json']);
  const cfg = JSON.parse(entries.find((e) => e.name === 'opencode.json').data.toString('utf8'));
  assert.deepEqual(Object.keys(cfg.provider['devflow-corp'].models), ['a']);
  const bat = entries.find((e) => e.name === 'Install.bat').data.toString('utf8');
  assert.match(bat, /\.config\\opencode/);
  assert.match(bat, /opencode\.json\.bak/);

  assert.equal((await getBuffer(server, `/api/llm-admin/opencode-bundle?provider=corp&token=nope`)).status, 404);
  assert.equal((await getBuffer(server, `/api/llm-admin/opencode-bundle?provider=nope&token=${tok.id}`)).status, 404);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: FAIL（`/opencode-bundle` 返回 404 not found）

- [ ] **Step 3: 实现** — `server/llm-mount.js`

顶部 import 增加：

```js
import { buildZip } from './collaboration/zip.js';
```

文件内 `sendJson` 之后新增常量与 helper：

```js
const INSTALL_BAT = [
  '@echo off',
  'setlocal',
  'set "DEST=%USERPROFILE%\\.config\\opencode"',
  'if not exist "%DEST%" mkdir "%DEST%"',
  'if exist "%DEST%\\opencode.json" copy /Y "%DEST%\\opencode.json" "%DEST%\\opencode.json.bak" >nul',
  'copy /Y "%~dp0opencode.json" "%DEST%\\opencode.json" >nul',
  'echo DevFlow opencode.json installed:',
  'echo   %DEST%\\opencode.json',
  'pause',
  '',
].join('\r\n');

function pickModels(available, asked) {
  if (!asked.length) return available;
  const filtered = available.filter((m) => asked.includes(m));
  return filtered.length ? filtered : asked;
}
```

`opencode-config` 分支内删除原 `let models...` 逻辑，改为：

```js
        const models = pickModels(p.models, asked);
```

并在其前保留 `asked` 计算（若该分支已有则复用）。

新增 bundle 分支（放在 `opencode-config` 之后）：

```js
      if (seg[0] === 'opencode-bundle' && method === 'GET') {
        const providerId = url.searchParams.get('provider') || '';
        const tokenId = url.searchParams.get('token') || '';
        const asked = url.searchParams.getAll('models').flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);
        const d = vault.getData();
        const rec = d.tokens.find((t) => t.id === tokenId);
        if (!rec) return sendJson(res, 404, { error: 'token not found' });
        const p = getProvider(providerId);
        if (!p || !p.baseURL) return sendJson(res, 404, { error: 'provider not found' });
        const config = JSON.stringify(buildOpencodeConfig({ host, port, providerId, baseURL: p.baseURL, token: rec.jwt, models: pickModels(p.models, asked) }), null, 2);
        const zip = buildZip([
          { name: 'opencode.json', data: Buffer.from(config, 'utf8') },
          { name: 'Install.bat', data: Buffer.from(INSTALL_BAT, 'utf8') },
        ]);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="devflow-opencode-${encodeURIComponent(providerId)}.zip"`,
          'Content-Length': zip.length,
        });
        return res.end(zip);
      }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```
git add server/llm-mount.js server/test/llm-mount.test.js
git commit -m "feat(server): 下载 opencode.json+Install.bat 安装包接口"
```

---

### Task 2: 前端下载入口

**Files:**
- Modify: `web/src/components/ProxyView.vue`
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

- [ ] **Step 1: 改 `ProxyView.vue` script**

在 `genConfig` 附近新增：

```ts
function bundleUrl(tk: LlmToken) {
  const p = providerById(rowProvider.value);
  const models = p && p.models.length ? rowModels.value : rowManual.value.split(',').map((s) => s.trim()).filter(Boolean);
  const q = new URLSearchParams({ provider: rowProvider.value, token: tk.id });
  for (const m of models) q.append('models', m);
  return `/api/llm-admin/opencode-bundle?${q.toString()}`;
}
```

- [ ] **Step 2: 改 `ProxyView.vue` 模板展开行**

在展开行「生成/复制」按钮行尾追加下载链接：

```html
            <a class="dlbtn" :href="bundleUrl(tk)" download>{{ $t('llm.config.download') }}</a>
```

并在该行之后、`<pre>` 之前加提示：

```html
          <div class="muted">{{ $t('llm.config.download_hint') }}</div>
```

- [ ] **Step 3: 加样式**

在 `<style scoped>` 末尾追加：

```css
.dlbtn { display: inline-flex; align-items: center; background: var(--ac); color: var(--onac); border: 1px solid var(--ac); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-family: inherit; text-decoration: none; font-size: 13px; }
```

- [ ] **Step 4: 加 i18n 词条**

`shared/i18n/zh-CN.js` 在 `llm.config.manual` 之后插入：

```js
  'llm.config.download': '下载安装包',
  'llm.config.download_hint': '压缩包含 opencode.json 与 Install.bat：解压后双击 Install.bat，会把 opencode.json 覆盖到 %USERPROFILE%\\.config\\opencode（旧文件备份为 opencode.json.bak）。',
```

`shared/i18n/en.js` 在 `llm.config.manual` 之后插入：

```js
  'llm.config.download': 'Download bundle',
  'llm.config.download_hint': 'The zip contains opencode.json and Install.bat. Unzip and double-click Install.bat to copy opencode.json to %USERPROFILE%\\.config\\opencode (existing file backed up as opencode.json.bak).',
```

- [ ] **Step 5: 类型 + i18n**

Run: `npm.cmd run typecheck`
Run: `npm.cmd run check:i18n`
Expected: 均通过。

- [ ] **Step 6: 提交**

```
git add web/src/components/ProxyView.vue shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(web): token 展开行下载安装包"
```

---

### Task 3: 全量验证

- [ ] **Step 1:** `npm.cmd run test:server` → 全绿。
- [ ] **Step 2:** `npm.cmd run test:web` → 全绿。
- [ ] **Step 3:** `npm.cmd run typecheck` → 无错误。
- [ ] **Step 4:** `npm.cmd run check:i18n` → 零命中。
- [ ] **Step 5:** `npm.cmd run build:web` → 构建成功。
- [ ] **Step 6: 人工验收**：展开 token → 选 provider/模型 → 下载 zip → 解压见 `opencode.json` + `Install.bat` → 双击 `Install.bat` 覆盖到 `%USERPROFILE%\.config\opencode\opencode.json` 且生成 `.bak`。

---

## 自查记录

- **Spec 覆盖**：§19.1 → Task 1；§19.2 → Task 2；§19.3 → Task 1/3。
- **占位符扫描**：无 TBD。
- **一致性**：`pickModels` 同时服务 `opencode-config` 与 `opencode-bundle`；`bundleUrl` 的 `models` 参数与接口 `getAll('models')` 对齐。
- **编码**：`INSTALL_BAT` 纯 ASCII（避免批处理代码页乱码与 i18n 命中）。
