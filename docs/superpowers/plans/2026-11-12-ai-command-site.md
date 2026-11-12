# AI 命令执行网站 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, 本会话内执行) to implement this plan task-by-task. 按 `AGENTS.md` 强制要求：**默认 inline 执行，不要用 subagent 驱动**。Steps use checkbox (`- [ ]`) syntax.

**Goal:** 在代理工具「静态网站」左侧新增「AI 命令执行」页签：对外提供一个插件站点，用户按 manifest 填表后触发默认 agent 跑插件 workflow，产物落在临时目录 `output/` 并展示。

**Architecture:** 新增独立模块 `server/ai-site/`（配置、用户、插件扫描、执行器、页面渲染、站点路由、管理 API）。端口模式自建 http server；路径模式由 `server/index.js` 在主服务里优先拦截，避免落入远程访问门禁。鉴权为「用户名 + Token」账号列表（参考 `server/remote-users.js`）。

**Tech Stack:** Node ESM、node:test、Vue 3 + vitest、`resolveAgentBin`/`withAgentEnv`/`wrapCmdBin`、`buildZip`。

---

**执行方式：** 按 `AGENTS.md`，一律 inline（`superpowers:executing-plans`），不要派 subagent。

**测试命令：** `npm.cmd run test:server`、`npm.cmd run test:web`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

---

### Task 1: 端口数据目录增加 ai-site 路径

**Files:**
- Modify: `server/port-paths.js:56-64`
- Test: `server/test/port-paths.test.js`（若不存在则新建；先检查）

- [ ] **Step 1: 检查是否已有 port-paths 测试**

Run: `Test-Path server/test/port-paths.test.js`
Expected: `True` 或 `False`，据此决定「修改已有测试」还是「新建」。

- [ ] **Step 2: 修改 `server/port-paths.js`**

在 `portPaths` 返回对象里、`proxyCapturesDir` 之后加：

```js
    aiSiteDir: path.join(dir, 'ai-site'),
    aiSiteRunsDir: path.join(dir, 'ai-site', 'runs'),
```

把 `ensurePortDirs` 的目录数组末尾加上这两个键：

```js
export function ensurePortDirs(paths) {
  for (const d of [paths.dir, paths.projectsDataDir, paths.schedulerDir, paths.collabDir, paths.statsCacheDir, paths.uploadDir, paths.downloadDir, paths.downloadsDir, paths.workflowsDir, paths.skillsRoot, paths.sessionLogsDir, paths.postmanDir, paths.notepadDir, paths.yamlDir, paths.jsDir, paths.translateDir, paths.markdownDir, paths.navicatDir, paths.proxyDir, paths.proxyCapturesDir, paths.aiSiteDir, paths.aiSiteRunsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
  return paths;
}
```

- [ ] **Step 3: 追加/新建测试**

若新建 `server/test/port-paths.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { portPaths, ensurePortDirs } from '../port-paths.js';

test('portPaths：ai-site 目录按端口隔离', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-portpaths-'));
  const p = portPaths(22222, { root });
  assert.equal(p.aiSiteDir, path.join(root, 'ports', '22222', 'ai-site'));
  assert.equal(p.aiSiteRunsDir, path.join(p.aiSiteDir, 'runs'));
  ensurePortDirs(p);
  assert.equal(fs.statSync(p.aiSiteRunsDir).isDirectory(), true);
});
```

若已有该测试文件，则把上面 `test(...)` 追加进去（import 合并去重）。

- [ ] **Step 4: 运行测试**

Run: `node --test "server/test/port-paths.test.js"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/port-paths.js server/test/port-paths.test.js
git commit -m "feat(ai-site): 端口数据目录增加 ai-site runs 路径"
```

---

### Task 2: 配置存储 `server/ai-site/config-store.js`

**Files:**
- Create: `server/ai-site/config-store.js`
- Test: `server/test/ai-site-config-store.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/ai-site-config-store.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAiSiteConfigStore, normalizeConfig } from '../ai-site/config-store.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-cfg-')), 'ai-site', 'config.json');
}

test('config：默认值 + sessionSecret 生成且稳定', () => {
  const file = tmpFile();
  const s = createAiSiteConfigStore({ file });
  const c = s.get();
  assert.equal(c.mode, 'port');
  assert.equal(c.listenPort, 22300);
  assert.equal(c.pathPrefix, '/ai');
  assert.equal(c.enabled, false);
  assert.equal(c.requireAuth, true);
  assert.match(c.sessionSecret, /^[0-9a-f]{48}$/);
  const again = createAiSiteConfigStore({ file: tmpFile() });
  assert.equal(again.get().requireAuth, true);
  const s2 = createAiSiteConfigStore({ file });
  assert.equal(s2.get().sessionSecret, c.sessionSecret);
});

test('config：端口/路径校验', () => {
  const s = createAiSiteConfigStore({ file: tmpFile() });
  assert.throws(() => s.save({ mode: 'bad' }), (e) => e.code === 'bad-request');
  assert.throws(() => s.save({ mode: 'port', listenPort: 0 }), (e) => e.code === 'bad-request');
  assert.throws(() => s.save({ mode: 'path', pathPrefix: 'ai' }), (e) => e.code === 'bad-request');
  assert.throws(() => s.save({ mode: 'path', pathPrefix: '/ai/' }), (e) => e.code === 'bad-request');
  assert.throws(() => s.save({ mode: 'path', pathPrefix: '/api' }), (e) => e.code === 'bad-request');
  const c = s.save({ mode: 'path', pathPrefix: '/ai', enabled: true });
  assert.equal(c.mode, 'path');
  assert.equal(c.pathPrefix, '/ai');
  assert.equal(c.enabled, true);
});

test('config：插件根目录必须存在，前缀冲突拒绝', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-root-'));
  const s = createAiSiteConfigStore({ file: tmpFile(), isPrefixTaken: (p) => p === '/taken' });
  assert.equal(normalizeConfig({ pluginRoot: dir }).pluginRoot, path.resolve(dir));
  assert.throws(() => s.save({ pluginRoot: path.join(dir, 'nope') }), (e) => e.code === 'bad-static-dir');
  assert.throws(() => s.save({ mode: 'path', pathPrefix: '/taken' }), (e) => e.code === 'bad-request');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/ai-site-config-store.test.js"`
Expected: FAIL（`Cannot find module .../config-store.js`）。

- [ ] **Step 3: 写实现**

Create `server/ai-site/config-store.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MODES = ['port', 'path'];
const RESERVED_PREFIXES = ['/api', '/ws'];
export const DEFAULT_AI_SITE_PORT = 22300;

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }

export function normalizeConfig(input, prev = {}, { isPrefixTaken = () => false } = {}) {
  const mode = String(input?.mode ?? prev.mode ?? 'port');
  if (!MODES.includes(mode)) throw err('bad-request', 'bad mode');

  const listenHost = String(input?.listenHost ?? prev.listenHost ?? '0.0.0.0').trim();
  if (!listenHost || /[\s/]/.test(listenHost)) throw err('bad-request', 'bad listen host');

  const rawPort = Number(input?.listenPort ?? prev.listenPort ?? DEFAULT_AI_SITE_PORT);
  if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) throw err('bad-request', 'bad listen port');

  const requireAuth = input?.requireAuth === undefined ? (prev.requireAuth !== false) : !!input.requireAuth;
  const enabled = input?.enabled === undefined ? !!prev.enabled : !!input.enabled;

  let pluginRoot = String(input?.pluginRoot ?? prev.pluginRoot ?? '').trim();
  if (pluginRoot) {
    pluginRoot = path.resolve(pluginRoot);
    let st = null;
    try { st = fs.statSync(pluginRoot); } catch { /* missing */ }
    if (!st || !st.isDirectory()) throw err('bad-static-dir', 'plugin root missing');
  }

  let sessionSecret = String(prev.sessionSecret || '').trim();
  if (!sessionSecret) sessionSecret = crypto.randomBytes(24).toString('hex');

  const base = { pluginRoot, mode, listenHost, requireAuth, enabled, sessionSecret };
  if (mode === 'port') return { ...base, listenPort: rawPort, pathPrefix: '' };

  const pathPrefix = String(input?.pathPrefix ?? prev.pathPrefix ?? '/ai').trim();
  if (!/^\/[^/]/.test(pathPrefix)) throw err('bad-request', 'bad prefix');
  if (pathPrefix.endsWith('/')) throw err('bad-request', 'bad prefix');
  if (RESERVED_PREFIXES.some((p) => pathPrefix === p || pathPrefix.startsWith(p + '/'))) throw err('bad-request', 'reserved prefix');
  if (isPrefixTaken(pathPrefix)) throw err('bad-request', 'prefix conflict');
  return { ...base, listenPort: 0, pathPrefix };
}

export function createAiSiteConfigStore({ file, isPrefixTaken = () => false } = {}) {
  let cfg = null;

  function load() {
    if (cfg) return cfg;
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { raw = {}; }
    cfg = normalizeConfig(raw, {}, { isPrefixTaken });
    return cfg;
  }

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  return {
    get() { return { ...load() }; },
    save(patch) {
      cfg = normalizeConfig({ ...load(), ...patch }, load(), { isPrefixTaken });
      persist();
      return { ...cfg };
    },
  };
}
```

- [ ] **Step 4: 运行测试**

Run: `node --test "server/test/ai-site-config-store.test.js"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/ai-site/config-store.js server/test/ai-site-config-store.test.js
git commit -m "feat(ai-site): 配置存储与校验"
```

---

### Task 3: 用户存储 `server/ai-site/users.js`

**Files:**
- Create: `server/ai-site/users.js`
- Test: `server/test/ai-site-users.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/ai-site-users.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAiSiteUsers } from '../ai-site/users.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-users-')), 'ai-site', 'users.json');
}

test('users：创建/唯一/落盘/登录', () => {
  const file = tmpFile();
  const s = createAiSiteUsers({ file });
  const a = s.create({ username: 'alice' });
  assert.match(a.token, /^[0-9a-f]{48}$/);
  assert.equal(a.uses, 0);
  assert.throws(() => s.create({ username: 'ALICE' }), (e) => e.code === 'duplicate-username');
  assert.equal(s.findByLogin('alice', a.token).id, a.id);
  assert.equal(s.findByLogin('alice', 'wrong'), null);
  assert.equal(s.findByToken(a.token).id, a.id);
  const s2 = createAiSiteUsers({ file });
  assert.equal(s2.list()[0].username, 'alice');
});

test('users：停用后不可登录，recordUse 累加', () => {
  const s = createAiSiteUsers({ file: tmpFile() });
  const a = s.create({ username: 'bob' });
  const u = s.recordUse(a.id, 1000);
  assert.equal(u.uses, 1);
  assert.equal(u.lastRunAt, 1000);
  s.update(a.id, { enabled: false });
  assert.equal(s.findByLogin('bob', a.token), null);
  assert.equal(s.findByToken(a.token), null);
  s.update(a.id, { enabled: true });
  assert.equal(s.recordUse(a.id, 2000).uses, 2);
  assert.equal(s.remove(a.id), true);
  assert.equal(s.list().length, 0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/ai-site-users.test.js"`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

