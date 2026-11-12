# US 自动开发流水线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `auto_docs_update` 中自动发现新增 US，顺序完成切分支、AI 开发、编译打包、提交推送，并在现有任务队列详情中展示进度与日志。

**Architecture:** 文档更新任务拉取后调用 `server/pipeline/` 编排器；每个 US 先切 `feature/<git user.name>`，再跑 opencode、测试/构建/打包命令，最后提交推送。状态存 `<数据目录>/pipeline/`，日志存当前作业运行目录，界面复用任务队列。

**Tech Stack:** Node ESM、node:test、git CLI、opencode runner、Vue 3、Element Plus、vitest。

**提交说明：** 按仓库规则，本计划不自动执行 `git commit`；只有用户明确要求时才提交。

---

## File Structure

新增：

- `server/pipeline/us-config.js` — 读写 `{ autoDev }`。
- `server/pipeline/us-detect.js` — US 文件夹识别。
- `server/pipeline/us-state.js` — 基线、items、pending 状态。
- `server/pipeline/us-commands.js` — 三种来源的构建命令解析。
- `server/pipeline/us-prompt.js` — US 文档收集与提示词渲染。
- `server/pipeline/us-git.js` — 分支、工作区、提交、推送。
- `server/pipeline/us-exec.js` — 执行测试/构建/打包命令。
- `server/pipeline/us-runner.js` — 单个 US 的完整流程。
- `server/pipeline/us-dev.js` — 基线、选择 pending、顺序编排。
- `server/pipeline/pipeline-mount.js` — `/api/pipeline/*`。
- `config/pipeline/us-prompt-template.md` — 中文提示词模板。
- `web/src/pipeline.ts` — 前端配置/重试 API。
- `server/test/us-config.test.js`
- `server/test/us-detect-state.test.js`
- `server/test/us-commands.test.js`
- `server/test/us-prompt.test.js`
- `server/test/us-git.test.js`
- `server/test/us-exec.test.js`
- `server/test/us-runner.test.js`
- `server/test/us-dev.test.js`
- `server/test/pipeline-mount.test.js`
- `web/src/pipeline.test.ts`

修改：

- `server/scheduler/queue/consumer.js` — docs 分支调用 `runUsDev`。
- `server/scheduler/index.js` — 透传 `runUsDev`。
- `server/index.js` — 创建编排器、放宽 docs 任务超时、挂载 `/api/pipeline/*`。
- `web/src/components/CodeStats.vue` — 「自动开发」开关。
- `web/src/jobs/JobsView.vue` — 作业详情「US 开发进度」。
- `shared/i18n/zh-CN.js` / `shared/i18n/en.js` — 中英文案。
- `docs/knowledge/us-auto-dev-pipeline.md` — 使用说明。

---

### Task 1: 配置存储

**Files:**
- Create: `server/pipeline/us-config.js`
- Test: `server/test/us-config.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUsConfigStore } from '../pipeline/us-config.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-us-config-'));
  return path.join(dir, 'config.json');
}

test('us-config：文件不存在时默认关闭', () => {
  const store = createUsConfigStore({ file: tmpFile() });
  assert.deepEqual(store.read(), { autoDev: false });
});

test('us-config：写入后读回布尔值', () => {
  const file = tmpFile();
  const store = createUsConfigStore({ file });
  store.write({ autoDev: true });
  assert.deepEqual(store.read(), { autoDev: true });
  store.write({ autoDev: 'yes' });
  assert.deepEqual(store.read(), { autoDev: false });
});

test('us-config：损坏文件回退默认值', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{bad', 'utf8');
  const store = createUsConfigStore({ file, logger: { warn() {} } });
  assert.deepEqual(store.read(), { autoDev: false });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test "server/test/us-config.test.js"`
Expected: FAIL，`Cannot find module .../server/pipeline/us-config.js`

- [ ] **Step 3: 实现**

```js
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_US_CONFIG = { autoDev: false };

export function normalizeUsConfig(raw) {
  return { autoDev: raw?.autoDev === true };
}

export function createUsConfigStore({ file, logger = console } = {}) {
  function read() {
    try {
      if (!file || !fs.existsSync(file)) return { ...DEFAULT_US_CONFIG };
      return normalizeUsConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      logger?.warn?.('us-config load failed', (e && e.message) || e);
      return { ...DEFAULT_US_CONFIG };
    }
  }
  function write(input) {
    const cfg = normalizeUsConfig(input);
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    }
    return cfg;
  }
  return { read, write };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test "server/test/us-config.test.js"`
Expected: 3 tests PASS

---

### Task 2: US 识别与状态

**Files:**
- Create: `server/pipeline/us-detect.js`
- Create: `server/pipeline/us-state.js`
- Test: `server/test/us-detect-state.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { US_RE, listUsDirs } from '../pipeline/us-detect.js';
import {
  createUsStateStore, resetBaseline, selectPending, markInterrupted, emptyUsState,
} from '../pipeline/us-state.js';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-us-state-'));
}

test('us-detect：只识别 US+6位编号+4位年份的一级目录并排序', () => {
  const root = tmpRoot();
  for (const name of ['US000002-2022-B', 'not-us', 'US000001-2021-A', 'US12-2021-X']) {
    fs.mkdirSync(path.join(root, name));
  }
  assert.equal(US_RE.test('US000001-2021-增加用户'), true);
  assert.equal(US_RE.test('us000001-2021-x'), true);
  assert.equal(US_RE.test('US12-2021-x'), false);
  assert.deepEqual(listUsDirs(root), ['US000001-2021-A', 'US000002-2022-B']);
  assert.deepEqual(listUsDirs(path.join(root, 'missing')), []);
});

test('us-state：基线之外的新 US 进入 pending，已有结果不重复', () => {
  const state = resetBaseline('D:/sol', ['US000001-2021-A']);
  assert.equal(selectPending(state, ['US000001-2021-A']).length, 0);
  assert.deepEqual(selectPending(state, ['US000001-2021-A', 'US000002-2022-B']), ['US000002-2022-B']);
  assert.equal(state.items['US000002-2022-B'].status, 'pending');
  state.items['US000002-2022-B'].status = 'success';
  assert.equal(selectPending(state, ['US000001-2021-A', 'US000002-2022-B']).length, 0);
});

test('us-state：失败的 US 重新置为 pending 后会被选中', () => {
  const state = resetBaseline('D:/sol', []);
  state.items['US000003-2023-C'] = { status: 'failed', attempts: 1 };
  assert.equal(selectPending(state, ['US000003-2023-C']).length, 0);
  state.items['US000003-2023-C'].status = 'pending';
  assert.deepEqual(selectPending(state, ['US000003-2023-C']), ['US000003-2023-C']);
});

test('us-state：running 视为中断失败；写入后读回', () => {
  const file = path.join(tmpRoot(), 'us-state.json');
  const state = emptyUsState('D:/sol');
  state.items['US000004-2024-D'] = { status: 'running', attempts: 1 };
  markInterrupted(state);
  assert.equal(state.items['US000004-2024-D'].status, 'failed');
  assert.equal(state.items['US000004-2024-D'].error, 'interrupted');
  const store = createUsStateStore({ file });
  store.write(state);
  assert.deepEqual(store.read(), state);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test "server/test/us-detect-state.test.js"`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `us-detect.js`**

```js
import fs from 'node:fs';

export const US_RE = /^US\d{6}-\d{4}-/i;

export function listUsDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && US_RE.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: 实现 `us-state.js`**

```js
import fs from 'node:fs';
import path from 'node:path';

export const US_STATUSES = ['pending', 'running', 'success', 'failed'];

export function emptyUsState(solutionDir = '') {
  return { solutionDir, baseline: [], items: {} };
}

