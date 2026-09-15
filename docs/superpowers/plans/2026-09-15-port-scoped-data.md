# 数据按端口隔离 + 端口外置到 `<应用目录>/data` 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **本项目按 AGENTS.md 规定使用 inline 执行**（本会话内执行，不用 subagent 驱动）。

**Goal:** 把「监听端口」与「数据目录」改成一一对应：端口存在 `<应用目录>/data/port.txt`，所有数据在 `<dataHome>/ports/<端口>/`，端口之间零共享。

**Architecture:** 新增两个纯逻辑模块（`server/port-file.js` 管端口文件读写与优先级、`server/port-paths.js` 管端口数据目录推导），把 `data-home.js` 的全局目录函数改为按端口，删除整套 profile 多档案机制（`workspace.js` / `workspace-http.js` / 选择界面 / `ports-state.json`），`devflow.xml` 不再承载 `port` 属性。

**Tech Stack:** Node 24 ESM（`node --test`）、Vue 3 + Vite + TS（`vitest` + `vue-tsc`）、PowerShell 5.1（Windows 打包脚本）。

**Spec:** `docs/superpowers/specs/2026-09-15-port-scoped-data-design.md`

**通用约定**

- 所有命令在仓库根 `D:\root\devflow\devflow` 执行；npm 一律用 `npm.cmd`（PowerShell 执行策略拦截 `npm.ps1`）。
- 单测：`node --test "server/test/<file>.test.js"`（Node 24 不接受目录参数）。
- 每个 Task 结束：跑相关单测 → `git add <具体文件>`（禁止 `git add -A`）→ commit。
- 提交前按 `docs/learn/git仓库提交检查和提交事项.md` 跑敏感信息扫描。

---

### Task 1: 端口文件模块 `server/port-file.js` + 端口数据目录模块 `server/port-paths.js`

**Files:**
- Create: `server/port-file.js`
- Create: `server/port-paths.js`
- Test: `server/test/port-file.test.js`
- Test: `server/test/port-paths.test.js`

- [ ] **Step 1: 写失败测试 `server/test/port-file.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validPort, readPortFile, writePortFile, resolvePort, DEFAULT_PORT,
} from '../port-file.js';

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-port-')), 'port.txt'); }

test('validPort 只接受 1-65535 整数', () => {
  assert.equal(validPort(22222), 22222);
  assert.equal(validPort('44444'), 44444);
  assert.equal(validPort(0), null);
  assert.equal(validPort(65536), null);
  assert.equal(validPort('abc'), null);
  assert.equal(validPort('22.5'), null);
  assert.equal(validPort(''), null);
  assert.equal(validPort(null), null);
});

test('readPortFile 缺失/非数字/越界一律 null', () => {
  const f = tmpFile();
  assert.equal(readPortFile(f), null);
  fs.writeFileSync(f, '  44444 \n', 'utf8');
  assert.equal(readPortFile(f), 44444, '应 trim');
  fs.writeFileSync(f, 'abc', 'utf8');
  assert.equal(readPortFile(f), null);
  fs.writeFileSync(f, '70000', 'utf8');
  assert.equal(readPortFile(f), null);
});

test('writePortFile 原子写入并可读回；非法值抛 bad-port', () => {
  const f = tmpFile();
  assert.equal(writePortFile(4100, f), 4100);
  assert.equal(fs.readFileSync(f, 'utf8'), '4100');
  assert.equal(fs.existsSync(f + '.tmp'), false, '不应残留 tmp');
  assert.equal(readPortFile(f), 4100);
  assert.throws(() => writePortFile(0, f), /bad-port|invalid port/);
});

test('resolvePort 优先级：env > 文件 > 默认', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '25000', 'utf8');
  assert.equal(resolvePort({ env: '33333', portFile: f }), 33333);
  assert.equal(resolvePort({ env: '', portFile: f }), 25000);
  assert.equal(resolvePort({ env: 'not-a-port', portFile: f }), 25000, 'env 非法则回落文件');
  assert.equal(resolvePort({ env: '', portFile: tmpFile() }), DEFAULT_PORT);
  assert.equal(DEFAULT_PORT, 22222);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/port-file.test.js"`
Expected: FAIL — `Cannot find module .../port-file.js`

- [ ] **Step 3: 实现 `server/port-file.js`**