Create `server/ai-site/users.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { genUserToken, normalizeUsername } from '../remote-users.js';

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}

function normalizeStored(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const username = String(raw.username || '').trim();
  const token = String(raw.token || '').trim();
  if (!id || !username || !token) return null;
  return {
    id, username, token,
    enabled: raw.enabled !== false,
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
    lastLoginAt: Number(raw.lastLoginAt) || 0,
    lastRunAt: Number(raw.lastRunAt) || 0,
    uses: Number(raw.uses) || 0,
  };
}

export function createAiSiteUsers({ file } = {}) {
  let list = null;

  function load() {
    if (list) return list;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      list = (Array.isArray(raw?.users) ? raw.users : []).map(normalizeStored).filter(Boolean);
    } catch { list = []; }
    return list;
  }

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ users: list }, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  function view(u) { return { ...u }; }

  function ensureUnique(username, selfId) {
    const uname = username.toLowerCase();
    if (load().some((x) => x.id !== selfId && x.username.toLowerCase() === uname)) throw err('duplicate-username', 'username exists');
  }

  return {
    list() { return load().map(view); },
    get(id) {
      const u = load().find((x) => x.id === String(id || ''));
      return u ? view(u) : null;
    },
    create(input = {}) {
      const username = normalizeUsername(input.username);
      ensureUnique(username, null);
      const ts = Date.now();
      const u = {
        id: crypto.randomUUID(), username, token: genUserToken(), enabled: input.enabled !== false,
        createdAt: ts, updatedAt: ts, lastLoginAt: 0, lastRunAt: 0, uses: 0,
      };
      load().push(u);
      persist();
      return view(u);
    },
    update(id, patch = {}) {
      const arr = load();
      const i = arr.findIndex((x) => x.id === String(id || ''));
      if (i < 0) throw err('not-found', 'user not found');
      const username = patch.username === undefined ? arr[i].username : normalizeUsername(patch.username);
      ensureUnique(username, arr[i].id);
      arr[i] = {
        ...arr[i], username,
        enabled: patch.enabled === undefined ? arr[i].enabled : !!patch.enabled,
        updatedAt: Date.now(),
      };
      persist();
      return view(arr[i]);
    },
    remove(id) {
      const arr = load();
      const i = arr.findIndex((x) => x.id === String(id || ''));
      if (i < 0) return false;
      arr.splice(i, 1);
      persist();
      return true;
    },
    findByLogin(username, token) {
      const name = String(username || '').trim().toLowerCase();
      const tk = String(token || '');
      if (!name || !tk) return null;
      const u = load().find((x) => x.enabled && x.username.toLowerCase() === name && safeEqual(tk, x.token));
      if (!u) return null;
      u.lastLoginAt = Date.now();
      try { persist(); } catch { /* ignore */ }
      return view(u);
    },
    findByToken(token) {
      const tk = String(token || '');
      if (!tk) return null;
      const u = load().find((x) => x.enabled && safeEqual(tk, x.token));
      return u ? view(u) : null;
    },
    recordUse(id, at = Date.now()) {
      const u = load().find((x) => x.id === String(id || ''));
      if (!u) return null;
      u.uses += 1;
      u.lastRunAt = at;
      try { persist(); } catch { /* ignore */ }
      return view(u);
    },
  };
}
```

- [ ] **Step 4: 运行测试**

Run: `node --test "server/test/ai-site-users.test.js"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/ai-site/users.js server/test/ai-site-users.test.js
git commit -m "feat(ai-site): 用户名+Token 用户存储与使用次数"
```

---

### Task 4: 插件扫描 `server/ai-site/plugins.js`

**Files:**
- Create: `server/ai-site/plugins.js`
- Test: `server/test/ai-site-plugins.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/ai-site-plugins.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listPlugins, readPlugin, readLogo, resolvePluginPath } from '../ai-site/plugins.js';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-plugins-'));
  const p = path.join(root, 'translate');
  fs.mkdirSync(path.join(p, 'workflow'), { recursive: true });
  fs.writeFileSync(path.join(p, 'manifest.json'), JSON.stringify({
    name: '翻译助手', description: '翻译文本', logo: 'logo.png', workflow: 'workflow/prompt.md',
    fields: [
      { key: 'text', label: '文本', type: 'textarea', required: true },
      { key: 'lang', label: '语言', type: 'select', options: ['中文', '英文'] },
      { key: 'bad', label: '坏', type: 'file' },
      { key: 'bad2', label: '坏2', type: 'bogus' },
    ],
  }));
  fs.writeFileSync(path.join(p, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(p, 'workflow', 'prompt.md'), '# go');
  return root;
}

test('plugins：扫描/解析/忽略非法字段', () => {
  const root = setup();
  const items = listPlugins(root);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'translate');
  assert.equal(items[0].title, '翻译助手');
  assert.equal(items[0].hasLogo, true);
  assert.deepEqual(items[0].fields.map((f) => f.key), ['text', 'lang']);
  assert.equal(items[0].fields[1].type, 'select');
  assert.deepEqual(items[0].fields[1].options, ['中文', '英文']);
  assert.equal(items[0].error, null);
});

test('plugins：缺 manifest 的目录跳过', () => {
  const root = setup();
  fs.mkdirSync(path.join(root, 'empty'));
  assert.equal(listPlugins(root).length, 1);
});

test('plugins：路径穿越拒绝', () => {
  const root = setup();
  assert.throws(() => resolvePluginPath(root, 'translate', '../x'), (e) => e.code === 'bad-path');
  assert.throws(() => resolvePluginPath(root, 'translate', '/abs'), (e) => e.code === 'bad-path');
  assert.throws(() => readPlugin(root, '../translate'), (e) => e.code === 'not-found');
  const logo = readLogo(root, 'translate');
  assert.equal(logo.contentType, 'image/png');
  assert.equal(logo.data.length, 4);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/ai-site-plugins.test.js"`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

Create `server/ai-site/plugins.js`:

```js
import fs from 'node:fs';
import path from 'node:path';

const FIELD_TYPES = new Set(['text', 'textarea', 'select', 'number', 'checkbox', 'date', 'color', 'password', 'email', 'url', 'tel', 'range']);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }
function inside(root, file) { return file === root || file.startsWith(root + path.sep); }

function normalizeFields(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const f of raw) {
    const key = String(f?.key || '').trim();
    const type = String(f?.type || 'text').trim();
    if (!key || seen.has(key)) continue;
    if (!FIELD_TYPES.has(type)) continue;
    const field = { key, label: String(f?.label || key), type, required: !!f?.required };
    if (type === 'select') {
      const options = Array.isArray(f?.options) ? f.options.map((x) => String(x)).filter(Boolean) : [];
      if (!options.length) continue;
      field.options = options;
    }
    if (f?.placeholder !== undefined) field.placeholder = String(f.placeholder);
    if (f?.default !== undefined) field.default = String(f.default);
    for (const k of ['min', 'max', 'step']) if (f?.[k] !== undefined) field[k] = Number(f[k]);
    out.push(field);
    seen.add(key);
  }
  return out;
}

export function resolvePluginPath(root, plugin, rel) {
  const rootAbs = path.resolve(root);
  const pluginName = String(plugin || '').trim();
  if (!pluginName || pluginName.includes('/') || pluginName.includes('\\') || pluginName === '.' || pluginName === '..') throw err('not-found');
  const pluginDir = path.join(rootAbs, pluginName);
  if (!inside(rootAbs, pluginDir)) throw err('bad-path');
  const r = String(rel || '').trim();
  if (!r || path.isAbsolute(r) || r.includes('\0')) throw err('bad-path');
  const target = path.resolve(pluginDir, r);
  if (!inside(pluginDir, target)) throw err('bad-path');
  return target;
}

export function normalizeManifest(raw, dirName) {
  const title = String(raw?.name || dirName || '').trim() || dirName;
  const workflow = String(raw?.workflow || '').trim();
  const logo = String(raw?.logo || '').trim();
  return {
    name: dirName,
    title,
    description: String(raw?.description || ''),
    workflow,
    logo,
    fields: normalizeFields(raw?.fields),
  };
}

export function readPlugin(root, plugin) {
  const pluginName = String(plugin || '').trim();
  if (!pluginName || pluginName.includes('/') || pluginName.includes('\\') || pluginName === '.' || pluginName === '..') throw err('not-found');
  const dir = path.resolve(root, pluginName);
  if (!inside(path.resolve(root), dir) || !fs.existsSync(dir)) throw err('not-found');
  const manifestFile = path.join(dir, 'manifest.json');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { throw err('bad-manifest', 'manifest.json missing or invalid'); }
  const pluginData = normalizeManifest(raw, pluginName);
  if (!pluginData.workflow) throw err('bad-manifest', 'workflow required');
  return { ...pluginData, dir };
}

export function listPlugins(root) {
  const rootAbs = path.resolve(String(root || ''));
  let entries = [];
  try { entries = fs.readdirSync(rootAbs, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    let item;
    try {
      const p = readPlugin(rootAbs, e.name);
      item = {
        name: p.name, title: p.title, description: p.description, fields: p.fields,
        workflow: p.workflow, logo: p.logo, hasLogo: !!(p.logo && fs.existsSync(resolvePluginPath(rootAbs, p.name, p.logo))),
        error: null,
      };
    } catch (e2) {
      item = { name: e.name, title: e.name, description: '', fields: [], workflow: '', logo: '', hasLogo: false, error: (e2 && e2.code) || 'bad-manifest' };
    }
    out.push(item);
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

export function readLogo(root, plugin) {
  const p = readPlugin(root, plugin);
  if (!p.logo) return null;
  let file;
  try { file = resolvePluginPath(root, p.name, p.logo); } catch { return null; }
  let st = null;
  try { st = fs.statSync(file); } catch { return null; }
  if (!st.isFile()) return null;
  const ext = path.extname(file).toLowerCase();
  if (!MIME[ext]) return null;
  return { data: fs.readFileSync(file), contentType: MIME[ext] };
}
```

- [ ] **Step 4: 运行测试**

Run: `node --test "server/test/ai-site-plugins.test.js"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/ai-site/plugins.js server/test/ai-site-plugins.test.js
git commit -m "feat(ai-site): 插件目录扫描与 manifest 解析"
```

---

### Task 5: 执行器 `server/ai-site/runner.js`