function normalizeItem(v) {
  const it = v && typeof v === 'object' ? v : {};
  return {
    status: US_STATUSES.includes(it.status) ? it.status : 'pending',
    attempts: Number.isFinite(it.attempts) ? it.attempts : 0,
    lastJobId: typeof it.lastJobId === 'string' ? it.lastJobId : null,
    branch: typeof it.branch === 'string' ? it.branch : null,
    commit: typeof it.commit === 'string' ? it.commit : null,
    error: typeof it.error === 'string' ? it.error : null,
    lastRunAt: Number.isFinite(it.lastRunAt) ? it.lastRunAt : null,
    logFiles: Array.isArray(it.logFiles) ? it.logFiles.filter((x) => typeof x === 'string') : [],
    commands: it.commands && typeof it.commands === 'object' ? it.commands : {},
  };
}

export function normalizeUsState(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const items = {};
  if (src.items && typeof src.items === 'object') {
    for (const [us, it] of Object.entries(src.items)) items[us] = normalizeItem(it);
  }
  return {
    solutionDir: typeof src.solutionDir === 'string' ? src.solutionDir : '',
    baseline: Array.isArray(src.baseline) ? src.baseline.filter((x) => typeof x === 'string') : [],
    items,
  };
}

export function createUsStateStore({ file, logger = console } = {}) {
  function read() {
    try {
      if (!file || !fs.existsSync(file)) return emptyUsState();
      return normalizeUsState(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      logger?.warn?.('us-state load failed', (e && e.message) || e);
      return emptyUsState();
    }
  }
  function write(state) {
    const next = normalizeUsState(state);
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    }
    return next;
  }
  return { read, write };
}

export function resetBaseline(solutionDir, current) {
  return { solutionDir, baseline: [...current], items: {} };
}

export function selectPending(state, current) {
  const base = new Set(state.baseline || []);
  for (const us of current) {
    if (base.has(us)) continue;
    if (!state.items[us]) state.items[us] = normalizeItem({ status: 'pending' });
  }
  return current.filter((us) => !base.has(us) && state.items[us]?.status === 'pending');
}

export function markInterrupted(state) {
  for (const it of Object.values(state.items || {})) {
    if (it.status !== 'running') continue;
    it.status = 'failed';
    it.error = 'interrupted';
  }
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `node --test "server/test/us-detect-state.test.js"`
Expected: 4 tests PASS

---

### Task 3: 构建命令解析

**Files:**
- Create: `server/pipeline/us-commands.js`
- Test: `server/test/us-commands.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUsCommands } from '../pipeline/us-commands.js';

test('us-commands：pipeline.json 优先，字段级回退', () => {
  const r = extractUsCommands({
    'pipeline.json': JSON.stringify({ build: 'npm run build' }),
    '01-需求分析.md': '---\npackage: npm run pack\n---\n',
    '05-构建发布.md': '## 测试\n```bash\nnpm test\n```\n',
  });
  assert.equal(r.error, undefined);
  assert.equal(r.build, 'npm run build');
  assert.equal(r.package, 'npm run pack');
  assert.equal(r.test, 'npm test');
});

test('us-commands：frontmatter 去引号', () => {
  const r = extractUsCommands({
    '01-需求分析.md': '---\nbuild: "pnpm build"\ntest: \'pnpm test\'\n---\n',
  });
  assert.equal(r.build, 'pnpm build');
  assert.equal(r.test, 'pnpm test');
});

test('us-commands：05 文档按标题取第一个代码块', () => {
  const md = [
    '# 构建发布', '',
    '## 构建', '说明', '```bash', 'npm ci', 'npm run build', '```', '',
    '## 打包', '```powershell', 'npm run package', '```',
  ].join('\n');
  const r = extractUsCommands({ '05-构建发布.md': md });
  assert.equal(r.build, 'npm ci\nnpm run build');
  assert.equal(r.package, 'npm run package');
});

test('us-commands：缺少 build 返回错误', () => {
  const r = extractUsCommands({ 'pipeline.json': '{"test":"npm test"}' });
  assert.equal(r.error, 'missing_build');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test "server/test/us-commands.test.js"`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

```js
const FIELDS = ['test', 'build', 'package'];

function clean(v) {
  if (typeof v !== 'string') return '';
  let s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  return s;
}

function fromJson(text) {
  try {
    const data = JSON.parse(text);
    const out = {};
    for (const f of FIELDS) out[f] = clean(data?.[f]);
    return out;
  } catch {
    return {};
  }
}

function fromFrontmatter(text) {
  const m = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const hit = line.match(/^(test|build|package)\s*:\s*(.*)$/i);
    if (hit) out[hit[1].toLowerCase()] = clean(hit[2]);
  }
  return out;
}

function sectionCode(text, names) {
  const lines = String(text || '').split(/\r?\n/);
  let inSection = false;
  let inFence = false;
  const buf = [];
  for (const line of lines) {
    const h = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (h) {
      if (inSection && !inFence) return buf.join('\n').trim();
      inSection = names.includes(h[1].trim().toLowerCase());
      continue;
    }
    if (!inSection) continue;
    if (/^```/.test(line)) {
      inFence = !inFence;
      if (!inFence && buf.length) return buf.join('\n').trim();
      continue;
    }
    if (inFence) buf.push(line);
  }
  return inSection && buf.length ? buf.join('\n').trim() : '';
}

function fromBuildDoc(text) {
  return {
    test: sectionCode(text, ['\u6d4b\u8bd5', 'test', 'tests']),
    build: sectionCode(text, ['\u6784\u5efa', 'build']),
    package: sectionCode(text, ['\u6253\u5305', 'package', 'pack', 'release']),
  };
}

export function extractUsCommands(files = {}) {
  const sources = [
    fromJson(files['pipeline.json'] || ''),
    fromFrontmatter(files['01-需求分析.md'] || ''),
    fromBuildDoc(files['05-构建发布.md'] || ''),
  ];
  const out = {};
  for (const f of FIELDS) out[f] = sources.map((s) => s[f]).find((v) => !!v) || '';
  if (!out.build) return { ...out, error: 'missing_build' };
  return out;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test "server/test/us-commands.test.js"`
Expected: 4 tests PASS

---

### Task 4: 文档收集与提示词

**Files:**
- Create: `server/pipeline/us-prompt.js`
- Create: `config/pipeline/us-prompt-template.md`
- Test: `server/test/us-prompt.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectUsDocs, renderUsPrompt } from '../pipeline/us-prompt.js';

function tmpUs() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-us-prompt-'));
}

test('us-prompt：只收集 md/json/txt，跳过符号链接', () => {
  const dir = tmpUs();
  fs.writeFileSync(path.join(dir, '01-需求分析.md'), '# 需求', 'utf8');
  fs.writeFileSync(path.join(dir, 'pipeline.json'), '{"build":"npm run build"}', 'utf8');
  fs.writeFileSync(path.join(dir, 'skip.png'), 'x', 'utf8');
  const r = collectUsDocs(dir);
  assert.deepEqual(r.docs.map((d) => d.rel).sort(), ['01-需求分析.md', 'pipeline.json']);
  assert.equal(r.truncated, false);
});

test('us-prompt：超过 200KB 截断并标记', () => {
  const dir = tmpUs();
  fs.writeFileSync(path.join(dir, 'big.md'), 'x'.repeat(210 * 1024), 'utf8');
  const r = collectUsDocs(dir);
  assert.equal(r.truncated, true);
  assert.ok(r.bytes <= 200 * 1024);
});