```js
// 监听端口的唯一权威源：<应用目录>/data/port.txt（单行纯数字）。
// 应用目录 = server 的上一级（绿色包根 / 仓库根），与启动时的工作目录无关。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const APP_DIR = path.join(__dirname, '..');
export const DATA_DIR = path.join(APP_DIR, 'data');
export const PORT_FILE = path.join(DATA_DIR, 'port.txt');
export const RUNTIME_PORT_FILE = path.join(DATA_DIR, 'runtime-port.txt');
export const DEFAULT_PORT = 22222;

export function validPort(n) {
  const p = Number(n);
  return Number.isInteger(p) && p >= 1 && p <= 65535 ? p : null;
}

export function readPortFile(file = PORT_FILE) {
  try {
    const text = String(fs.readFileSync(file, 'utf8')).trim();
    if (!/^\d+$/.test(text)) return null;
    return validPort(text);
  } catch { return null; }
}

export function writePortFile(port, file = PORT_FILE) {
  const p = validPort(port);
  if (!p) throw Object.assign(new Error('invalid port'), { code: 'bad-port' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, String(p), 'utf8');
  fs.renameSync(tmp, file);
  return p;
}

// env（DEVFLOW_PORT）> data/port.txt > 默认端口
export function resolvePort({ env = process.env.DEVFLOW_PORT, portFile = PORT_FILE, fallback = DEFAULT_PORT } = {}) {
  return validPort(env) ?? readPortFile(portFile) ?? validPort(fallback) ?? DEFAULT_PORT;
}

// 服务实际监听成功后写，供启动器（launch.ps1 / start.command）打开浏览器
export function writeRuntimePort(port, file = RUNTIME_PORT_FILE) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(port), 'utf8');
  } catch { /* ignore */ }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/port-file.test.js"`
Expected: PASS（4 tests）

- [ ] **Step 5: 写失败测试 `server/test/port-paths.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { portPaths, portRoot, ensurePortDirs } from '../port-paths.js';

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-portpaths-')); }

test('portPaths 全部落在 ports/<端口> 下', () => {
  const root = tmpRoot();
  const p = portPaths(44444, { root });
  const base = path.join(root, 'ports', '44444');
  assert.equal(p.id, '44444');
  assert.equal(p.port, 44444);
  assert.equal(p.dir, base);
  assert.equal(p.projectsFile, path.join(base, 'projects.json'));
  assert.equal(p.workflowsFile, path.join(base, 'workflows.json'));
  assert.equal(p.schedulerDir, path.join(base, 'scheduler'));
  assert.equal(p.collabDir, path.join(base, 'collab'));
  assert.equal(p.identityFile, path.join(base, 'collab', 'identity.json'));
  assert.equal(p.storeFile, path.join(base, 'collab', 'collab.json'));
  assert.equal(p.uploadDir, path.join(base, 'upload'));
  assert.equal(p.downloadDir, path.join(base, 'download'));
  assert.equal(p.downloadsDir, path.join(base, 'downloads'));
  assert.equal(p.relayPluginsDir, path.join(base, 'downloads', 'relay-plugins'));
  assert.equal(p.historyFile, path.join(base, 'message-history.jsonc'));
  assert.equal(p.skillsRoot, path.join(base, 'skills-opencode'));
  assert.equal(portRoot(44444, root), base);
});

test('同端口推导稳定，不同端口互不重叠', () => {
  const root = tmpRoot();
  assert.deepEqual(portPaths(22222, { root }), portPaths('22222', { root }));
  assert.notEqual(portPaths(22222, { root }).dir, portPaths(33333, { root }).dir);
});

test('ensurePortDirs 幂等创建必需子目录', () => {
  const root = tmpRoot();
  const p = ensurePortDirs(portPaths(22222, { root }));
  for (const d of [p.dir, p.schedulerDir, p.collabDir, p.uploadDir, p.downloadDir, p.downloadsDir, p.skillsRoot]) {
    assert.ok(fs.existsSync(d), d + ' 应存在');
  }
  ensurePortDirs(p);   // 第二次不抛
});
```

- [ ] **Step 6: 实现 `server/port-paths.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { dataHome } from './data-home.js';

// 端口数据根：<dataHome>/ports/<端口>
export function portRoot(port, root = dataHome()) {
  return path.join(root, 'ports', String(port));
}

// 纯路径推导：一个端口一份数据，全部在 ports/<端口>/ 下
export function portPaths(port, { root = dataHome() } = {}) {
  const dir = portRoot(port, root);
  return {
    id: String(port),
    port: Number(port),
    dir,
    projectsFile: path.join(dir, 'projects.json'),
    workflowsFile: path.join(dir, 'workflows.json'),
    schedulerDir: path.join(dir, 'scheduler'),
    collabDir: path.join(dir, 'collab'),
    identityFile: path.join(dir, 'collab', 'identity.json'),
    storeFile: path.join(dir, 'collab', 'collab.json'),
    uploadDir: path.join(dir, 'upload'),
    downloadDir: path.join(dir, 'download'),
    downloadsDir: path.join(dir, 'downloads'),
    relayPluginsDir: path.join(dir, 'downloads', 'relay-plugins'),
    historyFile: path.join(dir, 'message-history.jsonc'),
    skillsRoot: path.join(dir, 'skills-opencode'),
  };
}

export function ensurePortDirs(paths) {
  for (const d of [paths.dir, paths.schedulerDir, paths.collabDir, paths.uploadDir, paths.downloadDir, paths.downloadsDir, paths.skillsRoot]) {
    fs.mkdirSync(d, { recursive: true });
  }
  return paths;
}
```

- [ ] **Step 7: 跑测试确认通过**

Run: `node --test "server/test/port-file.test.js" "server/test/port-paths.test.js"`
Expected: PASS（7 tests）

- [ ] **Step 8: 提交**

```bash
git add server/port-file.js server/port-paths.js server/test/port-file.test.js server/test/port-paths.test.js
git commit -m "feat(server): 端口文件与端口数据目录模块（port-file/port-paths）"
```