**Files:**
- Create: `server/ai-site/runner.js`
- Test: `server/test/ai-site-runner.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/ai-site-runner.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createAiSiteRunner } from '../ai-site/runner.js';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return child;
}

function setupPlugin(root) {
  const dir = path.join(root, 'translate');
  fs.mkdirSync(path.join(dir, 'workflow'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'workflow', 'prompt.md'), 'PROMPT');
  fs.writeFileSync(path.join(dir, 'workflow', 'extra.txt'), 'E');
  return dir;
}

test('runner：建 run 目录、写 input.json、复制 workflow、调用 agent', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-run-'));
  const pluginDir = setupPlugin(root);
  const runsDir = path.join(root, 'runs');
  let captured = null;
  const runner = createAiSiteRunner({
    runsDir,
    resolveBin: () => 'opencode',
    spawnFn: (bin, args, opts) => {
      captured = { bin, args, opts };
      const c = fakeChild();
      setTimeout(() => {
        c.stdout.emit('data', 'hello');
        c.stderr.emit('data', 'warn');
        c.emit('close', 0);
      }, 0);
      return c;
    },
  });
  const run = runner.createRun({
    pluginName: 'translate',
    pluginDir,
    workflowPath: path.join(pluginDir, 'workflow', 'prompt.md'),
    values: { text: 'hi' },
    user: 'alice',
  });
  assert.ok(run.id);
  assert.equal(run.status, 'running');
  const runDir = path.join(runsDir, run.id);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runDir, 'input.json'), 'utf8')), { text: 'hi' });
  assert.equal(fs.readFileSync(path.join(runDir, 'prompt.md'), 'utf8'), 'PROMPT');
  assert.equal(fs.existsSync(path.join(runDir, 'output')), true);
  assert.equal(captured.bin, 'opencode');
  assert.deepEqual(captured.args, ['run', 'PROMPT']);
  assert.equal(captured.opts.cwd, runDir);

  await new Promise((r) => setTimeout(r, 20));
  const done = runner.getRun(run.id);
  assert.equal(done.status, 'success');
  assert.equal(done.exitCode, 0);
  assert.match(fs.readFileSync(path.join(runDir, 'run.log'), 'utf8'), /hello/);
});

test('runner：保留最近 N 个 run', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-prune-'));
  const pluginDir = setupPlugin(root);
  const runsDir = path.join(root, 'runs');
  const runner = createAiSiteRunner({
    runsDir, keepRuns: 2, resolveBin: () => 'opencode',
    spawnFn: () => fakeChild(),
  });
  const ids = [];
  for (let i = 0; i < 4; i += 1) {
    ids.push(runner.createRun({ pluginName: 'translate', pluginDir, workflowPath: path.join(pluginDir, 'workflow', 'prompt.md'), values: {}, user: '' }).id);
    const t = new Date(Date.now() + i * 1000);
    fs.utimesSync(path.join(runsDir, ids[i]), t, t);
  }
  const kept = fs.readdirSync(runsDir);
  assert.equal(kept.length, 2);
  assert.equal(kept.includes(ids[0]), false);
});

test('runner：output 文件列表、读取防穿越、zip', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-files-'));
  const pluginDir = setupPlugin(root);
  const runsDir = path.join(root, 'runs');
  const runner = createAiSiteRunner({ runsDir, resolveBin: () => 'opencode', spawnFn: () => fakeChild() });
  const run = runner.createRun({ pluginName: 'translate', pluginDir, workflowPath: path.join(pluginDir, 'workflow', 'prompt.md'), values: {}, user: '' });
  const outDir = path.join(runsDir, run.id, 'output');
  fs.writeFileSync(path.join(outDir, 'a.txt'), 'A');
  fs.mkdirSync(path.join(outDir, 'sub'));
  fs.writeFileSync(path.join(outDir, 'sub', 'b.md'), 'B');
  const files = runner.listFiles(run.id).map((f) => f.path).sort();
  assert.deepEqual(files, ['a.txt', 'sub/b.md']);
  assert.equal(runner.readFile(run.id, 'a.txt').data.toString('utf8'), 'A');
  assert.throws(() => runner.readFile(run.id, '../run.json'), (e) => e.code === 'bad-path');
  const zip = runner.zipOutput(run.id);
  assert.equal(zip.subarray(0, 2).toString('utf8'), 'PK');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/ai-site-runner.test.js"`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

Create `server/ai-site/runner.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { buildZip } from '../collaboration/zip.js';
import { wrapCmdBin } from '../win-spawn.js';
import { resolveAgentBin } from '../collaboration/agent-stats.js';
import { withAgentEnv } from '../agent-env.js';

const LOG_LIMIT = 1024 * 1024;

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }
function inside(root, file) { return file === root || file.startsWith(root + path.sep); }

function walk(dir, base = '', out = { list: [], count: 0 }) {
  if (out.count > 5000) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel, out);
    else if (e.isFile()) {
      out.count += 1;
      if (out.count > 5000) break;
      const st = fs.statSync(path.join(dir, e.name));
      out.list.push({ path: rel, size: st.size, mtime: st.mtimeMs });
    }
  }
  return out;
}

export function createAiSiteRunner({
  runsDir,
  spawnFn = spawn,
  agentCmd = 'opencode',
  timeoutMs = Number(process.env.DEVFLOW_AI_SITE_TIMEOUT_MS || 10 * 60 * 1000),
  keepRuns = 50,
  resolveBin = resolveAgentBin,
} = {}) {
  const runs = new Map();

  function prune() {
    let entries = [];
    try { entries = fs.readdirSync(runsDir, { withFileTypes: true }); } catch { return; }
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => {
      const full = path.join(runsDir, e.name);
      let mtime = 0;
      try { mtime = fs.statSync(full).mtimeMs; } catch { /* ignore */ }
      return { name: e.name, full, mtime };
    }).sort((a, b) => b.mtime - a.mtime);
    for (const d of dirs.slice(keepRuns)) {
      try { fs.rmSync(d.full, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  function emit(run, event) {
    run.events.push(event);
    if (run.events.length > 500) run.events.shift();
    for (const cb of run.listeners) { try { cb(event); } catch { /* ignore */ } }
  }

  function createRun({ pluginName, pluginDir, workflowPath, values = {}, user = '' }) {
    const id = crypto.randomUUID();
    const runDir = path.join(runsDir, id);
    fs.mkdirSync(path.join(runDir, 'output'), { recursive: true });
    prune(); // 新目录已存在（mtime 最新），保留最近 keepRuns 个

    let prompt = '';
    try { prompt = fs.readFileSync(workflowPath, 'utf8'); } catch { prompt = ''; }
    const sourceDir = path.dirname(workflowPath);
    if (inside(pluginDir, sourceDir) && fs.existsSync(sourceDir)) {
      fs.cpSync(sourceDir, runDir, { recursive: true });
    }
    fs.writeFileSync(path.join(runDir, 'input.json'), JSON.stringify(values, null, 2), 'utf8');

    const startedAt = Date.now();
    const meta = {
      id, plugin: pluginName, user, startedAt, finishedAt: 0,
      exitCode: null, status: 'running', error: null,
      listeners: new Set(), events: [], log: '',
    };
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(publicMeta(meta), null, 2), 'utf8');
    runs.set(id, meta);

    const bin = resolveBin(agentCmd);
    const wrapped = wrapCmdBin(bin, ['run', prompt]);
    const stream = fs.createWriteStream(path.join(runDir, 'run.log'), { flags: 'a' });
    let child = null;
    try {
      child = spawnFn(wrapped.bin, wrapped.args, {
        cwd: runDir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: withAgentEnv(),
      });
    } catch (e) {
      finish(-1, true, String(e && e.message || e));
      return publicMeta(meta);
    }

    const timer = timeoutMs > 0 ? setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      meta.error = 'timeout';
    }, timeoutMs) : null;
    timer?.unref?.();

    const onData = (chunk) => {
      const text = String(chunk);
      meta.log = (meta.log + text).slice(-LOG_LIMIT);
      stream.write(text);
      emit(meta, { type: 'chunk', data: text });
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    let done = false;
    function finish(exitCode, spawnError = false, errMsg = null) {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      meta.finishedAt = Date.now();
      meta.exitCode = exitCode;
      meta.status = meta.error === 'timeout' ? 'timeout' : (spawnError || exitCode !== 0 ? 'error' : 'success');
      if (errMsg) meta.error = errMsg;
      stream.end();
      try { fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(publicMeta(meta), null, 2), 'utf8'); } catch { /* ignore */ }
      emit(meta, { type: 'done', status: meta.status, exitCode: meta.exitCode, error: meta.error });
    }

    child.on?.('error', (e) => finish(-1, true, String(e && e.message || e)));
    child.on?.('close', (code) => finish(code ?? null, false, null));
    return publicMeta(meta);
  }

  function publicMeta(meta) {
    return {
      id: meta.id, plugin: meta.plugin, user: meta.user,
      startedAt: meta.startedAt, finishedAt: meta.finishedAt,
      exitCode: meta.exitCode, status: meta.status, error: meta.error,
    };
  }

  function getRun(id) {
    const m = runs.get(String(id || ''));
    return m ? publicMeta(m) : null;
  }

  function subscribe(id, cb) {
    const m = runs.get(String(id || ''));
    if (!m) return () => {};
    for (const ev of m.events) { try { cb(ev); } catch { /* ignore */ } }
    m.listeners.add(cb);
    return () => m.listeners.delete(cb);
  }

  function outputDir(id) { return path.join(runsDir, String(id || ''), 'output'); }

  function listFiles(id) { return walk(outputDir(id)).list; }

  function readFile(id, rel) {
    const root = path.resolve(outputDir(id));
    const r = String(rel || '');
    if (!r || path.isAbsolute(r) || r.includes('\0')) throw err('bad-path');
    const file = path.resolve(root, r);
    if (!inside(root, file)) throw err('bad-path');
    const st = fs.statSync(file);
    if (!st.isFile()) throw err('not-found');
    return { data: fs.readFileSync(file), size: st.size };
  }

  function zipOutput(id) {
    const root = outputDir(id);
    const entries = [];
    for (const f of walk(root).list) {
      entries.push({ name: f.path, data: fs.readFileSync(path.join(root, f.path)) });
    }
    return buildZip(entries);
  }

  return { createRun, getRun, subscribe, listFiles, readFile, zipOutput, prune };
}
```

- [ ] **Step 4: 运行测试**

Run: `node --test "server/test/ai-site-runner.test.js"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/ai-site/runner.js server/test/ai-site-runner.test.js
git commit -m "feat(ai-site): run 目录/复制 workflow/调用 agent 执行器"
```

---

### Task 6: 页面渲染 `server/ai-site/pages.js` + i18n 词条

**Files:**
- Create: `server/ai-site/pages.js`
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`
- Test: `server/test/ai-site-pages.test.js`

- [ ] **Step 1: 先加 i18n 词条**

在 `shared/i18n/zh-CN.js` 的 `'proxy.tabs.llm'` 之后加：

```js
  'proxy.tabs.ai': 'AI 命令执行',
  'ai_site.title': 'AI 命令执行',
  'ai_site.login.title': '登录 AI 命令执行',
  'ai_site.login.username': '用户名',
  'ai_site.login.token': 'Token',
  'ai_site.login.submit': '登录',
  'ai_site.login.error': '用户名或 Token 不正确',
  'ai_site.logout': '退出登录',
  'ai_site.plugins.empty': '插件目录为空',
  'ai_site.plugins.bad': '插件配置无效',
  'ai_site.form.run': '执行',
  'ai_site.form.running': '执行中…',
  'ai_site.form.fields_hint': '按 manifest 填完字段后执行',
  'ai_site.form.file_unsupported': '暂不支持 file 上传字段，已忽略',
  'ai_site.result.title': '执行结果',
  'ai_site.result.log': '执行日志',
  'ai_site.result.output': '产物文件',
  'ai_site.result.empty': '暂无产物',
  'ai_site.result.download': '下载',
  'ai_site.result.zip': '打包下载 output',
  'ai_site.required': '请填写必填字段：{name}',