test('us-prompt：模板占位符全部替换', () => {
  const text = renderUsPrompt('US={{us}} B={{branch}} C={{cwd}}\n{{docs}}\n{{build}}', {
    us: 'US000001-2021-A',
    branch: 'feature/zhangsan',
    cwd: '/repo',
    docs: [{ rel: 'a.md', text: '# A' }],
    commands: { build: 'npm run build', test: '', package: '' },
  });
  assert.match(text, /US=US000001-2021-A/);
  assert.match(text, /B=feature\/zhangsan/);
  assert.match(text, /C=\/repo/);
  assert.match(text, /### a\.md/);
  assert.match(text, /npm run build/);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test "server/test/us-prompt.test.js"`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `us-prompt.js`**

```js
import fs from 'node:fs';
import path from 'node:path';

export const MAX_US_DOC_BYTES = 200 * 1024;
const EXTS = new Set(['.md', '.json', '.txt']);

function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walk(full, base, out);
    else if (e.isFile() && EXTS.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
}

export function collectUsDocs(usDir, { maxBytes = MAX_US_DOC_BYTES } = {}) {
  const files = [];
  try {
    walk(usDir, usDir, files);
  } catch {
    return { docs: [], bytes: 0, truncated: false };
  }
  files.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const docs = [];
  let bytes = 0;
  let truncated = false;
  for (const file of files) {
    let buf;
    try {
      buf = fs.readFileSync(file);
    } catch {
      continue;
    }
    if (bytes + buf.length > maxBytes) {
      truncated = true;
      break;
    }
    bytes += buf.length;
    docs.push({ rel: path.relative(usDir, file), text: buf.toString('utf8') });
  }
  return { docs, bytes, truncated };
}

export function renderUsPrompt(template, { us, branch, cwd, docs, commands }) {
  const body = docs.map((d) => `### ${d.rel}\n\n${d.text.trim()}`).join('\n\n');
  return String(template || '')
    .replaceAll('{{us}}', String(us || ''))
    .replaceAll('{{branch}}', String(branch || ''))
    .replaceAll('{{cwd}}', String(cwd || ''))
    .replaceAll('{{test}}', String(commands?.test || ''))
    .replaceAll('{{build}}', String(commands?.build || ''))
    .replaceAll('{{package}}', String(commands?.package || ''))
    .replaceAll('{{docs}}', body);
}
```

- [ ] **Step 4: 创建模板**

`config/pipeline/us-prompt-template.md`：

```markdown
# 实现用户需求

你正在代码仓 `{{cwd}}` 中工作，目标分支是 `{{branch}}`。

请阅读下面的 US 文档，按需求完成代码与必要的测试改动。

约束：

- 不要执行 `git commit`、`git push`，不要修改 git 配置。
- 把改动留在工作区，由流水线负责提交与推送。
- 可以运行测试验证，但不要删除或覆盖与本需求无关的文件。

项目声明的命令：

- test: `{{test}}`
- build: `{{build}}`
- package: `{{package}}`

## US 文档

{{docs}}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `node --test "server/test/us-prompt.test.js"`
Expected: 3 tests PASS

---

### Task 5: Git 分支与提交

**Files:**
- Create: `server/pipeline/us-git.js`
- Test: `server/test/us-git.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  sanitizeBranchUser, branchFor, getGitUserName, prepareUserBranch, commitAll, pushBranch,
} from '../pipeline/us-git.js';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-us-git-'));
  const bare = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  execFileSync('git', ['init', '--bare', bare]);
  execFileSync('git', ['init', work]);
  git(work, ['config', 'user.email', 'dev@example.com']);
  git(work, ['config', 'user.name', 'zhangsan']);
  fs.writeFileSync(path.join(work, 'README.md'), 'init\n');
  git(work, ['add', '-A']);
  git(work, ['commit', '-m', 'init']);
  git(work, ['branch', '-M', 'master']);
  git(work, ['remote', 'add', 'origin', bare]);
  git(work, ['push', '-u', 'origin', 'master']);
  return { root, bare, work };
}

test('us-git：分支名清洗', () => {
  assert.equal(sanitizeBranchUser('  zhang san  '), 'zhang-san');
  assert.equal(sanitizeBranchUser('a~b^c:d*e[f'), 'a-b-c-d-e-f');
  assert.equal(branchFor('zhang san'), 'feature/zhang-san');
  assert.equal(branchFor('   '), '');
});

test('us-git：读取 user.name 并创建 feature 分支', async () => {
  const { work } = tempRepo();
  assert.equal(await getGitUserName(work), 'zhangsan');
  const r = await prepareUserBranch(work, 'zhangsan');
  assert.equal(r.branch, 'feature/zhangsan');
  assert.equal(git(work, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/zhangsan');
});

test('us-git：脏工作区拒绝', async () => {
  const { work } = tempRepo();
  fs.writeFileSync(path.join(work, 'dirty.txt'), 'x');
  const r = await prepareUserBranch(work, 'zhangsan');
  assert.equal(r.error, 'dirty-worktree');
});

test('us-git：提交并推送分支', async () => {
  const { work, bare } = tempRepo();
  await prepareUserBranch(work, 'zhangsan');
  fs.writeFileSync(path.join(work, 'a.txt'), 'a');
  const c = await commitAll(work, 'feat(US000001): demo');
  assert.equal(c.commit.length, 40);
  const p = await pushBranch(work, 'feature/zhangsan');
  assert.equal(p.ok, true);
  const branches = execFileSync('git', ['branch'], { cwd: bare, encoding: 'utf8' });
  assert.match(branches, /feature\/zhangsan/);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test "server/test/us-git.test.js"`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

```js
import { spawn } from 'node:child_process';

function run(cwd, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: String(e && e.message || e) });
    }
    let stdout = '';
    let stderr = '';
    const timer = timeoutMs > 0 ? setTimeout(() => child.kill('SIGKILL'), timeoutMs) : null;
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(e && e.message || e) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export function sanitizeBranchUser(name) {
  return String(name || '').trim()
    .replace(/[\s~^:?*[\\\x00-\x1f]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function branchFor(user) {
  const u = sanitizeBranchUser(user);
  return u ? `feature/${u}` : '';
}

export async function getGitUserName(cwd) {
  const r = await run(cwd, ['config', 'user.name']);
  return r.code === 0 ? r.stdout.trim() : '';
}

async function defaultBranch(cwd) {
  const head = await run(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (head.code === 0 && head.stdout.trim()) return head.stdout.trim();
  for (const name of ['origin/main', 'origin/master']) {
    const ok = await run(cwd, ['show-ref', '--verify', '--quiet', `refs/remotes/${name}`]);
    if (ok.code === 0) return name;
  }
  return '';
}

export async function prepareUserBranch(cwd, user) {
  const branch = branchFor(user);
  if (!branch) return { error: 'missing-user-name' };

  const fetched = await run(cwd, ['fetch', 'origin']);
  if (fetched.code !== 0) return { error: 'fetch-failed', message: fetched.stderr.trim() };

  const local = await run(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  let checked;
  if (local.code === 0) {
    checked = await run(cwd, ['checkout', branch]);
  } else {
    const remote = await run(cwd, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`]);
    if (remote.code === 0) checked = await run(cwd, ['checkout', '-b', branch, '--track', `origin/${branch}`]);
    else {
      const base = await defaultBranch(cwd);
      if (!base) return { error: 'no-default-branch' };
      checked = await run(cwd, ['checkout', '-b', branch, base]);
    }
  }
  if (checked.code !== 0) return { error: 'checkout-failed', message: checked.stderr.trim() };

  const status = await run(cwd, ['status', '--porcelain']);
  if (status.stdout.trim()) return { error: 'dirty-worktree' };
  return { branch };
}