---

### Task 2: `data-home.js` 端口化 + 清理死代码与遗留文件

**Files:**
- Modify: `server/data-home.js`
- Modify: `server/config.js:4,36-47`
- Modify: `server/devflow-config.js:105-114`
- Modify: `server/llm-mount.js:11,103,248`
- Modify: `server/index.js:26,32,52-56,204-205`
- Delete: `server/projects.json`、`server/workflows.json`
- Test: `server/test/data-home.test.js`

- [ ] **Step 1: 改写 `server/test/data-home.test.js`（先红）**

整文件替换为：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataHome, downloadsDir, relayPluginsDir } from '../data-home.js';

function withDataHome(fn) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'df-data-'));
  const prev = process.env.DEVFLOW_DATA_HOME;
  process.env.DEVFLOW_DATA_HOME = data;
  try { fn(data); } finally {
    if (prev === undefined) delete process.env.DEVFLOW_DATA_HOME; else process.env.DEVFLOW_DATA_HOME = prev;
  }
}

test('dataHome 可被 DEVFLOW_DATA_HOME 覆盖', () => {
  withDataHome((data) => { assert.equal(dataHome(), data); });
});

test('downloadsDir/relayPluginsDir 按端口隔离', () => {
  withDataHome((data) => {
    assert.equal(downloadsDir(22222), path.join(data, 'ports', '22222', 'downloads'));
    assert.equal(relayPluginsDir(22222), path.join(data, 'ports', '22222', 'downloads', 'relay-plugins'));
    assert.notEqual(downloadsDir(22222), downloadsDir(33333));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/data-home.test.js"`
Expected: FAIL（`downloadsDir(22222)` 返回 `.../downloads`，不是 `.../ports/22222/downloads`）

- [ ] **Step 3: 改写 `server/data-home.js`**

整文件替换为：

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 运行时数据统一落在用户数据目录（Windows：%USERPROFILE%\.local\share\void；
// Linux/macOS：$XDG_DATA_HOME 或 ~/.local/share 下 /void）。
export function dataHome() {
  if (process.env.DEVFLOW_DATA_HOME) return path.resolve(process.env.DEVFLOW_DATA_HOME);
  const base = process.platform === 'win32'
    ? path.join(process.env.USERPROFILE || os.homedir(), '.local', 'share')
    : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
  return path.join(base, 'void');
}

// 一个端口一份数据：<dataHome>/ports/<端口>
function portRoot(port, root) {
  return path.join(root, 'ports', String(port));
}
// 活动配置目录（<端口>/downloads/devflow.xml）；注意与协作收件目录 downloadDir（单数）区分
export function downloadsDir(port, root = dataHome()) {
  return path.join(portRoot(port, root), 'downloads');
}
// 中转站转换插件目录（<端口>/downloads/relay-plugins）；仅加载其下 *.mjs
export function relayPluginsDir(port, root = dataHome()) {
  return path.join(downloadsDir(port, root), 'relay-plugins');
}

// ---- 多实例（同机模拟集群）：DEVFLOW_NODE 指定实例，状态按该实例公钥指纹隔离 ----
// identity 存在 <root>/nodes/<实例名>/identity.json（按名字引导）；其余状态全部落到
// <root>/nodes/<公钥指纹16hex>/ 下，同实例稳定、不同实例/不同密钥天然隔离。
export function instanceName() {
  const n = (process.env.DEVFLOW_NODE || '').trim();
  return n === '' || n === 'default' ? '' : n;
}
export function instanceSeedDir(name) {
  const d = path.join(dataHome(), 'nodes', name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
export function instanceFpRoot(fp) {
  const d = path.join(dataHome(), 'nodes', fp);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
```

删除的导出：`ensureDataHome`、`collabDir`、`uploadDir`、`downloadDir`、`seedFromLegacy`。

> `portPaths`（Task 1）自带公开的 `portRoot` 实现，**不要**从 `data-home.js` 引入，避免循环依赖。本文件里的 `portRoot` 是**私有**的（不导出），仅供同文件内 `downloadsDir`/`relayPluginsDir` 复用。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/data-home.test.js" "server/test/port-paths.test.js"`
Expected: PASS

- [ ] **Step 5: 删除 `server/config.js` 的死代码 `resolveFiles()`**

- 第 4 行改为：`import { t } from './i18n.js';`
- 删除第 36-47 行整个 `resolveFiles()` 函数

保留 `loadJson`、`sampleProjects`、`sampleWorkflows`、`ensureDefaults`、`loadProjects`、`loadWorkflows`。

Run: `node --test "server/test/config.test.js"`
Expected: PASS

- [ ] **Step 6: `server/devflow-config.js` 的 `resolveActiveConfigFile` 收端口**

第 104-114 行替换为：

```js
// 解析运行时活动配置：优先 <dataHome>/ports/<端口>/downloads/devflow.xml；不存在则从仓库模板 seed（不覆盖已存在的）
export function resolveActiveConfigFile(baseDir, port) {
  const dir = downloadsDir(port);
  const active = path.join(dir, 'devflow.xml');
  if (fs.existsSync(active)) return active;
  fs.mkdirSync(dir, { recursive: true });        // 失败向上抛出 → 启动失败
  const template = defaultConfigFile(baseDir);
  if (fs.existsSync(template)) fs.copyFileSync(template, active);
  else fs.writeFileSync(active, serializeDevflowConfig(buildDefaultConfig()), 'utf8');
  return active;
}
```

- [ ] **Step 7: `server/llm-mount.js` 去掉全局 `downloadsDir()`**

- 第 11 行 `import { downloadsDir } from './data-home.js';` 整行删除。
- 第 103 行签名加 `relayTestsDir`：

```js
export function createLlmMount({ vault, host, port, logger = console, pluginsDir = null, relayTestsDir = null, cache = createCache(), reveal = revealInOs } = {}) {
```

- 第 248 行改为：

```js
        const dir = relayTestsDir || (pluginsDir ? path.join(path.dirname(pluginsDir), 'relay-tests') : path.join(os.tmpdir(), 'devflow-relay-tests'));
```

- 文件头补 `import os from 'node:os';`（若未引入）。

Run: `node --test "server/test/llm-mount.test.js"`
Expected: PASS

- [ ] **Step 8: `server/index.js` 调用点与启动顺序**

- 第 26 行：从 `devflow-config.js` 的 import 列表删掉 `DEFAULT_PORT`。
- 第 32 行替换为（`dataHome` **保留**，它在第 655-677 行仍被使用，Task 4 才移除）：

```js
import { dataHome, instanceName, instanceSeedDir, instanceFpRoot } from './data-home.js';
import { APP_DIR, resolvePort } from './port-file.js';
```

- 第 52-56 行替换为：

```js
let configFile = resolveActiveConfigFile(APP_DIR, resolvePort());
let BOOT_CFG = loadDevflowConfig(configFile);
const HOST = process.env.DEVFLOW_HOST || BOOT_CFG.server.host || '127.0.0.1';
const PORT = resolvePort();
setLocale(BOOT_CFG.server.language);
```

（`configFile`/`BOOT_CFG` 用 `let`：端口冲突换端口后会在 `onListening` 里按实际端口重算。）

- 第 204-205 行替换为：

```js
  seedPlugins(paths.relayPluginsDir, path.join(__dirname, '..', 'config', 'relay-plugins'));
  const llmMount = createLlmMount({ vault: llmVault, host: detectHost(), port, logger: log, pluginsDir: paths.relayPluginsDir, relayTestsDir: path.join(paths.downloadsDir, 'relay-tests') });
```

- [ ] **Step 9: 删除遗留 seed 文件（先确认零引用）**

Run: `git grep -n -I -E "legacyP|legacyW" -- server`
Expected: 无输出（`resolveFiles()` 已在 Step 5 删除，`server/projects.json`、`server/workflows.json` 不再被任何代码引用）

```bash
git rm server/projects.json server/workflows.json
```

- [ ] **Step 10: 提交**

```bash
git add server/data-home.js server/config.js server/devflow-config.js server/llm-mount.js server/index.js server/test/data-home.test.js
git commit -m "refactor(server): 数据目录端口化（dataHome 数据根、downloadsDir/relayPluginsDir 按端口），清理死代码与遗留 seed"
```

---

### Task 3: 端口从 `devflow.xml` 移除 + `/api/settings` 与冲突弹窗写端口文件

**Files:**
- Modify: `server/devflow-config.js`（`buildDefaultConfig` / `parseDevflowConfig` / `serializeDevflowConfig` / `updateServerAttrs`；删 `DEFAULT_PORT`、`validPort`）
- Modify: `server/index.js:331-350,572-574,615-621`
- Test: `server/test/devflow-config.test.js`
- Test: `server/test/i18n-settings.test.js`
- Test: `server/test/server-port.test.js`（新增）

- [ ] **Step 1: 更新 XML 相关测试（先红）**

`server/test/devflow-config.test.js`：

- 第 32-33 行改为：
  ```js
    assert.equal(c.server.language, 'en');
    assert.equal(c.server.port, undefined, '端口不再来自 XML');
  ```
- 第 43-44 行改为：
  ```js
    assert.equal(c.server.language, 'zh-CN');
  ```
- 第 52 行（`assert.equal(back.server.port, cfg.server.port);`）删除。
- 第 64-73 行整个 test 替换为：
  ```js
  test('updateServerAttrs 只写 language/host，不再写 port，且保留注释', () => {
    const f = tmpFile();
    fs.writeFileSync(f, SAMPLE, 'utf8');
    const next = updateServerAttrs(f, { language: 'zh-CN', host: '0.0.0.0' });
    assert.deepEqual(next, { language: 'zh-CN', host: '0.0.0.0' });
    const xml = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(xml, /<server[^>]*\bport=/, 'XML 不应再写 port 属性');
    assert.match(xml, /<server language="zh-CN" host="0.0.0.0" \/>/);
    assert.ok(xml.includes('<!-- keep me -->'), '注释保留');
    assert.ok(xml.includes('nga.cmd'), '其余内容保留');
  });
  ```
- 第 75-79 行整个 test 替换为：
  ```js
  test('loadDevflowConfig 文件缺失返回默认', () => {
    const c = loadDevflowConfig(tmpFile());
    assert.equal(c.server.language, 'zh-CN');
    assert.ok(c.agents.list.length >= 1);
  });
  ```
- 第 96 行 `updateServerAttrs(f, { port: 25000, language: 'en' });` 改为：
  ```js
    updateServerAttrs(f, { language: 'en' });
  ```
- 第 102-103 行改为：
  ```js
    assert.equal(c.server.language, 'en');
  ```
- 第 118-158 行（4 个 `resolveActiveConfigFile` 测试）**已在 Task 2 一并更新**（签名在 Task 2 变更，测试必须同步），这里不再重复。

`server/test/i18n-settings.test.js` 第 14-22 行（第二个 test）替换为：

```js
test('updateServerAttrs 持久化 language 且不影响 host', () => {
  const f = tmpFile();
  updateServerAttrs(f, { language: 'en' });
  assert.equal(loadDevflowConfig(f).server.language, 'en');
  updateServerAttrs(f, { host: '0.0.0.0' });
  const s = loadDevflowConfig(f).server;
  assert.equal(s.host, '0.0.0.0');
  assert.equal(s.language, 'en', '改 host 不丢 language');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/devflow-config.test.js" "server/test/i18n-settings.test.js"`
Expected: FAIL（仍然写出 `port` 属性；`resolveActiveConfigFile` 只收 1 个参数）

- [ ] **Step 3: 改 `server/devflow-config.js`**

- 删第 9 行 `export const DEFAULT_PORT = 22222;`
- 删第 29-32 行 `validPort()`
- 第 34-40 行改为：
  ```js
  export function buildDefaultConfig() {
    return {
      server: { language: DEFAULT_LOCALE, host: '127.0.0.1' },
      agents: { default: DEFAULT_AGENT, list: DEFAULT_AGENTS.map((a) => ({ ...a })) },
      workflows: fallbackWorkflows(),
    };
  }
  ```
- 第 46-49 行改为：
  ```js
    const serverTag = (text.match(/<server\b([^>]*?)\/?>/i) || [])[1] || '';
    const language = normalizeLocale(decode(attr(serverTag, 'language')) || defaults.server.language);
    const host = decode(attr(serverTag, 'host')) || defaults.server.host;
  ```
- 第 69-73 行改为：
  ```js
    return {
      server: { language, host },
      agents: { default: defAgent, list },
      workflows: workflows.length ? workflows : fallbackWorkflows(),
    };
  ```
- 第 84 行 `<server ...>` 行改为：
  ```js
    <server language="${escXml(cfg.server.language)}" host="${escXml(cfg.server.host || '127.0.0.1')}" />
  ```
- 第 123-139 行 `updateServerAttrs()` 替换为：
  ```js
  export function updateServerAttrs(file, patch = {}) {
    ensureConfigFile(file);
    let xml = fs.readFileSync(file, 'utf8');
    const m = xml.match(/<server\b([^>]*?)\s*\/?>/i);
    const cur = m ? m[1] : '';
    const language = patch.language != null
      ? normalizeLocale(patch.language)
      : normalizeLocale(decode(attr(cur, 'language')) || DEFAULT_LOCALE);
    const host = patch.host != null
      ? (String(patch.host).trim() || '127.0.0.1')
      : (decode(attr(cur, 'host')) || '127.0.0.1');
    const tag = `<server language="${language}" host="${escXml(host)}" />`;
    if (m) xml = xml.slice(0, m.index) + tag + xml.slice(m.index + m[0].length);
    else xml = xml.replace(/<devflow(\s*)>/i, `<devflow$1>\n  ${tag}`);
    fs.writeFileSync(file, xml, 'utf8');
    return { language, host };
  }
  ```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/devflow-config.test.js" "server/test/i18n-settings.test.js"`
Expected: PASS

- [ ] **Step 5: 写测试 `server/test/server-port.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writePortFile, readPortFile } from '../port-file.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-srvport-')); }

test('写端口文件后读回一致，且不残留 tmp', () => {
  const f = path.join(tmpDir(), 'port.txt');
  assert.equal(writePortFile(4100, f), 4100);
  assert.equal(readPortFile(f), 4100);
  assert.equal(fs.existsSync(f + '.tmp'), false);
});

test('非法端口抛 bad-port 且不落文件', () => {
  const f = path.join(tmpDir(), 'port.txt');
  assert.throws(() => writePortFile(99999, f), /bad-port|invalid port/);
  assert.equal(fs.existsSync(f), false);
});

test('目标不可写时抛出（调用方转成 500）', () => {
  const asDir = path.join(tmpDir(), 'port.txt');
  fs.mkdirSync(asDir, { recursive: true });      // 用目录占位，令 rename 必然失败
  assert.throws(() => writePortFile(4100, asDir));
});
```

- [ ] **Step 6: 跑测试确认通过（不依赖 Step 3 改动）**

Run: `node --test "server/test/server-port.test.js"`
Expected: PASS（3 tests）

- [ ] **Step 7: 改 `server/index.js`**

- import 行（Task 2 引入的那行）改为：
  ```js
  import { APP_DIR, resolvePort, validPort, writePortFile, writeRuntimePort } from './port-file.js';
  ```
- 第 331-336 行（`/api/settings` GET）替换为：
  ```js
  if (url.pathname === '/api/settings' && req.method === 'GET') {
    const s = loadDevflowConfig(configFile).server;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ settings: { ...s, port: PORT }, envPort: process.env.DEVFLOW_PORT || null, currentPort: PORT, host: HOST }));
    return;
  }
  ```
- 第 337-350 行（`/api/settings` POST）替换为：
  ```js
  if (url.pathname === '/api/settings' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const port = validPort(body.port);
      if (!port) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid port' })); return; }
      try {
        writePortFile(port);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'port-save-failed', message: String(e && e.message || e) }));
        return;
      }
      log.info(t('term.port_saved'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ port, needRestart: true }));
    });
    return;
  }
  ```
- 第 572-574 行本地 `function writeRuntimePort(port) {...}` 整段删除（改用 `port-file.js` 的导出）。
- 第 615-621 行「更换端口」分支替换为：
  ```js
  if (r && r.action === 'switch' && Number.isInteger(r.port)) {
    try { writePortFile(r.port); log.info(t('port.in_use.switched', { port: r.port })); }
    catch (e) { log.warn('failed to persist port', e && e.message); }
    currentPort = r.port;
    startListening(r.port);
    return;
  }
  ```

- [ ] **Step 8: 跑测试**

Run: `node --test "server/test/server-port.test.js" "server/test/devflow-config.test.js" "server/test/i18n-settings.test.js"` → PASS
Run: `npm.cmd run check:i18n` → 无中文命中（本 Task **不新增** i18n 词条，复用已有 `term.port_saved`）

- [ ] **Step 9: 提交**

```bash
git add server/devflow-config.js server/index.js server/test/devflow-config.test.js server/test/i18n-settings.test.js server/test/server-port.test.js
git commit -m "feat(server): 端口从 devflow.xml 移到 data/port.txt，/api/settings 与冲突弹窗写端口文件"
```

---

### Task 4: 启动收尾改用 `portPaths`，删除整套档案机制

**Files:**
- Modify: `server/index.js:39-43,213,233,299-305,634-689`
- Delete: `server/workspace.js`
- Delete: `server/workspace-http.js`
- Delete: `server/test/workspace.test.js`
- Delete: `server/test/workspace-http.test.js`

- [ ] **Step 1: `server/index.js` 删档案 import、加 port-paths import**

- 第 39-43 行的 `import { migrateLegacy, resolveProfile, ... } from './workspace.js';` 整段删除。
- 第 43 行 `import { createWorkspaceHttp } from './workspace-http.js';` 删除。
- 第 32 行 import 去掉 `dataHome`（其最后用法在第 655-677 行，本 Task Step 4 已替换）：
  ```js
  import { instanceName, instanceSeedDir, instanceFpRoot } from './data-home.js';
  ```
- 在第 32 行（`import { APP_DIR, resolvePort, validPort, writePortFile, writeRuntimePort } from './port-file.js';`）之后追加：
  ```js
  import { portPaths, ensurePortDirs } from './port-paths.js';
  ```
- 第 213 行 `let workspaceHttp = null;` 删除。

- [ ] **Step 2: 删掉 `/api/workspace` 路由**

第 299-305 行整段删除：

```js
  // 工作区选择（永远可用）
  if (url.pathname.startsWith('/api/workspace')) {
    if (!ws && workspaceHttp) { await workspaceHttp(req, res, url); return; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ready: true, needSelect: false, listenPort: actualPort, current: ws ? ws.paths.id : null, profiles: [] }));
    return;
  }
```

- [ ] **Step 3: `initWorkspace` 的日志改为端口/数据目录**

第 233 行：

```js
  log.info(`workspace ready: port=${port} dataDir=${paths.dir}`);
```

- [ ] **Step 4: 改启动收尾（`server/index.js:634-689`）**

第 634-689 行整段（`onListening` 到 `startListening();`）替换为：

```js
  const onListening = () => {
    server.removeListener('error', onError);
    const actual = server.address().port;
    currentPort = actual;
    writeRuntimePort(actual);
    // 端口可能因冲突弹窗变化：配置路径与数据目录一律按「实际端口」重算
    configFile = resolveActiveConfigFile(APP_DIR, actual);
    BOOT_CFG = loadDevflowConfig(configFile);
    setLocale(BOOT_CFG.server.language);
    log.info(`listening on http://${HOST}:${actual}  (ws: ws://${HOST}:${actual}/ws)  ${VERSION}`);

    if (NODE) {   // 逃生通道：沿用 nodes/<name> 机制，不进端口数据目录
      const seedDir = instanceSeedDir(NODE);
      const identity = loadIdentity({ file: path.join(seedDir, 'identity.json'), host: HOST, port: actual });
      const stateRoot = instanceFpRoot(publicFingerprint(identity.publicKey));
      const paths = ensurePortDirs({
        ...portPaths(actual),
        id: `node-${NODE}`,
        dir: stateRoot,
        identityFile: path.join(seedDir, 'identity.json'),
        storeFile: path.join(stateRoot, 'collab.json'),
        uploadDir: path.join(stateRoot, 'upload'),
        downloadDir: path.join(stateRoot, 'download'),
        downloadsDir: path.join(stateRoot, 'downloads'),
        relayPluginsDir: path.join(stateRoot, 'downloads', 'relay-plugins'),
        schedulerDir: path.join(stateRoot, 'scheduler'),
        projectsFile: path.join(stateRoot, 'projects.json'),
        workflowsFile: path.join(stateRoot, 'workflows.json'),
        historyFile: path.join(stateRoot, 'message-history.jsonc'),
        skillsRoot: process.env.DEVFLOW_COLLAB_SKILLS || path.join(stateRoot, 'skills-opencode'),
      });
      initWorkspace(paths, actual);
      return;
    }

    const paths = ensurePortDirs(portPaths(actual));
    initWorkspace(paths, actual);
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, HOST);
}

startListening();

export { server };
```

（`migrateLegacy`、`resolveProfile`、`createProfile`、`bindProfile`、`touchProfile` 的调用全部消失；`actualPort` 变量保留供 `/api/remote/state` 使用。）

- [ ] **Step 5: 删除档案机制文件与测试**

```bash
git rm server/workspace.js server/workspace-http.js server/test/workspace.test.js server/test/workspace-http.test.js
```

- [ ] **Step 6: 校验无残留引用并跑全量服务端测试**

Run: `git grep -n -I -E "workspace\.js|workspace-http|resolveProfile|migrateLegacy|profilePaths|createWorkspaceService|ports-state" -- server web shared`
Expected: 无输出

Run: `npm.cmd run test:server`
Expected: 全绿

- [ ] **Step 7: 提交**

```bash
git add server/index.js
git commit -m "refactor(server): 启动改用 portPaths 单档案，删除 profile 多档案机制"
```

---

### Task 5: 前端删除档案选择界面 + i18n 清理

**Files:**
- Delete: `web/src/components/WorkspacePicker.vue`
- Delete: `web/src/useWorkspace.ts`
- Modify: `web/src/App.vue:16,18,25-26,554`
- Modify: `shared/i18n/zh-CN.js`（删 11 条）
- Modify: `shared/i18n/en.js`（删 11 条）

- [ ] **Step 1: 删组件与组合式函数**

```bash
git rm web/src/components/WorkspacePicker.vue web/src/useWorkspace.ts
```

- [ ] **Step 2: `web/src/App.vue` 去掉引用**

- 删第 16 行 `import { useWorkspace, type WorkspaceState } from './useWorkspace';`
- 删第 18 行 `import WorkspacePicker from './components/WorkspacePicker.vue';`
- 删第 25-26 行：
  ```js
  const ws = useWorkspace();
  const wsState = ref<WorkspaceState | null>(null);
  ```
- 删第 554 行 `<WorkspacePicker v-if="wsState" :state="wsState" />`

- [ ] **Step 3: 删除 11 条 `ws.*` 词条（中英各 11 条）**

`shared/i18n/zh-CN.js` 删除：第 437 行 `'ws.pick.title'`；第 478-487 行 `'ws.pick.desc'`、`'ws.pick.use'`、`'ws.pick.create'`、`'ws.pick.new_name'`、`'ws.pick.last_used'`、`'ws.pick.projects'`、`'ws.pick.loading'`、`'ws.pick.failed'`、`'ws.default_profile_name'`、`'ws.migrated_profile_name'`。

`shared/i18n/en.js` 删除同名 11 条（`'ws.pick.title'` 在第 437 行，其余在第 478-487 行）。

- [ ] **Step 4: 校验无残留引用**

Run: `git grep -n -I -E "ws\.pick\.|ws\.default_profile_name|ws\.migrated_profile_name|WorkspacePicker|useWorkspace" -- web server shared`
Expected: 无输出

- [ ] **Step 5: i18n 检查与前端测试**

Run: `npm.cmd run check:i18n` → 无中文命中
Run: `npm.cmd --prefix web test` → 全绿

- [ ] **Step 6: 提交**

```bash
git add web/src/App.vue shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "refactor(web): 删除档案选择界面与其 i18n 词条"
```

---

### Task 6: 打包脚本端口文件路径（`runtime-port.txt` → `data/`）

**Files:**
- Modify: `scripts/build.js:150,243`
- Modify: `scripts/build-mac.js:139-142`

- [ ] **Step 1: `scripts/build.js` 的 launch.ps1 改读 `data\runtime-port.txt`**

第 150 行改为：

```js
  "$portFile = Join-Path $root 'data\\runtime-port.txt'",
```

- [ ] **Step 2: `scripts/build.js` 使用说明补充端口与数据目录**

第 243 行之后插入两行：

```js
  "端口文件：data\\port.txt（单行端口号；改端口写这里，重启生效）",
  "数据目录：%USERPROFILE%\\.local\\share\\void\\ports\\<端口>\\（换端口 = 换一份数据）",
```

- [ ] **Step 3: `scripts/build-mac.js` 同步**

- 第 139 行注释改为：`# 端口优先取 data/runtime-port.txt；缺省用服务端默认（data/port.txt > 22222）`
- 第 141-142 行替换为：
  ```js
    'if [ -f "data/runtime-port.txt" ]; then',
    "  PORT=\"$(tr -cd '0-9' < \"data/runtime-port.txt\")\"",
  ```
- 第 228 行 `(e) => e.name !== "runtime-port.txt",` **保持不变**（该过滤作用于 `config/` 拷贝；`runtime-port.txt` 已不在 `config/` 下，保留是无害的冗余）。

- [ ] **Step 4: 校验脚本语法与打包**

Run: `node --check scripts/build.js; node --check scripts/build-mac.js`
Expected: 无输出（语法通过）

Run: `npm.cmd run build:web` 然后 `node scripts/build.js`
Expected: 产物生成成功，且产物内**没有** `config\runtime-port.txt`

- [ ] **Step 5: 提交**

```bash
git add scripts/build.js scripts/build-mac.js
git commit -m "build: runtime-port.txt 移到 data/，使用说明补充端口与数据目录"
```

---

### Task 7: 文档同步（AGENTS.md）

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: 改「配置（统一 XML）」一节**

改标题为「配置（端口 + XML）」并替换内容要点：

- **端口**：`<应用目录>/data/port.txt`（单行纯数字）。优先级 `DEVFLOW_PORT` 环境变量 > 该文件 > 默认 `22222`。设置面板保存端口只写该文件，重启后端生效。
- **活动配置**：`<dataHome>/ports/<端口>/downloads/devflow.xml`（Windows：`%USERPROFILE%\.local\share\void\ports\<端口>\downloads\devflow.xml`），只含 `<server language host>` + `<agents>` + `<workflows>`，**不再含 port**。
- **数据目录**：`%USERPROFILE%\.local\share\void`（由 `devflow` 改名），所有数据在 `ports/<端口>/` 下按端口隔离，端口之间零共享；**换端口 = 换一份数据**。
- **不自动迁移**：需要时手动把 `%USERPROFILE%\.local\share\devflow\ports\22222\` 内容复制到 `%USERPROFILE%\.local\share\void\ports\<新端口>\`。
- 删除对 `ports-state.json`、`workspace ready: profile=` 的旧描述。

- [ ] **Step 2: 全文替换数据目录路径示例**

把 `AGENTS.md` 中出现的 `%USERPROFILE%\.local\share\devflow` 按语义替换为 `%USERPROFILE%\.local\share\void`（数据根）或 `...\void\ports\<端口>`（配置项）；「目录速览」补一句「数据按端口隔离在 `...\void\ports\<端口>`」。

- [ ] **Step 3: 提交**

```bash
git add AGENTS.md
git commit -m "docs(agents): 端口存 data/port.txt、数据按端口隔离、数据目录改名 void"
```

---

### Task 8: 全量验收

**Files:** 无（只跑命令与手工验证）

- [ ] **Step 1: 全量测试与检查**

Run: `npm.cmd test` → server + web 全绿
Run: `npm.cmd run typecheck` → 无报错
Run: `npm.cmd run check:i18n` → 无中文命中

- [ ] **Step 2: dev 双端口隔离手工验证**

1. `npm.cmd run dev:server`（自带 `DEVFLOW_PORT=33333`）+ `npm.cmd run dev:web`
2. 启动日志出现 `workspace ready: port=33333 dataDir=C:\Users\<user>\.local\share\void\ports\33333`
3. `Test-Path "$env:USERPROFILE\.local\share\void\ports\33333\projects.json"` → `True`
4. 另一终端临时清空 `DEVFLOW_PORT` 后 `node server/index.js`：应读 `data\port.txt`，缺文件时用 22222 并 warn，数据落在 `ports\22222\`

- [ ] **Step 3: 设置面板改端口验证**

1. 设置面板端口改为 `4100` → 保存，界面提示「已保存，重启后生效」
2. `Get-Content data\port.txt` → `4100`
3. 重启后端 → 日志 `listening ... :4100`、`dataDir=...\void\ports\4100`，该目录为空（隔离生效）

- [ ] **Step 4: 绿色包验证**

Run: `npm.cmd run build:web` 然后 `node scripts/build.js`
1. 产物内没有 `config\runtime-port.txt`
2. 双击 `start.bat` → 浏览器自动打开，产物根生成 `data\runtime-port.txt`

- [ ] **Step 5: 收尾提交（若有验收期微调）**

```bash
git add <仅本次改动涉及的文件>
git commit -m "chore: 验收期微调"
```

---

## 附：明确不做（与 spec §11 一致）

- 不自动迁移旧 `devflow` 目录数据。
- 不改 `downloads/`、`upload/`、`download/` 等子目录名。
- 不做一端口多档案，不保留选择界面。
- 不改协作协议、调度/项目/工作流的接口形状。
- 不改 `DEVFLOW_NODE` 用途（仅收敛其残留共享路径）。
- 不做端口占用自动换端口（沿用弹窗，只改写入目标）。
- 不新增 i18n 词条（端口提示复用 `term.port_saved` / `term.save_failed` / `term.port_invalid`）。