```

在 `shared/i18n/en.js` 的 `'proxy.tabs.llm'` 之后加：

```js
  'proxy.tabs.ai': 'AI command',
  'ai_site.title': 'AI command',
  'ai_site.login.title': 'Sign in to AI command',
  'ai_site.login.username': 'Username',
  'ai_site.login.token': 'Token',
  'ai_site.login.submit': 'Sign in',
  'ai_site.login.error': 'Invalid username or token',
  'ai_site.logout': 'Sign out',
  'ai_site.plugins.empty': 'No plugins in this folder',
  'ai_site.plugins.bad': 'Invalid plugin manifest',
  'ai_site.form.run': 'Run',
  'ai_site.form.running': 'Running…',
  'ai_site.form.fields_hint': 'Fill the fields declared in the manifest, then run',
  'ai_site.form.file_unsupported': 'file upload fields are not supported in v1 and were ignored',
  'ai_site.result.title': 'Result',
  'ai_site.result.log': 'Log',
  'ai_site.result.output': 'Output files',
  'ai_site.result.empty': 'No output yet',
  'ai_site.result.download': 'Download',
  'ai_site.result.zip': 'Download output as zip',
  'ai_site.required': 'Please fill required field: {name}',
```

- [ ] **Step 2: 写失败测试**

Create `server/test/ai-site-pages.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../i18n.js';
import { loginPage, listPage, formPage } from '../ai-site/pages.js';

const PLUGIN = {
  name: 'translate', title: '翻译助手', description: '翻译文本', logo: 'logo.png', hasLogo: true,
  fields: [
    { key: 'text', label: '文本', type: 'textarea', required: true },
    { key: 'lang', label: '语言', type: 'select', options: ['中文', '英文'] },
    { key: 'n', label: '数量', type: 'number', min: 1, max: 9 },
  ],
};

test('pages：登录页包含表单与用户名/token 字段', () => {
  setLocale('zh-CN');
  const html = loginPage({ base: '/ai' });
  assert.match(html, /<form[^>]+action="\/ai\/__login"/);
  assert.match(html, /name="username"/);
  assert.match(html, /name="token"/);
});

test('pages：列表页展示 logo/name/description 与链接', () => {
  const html = listPage({ base: '', plugins: [PLUGIN], authenticated: true });
  assert.match(html, /翻译助手/);
  assert.match(html, /翻译文本/);
  assert.match(html, /href="\/p\/translate"/);
  assert.match(html, /__assets\/logo\/translate/);
});