export async function commitAll(cwd, message) {
  const status = await run(cwd, ['status', '--porcelain']);
  if (!status.stdout.trim()) return { commit: null };
  const added = await run(cwd, ['add', '-A']);
  if (added.code !== 0) return { error: 'git-add-failed', message: added.stderr.trim() };
  const committed = await run(cwd, ['commit', '-m', message]);
  if (committed.code !== 0) return { error: 'git-commit-failed', message: committed.stderr.trim() };
  const head = await run(cwd, ['rev-parse', 'HEAD']);
  return { commit: head.stdout.trim() };
}

export async function pushBranch(cwd, branch) {
  const first = await run(cwd, ['push', '-u', 'origin', branch]);
  if (first.code === 0) return { ok: true, rebased: false };
  const pull = await run(cwd, ['pull', '--rebase', 'origin', branch]);
  if (pull.code !== 0) {
    await run(cwd, ['rebase', '--abort']);
    return { ok: false, error: 'push-rejected', message: first.stderr.trim() };
  }
  const second = await run(cwd, ['push', '-u', 'origin', branch]);
  return second.code === 0
    ? { ok: true, rebased: true }
    : { ok: false, error: 'push-rejected', message: second.stderr.trim() };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test "server/test/us-git.test.js"`
Expected: 4 tests PASS（需要本机可用的 git）

---

### Task 6: 命令执行

**Files:**
- Create: `server/pipeline/us-exec.js`
- Test: `server/test/us-exec.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '../pipeline/us-exec.js';

function tmpLog() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-us-exec-')), 'cmd.log');
}

test('us-exec：成功命令写日志并返回 0', async () => {
  const logPath = tmpLog();
  const r = await runCommand({
    cwd: process.cwd(),
    command: 'node -e "console.log(\'hello-ok\')"',
    logPath,
  });
  assert.equal(r.ok, true);
  assert.equal(r.exitCode, 0);
  assert.match(fs.readFileSync(logPath, 'utf8'), /hello-ok/);
});

test('us-exec：失败命令返回非 0', async () => {
  const r = await runCommand({
    cwd: process.cwd(),
    command: 'node -e "process.exit(3)"',
    logPath: tmpLog(),
  });
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 3);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test "server/test/us-exec.test.js"`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

```js
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function killTree(child) {
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill('SIGKILL');
    }
  } catch { /* ignore */ }
}

export function runCommand({ cwd, command, logPath, timeoutMs = 600000 }) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const stream = fs.createWriteStream(logPath, { flags: 'a' });
    const head = `\n$ ${command}\n`;
    stream.write(head);
    const shell = process.platform === 'win32'
      ? { bin: 'cmd.exe', args: ['/d', '/s', '/c', command] }
      : { bin: '/bin/sh', args: ['-c', command] };
    let child;
    try {
      child = spawn(shell.bin, shell.args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      stream.end();
      return resolve({ ok: false, exitCode: null, timedOut: false, error: String(e && e.message || e) });
    }
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs) : null;
    child.stdout.on('data', (c) => stream.write(c));
    child.stderr.on('data', (c) => stream.write(c));
    const done = (exitCode, error = null) => {
      if (timer) clearTimeout(timer);
      stream.end();
      resolve({ ok: exitCode === 0 && !timedOut && !error, exitCode, timedOut, error });
    };
    child.on('error', (e) => done(null, String(e && e.message || e)));
    child.on('close', (code) => done(code ?? null));
  });
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test "server/test/us-exec.test.js"`
Expected: 2 tests PASS

---

### Task 7: 单个 US 流程

**Files:**
- Create: `server/pipeline/us-runner.js`
- Test: `server/test/us-runner.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runOneUs } from '../pipeline/us-runner.js';

function fixtures() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-us-runner-'));
  const solutionDir = path.join(root, 'solution');
  const codeDir = path.join(root, 'code');
  const us = 'US000001-2021-增加一个用户管理系统';
  const usDir = path.join(solutionDir, us);
  fs.mkdirSync(usDir, { recursive: true });
  fs.mkdirSync(codeDir, { recursive: true });
  fs.writeFileSync(path.join(usDir, '01-需求分析.md'), '# 需求');
  fs.writeFileSync(path.join(usDir, 'pipeline.json'), JSON.stringify({ build: 'npm run build', test: 'npm test' }));
  const logDir = path.join(root, 'logs', 'us', us);
  return { root, solutionDir, codeDir, us, logDir };
}

const template = 'US={{us}} B={{branch}} C={{cwd}}\n{{docs}}';

test('us-runner：成功时提交 feat 并推送', async () => {
  const f = fixtures();
  const calls = [];
  const git = {
    prepareUserBranch: async () => ({ branch: 'feature/zhangsan' }),
    commitAll: async (_cwd, msg) => { calls.push(msg); return { commit: 'a'.repeat(40) }; },
    pushBranch: async () => ({ ok: true }),
  };
  const exec = async ({ command }) => ({ ok: true, exitCode: 0, command });
  const runAi = async ({ logPath }) => { fs.writeFileSync(logPath, 'ai ok'); return { ok: true, exitCode: 0 }; };
  const item = await runOneUs({
    us: f.us, solutionDir: f.solutionDir, codeDir: f.codeDir, user: 'zhangsan',
    logDir: f.logDir, runId: 'j_test', template, git, exec, runAi,
  });
  assert.equal(item.status, 'success');
  assert.equal(item.branch, 'feature/zhangsan');
  assert.equal(item.commit, 'a'.repeat(40));
  assert.deepEqual(item.commands.test.exitCode, 0);
  assert.deepEqual(item.commands.build.exitCode, 0);
  assert.match(calls[0], /^feat\(US000001\):/);
  assert.ok(fs.existsSync(path.join(f.logDir, 'ai.log')));
});

test('us-runner：构建失败提交 wip 并标记 failed', async () => {
  const f = fixtures();
  let message = '';
  const git = {
    prepareUserBranch: async () => ({ branch: 'feature/zhangsan' }),
    commitAll: async (_cwd, msg) => { message = msg; return { commit: 'b'.repeat(40) }; },
    pushBranch: async () => ({ ok: true }),
  };
  const exec = async ({ command }) => ({ ok: !command.includes('build'), exitCode: command.includes('build') ? 1 : 0 });
  const runAi = async () => ({ ok: true, exitCode: 0 });
  const item = await runOneUs({
    us: f.us, solutionDir: f.solutionDir, codeDir: f.codeDir, user: 'zhangsan',
    logDir: f.logDir, runId: 'j_test', template, git, exec, runAi,
  });
  assert.equal(item.status, 'failed');
  assert.match(message, /^wip\(US000001\):.*\[failed\]$/);
  assert.equal(item.error, 'build-failed');
});

test('us-runner：缺少 build 命令直接失败，不调用 AI', async () => {
  const f = fixtures();
  fs.writeFileSync(path.join(f.solutionDir, f.us, 'pipeline.json'), '{"test":"npm test"}');
  let aiCalled = false;
  const item = await runOneUs({
    us: f.us, solutionDir: f.solutionDir, codeDir: f.codeDir, user: 'zhangsan',
    logDir: f.logDir, runId: 'j_test', template,
    git: { prepareUserBranch: async () => ({ branch: 'feature/zhangsan' }) },
    exec: async () => ({ ok: true, exitCode: 0 }),
    runAi: async () => { aiCalled = true; return { ok: true, exitCode: 0 }; },
  });
  assert.equal(item.status, 'failed');
  assert.equal(item.error, 'missing_build');
  assert.equal(aiCalled, false);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test "server/test/us-runner.test.js"`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

```js
import fs from 'node:fs';
import path from 'node:path';
import { collectUsDocs, renderUsPrompt } from './us-prompt.js';
import { extractUsCommands } from './us-commands.js';
import * as defaultGit from './us-git.js';
import { runCommand as defaultExec } from './us-exec.js';

const AI_TIMEOUT_MS = 30 * 60 * 1000;
const CMD_TIMEOUT_MS = 10 * 60 * 1000;

function commitSubject(us) {
  const code = (String(us).match(/^(US\d{6})/) || [])[1] || String(us);
  const title = String(us).replace(/^US\d{6}-\d{4}-/, '') || String(us);
  return { code, title };
}

export async function runOneUs({
  us, solutionDir, codeDir, user, logDir, runId,
  template, git = defaultGit, exec = defaultExec, runAi = null,
  now = Date.now,
}) {
  fs.mkdirSync(logDir, { recursive: true });
  const item = {
    us, status: 'failed', branch: null, commit: null, error: null,
    logFiles: [], commands: {}, startedAt: now(), finishedAt: null,
  };

  const prepared = await git.prepareUserBranch(codeDir, user);
  if (prepared.error) {
    item.error = prepared.error;
    item.finishedAt = now();
    return item;
  }
  item.branch = prepared.branch;

  const collected = collectUsDocs(path.join(solutionDir, us));
  const files = Object.fromEntries(collected.docs.map((d) => [d.rel, d.text]));
  const commands = extractUsCommands(files);
  if (commands.error) {
    item.error = commands.error;
    item.finishedAt = now();
    return item;
  }

  const prompt = renderUsPrompt(template, {
    us, branch: prepared.branch, cwd: codeDir, docs: collected.docs, commands,
  });
  const aiLog = path.join(logDir, 'ai.log');
  let aiOk = false;
  if (runAi) {
    const ai = await runAi({ cwd: codeDir, prompt, logPath: aiLog, timeoutMs: AI_TIMEOUT_MS });
    item.logFiles.push('ai.log');
    aiOk = !!ai?.ok;
    if (!aiOk) item.error = ai?.error || 'ai-failed';
  } else {
    item.error = 'missing-ai-runner';
  }

  let commandsOk = aiOk;
  if (aiOk) {
    for (const name of ['test', 'build', 'package']) {
      const command = commands[name];
      if (!command) continue;
      const logPath = path.join(logDir, `${name}.log`);
      const r = await exec({ cwd: codeDir, command, logPath, timeoutMs: CMD_TIMEOUT_MS });
      item.logFiles.push(`${name}.log`);
      item.commands[name] = {
        command, exitCode: r.exitCode ?? null, timedOut: !!r.timedOut, ok: !!r.ok,
      };
      if (!r.ok) {
        commandsOk = false;
        item.error = `${name}-failed`;
        break;
      }
    }
  }

  const ok = aiOk && commandsOk;
  const { code, title } = commitSubject(us);
  const message = ok ? `feat(${code}): ${title}` : `wip(${code}): ${title} [failed]`;
  const committed = await git.commitAll(codeDir, message);
  if (committed.error) {
    item.error = committed.error;
  } else {
    item.commit = committed.commit || null;
    if (item.commit && git.pushBranch) {
      const pushed = await git.pushBranch(codeDir, prepared.branch);
      if (!pushed.ok) item.error = pushed.error || 'push-failed';
      else item.status = ok && !item.error ? 'success' : 'failed';
    } else if (!item.error) {
      item.status = ok ? 'success' : 'failed';
    }
  }

  item.finishedAt = now();
  return item;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test "server/test/us-runner.test.js"`
Expected: 3 tests PASS

---

### Task 8: 编排器（基线、pending、顺序执行）

**Files:**
- Create: `server/pipeline/us-dev.js`
- Test: `server/test/us-dev.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUsDev } from '../pipeline/us-dev.js';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-us-dev-'));
}

function setup() {
  const root = tmpRoot();
  const solution = path.join(root, 'solution');
  const code = path.join(root, 'code');
  fs.mkdirSync(solution, { recursive: true });
  fs.mkdirSync(code, { recursive: true });
  fs.writeFileSync(path.join(root, 'template.md'), 'US={{us}}');
  return { root, solution, code };
}

test('us-dev：首次运行/目录变化只记基线，不处理已有 US', async () => {
  const f = setup();
  fs.mkdirSync(path.join(f.solution, 'US000001-2021-A'));
  const dir = path.join(f.root, 'pipeline');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ autoDev: true }));
  let ran = 0;
  const dev = createUsDev({
    dir,
    templateFile: path.join(f.root, 'template.md'),
    docsState: () => ({ solution: { selected: true, path: f.solution }, code: { selected: true, path: f.code } }),
    git: { getGitUserName: async () => 'zhangsan' },
    runOne: async () => { ran++; return { us: 'x', status: 'success' }; },
  });
  const r = await dev({ logDir: path.join(f.root, 'run'), runId: 'j1', docResults: [] });
  assert.equal(r.skipped, 'baseline');
  assert.equal(ran, 0);
});

test('us-dev：只处理基线与已处理之外的新 US，并写状态', async () => {
  const f = setup();
  fs.mkdirSync(path.join(f.solution, 'US000001-2021-A'));
  const dir = path.join(f.root, 'pipeline');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ autoDev: true }));
  fs.writeFileSync(path.join(dir, 'us-state.json'), JSON.stringify({
    solutionDir: f.solution, baseline: ['US000001-2021-A'], items: {},
  }));
  fs.mkdirSync(path.join(f.solution, 'US000002-2022-B'));
  const seen = [];
  const dev = createUsDev({
    dir,
    templateFile: path.join(f.root, 'template.md'),
    docsState: () => ({ solution: { selected: true, path: f.solution }, code: { selected: true, path: f.code } }),
    git: { getGitUserName: async () => 'zhangsan' },
    runOne: async ({ us }) => { seen.push(us); return { us, status: 'success', branch: 'feature/zhangsan', commit: 'c' }; },
  });
  const r = await dev({ logDir: path.join(f.root, 'run'), runId: 'j2', docResults: [] });
  assert.deepEqual(seen, ['US000002-2022-B']);
  assert.equal(r.failed, 0);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'us-state.json'), 'utf8'));
  assert.equal(state.items['US000002-2022-B'].status, 'success');
});