test('pages：表单页按字段类型渲染', () => {
  const html = formPage({ base: '/ai', plugin: PLUGIN });
  assert.match(html, /<textarea[^>]+name="text"[^>]*required/);
  assert.match(html, /<select[^>]+name="lang"/);
  assert.match(html, /<option value="中文"/);
  assert.match(html, /<input[^>]+type="number"[^>]+name="n"/);
  assert.match(html, /\/ai\/__api\/run/);
});
```

- [ ] **Step 3: 运行确认失败**

Run: `node --test "server/test/ai-site-pages.test.js"`
Expected: FAIL（模块不存在 / 词条缺失时也先确认）。

- [ ] **Step 4: 写实现**

Create `server/ai-site/pages.js`:

```js
import { t } from '../i18n.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;font:14px/1.6 ui-sans-serif,system-ui,"Segoe UI","Microsoft YaHei",sans-serif;background:#0e1116;color:#d5dae1}
header{display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #2a323e;background:#11151b}
header h1{font-size:16px;margin:0;flex:1}
a{color:#4c9aff;text-decoration:none}
main{padding:18px;max-width:1000px;margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.card{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid #2a323e;border-radius:10px;background:#151b23;color:#d5dae1}
.card:hover{border-color:#4c9aff}
.logo{width:42px;height:42px;border-radius:8px;object-fit:cover;background:#222b36;flex:none;display:flex;align-items:center;justify-content:center;font-size:20px}
.card b{display:block;color:#e6e9ef}
.card small{color:#8b97a7}
form.card{display:block}
label{display:block;margin:10px 0 4px;color:#9aa4b2}
input,select,textarea{width:100%;padding:7px 9px;border-radius:6px;border:1px solid #2a323e;background:#0e1116;color:#e6e9ef;font:inherit}
textarea{min-height:90px;resize:vertical}
button{padding:7px 16px;border-radius:6px;border:1px solid #4c9aff;background:#4c9aff;color:#fff;cursor:pointer;font:inherit}
button:disabled{opacity:.5;cursor:default}
pre{background:#0a0d11;border:1px solid #2a323e;border-radius:8px;padding:10px;white-space:pre-wrap;overflow:auto;max-height:360px;font-size:12px}
.out{list-style:none;padding:0;margin:0}
.out li{display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid #1c232c}
.out li span{flex:1;word-break:break-all}
.err{color:#ff6b6b}
.muted{color:#8b97a7}
`;

function shell(title, body, extra = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style>${extra}</head><body>${body}</body></html>`;
}

export function loginPage({ base = '', error = false }) {
  const action = `${base}/__login`;
  return shell(t('ai_site.login.title'),
    `<header><h1>${esc(t('ai_site.login.title'))}</h1></header>
<main><form class="card" method="POST" action="${esc(action)}">
<label>${esc(t('ai_site.login.username'))}</label><input name="username" autocomplete="username" />
<label>${esc(t('ai_site.login.token'))}</label><input name="token" type="password" autocomplete="current-password" />
${error ? `<p class="err">${esc(t('ai_site.login.error'))}</p>` : ''}
<p><button type="submit">${esc(t('ai_site.login.submit'))}</button></p>
</form></main>`);
}

export function listPage({ base = '', plugins = [], authenticated = false }) {
  const cards = plugins.map((p) => `<a class="card" href="${esc(`${base}/p/${encodeURIComponent(p.name)}`)}">
<span class="logo">${p.hasLogo ? `<img class="logo" src="${esc(`${base}/__assets/logo/${encodeURIComponent(p.name)}`)}" alt="" />` : '🧩'}</span>
<span><b>${esc(p.title)}</b><small>${esc(p.description || '')}${p.error ? ` · ${esc(t('ai_site.plugins.bad'))}` : ''}</small></span>
</a>`).join('');
  return shell(t('ai_site.title'),
    `<header><h1>${esc(t('ai_site.title'))}</h1>${authenticated ? `<a href="${esc(`${base}/__logout`)}">${esc(t('ai_site.logout'))}</a>` : ''}</header>
<main>${plugins.length ? `<div class="grid">${cards}</div>` : `<p class="muted">${esc(t('ai_site.plugins.empty'))}</p>`}</main>`);
}

function fieldHtml(f) {
  const label = `<label>${esc(f.label)}${f.required ? ' *' : ''}</label>`;
  if (f.type === 'textarea') {
    return `${label}<textarea name="${esc(f.key)}"${f.required ? ' required' : ''} placeholder="${esc(f.placeholder || '')}">${esc(f.default || '')}</textarea>`;
  }
  if (f.type === 'select') {
    const opts = (f.options || []).map((o) => `<option value="${esc(o)}"${String(f.default) === String(o) ? ' selected' : ''}>${esc(o)}</option>`).join('');
    return `${label}<select name="${esc(f.key)}"${f.required ? ' required' : ''}>${opts}</select>`;
  }
  if (f.type === 'checkbox') {
    return `<label><input type="checkbox" name="${esc(f.key)}" value="1"${f.default === 'true' ? ' checked' : ''} /> ${esc(f.label)}</label>`;
  }
  const attrs = [
    `type="${esc(f.type)}"`, `name="${esc(f.key)}"`,
    f.required ? 'required' : '',
    f.placeholder !== undefined ? `placeholder="${esc(f.placeholder)}"` : '',
    f.default !== undefined ? `value="${esc(f.default)}"` : '',
    f.min !== undefined ? `min="${esc(f.min)}"` : '',
    f.max !== undefined ? `max="${esc(f.max)}"` : '',
    f.step !== undefined ? `step="${esc(f.step)}"` : '',
  ].filter(Boolean).join(' ');
  return `${label}<input ${attrs} />`;
}

export function formPage({ base = '', plugin }) {
  const fields = (plugin.fields || []).map(fieldHtml).join('');
  const hasFile = (plugin.fields || []).some((f) => f.type === 'file');
  const script = `
const base = ${JSON.stringify(base)};
const form = document.getElementById('f');
const log = document.getElementById('log');
const statusEl = document.getElementById('status');
const outEl = document.getElementById('out');
function renderFiles(files){
  document.getElementById('ziplink').href = base + '/__api/runs/' + encodeURIComponent(window.__runId) + '/zip';
  outEl.innerHTML = '';
  document.getElementById('outwrap').style.display = 'block';
  if(!files.length){ outEl.innerHTML = '<li class="muted">${esc(t('ai_site.result.empty'))}</li>'; return; }
  for(const f of files){
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = base + '/__api/runs/' + encodeURIComponent(window.__runId) + '/file?path=' + encodeURIComponent(f.path);
    a.textContent = f.path + ' (' + f.size + 'B)';
    a.target = '_blank';
    const dl = document.createElement('a');
    dl.href = a.href + '&download=1';
    dl.textContent = '${esc(t('ai_site.result.download'))}';
    li.appendChild(a); li.appendChild(dl);
    outEl.appendChild(li);
  }
}
form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const values = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') { if (el.checked) values[el.name] = '1'; }
    else values[el.name] = el.value;
  }
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true; statusEl.textContent = '${esc(t('ai_site.form.running'))}'; log.textContent = ''; outEl.innerHTML = '';
  try {
    const res = await fetch(base + '/__api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plugin: ${JSON.stringify(plugin.name)}, values }) });
    const j = await res.json();
    if (!res.ok || !j.runId) throw new Error(j.error || ('HTTP ' + res.status));
    window.__runId = j.runId;
    const es = new EventSource(base + '/__api/stream/' + encodeURIComponent(j.runId));
    es.addEventListener('chunk', (e) => { log.textContent += JSON.parse(e.data).data; log.scrollTop = log.scrollHeight; });
    es.addEventListener('done', async (e) => {
      const d = JSON.parse(e.data);
      statusEl.textContent = d.status;
      es.close(); btn.disabled = false;
      try { const r = await fetch(base + '/__api/runs/' + encodeURIComponent(window.__runId) + '/files'); const fj = await r.json(); renderFiles(fj.items || []); } catch {}
    });
    es.onerror = () => { es.close(); btn.disabled = false; statusEl.textContent = 'error'; };
  } catch (e) {
    statusEl.textContent = String(e && e.message || e);
    btn.disabled = false;
  }
});
`;
  return shell(`${plugin.title} · ${t('ai_site.title')}`,
    `<header><h1>${esc(plugin.title)}</h1><a href="${esc(base || '/')}">${esc(t('ai_site.title'))}</a></header>
<main>
<p class="muted">${esc(plugin.description || '')}</p>
<form id="f" class="card">${fields}
${hasFile ? `<p class="muted">${esc(t('ai_site.form.file_unsupported'))}</p>` : ''}
<p><button type="submit">${esc(t('ai_site.form.run'))}</button> <span id="status" class="muted"></span></p>
</form>
<h3>${esc(t('ai_site.result.log'))}</h3><pre id="log"></pre>
<div id="outwrap" style="display:none">
<h3>${esc(t('ai_site.result.output'))} <a href="#" id="ziplink">${esc(t('ai_site.result.zip'))}</a></h3>
<ul class="out" id="out"></ul>
</div>
</main><script>${script}</script>`);
}
```

> 说明：`formPage` 中 `#ziplink` 的 `href` 在 `renderFiles` 里按当前 runId 赋值。

- [ ] **Step 5: 运行测试**

Run: `node --test "server/test/ai-site-pages.test.js"`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add server/ai-site/pages.js shared/i18n/zh-CN.js shared/i18n/en.js server/test/ai-site-pages.test.js
git commit -m "feat(ai-site): 登录/列表/表单页面渲染与词条"
```

---

### Task 7: 站点路由 `server/ai-site/serve.js`

**Files:**
- Create: `server/ai-site/serve.js`
- Test: `server/test/ai-site-serve.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/ai-site-serve.test.js`（用真实 http server + fetch，覆盖登录、鉴权、插件列表、run 建任务、文件读取防穿越）：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createAiSiteServe } from '../ai-site/serve.js';
import { createAiSiteUsers } from '../ai-site/users.js';
import { createAiSiteRunner } from '../ai-site/runner.js';
import { setLocale } from '../i18n.js';

function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {};
  setTimeout(() => { c.stdout.emit('data', 'ok'); c.emit('close', 0); }, 0);
  return c;
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-serve-'));
  const pluginRoot = path.join(root, 'plugins');
  const p = path.join(pluginRoot, 'hello');
  fs.mkdirSync(path.join(p, 'workflow'), { recursive: true });
  fs.writeFileSync(path.join(p, 'manifest.json'), JSON.stringify({ name: 'Hello', workflow: 'workflow/prompt.md', fields: [{ key: 'x', label: 'X', type: 'text', required: true }] }));
  fs.writeFileSync(path.join(p, 'workflow', 'prompt.md'), 'PROMPT');
  const users = createAiSiteUsers({ file: path.join(root, 'users.json') });
  const runner = createAiSiteRunner({ runsDir: path.join(root, 'runs'), resolveBin: () => 'opencode', spawnFn: () => fakeChild() });
  return { root, pluginRoot, users, runner };
}

function listen(handler) {
  const srv = http.createServer((req, res) => handler(req, res));
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port })));
}

test('serve：未登录跳登录页，登录后可看插件列表并执行', async () => {
  setLocale('zh-CN');
  const { pluginRoot, users, runner } = setup();
  const config = { pluginRoot, requireAuth: true, sessionSecret: 'k'.repeat(48), pathPrefix: '' };
  const serve = createAiSiteServe({ getConfig: () => config, users, runner, logger: console });
  const { srv, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://x');
    serve.handle(req, res, url, { base: '' });
  });
  try {
    const r1 = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
    assert.equal(r1.status, 200);
    assert.match(await r1.text(), /name="username"/);

    const u = users.create({ username: 'alice' });
    const r2 = await fetch(`http://127.0.0.1:${port}/__login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `username=alice&token=${encodeURIComponent(u.token)}`,
    });
    assert.equal(r2.status, 302);
    const cookie = String(r2.headers.get('set-cookie')).split(';')[0];

    const r3 = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie } });
    assert.match(await r3.text(), /Hello/);

    const r4 = await fetch(`http://127.0.0.1:${port}/__api/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ plugin: 'hello', values: { x: '1' } }),
    });
    assert.equal(r4.status, 200);
    const j = await r4.json();
    assert.ok(j.runId);
    assert.equal(users.list()[0].uses, 1);
  } finally { srv.close(); }
});

test('serve：路径遍历 output 文件被拒绝', async () => {
  setLocale('zh-CN');
  const { pluginRoot, users, runner } = setup();
  const config = { pluginRoot, requireAuth: false, sessionSecret: 'k'.repeat(48), pathPrefix: '' };
  const serve = createAiSiteServe({ getConfig: () => config, users, runner, logger: console });
  const { srv, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://x');
    serve.handle(req, res, url, { base: '' });
  });
  try {
    const run = runner.createRun({ pluginName: 'hello', pluginDir: path.join(pluginRoot, 'hello'), workflowPath: path.join(pluginRoot, 'hello', 'workflow', 'prompt.md'), values: {}, user: '' });
    const r = await fetch(`http://127.0.0.1:${port}/__api/runs/${run.id}/file?path=${encodeURIComponent('../run.json')}`);
    assert.equal(r.status, 400);
  } finally { srv.close(); }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/ai-site-serve.test.js"`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

Create `server/ai-site/serve.js`:

```js
import crypto from 'node:crypto';
import path from 'node:path';
import { loginPage, listPage, formPage } from './pages.js';
import { listPlugins, readPlugin, readLogo } from './plugins.js';
import { staticContentType } from '../proxy-static.js';

const COOKIE = 'df_ai_auth';

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0; const chunks = [];
    req.on('data', (c) => { total += c.length; if (total > limit) { reject(new Error('too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sign(secret, userId) {
  return crypto.createHmac('sha256', secret).update(userId).digest('hex');
}
function cookieFor(secret, userId, base) {
  const path = base || '/';
  return `${COOKIE}=${encodeURIComponent(`${userId}.${sign(secret, userId)}`)}; HttpOnly; SameSite=Lax; Path=${path}`;
}
function clearCookie(base) {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=${base || '/'}; Max-Age=0`;
}

export function createAiSiteServe({ getConfig, users, runner, logger = console }) {
  function authUser(req) {
    const cfg = getConfig();
    if (!cfg.requireAuth) return { id: '', username: 'anonymous' };
    const raw = parseCookies(req)[COOKIE];
    if (!raw) return null;
    const dot = raw.lastIndexOf('.');
    if (dot <= 0) return null;
    const userId = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    const expect = sign(cfg.sessionSecret, userId);
    if (sig.length !== expect.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const u = users.get(userId);
    return u && u.enabled ? u : null;
  }

  async function handle(req, res, url, { base = '' } = {}) {
    const cfg = getConfig();
    const method = req.method || 'GET';
    const p = url.pathname;

    if (p === '/__login' && method === 'POST') {
      let body = '';
      try { body = await readBody(req); } catch { return sendJson(res, 400, { error: 'bad-request' }); }
      const form = new URLSearchParams(body);
      const u = users.findByLogin(form.get('username') || '', form.get('token') || '');
      if (!u) return sendHtml(res, 401, loginPage({ base, error: true }));
      res.writeHead(302, { 'Set-Cookie': cookieFor(cfg.sessionSecret, u.id, base), Location: `${base}/` });
      res.end();
      return;
    }
    if (p === '/__logout') {
      res.writeHead(302, { 'Set-Cookie': clearCookie(base), Location: `${base}/` });
      res.end();
      return;
    }

    if (cfg.requireAuth) {
      const access = url.searchParams.get('access');
      if (access) {
        const u = users.findByToken(access);
        if (u) {
          res.writeHead(302, { 'Set-Cookie': cookieFor(cfg.sessionSecret, u.id, base), Location: `${base}/` });
          res.end();
          return;
        }
      }
    }

    const user = authUser(req);
    if (!user) return sendHtml(res, 200, loginPage({ base }));

    if (p === '/' && method === 'GET') {
      return sendHtml(res, 200, listPage({ base, plugins: listPlugins(cfg.pluginRoot), authenticated: cfg.requireAuth }));
    }

    const logoMatch = p.match(/^\/__assets\/logo\/([^/]+)$/);
    if (logoMatch && method === 'GET') {
      const logo = readLogo(cfg.pluginRoot, decodeURIComponent(logoMatch[1]));
      if (!logo) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': logo.contentType, 'Cache-Control': 'no-cache' });
      res.end(logo.data);
      return;
    }

    const formMatch = p.match(/^\/p\/([^/]+)$/);
    if (formMatch && method === 'GET') {
      let plugin;
      try { plugin = readPlugin(cfg.pluginRoot, decodeURIComponent(formMatch[1])); } catch { res.writeHead(404); res.end('Not Found'); return; }
      return sendHtml(res, 200, formPage({ base, plugin }));
    }

    if (p === '/__api/run' && method === 'POST') {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'bad-json' }); }
      let plugin;
      try { plugin = readPlugin(cfg.pluginRoot, String(body.plugin || '')); } catch { return sendJson(res, 404, { error: 'not-found' }); }
      const values = body.values && typeof body.values === 'object' ? body.values : {};
      const missing = plugin.fields.filter((f) => f.required && !String(values[f.key] ?? '').trim());
      if (missing.length) return sendJson(res, 400, { error: 'required', fields: missing.map((f) => f.key) });
      const allowed = new Set(plugin.fields.map((f) => f.key));
      const clean = {};
      for (const k of Object.keys(values)) if (allowed.has(k)) clean[k] = String(values[k] ?? '');
      let run;
      try {
        run = runner.createRun({
          pluginName: plugin.name, pluginDir: plugin.dir,
          workflowPath: path.join(plugin.dir, plugin.workflow),
          values: clean, user: user.id || 'anonymous',
        });
      } catch (e) {
        logger?.warn?.('ai-site run failed', (e && e.message) || e);
        return sendJson(res, 500, { error: 'run-failed' });
      }
      if (user.id) users.recordUse(user.id);
      return sendJson(res, 200, { runId: run.id });
    }

    const streamMatch = p.match(/^\/__api\/stream\/([^/]+)$/);
    if (streamMatch && method === 'GET') {
      const runId = decodeURIComponent(streamMatch[1]);
      const run = runner.getRun(runId);
      if (!run) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.flushHeaders?.();
      const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      const off = runner.subscribe(runId, (ev) => send(ev.type, ev.type === 'chunk' ? { data: ev.data } : ev));
      const keep = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
      keep.unref?.();
      req.on('close', () => { clearInterval(keep); off(); if (!res.writableEnded) res.end(); });
      return;
    }

    const filesMatch = p.match(/^\/__api\/runs\/([^/]+)\/files$/);
    if (filesMatch && method === 'GET') {
      const runId = decodeURIComponent(filesMatch[1]);
      if (!runner.getRun(runId)) return sendJson(res, 404, { error: 'not-found' });
      return sendJson(res, 200, { items: runner.listFiles(runId) });
    }

    const fileMatch = p.match(/^\/__api\/runs\/([^/]+)\/file$/);
    if (fileMatch && method === 'GET') {
      const runId = decodeURIComponent(fileMatch[1]);
      let file;
      try { file = runner.readFile(runId, url.searchParams.get('path') || ''); }
      catch (e) { return sendJson(res, e.code === 'bad-path' ? 400 : 404, { error: e.code || 'not-found' }); }
      const filePath = url.searchParams.get('path') || '';
      const ext = String(filePath).slice(String(filePath).lastIndexOf('.')).toLowerCase();
      const inlineImg = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf'].includes(ext);
      const ct = inlineImg ? staticContentType(filePath) : 'text/plain; charset=utf-8';
      const headers = { 'Content-Type': ct, 'Cache-Control': 'no-cache', 'Content-Length': String(file.size) };
      if (url.searchParams.get('download') === '1' || !inlineImg) headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(String(filePath).split('/').pop())}"`;
      res.writeHead(200, headers);
      res.end(file.data);
      return;
    }

    const zipMatch = p.match(/^\/__api\/runs\/([^/]+)\/zip$/);
    if (zipMatch && method === 'GET') {
      const runId = decodeURIComponent(zipMatch[1]);
      if (!runner.getRun(runId)) return sendJson(res, 404, { error: 'not-found' });
      const zip = runner.zipOutput(runId);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="output-${runId}.zip"`, 'Content-Length': String(zip.length) });
      res.end(zip);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }

  return { handle };
}
```

- [ ] **Step 4: 运行测试**

Run: `node --test "server/test/ai-site-serve.test.js"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/ai-site/serve.js server/test/ai-site-serve.test.js
git commit -m "feat(ai-site): 站点路由与登录鉴权/SSE/文件下载"
```

---

### Task 8: 管理 API `server/ai-site/mount.js`

**Files:**
- Create: `server/ai-site/mount.js`
- Test: `server/test/ai-site-mount.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/ai-site-mount.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAiSiteMount } from '../ai-site/mount.js';

function call(mount, { method = 'GET', path: p = '/api/ai-site/config', body = null }) {
  return new Promise((resolve) => {
    const req = { method, url: p, headers: {}, on(ev, cb) { if (ev === 'data' && body) cb(Buffer.from(JSON.stringify(body))); if (ev === 'end') cb(); } };
    const chunks = [];
    const res = {
      statusCode: 0, headers: {},
      writeHead(s, h) { this.statusCode = s; this.headers = h || {}; },
      end(s) { chunks.push(s || ''); resolve({ status: this.statusCode, body: JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(String(c)))).toString('utf8') || '{}') }); },
    };
    mount(req, res, new URL(p, 'http://x'));
  });
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-mount-'));
  const pluginRoot = path.join(root, 'plugins');
  fs.mkdirSync(path.join(pluginRoot, 'p1'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'p1', 'manifest.json'), JSON.stringify({ name: 'P1', workflow: 'w.md' }));
  fs.writeFileSync(path.join(pluginRoot, 'p1', 'w.md'), 'x');
  const applied = [];
  return { root, pluginRoot, applied };
}

test('mount：配置读写、插件预览、用户增删改', async () => {
  const { root, pluginRoot, applied } = setup();
  const store = {
    cfg: { pluginRoot: '', mode: 'port', listenPort: 22300, pathPrefix: '/ai', enabled: false, requireAuth: true, sessionSecret: 'k'.repeat(48), listenHost: '0.0.0.0' },
    get() { return { ...this.cfg }; },
    save(patch) { this.cfg = { ...this.cfg, ...patch }; return { ...this.cfg }; },
  };
  const usersFile = path.join(root, 'users.json');
  const { createAiSiteUsers } = await import('../ai-site/users.js');
  const users = createAiSiteUsers({ file: usersFile });
  const mount = createAiSiteMount({
    configStore: store, users, getPlugins: (r) => [{ name: 'p1', title: 'P1' }], pluginsRoot: () => pluginRoot,
    apply: async () => { applied.push(1); }, status: () => ({ status: 'stopped' }),
  });

  const c = await call(mount, { path: '/api/ai-site/config' });
  assert.equal(c.status, 200);
  assert.equal(c.body.config.listenPort, 22300);

  const saved = await call(mount, { method: 'POST', path: '/api/ai-site/config', body: { enabled: true, listenPort: 22301 } });
  assert.equal(saved.status, 200);
  assert.equal(applied.length, 1);

  const pl = await call(mount, { path: '/api/ai-site/plugins' });
  assert.equal(pl.body.items.length, 1);

  const created = await call(mount, { method: 'POST', path: '/api/ai-site/users', body: { username: 'alice' } });
  assert.equal(created.status, 200);
  assert.ok(created.body.item.token);
  const id = created.body.item.id;

  const updated = await call(mount, { method: 'PATCH', path: '/api/ai-site/users', body: { id, enabled: false } });
  assert.equal(updated.body.item.enabled, false);

  const removed = await call(mount, { method: 'DELETE', path: `/api/ai-site/users?id=${id}` });
  assert.equal(removed.body.ok, true);
  assert.equal(users.list().length, 0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/ai-site-mount.test.js"`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

Create `server/ai-site/mount.js`:

```js
import { listPlugins } from './plugins.js';

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function sendErr(res, code) {
  const status = code === 'not-found' ? 404 : code === 'duplicate-username' ? 409 : 400;
  sendJson(res, status, { error: code || 'bad-request' });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''; const chunks = [];
    req.on('data', (c) => { raw += c; chunks.push(c); });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

export function createAiSiteMount({ configStore, users, apply, status, pluginsRoot }) {
  return async function mount(req, res, url) {
    const seg = url.pathname.replace(/^\/api\/ai-site\/?/, '').split('/').filter(Boolean);
    const head = seg[0] || '';
    const method = req.method;
    let body = {};
    try {
      if (method === 'POST' || method === 'PATCH') {
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      }
    } catch { body = {}; }

    try {
      if (head === 'config' && !seg[1]) {
        if (method === 'GET') return sendJson(res, 200, { config: configStore.get(), status: status() });
        if (method === 'POST') {
          const saved = configStore.save(body);
          await apply(saved);
          return sendJson(res, 200, { ok: true, config: saved, status: status() });
        }
      }
      if (head === 'start' && method === 'POST') {
        const saved = configStore.save({ enabled: true });
        await apply(saved);
        return sendJson(res, 200, { ok: true, config: saved, status: status() });
      }
      if (head === 'stop' && method === 'POST') {
        const saved = configStore.save({ enabled: false });
        await apply(saved);
        return sendJson(res, 200, { ok: true, config: saved, status: status() });
      }
      if (head === 'plugins' && method === 'GET') {
        return sendJson(res, 200, { items: listPlugins(pluginsRoot()) });
      }
      if (head === 'users' && !seg[1]) {
        if (method === 'GET') return sendJson(res, 200, { items: users.list() });
        if (method === 'POST') return sendJson(res, 200, { ok: true, item: users.create(body) });
        if (method === 'PATCH') return sendJson(res, 200, { ok: true, item: users.update(String(body.id || ''), body) });
        if (method === 'DELETE') {
          const id = String(url.searchParams.get('id') || '');
          return sendJson(res, 200, { ok: users.remove(id) });
        }
      }
      return sendJson(res, 404, { error: 'not-found' });
    } catch (e) {
      return sendErr(res, (e && e.code) || 'bad-request');
    }
  };
}
```

- [ ] **Step 4: 运行测试**

Run: `node --test "server/test/ai-site-mount.test.js"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/ai-site/mount.js server/test/ai-site-mount.test.js
git commit -m "feat(ai-site): 配置/插件预览/用户管理 API"
```

---

### Task 9: 装配 `server/ai-site/index.js`

**Files:**
- Create: `server/ai-site/index.js`
- Test: `server/test/ai-site-index.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/ai-site-index.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAiSite } from '../ai-site/index.js';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-index-'));
  const pluginRoot = path.join(root, 'plugins');
  fs.mkdirSync(path.join(pluginRoot, 'p1'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'p1', 'manifest.json'), JSON.stringify({ name: 'P1', workflow: 'w.md' }));
  fs.writeFileSync(path.join(pluginRoot, 'p1', 'w.md'), 'x');
  return { root, pluginRoot };
}

test('ai-site：路径模式匹配与剥离前缀', async () => {
  const { root, pluginRoot } = setup();
  let seenPath = '';
  const site = createAiSite({
    dir: path.join(root, 'ai-site'), logger: console,
    isPrefixTaken: () => false,
    serveOptions: { getConfig: null },
  });
  site.configStore.save({ pluginRoot, mode: 'path', pathPrefix: '/ai', enabled: true, requireAuth: false });
  assert.equal(site.matchPath('/ai'), true);
  assert.equal(site.matchPath('/ai/p/x'), true);
  assert.equal(site.matchPath('/apix'), false);
  assert.equal(site.matchPath('/api/x'), false);
  site.configStore.save({ mode: 'path', pathPrefix: '/ai2', enabled: false });
  assert.equal(site.matchPath('/ai2'), false);
  await site.stop();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/ai-site-index.test.js"`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

Create `server/ai-site/index.js`:

```js
import http from 'node:http';
import path from 'node:path';
import { createAiSiteConfigStore } from './config-store.js';
import { createAiSiteUsers } from './users.js';
import { createAiSiteRunner } from './runner.js';
import { createAiSiteServe } from './serve.js';
import { createAiSiteMount } from './mount.js';
import { listPlugins } from './plugins.js';

function matchPrefix(prefix, pathname) {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

export function createAiSite({ dir, logger = console, isPrefixTaken = () => false, runnerOptions = {} } = {}) {
  const configStore = createAiSiteConfigStore({ file: path.join(dir, 'config.json'), isPrefixTaken });
  const users = createAiSiteUsers({ file: path.join(dir, 'users.json') });
  const runner = createAiSiteRunner({ runsDir: path.join(dir, 'runs'), ...runnerOptions });
  const serve = createAiSiteServe({ getConfig: () => configStore.get(), users, runner, logger });
  let server = null;
  let state = { status: 'stopped', error: null };

  // config 变更时 serve/runner 都通过 getConfig() 实时读取；此处只负责监听生命周期。

  function matchPath(pathname) {
    const cfg = configStore.get();
    return !!(cfg.enabled && cfg.mode === 'path' && matchPrefix(cfg.pathPrefix, pathname));
  }

  function handleHttp(req, res, url) {
    const cfg = configStore.get();
    const prefix = cfg.mode === 'path' ? cfg.pathPrefix : '';
    let nextUrl = url;
    if (prefix && matchPrefix(prefix, url.pathname)) {
      const stripped = url.pathname.slice(prefix.length) || '/';
      nextUrl = new URL(stripped + url.search, 'http://localhost');
    }
    serve.handle(req, res, nextUrl, { base: prefix });
  }

  async function start() {
    await stop();
    const cfg = configStore.get();
    if (!cfg.enabled || cfg.mode !== 'port') { state = { status: 'stopped', error: null }; return; }
    server = http.createServer((req, res) => {
      let url;
      try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); res.end(); return; }
      serve.handle(req, res, url, { base: '' });
    });
    await new Promise((resolve) => {
      server.once('error', (e) => {
        state = { status: 'error', error: e && e.code === 'EADDRINUSE' ? 'port-in-use' : String((e && e.message) || e) };
        logger?.warn?.(`ai-site listen failed: ${state.error}`);
        server = null;
        resolve();
      });
      server.listen(cfg.listenPort, cfg.listenHost, () => {
        state = { status: 'running', error: null };
        logger?.info?.(`ai-site listening on http://${cfg.listenHost}:${cfg.listenPort}`);
        resolve();
      });
    });
  }

  async function stop() {
    const s = server;
    server = null;
    state = { status: 'stopped', error: null };
    if (!s) return;
    await new Promise((resolve) => { try { s.close(() => resolve()); } catch { resolve(); } });
  }

  async function apply() { await start(); }

  const mount = createAiSiteMount({
    configStore, users, apply,
    status: () => ({ ...state, mode: configStore.get().mode, enabled: configStore.get().enabled }),
    pluginsRoot: () => configStore.get().pluginRoot,
  });

  return {
    configStore, users, runner, serve, mount,
    matchPath, handleHttp, start, stop, apply,
    status: () => ({ ...state }),
    listPlugins: () => listPlugins(configStore.get().pluginRoot),
  };
}
```

- [ ] **Step 4: 运行测试**

Run: `node --test "server/test/ai-site-index.test.js"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/ai-site/index.js server/test/ai-site-index.test.js
git commit -m "feat(ai-site): 站点装配（端口监听/路径拦截）"
```

---

### Task 10: 接入主服务 `server/index.js`

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 加 import**

在 `server/index.js` 的 `import { createProxyMount } ...` 附近加：

```js
import { createAiSite } from './ai-site/index.js';
```

（实际 import 位置以文件里 proxy 相关 import 为准。）

- [ ] **Step 2: buildWorkspace 里创建 aiSite**

在 `const proxyMount = createProxyMount(...)` 之后加：

```js
  const aiSite = createAiSite({
    dir: paths.aiSiteDir,
    logger: log,
    isPrefixTaken: (prefix) => proxyStore.list().some((r) => r.mode === 'path' && (r.pathPrefix === prefix || r.pathPrefix.startsWith(prefix + '/') || prefix.startsWith(r.pathPrefix + '/'))),
  });
```

在 `return { ... }` 的对象里加 `aiSite`。

> 补充：`initWorkspace` 的 `NODE` 逃生分支会覆盖 `dir` 等路径，请在它的 `ensurePortDirs({...})` 对象里补 `aiSiteDir: path.join(stateRoot, 'ai-site'), aiSiteRunsDir: path.join(stateRoot, 'ai-site', 'runs')`，避免 AI 站点数据落回默认端口目录。

- [ ] **Step 3: initWorkspace 启动**

在 `void ws.proxyEngine.startEnabled()...` 之后加：

```js
  void ws.aiSite.start().catch((e) => log.warn('ai-site start failed', (e && e.message) || e));
```

- [ ] **Step 4: 请求分发（路径模式，放在远程门禁之前）**

在 `const url = new URL(req.url, 'http://localhost');` 之后、`// 远程访问门禁` 之前加：

```js
  // AI 命令执行站点：路径模式优先拦截，走站点自己的登录鉴权（不受 devflow 远程门禁影响）
  if (ws && ws.aiSite && ws.aiSite.matchPath(url.pathname)) {
    ws.aiSite.handleHttp(req, res, url);
    return;
  }
```

- [ ] **Step 5: 管理 API 挂载**

在 `if (url.pathname.startsWith('/api/nginx')) { ... }` 之前加：

```js
  if (url.pathname.startsWith('/api/ai-site')) { await ws.aiSite.mount(req, res, url); return; }
```

- [ ] **Step 6: 运行现有服务端测试**

Run: `npm.cmd run test:server`
Expected: 全部 PASS（若因无关改动失败，先确认不是本次引入）。

- [ ] **Step 7: 提交**

```bash
git add server/index.js
git commit -m "feat(ai-site): 主服务接入 AI 站点与 /api/ai-site"
```

---

### Task 11: 前端数据层 `web/src/tools/ai-site/useAiSite.ts`

**Files:**
- Create: `web/src/tools/ai-site/useAiSite.ts`
- Test: `web/src/tools/ai-site/useAiSite.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/src/tools/ai-site/useAiSite.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAiSite } from './useAiSite';

function okJson(body: unknown) { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response); }

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.restoreAllMocks();
  fetchMock = vi.fn((u: string) => {
    if (String(u) === '/api/ai-site/config') return okJson({ config: { pluginRoot: 'C:/p', mode: 'port', listenPort: 22300, pathPrefix: '/ai', enabled: true, requireAuth: true, listenHost: '0.0.0.0', sessionSecret: 'x' }, status: { status: 'running' } });
    if (String(u) === '/api/ai-site/plugins') return okJson({ items: [{ name: 'p1', title: 'P1' }] });
    if (String(u) === '/api/ai-site/users') return okJson({ items: [{ id: 'u1', username: 'alice', uses: 2 }] });
    return okJson({});
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('useAiSite', () => {
  it('load 读取配置/插件/用户', async () => {
    const api = useAiSite();
    await api.load();
    expect(api.config.value?.pluginRoot).toBe('C:/p');
    expect(api.status.value?.status).toBe('running');
    expect(api.plugins.value[0].name).toBe('p1');
    expect(api.users.value[0].username).toBe('alice');
  });

  it('save/start/stop 走 POST', async () => {
    const api = useAiSite();
    await api.save({ enabled: true });
    await api.start();
    await api.stop();
    const methods = fetchMock.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method);
    expect(methods).toContain('POST');
  });

  it('pickFolder 调项目选择接口', async () => {
    fetchMock.mockImplementation(() => okJson({ path: 'C:/plugins' }));
    const api = useAiSite();
    const r = await api.pickFolder();
    expect(r.path).toBe('C:/plugins');
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/projects/pick');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- useAiSite`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

Create `web/src/tools/ai-site/useAiSite.ts`:

```ts
import { ref, type Ref } from 'vue';

export interface AiSiteConfig {
  pluginRoot: string;
  mode: 'port' | 'path';
  listenHost: string;
  listenPort: number;
  pathPrefix: string;
  enabled: boolean;
  requireAuth: boolean;
  sessionSecret: string;
}
export interface AiSiteStatus { status: 'running' | 'stopped' | 'error'; error: string | null; mode?: string; enabled?: boolean }
export interface AiSiteUser { id: string; username: string; token: string; enabled: boolean; uses: number; lastLoginAt: number; lastRunAt: number }
export interface AiSitePlugin { name: string; title: string; description: string; hasLogo: boolean; fields: unknown[]; error: string | null }

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function jfetch(url: string, opt: RequestInit = {}): Promise<any> {
  const res = await fetch(url, opt);
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(j?.error || `HTTP ${res.status}`));
  return j;
}

export interface AiSiteApi {
  config: Ref<AiSiteConfig | null>;
  status: Ref<AiSiteStatus | null>;
  users: Ref<AiSiteUser[]>;
  plugins: Ref<AiSitePlugin[]>;
  load: () => Promise<void>;
  save: (patch: Partial<AiSiteConfig>) => Promise<AiSiteConfig>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  createUser: (username: string) => Promise<AiSiteUser>;
  updateUser: (id: string, patch: Partial<AiSiteUser>) => Promise<AiSiteUser>;
  removeUser: (id: string) => Promise<void>;
  pickFolder: () => Promise<{ path?: string; cancelled?: boolean; error?: string; message?: string }>;
}

export function useAiSite(): AiSiteApi {
  const config = ref<AiSiteConfig | null>(null);
  const status = ref<AiSiteStatus | null>(null);
  const users = ref<AiSiteUser[]>([]);
  const plugins = ref<AiSitePlugin[]>([]);

  async function loadPlugins() {
    const j = await jfetch('/api/ai-site/plugins');
    plugins.value = Array.isArray(j.items) ? j.items : [];
  }

  async function loadUserList() {
    const j = await jfetch('/api/ai-site/users');
    users.value = Array.isArray(j.items) ? j.items : [];
  }

  async function load(): Promise<void> {
    const j = await jfetch('/api/ai-site/config');
    config.value = j.config as AiSiteConfig;
    status.value = j.status as AiSiteStatus;
    await Promise.all([loadPlugins(), loadUserList()]);
  }

  async function save(patch: Partial<AiSiteConfig>): Promise<AiSiteConfig> {
    const j = await jfetch('/api/ai-site/config', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(patch) });
    config.value = j.config as AiSiteConfig;
    status.value = j.status as AiSiteStatus;
    await loadPlugins();
    return config.value;
  }

  async function start(): Promise<void> {
    const j = await jfetch('/api/ai-site/start', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    config.value = j.config as AiSiteConfig;
    status.value = j.status as AiSiteStatus;
  }

  async function stop(): Promise<void> {
    const j = await jfetch('/api/ai-site/stop', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    config.value = j.config as AiSiteConfig;
    status.value = j.status as AiSiteStatus;
  }

  async function createUser(username: string): Promise<AiSiteUser> {
    const j = await jfetch('/api/ai-site/users', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ username }) });
    await loadUserList();
    return j.item as AiSiteUser;
  }

  async function updateUser(id: string, patch: Partial<AiSiteUser>): Promise<AiSiteUser> {
    const j = await jfetch('/api/ai-site/users', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ id, ...patch }) });
    await loadUserList();
    return j.item as AiSiteUser;
  }

  async function removeUser(id: string): Promise<void> {
    await jfetch(`/api/ai-site/users?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadUserList();
  }

  function pickFolder(): Promise<{ path?: string; cancelled?: boolean; error?: string; message?: string }> {
    return jfetch('/api/projects/pick', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
  }

  return { config, status, users, plugins, load, save, start, stop, createUser, updateUser, removeUser, pickFolder };
}
```

- [ ] **Step 4: 运行测试**

Run: `npm.cmd --prefix web run test -- useAiSite`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/tools/ai-site/useAiSite.ts web/src/tools/ai-site/useAiSite.test.ts
git commit -m "feat(ai-site): 前端数据层 useAiSite"
```

---

### Task 12: 前端视图 `AiSiteView.vue` + 页签接入

**Files:**
- Create: `web/src/tools/ai-site/AiSiteView.vue`
- Modify: `web/src/components/ProxyHubView.vue`
- Modify: `web/src/uiIntents.ts:7`
- Test: `web/src/tools/ai-site/AiSiteView.test.ts`

- [ ] **Step 1: `uiIntents.ts` 增加 `'ai'`**

```ts
export type ProxyTab = 'ai' | 'nginx' | 'static' | 'llm';
```

- [ ] **Step 2: `ProxyHubView.vue` 接入**

改 `loadTab` 的合法值判断，并在页签条最左侧加 ai 按钮、内容区加组件：

```ts
import AiSiteView from '../tools/ai-site/AiSiteView.vue';
const KEY = 'devflow-proxy-tab';
function loadTab(): ProxyTab {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v === 'ai' || v === 'nginx' || v === 'static' || v === 'llm') return v;
  } catch { /* ignore */ }
  return 'static';
}
```

模板 `hubbar` 内、`static` 按钮之前：

```html
<button class="hubtab" :class="{ on: tab === 'ai' }" @click="setTab('ai')">{{ $t('proxy.tabs.ai') }}</button>
```

`hubbody` 内、`StaticSitesView` 之前：

```html
<AiSiteView v-show="tab === 'ai'" />
```

- [ ] **Step 3: 写失败测试**

Create `web/src/tools/ai-site/AiSiteView.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import AiSiteView from './AiSiteView.vue';

function okJson(body: unknown) { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response); }

const CONFIG = { pluginRoot: 'C:/plugins', mode: 'port', listenHost: '0.0.0.0', listenPort: 22300, pathPrefix: '/ai', enabled: true, requireAuth: true, sessionSecret: 'x' };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.restoreAllMocks();
  fetchMock = vi.fn((u: string, opt?: RequestInit) => {
    const s = String(u);
    if (s === '/api/ai-site/config' && (!opt || opt.method !== 'POST')) return okJson({ config: CONFIG, status: { status: 'running', error: null } });
    if (s === '/api/ai-site/config') return okJson({ config: CONFIG, status: { status: 'running', error: null } });
    if (s === '/api/ai-site/plugins') return okJson({ items: [{ name: 'p1', title: 'P1', description: 'd' }] });
    if (s === '/api/ai-site/users') return okJson({ items: [{ id: 'u1', username: 'alice', token: 't', enabled: true, uses: 2, lastLoginAt: 0, lastRunAt: 0 }] });
    if (s.startsWith('/api/projects/pick')) return okJson({ path: 'C:/plugins' });
    return okJson({ ok: true, item: { id: 'u2', username: 'bob', token: 't2' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('AiSiteView', () => {
  it('展示配置、插件与用户使用次数', async () => {
    const w = mountC(AiSiteView);
    await flushPromises();
    expect((w.find('[data-field="plugin-root"]').element as HTMLInputElement).value).toBe('C:/plugins');
    expect(w.text()).toContain('P1');
    expect(w.text()).toContain('alice');
    expect(w.text()).toContain('2');
    w.unmount();
  });

  it('新增用户走 POST /api/ai-site/users', async () => {
    const w = mountC(AiSiteView);
    await flushPromises();
    await w.find('[data-field="new-user"]').setValue('bob');
    await w.find('[data-action="add-user"]').trigger('click');
    await flushPromises();
    const post = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/ai-site/users' && (c[1] as RequestInit)?.method === 'POST');
    expect(post).toBeTruthy();
    w.unmount();
  });
});
```

- [ ] **Step 4: 运行确认失败**

Run: `npm.cmd --prefix web run test -- AiSiteView`
Expected: FAIL（模块不存在）。

- [ ] **Step 5: 写实现**

Create `web/src/tools/ai-site/AiSiteView.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { t } from '../../i18n';
import { copyText } from '../../clipboard';
import { useAiSite, type AiSiteConfig, type AiSiteUser } from './useAiSite';

const api = useAiSite();
const form = ref<AiSiteConfig | null>(null);
const msg = ref('');
const busy = ref(false);
const newUser = ref('');

function baseHost(): string {
  const c = form.value;
  if (!c) return '';
  if (c.mode === 'port') return `http://${location.hostname}:${c.listenPort}`;
  return `${location.origin}${c.pathPrefix}`;
}
const accessUrl = () => `${baseHost()}/`;

onMounted(async () => {
  try {
    await api.load();
    form.value = api.config.value ? { ...api.config.value } : null;
  } catch (e) { msg.value = String((e as Error)?.message || e); }
});

async function pickDir() {
  try {
    const r = await api.pickFolder();
    if (r.error) { msg.value = r.error === 'unsupported' ? t('nginx.pick_unsupported') : t('nginx.pick_failed', { msg: r.message || r.error }); return; }
    if (r.cancelled || !r.path || !form.value) return;
    form.value = { ...form.value, pluginRoot: r.path };
  } catch (e) { msg.value = String((e as Error)?.message || e); }
}

async function doSave() {
  if (!form.value) return;
  busy.value = true; msg.value = '';
  try {
    const saved = await api.save(form.value);
    form.value = { ...saved };
    msg.value = t('nginx.saved_ok');
  } catch (e) { msg.value = String((e as Error)?.message || e); } finally { busy.value = false; }
}

async function toggle() {
  busy.value = true;
  try {
    if (api.status.value?.status === 'running') await api.stop(); else await api.start();
    form.value = api.config.value ? { ...api.config.value } : null;
  } catch (e) { msg.value = String((e as Error)?.message || e); } finally { busy.value = false; }
}

async function addUser() {
  const name = newUser.value.trim();
  if (!name) return;
  try {
    const u = await api.createUser(name);
    newUser.value = '';
    await copyText(u.token);
    msg.value = t('nginx.copied');
  } catch (e) { msg.value = String((e as Error)?.message || e); }
}