test('us-dev：开关关闭直接跳过', async () => {
  const f = setup();
  const dev = createUsDev({
    dir: path.join(f.root, 'pipeline'),
    templateFile: path.join(f.root, 'template.md'),
    docsState: () => ({ solution: { selected: true, path: f.solution }, code: { selected: true, path: f.code } }),
    git: { getGitUserName: async () => 'zhangsan' },
    runOne: async () => { throw new Error('should not run'); },
  });
  const r = await dev({ logDir: path.join(f.root, 'run'), runId: 'j3', docResults: [] });
  assert.equal(r.skipped, 'disabled');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test "server/test/us-dev.test.js"`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

```js
import fs from 'node:fs';
import path from 'node:path';
import { buildSpawnSpec } from '../scheduler/runner.js';
import { createUsConfigStore } from './us-config.js';
import { listUsDirs } from './us-detect.js';
import {
  createUsStateStore, resetBaseline, selectPending, markInterrupted,
} from './us-state.js';
import { runOneUs } from './us-runner.js';
import * as defaultGit from './us-git.js';

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function samePath(a, b) {
  const norm = (p) => path.resolve(String(p || '')).replace(/\\/g, '/').toLowerCase();
  return norm(a) === norm(b);
}

function makeRunAi(ctx) {
  return async ({ cwd, prompt, logPath, timeoutMs }) => {
    const r = await ctx.runner.run({
      runId: ctx.runId,
      spec: buildSpawnSpec({ type: 'ai', ai: { source: 'prompt' } }, {
        cwd, aiPrompt: prompt, aiBin: ctx.aiBin, opencodeDataDir: ctx.opencodeDataDir,
      }),
      logPath,
      timeoutMs: Math.min(timeoutMs, ctx.remaining ? ctx.remaining() : timeoutMs),
    });
    return {
      ok: !r.spawnError && !r.timedOut && r.exitCode === 0,
      exitCode: r.exitCode ?? null,
      timedOut: !!r.timedOut,
      error: r.error || (r.timedOut ? 'timeout' : null),
    };
  };
}

export function createUsDev({
  dir, docsState = () => ({}), templateFile, logger = console,
  git = defaultGit, runOne = runOneUs, now = Date.now,
}) {
  const configStore = createUsConfigStore({ file: path.join(dir, 'config.json'), logger });
  const stateStore = createUsStateStore({ file: path.join(dir, 'us-state.json'), logger });

  function failAll(state, usList, error) {
    for (const us of usList) {
      state.items[us] = { ...(state.items[us] || {}), status: 'failed', error, lastRunAt: now() };
    }
    stateStore.write(state);
  }

  return async function run(ctx = {}) {
    const cfg = configStore.read();
    if (!cfg.autoDev) return { skipped: 'disabled', items: [], failed: 0 };

    const ds = docsState() || {};
    const solutionDir = ds.solution?.selected ? String(ds.solution.path || '').trim() : '';
    const codeDir = ds.code?.selected ? String(ds.code.path || '').trim() : '';
    if (!solutionDir || !isDir(solutionDir)) return { skipped: 'no-solution', items: [], failed: 0 };

    const solutionPull = (ctx.docResults || []).find((r) => samePath(r.dir, solutionDir));
    if (solutionPull && !solutionPull.ok) return { skipped: 'solution-pull-failed', items: [], failed: 0 };

    const current = listUsDirs(solutionDir);
    let state = stateStore.read();
    if (!state.solutionDir || state.solutionDir !== solutionDir) {
      stateStore.write(resetBaseline(solutionDir, current));
      return { skipped: 'baseline', items: [], failed: 0 };
    }

    markInterrupted(state);
    const pending = selectPending(state, current);
    if (!pending.length) {
      stateStore.write(state);
      return { items: [], failed: 0 };
    }

    if (!codeDir || !isDir(codeDir)) {
      failAll(state, pending, 'code-dir-missing');
      return { items: pending.map((us) => state.items[us]), failed: pending.length };
    }

    const user = await git.getGitUserName(codeDir);
    if (!user) {
      failAll(state, pending, 'missing-user-name');
      return { items: pending.map((us) => state.items[us]), failed: pending.length };
    }

    const template = fs.readFileSync(templateFile, 'utf8');
    const runAi = makeRunAi(ctx);
    const items = [];
    for (const us of pending) {
      state.items[us] = {
        ...state.items[us], status: 'running', attempts: (state.items[us].attempts || 0) + 1,
        lastJobId: ctx.runId || null,
      };
      stateStore.write(state);
      const item = await (async () => {
        try {
          return await runOne({
            us, solutionDir, codeDir, user,
            logDir: path.join(ctx.logDir, 'us', us),
            runId: ctx.runId, template, git, runAi, now,
            runner: ctx.runner, aiBin: ctx.aiBin, opencodeDataDir: ctx.opencodeDataDir,
          });
        } catch (e) {
          return { us, status: 'failed', error: String(e?.message || e), finishedAt: now() };
        }
      })();
      state.items[us] = {
        ...state.items[us], ...item,
        lastJobId: ctx.runId || null, lastRunAt: now(),
      };
      stateStore.write(state);
      items.push(state.items[us]);
    }

    return {
      items,
      failed: items.filter((x) => x.status !== 'success').length,
    };
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test "server/test/us-dev.test.js"`
Expected: 3 tests PASS

---

### Task 9: 接入 docs 任务

**Files:**
- Modify: `server/scheduler/queue/consumer.js:112-115, 200-221`
- Modify: `server/scheduler/index.js:11-15, 88-96`
- Modify: `server/index.js`（创建编排器、传参、放宽超时）

- [ ] **Step 1: consumer 增加 `runUsDev` 参数**

在 `createConsumer` 参数列表加入 `runUsDev = null`：

```js
  aiBin = 'opencode', opencodeDataDir = null, projectResolver = () => null, publicBaseUrl = null, onEvent = () => {}, docDirs = () => [], runUsDev = null,
```

在 docs 分支 `result = { ... docResults: r.results }` 之后加入：

```js
          if (runUsDev) {
            try {
              const usDev = await runUsDev({
                runner, aiBin, opencodeDataDir, job, runId: job.jobId,
                logDir: ctx.outputDir, deadline, remaining, now,
                docResults: r.results,
              });
              if (usDev) {
                result.usDev = usDev;
                if (usDev.failed > 0) status = S.FAILED;
              }
            } catch (e) {
              result.usDev = { items: [], failed: 1, error: String(e?.message || e) };
              status = S.FAILED;
            }
          }
```

- [ ] **Step 2: scheduler 透传**

`server/scheduler/index.js` 的 `createScheduler` 参数加 `runUsDev = null`，并传给 `createConsumer`：

```js
        aiBin: agentCmd, opencodeDataDir, projectResolver, publicBaseUrl, logger, docDirs, runUsDev,
```

- [ ] **Step 3: index 创建编排器并传入**

在创建 `docUpdateStore` 之后：

```js
  const usDev = createUsDev({
    dir: path.join(paths.dir, 'pipeline'),
    docsState: () => docUpdateStore.read(),
    templateFile: path.join(__dirname, '..', 'config', 'pipeline', 'us-prompt-template.md'),
    logger: log,
  });
```

在 `createScheduler({ ... })` 里加入 `runUsDev: usDev,`。

在 `ensureTask('auto_docs_update', ...)` 之后加入：

```js
    scheduler.store.updateTask('auto_docs_update', { maxRunMilliSecond: 6 * 60 * 60 * 1000 });
```

顶部 import：

```js
import { createUsDev } from './pipeline/us-dev.js';
```

- [ ] **Step 4: 运行现有调度器测试**

Run: `node --test "server/test/scheduler*.test.js"`
Expected: 全部 PASS

---

### Task 10: `/api/pipeline/*`

**Files:**
- Create: `server/pipeline/pipeline-mount.js`
- Test: `server/test/pipeline-mount.test.js`
- Modify: `server/index.js`（在 `buildWorkspace` 内创建并挂到 `ws`）

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPipelineMount } from '../pipeline/pipeline-mount.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-pipeline-mount-'));
}

function fakeRes() {
  const out = { status: 0, body: '', headers: {} };
  return {
    out,
    writeHead(s) { out.status = s; },
    end(s) { out.body = String(s || ''); },
  };
}

test('pipeline-mount：开关打开时重建基线', async () => {
  const dir = tmpDir();
  const solution = path.join(dir, 'solution');
  fs.mkdirSync(path.join(solution, 'US000001-2021-A'), { recursive: true });
  const mount = createPipelineMount({
    dir: path.join(dir, 'pipeline'),
    docsState: () => ({ solution: { selected: true, path: solution } }),
    scheduler: { engine: { manualRun: async () => ({}) } },
  });
  const body = JSON.stringify({ autoDev: true });
  const req = { method: 'POST', url: '/api/pipeline/config', on(evt, cb) { if (evt === 'data') cb(Buffer.from(body)); if (evt === 'end') cb(); } };
  const res = fakeRes();
  await mount(req, res);
  assert.equal(res.out.status, 200);
  assert.match(res.out.body, /"autoDev":true/);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'pipeline', 'us-state.json'), 'utf8'));
  assert.deepEqual(state.baseline, ['US000001-2021-A']);
});

test('pipeline-mount：重试把 failed 置回 pending 并触发 docs', async () => {
  const dir = tmpDir();
  const pipeline = path.join(dir, 'pipeline');
  fs.mkdirSync(pipeline, { recursive: true });
  fs.writeFileSync(path.join(pipeline, 'config.json'), '{"autoDev":true}');
  fs.writeFileSync(path.join(pipeline, 'us-state.json'), JSON.stringify({
    solutionDir: 'D:/sol', baseline: [], items: { 'US000002-2022-B': { status: 'failed' } },
  }));
  let ran = 0;
  const mount = createPipelineMount({
    dir: pipeline,
    docsState: () => ({}),
    scheduler: { engine: { manualRun: async () => { ran++; return {}; } } },
  });
  const body = JSON.stringify({ us: 'US000002-2022-B' });
  const req = { method: 'POST', url: '/api/pipeline/retry', on(evt, cb) { if (evt === 'data') cb(Buffer.from(body)); if (evt === 'end') cb(); } };
  const res = fakeRes();
  await mount(req, res);
  assert.equal(ran, 1);
  const state = JSON.parse(fs.readFileSync(path.join(pipeline, 'us-state.json'), 'utf8'));
  assert.equal(state.items['US000002-2022-B'].status, 'pending');
});

test('pipeline-mount：日志路径不允许穿越', async () => {
  const dir = tmpDir();
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir, { recursive: true });
  const mount = createPipelineMount({
    dir: path.join(dir, 'pipeline'),
    docsState: () => ({}),
    scheduler: { engine: { manualRun: async () => ({}) } },
    runDirFor: () => runDir,
  });
  const req = { method: 'GET', url: '/api/pipeline/logs?jobId=j_1&us=US000001-2021-A&file=../../secret.txt' };
  const res = fakeRes();
  await mount(req, res);
  assert.equal(res.out.status, 400);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test "server/test/pipeline-mount.test.js"`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

```js
import fs from 'node:fs';
import path from 'node:path';
import { createUsConfigStore } from './us-config.js';
import { createUsStateStore, resetBaseline } from './us-state.js';
import { US_RE, listUsDirs } from './us-detect.js';

const LOG_FILES = new Set(['ai.log', 'test.log', 'build.log', 'package.log']);
const JOB_RE = /^j_[A-Za-z0-9]+$/;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function inside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function createPipelineMount({
  dir, docsState = () => ({}), scheduler, logger = console,
  runDirFor = (jobId) => scheduler.store.runDirFor('auto_docs_update', jobId),
}) {
  const config = createUsConfigStore({ file: path.join(dir, 'config.json'), logger });
  const state = createUsStateStore({ file: path.join(dir, 'us-state.json'), logger });

  return async function mount(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/pipeline/config' && req.method === 'GET') {
        return sendJson(res, 200, config.read());
      }
      if (url.pathname === '/api/pipeline/config' && req.method === 'POST') {
        const body = await readBody(req);
        const next = config.write(body);
        if (next.autoDev) {
          const ds = docsState() || {};
          const solutionDir = ds.solution?.selected ? String(ds.solution.path || '').trim() : '';
          if (solutionDir && fs.existsSync(solutionDir)) state.write(resetBaseline(solutionDir, listUsDirs(solutionDir)));
        }
        return sendJson(res, 200, next);
      }
      if (url.pathname === '/api/pipeline/retry' && req.method === 'POST') {
        const body = await readBody(req);
        const us = String(body.us || '');
        if (!US_RE.test(us)) return sendJson(res, 400, { error: 'bad-us' });
        const current = state.read();
        if (!current.items[us]) return sendJson(res, 404, { error: 'not-found' });
        current.items[us].status = 'pending';
        current.items[us].error = null;
        state.write(current);
        if (config.read().autoDev && scheduler?.engine?.manualRun) await scheduler.engine.manualRun('auto_docs_update');
        return sendJson(res, 200, { ok: true });
      }
      if (url.pathname === '/api/pipeline/logs' && req.method === 'GET') {
        const jobId = String(url.searchParams.get('jobId') || '');
        const us = String(url.searchParams.get('us') || '');
        const file = String(url.searchParams.get('file') || '');
        if (!JOB_RE.test(jobId) || !US_RE.test(us) || !LOG_FILES.has(file)) return sendJson(res, 400, { error: 'bad-args' });
        const runDir = path.resolve(runDirFor(jobId));
        const target = path.resolve(runDir, 'us', us, file);
        if (!inside(runDir, target) || !fs.existsSync(target)) return sendJson(res, 404, { error: 'not-found' });
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(target, 'utf8'));
      }
      return sendJson(res, 404, { error: 'not-found' });
    } catch (e) {
      logger?.error?.('pipeline http', e);
      return sendJson(res, 500, { error: 'internal', message: String(e?.message || e) });
    }
  };
}
```

- [ ] **Step 4: 挂载到 workspace**

在 `server/index.js` 的 `buildWorkspace` 内、创建 `scheduler` 之后加入：

```js
  const pipelineMount = createPipelineMount({
    dir: path.join(paths.dir, 'pipeline'),
    docsState: () => docUpdateStore.read(),
    scheduler,
    logger: log,
  });
```

把 `pipelineMount` 加入 `buildWorkspace` 的返回对象（与 `scheduler, httpApi, ...` 同一行）。

在请求分发里、`/api/scheduler` 之前加入：

```js
  if (url.pathname.startsWith('/api/pipeline/')) { await ws.pipelineMount(req, res); return; }
```

- [ ] **Step 5: 运行测试**

Run: `node --test "server/test/pipeline-mount.test.js"`
Expected: 3 tests PASS

---

### Task 11: 前端开关与作业详情

**Files:**
- Create: `web/src/pipeline.ts`
- Test: `web/src/pipeline.test.ts`
- Modify: `web/src/components/CodeStats.vue`
- Modify: `web/src/jobs/JobsView.vue`
- Modify: `shared/i18n/zh-CN.js` / `shared/i18n/en.js`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadPipelineConfig, savePipelineConfig, retryPipelineUs } from './pipeline';

function ok(data: unknown) { return { ok: true, text: async () => JSON.stringify(data) } as any; }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ok({ autoDev: true })));
});

describe('pipeline api', () => {
  it('读取配置', async () => {
    expect(await loadPipelineConfig()).toEqual({ autoDev: true });
  });
  it('保存配置', async () => {
    await savePipelineConfig(true);
    expect(fetch).toHaveBeenCalledWith('/api/pipeline/config', expect.objectContaining({ method: 'POST' }));
  });
  it('重试 US', async () => {
    await retryPipelineUs('US000001-2021-A');
    expect(fetch).toHaveBeenCalledWith('/api/pipeline/retry', expect.objectContaining({ method: 'POST' }));
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm.cmd --prefix web run test -- pipeline.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `web/src/pipeline.ts`**

```ts
async function api(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export interface PipelineConfig { autoDev: boolean }

export function loadPipelineConfig(): Promise<PipelineConfig> {
  return api('GET', '/api/pipeline/config');
}

export function savePipelineConfig(autoDev: boolean): Promise<PipelineConfig> {
  return api('POST', '/api/pipeline/config', { autoDev });
}

export function retryPipelineUs(us: string): Promise<{ ok: boolean }> {
  return api('POST', '/api/pipeline/retry', { us });
}
```

- [ ] **Step 4: CodeStats 增加开关**

`web/src/components/CodeStats.vue`：

```ts
import { loadPipelineConfig, savePipelineConfig } from '../pipeline';
const autoDev = ref(false);
async function loadAutoDev() {
  try { autoDev.value = (await loadPipelineConfig()).autoDev; } catch { autoDev.value = false; }
}
async function toggleAutoDev(v: boolean) {
  try {
    autoDev.value = (await savePipelineConfig(v)).autoDev;
  } catch {
    autoDev.value = !v;
    docError.value = t('pipeline.config_failed');
  }
}
function onAutoDevChange(e: Event) {
  void toggleAutoDev((e.target as HTMLInputElement).checked);
}
onMounted(() => { void loadAutoDev(); });
```

模板放在 `docbigbtns` 上方：

```html
<label class="docchk autodev">
  <input type="checkbox" :checked="autoDev" @change="onAutoDevChange" />
  <span>{{ $t('codestat.docs.auto_dev') }}</span>
</label>
<div class="dochint">{{ $t('pipeline.auto_dev_hint') }}</div>
```

样式：

```css
.autodev { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
```

- [ ] **Step 5: JobsView 增加 US 段**

脚本加入：

```ts
import { loadPipelineConfig, retryPipelineUs } from '../pipeline';

interface UsDevItem {
  us: string; status: string; branch?: string | null; commit?: string | null;
  error?: string | null; logFiles?: string[]; commands?: Record<string, { exitCode?: number | null }>;
}
const pipelineAutoDev = ref(false);
async function loadPipelineAutoDev() {
  try { pipelineAutoDev.value = (await loadPipelineConfig()).autoDev; } catch { pipelineAutoDev.value = false; }
}
const detailUsDev = computed<{ items: UsDevItem[]; failed?: number; skipped?: string } | null>(() => {
  if (!detail.value) return null;
  try { return JSON.parse(detail.value.result || '{}').usDev || null; } catch { return null; }
});
function usLogUrl(item: UsDevItem, file: string): string {
  const jobId = detail.value?.jobId || '';
  return `/api/pipeline/logs?jobId=${encodeURIComponent(jobId)}&us=${encodeURIComponent(item.us)}&file=${encodeURIComponent(file)}`;
}
async function retryUs(us: string) {
  await retryPipelineUs(us);
  await jobs.refresh();
}
onMounted(() => { void loadPipelineAutoDev(); });
```

模板放在 report 之前：

```html
<div v-if="detailUsDev?.items?.length" class="usdev">
  <h4>{{ $t('pipeline.usdev.title') }}</h4>
  <div v-for="it in detailUsDev.items" :key="it.us" class="usrow">
    <div class="ushead">
      <b>{{ it.us }}</b>
      <span class="dim">{{ $t('pipeline.usdev.status.' + it.status) }}</span>
      <span v-if="it.branch" class="dim">{{ it.branch }}</span>
      <span v-if="it.commit" class="dim">{{ it.commit.slice(0, 7) }}</span>
    </div>
    <div v-if="it.error" class="dim">{{ it.error }}</div>
    <div v-if="it.logFiles?.length" class="uslogs">
      <a v-for="f in it.logFiles" :key="f" :href="usLogUrl(it, f)" target="_blank" rel="noopener">{{ f }}</a>
    </div>
    <button v-if="it.status === 'failed' && pipelineAutoDev" @click="retryUs(it.us)">{{ $t('pipeline.usdev.retry') }}</button>
  </div>
</div>
```

样式：

```css
.usdev { margin: 10px 0; padding: 8px 0; border-top: 1px solid var(--border-color, #333); }
.usdev h4 { margin: 0 0 8px; font-size: 13px; }
.usrow { padding: 6px 0; font-size: 12px; border-bottom: 1px dashed var(--border-color, #333); }
.ushead { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.uslogs { display: flex; gap: 8px; margin: 4px 0; }
```

- [ ] **Step 6: 补 i18n**

`shared/i18n/zh-CN.js`：

```js
  'codestat.docs.auto_dev': '自动开发',
  'pipeline.auto_dev_hint': '开启后只处理之后新增的 US；已有 US 记为基线，不补跑。',
  'pipeline.config_failed': '自动开发开关保存失败',
  'pipeline.usdev.title': 'US 开发进度',
  'pipeline.usdev.retry': '重试',
  'pipeline.usdev.status.pending': '待执行',
  'pipeline.usdev.status.running': '执行中',
  'pipeline.usdev.status.success': '成功',
  'pipeline.usdev.status.failed': '失败',
```

`shared/i18n/en.js`：

```js
  'codestat.docs.auto_dev': 'Auto development',
  'pipeline.auto_dev_hint': 'Only US items added after enabling are processed; existing US items become the baseline.',
  'pipeline.config_failed': 'Failed to save the auto development switch',
  'pipeline.usdev.title': 'US development',
  'pipeline.usdev.retry': 'Retry',
  'pipeline.usdev.status.pending': 'Pending',
  'pipeline.usdev.status.running': 'Running',
  'pipeline.usdev.status.success': 'Success',
  'pipeline.usdev.status.failed': 'Failed',
```

- [ ] **Step 7: 运行前端测试与类型检查**

Run: `npm.cmd --prefix web run test -- pipeline.test.ts`
Expected: 3 tests PASS

Run: `npm.cmd --prefix web run typecheck`
Expected: PASS

---

### Task 12: 文档与全量验证

**Files:**
- Create: `docs/knowledge/us-auto-dev-pipeline.md`

- [ ] **Step 1: 写使用说明**

```markdown
# US 自动开发流水线

## 开启

1. 在「代码统计 → 代码生成流水线」为知识库、方案仓、代码仓等选择目录。
2. 打开「自动开发」开关。开启时当前已有 US 记为基线，不补跑。
3. 方案仓新增 `US000001-2021-需求名称` 文件夹后，下一次文档更新自动处理。

## 每个 US 做什么

1. 切到 `feature/<git user.name>`（不存在则从 origin 默认分支创建）。
2. 用 opencode 读取 US 文档并改代码。
3. 依次执行 US 声明的 `test`、`build`、`package`。
4. 成功提交 `feat(...)`，失败提交 `wip(...) [failed]`，推送 `feature/<user>`。

## 构建命令来源

按字段优先级：`pipeline.json` → `01-需求分析.md` frontmatter → `05-构建发布.md`。

## 查看进度

「定时任务 → 任务队列」里的 `auto_docs_update` 作业详情，包含每个 US 的状态、分支、提交号、日志与重试按钮。

## 注意

- 失败 US 不自动重跑，需手动点「重试」。
- 失败会写 WIP 提交到用户分支，后续 US 继续在该分支执行。
- 不会 force push，不会覆盖未提交改动。
```

- [ ] **Step 2: 跑服务端全量测试**

Run: `npm.cmd test:server`
Expected: 全部 PASS（允许既有 skip）

- [ ] **Step 3: 跑前端全量测试**

Run: `npm.cmd --prefix web run test`
Expected: 全部 PASS

- [ ] **Step 4: 类型与 i18n**

Run: `npm.cmd run typecheck`
Expected: PASS

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`

- [ ] **Step 5: 构建前端**

Run: `npm.cmd run build:web`
Expected: 构建成功，`web/dist` 更新

- [ ] **Step 6: 手动冒烟（可选）**

1. 在 33333 页面选择方案仓/代码仓，开启自动开发。
2. 在方案仓新建 `US000009-2026-冒烟测试`，放一个 `pipeline.json`：`{ "build": "node -e \"console.log('ok')\"" }`。
3. 等待一次文档更新，确认任务队列出现 `auto_docs_update`，详情里有该 US 的成功记录与日志。

---

## Self-Review

- 规格覆盖：触发/基线 → Task 2、8；切分支 → Task 5、7；AI 开发 → Task 4、7；命令解析 → Task 3；提交推送 → Task 5、7；失败 WIP 与继续 → Task 7、8；状态/日志/界面 → Task 9、10、11；安全 → Task 5、7、10；测试 → 各 Task 与 Task 12。
- 无 TBD/TODO；所有新增接口与字段名在各 Task 中保持一致。
- 已知取舍：docs 作业同步处理所有新 US，单作业最长 6 小时；失败会污染 `feature/<user>`，按用户选择保留 WIP。