async function toggleUser(u: AiSiteUser) {
  try { await api.updateUser(u.id, { enabled: !u.enabled }); } catch (e) { msg.value = String((e as Error)?.message || e); }
}

async function removeUser(u: AiSiteUser) {
  try { await ElMessageBox.confirm(u.username, t('nginx.delete'), { type: 'warning' }); } catch { return; }
  try { await api.removeUser(u.id); } catch (e) { msg.value = String((e as Error)?.message || e); }
}

async function copyAccess() { await copyText(accessUrl()); msg.value = t('nginx.copied'); }
function openSite() { window.open(accessUrl(), '_blank', 'noopener'); }
function copyToken(u: AiSiteUser) { void copyText(u.token); msg.value = t('nginx.copied'); }
</script>

<template>
  <div v-if="form" class="aibody">
    <section class="aicard">
      <div class="aihead">
        <b>{{ $t('ai_site.title') }}</b>
        <span class="aistat" :class="api.status.value?.status">{{ api.status.value?.status }}</span>
      </div>
      <div class="airow">
        <label class="aigrow">{{ $t('static_site.root_dir') }}
          <input v-model="form.pluginRoot" class="aiin" data-field="plugin-root" :placeholder="$t('nginx.static_dir_ph')" />
        </label>
        <button class="aibtn" @click="pickDir">{{ $t('nginx.pick_dir') }}</button>
      </div>
      <div class="airow">
        <label>{{ $t('nginx.mode') }}
          <select v-model="form.mode" class="aiin">
            <option value="port">{{ $t('nginx.mode_port') }}</option>
            <option value="path">{{ $t('nginx.mode_path') }}</option>
          </select>
        </label>
        <label v-if="form.mode === 'port'">{{ $t('nginx.listen') }}
          <input v-model.number="form.listenPort" type="number" class="aiin" min="1" max="65535" />
        </label>
        <label v-else>{{ $t('nginx.path_prefix') }}
          <input v-model="form.pathPrefix" class="aiin" placeholder="/ai" />
        </label>
        <label class="aichk"><input v-model="form.requireAuth" type="checkbox" />{{ $t('ai_site.login.title') }}</label>
      </div>
      <div class="aiactions">
        <button class="aibtn primary" :disabled="busy" @click="doSave">{{ $t('nginx.saved') }}</button>
        <button class="aibtn" :disabled="busy" @click="toggle">{{ api.status.value?.status === 'running' ? $t('nginx.stop') : $t('nginx.start') }}</button>
        <span class="aimsg">{{ msg }}</span>
      </div>
      <div class="aiurl">
        <code>{{ accessUrl() }}</code>
        <button class="aibtn" @click="copyAccess">{{ $t('nginx.copy') }}</button>
        <button class="aibtn" @click="openSite">{{ $t('static_site.open') }}</button>
      </div>
    </section>

    <section class="aicard">
      <div class="aihead"><b>{{ $t('ai_site.login.title') }}</b></div>
      <div class="airow">
        <input v-model="newUser" class="aiin" data-field="new-user" :placeholder="$t('ai_site.login.username')" />
        <button class="aibtn primary" data-action="add-user" @click="addUser">+</button>
      </div>
      <div v-for="u in api.users.value" :key="u.id" class="aiuser">
        <span class="ainame">{{ u.username }}</span>
        <span class="a muted">{{ u.uses }}</span>
        <button class="aibtn" @click="copyToken(u)">{{ $t('nginx.copy') }}</button>
        <label class="aichk"><input type="checkbox" :checked="u.enabled" @change="toggleUser(u)" />{{ u.enabled ? 'on' : 'off' }}</label>
        <button class="aibtn danger" @click="removeUser(u)">×</button>
      </div>
    </section>

    <section class="aicard">
      <div class="aihead"><b>{{ $t('ai_site.result.output') }}</b></div>
      <div v-if="!api.plugins.value.length" class="a muted">{{ $t('ai_site.plugins.empty') }}</div>
      <div v-for="p in api.plugins.value" :key="p.name" class="aiplugin">
        <b>{{ p.title }}</b>
        <span class="a muted">{{ p.name }} · {{ p.description }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.aibody { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 10px; overflow: auto; padding: 8px 10px; box-sizing: border-box; }
.aicard { border: 1px solid var(--bd); border-radius: 8px; background: var(--bg3); padding: 10px; display: flex; flex-direction: column; gap: 8px; flex: none; }
.aihead { display: flex; align-items: center; gap: 8px; color: var(--tx1); }
.aihead b { flex: 1; }
.aistat { font-size: 12px; color: var(--tx3); }
.aistat.running { color: #2ecc71; }
.aistat.error { color: #e74c3c; }
.airow { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
.airow label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--tx2); }
.aigrow { flex: 1; min-width: 260px; }
.aichk { flex-direction: row !important; align-items: center; gap: 6px; }
.aiin { background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 6px; padding: 4px 6px; }
.aiactions, .aiurl { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.aiurl code { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: var(--tx3); background: var(--bg2); border: 1px solid var(--bd); border-radius: 6px; padding: 4px 6px; overflow-wrap: anywhere; }
.aibtn { background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.aibtn.primary { border-color: var(--ac2); color: var(--ac2); }
.aibtn.danger { border-color: var(--err); color: var(--err); }
.aimsg { color: var(--ac2); }
.aiuser, .aiplugin { display: flex; gap: 8px; align-items: center; font-size: 12px; }
.ainame { font-weight: 600; color: var(--tx2); }
.a.muted { color: var(--tx4); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
```

- [ ] **Step 6: 运行测试**

Run: `npm.cmd --prefix web run test -- AiSiteView`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add web/src/tools/ai-site/AiSiteView.vue web/src/tools/ai-site/AiSiteView.test.ts web/src/components/ProxyHubView.vue web/src/uiIntents.ts
git commit -m "feat(ai-site): 前端 AI 命令执行页签与配置/用户视图"
```

---

### Task 13: 全量校验

**Files:** 无

- [ ] **Step 1: i18n 对称检查**

Run: `npm.cmd run check:i18n`
Expected: 通过（无缺失/多余键、无中文硬编码）。

- [ ] **Step 2: 服务端测试**

Run: `npm.cmd run test:server`
Expected: 全部 PASS。

- [ ] **Step 3: 前端测试**

Run: `npm.cmd run test:web`
Expected: 全部 PASS。

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过。

- [ ] **Step 5: 提交（若上一步产生类型/格式修复）**

```bash
git add -u
git commit -m "chore(ai-site): 校验修复"
```

---

## 自检记录（写完计划后回看规格）

- 规格目标：页签位置 ✅ Task 12；配置/模式 ✅ Task 2/9；插件扫描与 logo ✅ Task 4；列表/表单/执行页 ✅ Task 6；执行流（input.json/workflow 复制/output/agent） ✅ Task 5；用户名+Token 鉴权 ✅ Task 3/7；关闭鉴权 ✅ Task 2/7；使用次数 ✅ Task 3/5/7；保留 50 ✅ Task 5；i18n ✅ Task 6/13。
- 占位符扫描：无 TBD/TODO；每个代码步骤给了完整代码。
- 类型一致性：`createAiSiteServe({ getConfig, users, runner, logger })`、`runner.createRun({ pluginName, pluginDir, workflowPath, values, user })`、`runner.listFiles/readFile/zipOutput`、`configStore.get/save` 在各任务中一致。
- 已知偏差（有意）：先复制 workflow 再写 `input.json`（避免插件自带 input.json 覆盖用户输入）；`formPage` 的 zip 链接用前端赋值 runId。
