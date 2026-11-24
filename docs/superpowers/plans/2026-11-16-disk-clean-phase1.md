# 系统盘清理工具（第 1 期）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「系统清理」小工具：分析 Windows 系统 / 应用 / 浏览器缓存，勾选后通过回收站或永久删除清理，含排除列表、自定义目录、UAC 提权助手与历史记录。

**Architecture:** Node 负责类别解析、扫描与统计；删除统一交给生成的 PowerShell 助手（回收站 / 永久 / 提权三种场景共用），任务目录 + 轮询取结果。前端作为主页面工具页签接入，分析/清理均为后台任务 + 500ms 轮询。

**Tech Stack:** Node ESM（node:test）、PowerShell 5.1（Microsoft.VisualBasic FileIO、Start-Process -Verb RunAs）、Vue 3 + TypeScript + vitest、现有 i18n（shared/i18n）。

规格：`docs/superpowers/specs/2026-11-16-disk-clean-tool-design.md`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `server/disk-clean/catalog.js` | 类别表、路径解析、默认勾选/风险/需管理员 |
| `server/disk-clean/fs-walk.js` | 通配转正则、目录测量、条目列举（跳符号链接/超限截断） |
| `server/disk-clean/validate.js` | 自定义目录校验、排除规则匹配 |
| `server/disk-clean/store.js` | 设置（排除/自定义）与历史读写 |
| `server/disk-clean/scan.js` | 后台扫描任务（内存 Map + TTL） |
| `server/disk-clean/clean.js` | 清理任务：校验、job、启动助手、轮询结果 |
| `server/disk-clean/helper.ps1` | PowerShell 删除助手（UTF-8 BOM） |
| `server/disk-clean/mount.js` | `/api/disk-clean/*` 路由 |
| `server/port-paths.js` | 增加 `diskCleanDir` |
| `server/index.js` | 装配与分发 |
| `web/src/tools/disk-clean/selection.ts` | 纯函数：默认勾选、汇总、可清理判定 |
| `web/src/tools/disk-clean/useDiskClean.ts` | 状态机 + 轮询 + 接口调用 |
| `web/src/tools/disk-clean/DiskCleanTool.vue` | 页面 |
| `web/src/tools/catalog.ts` | 注册 `disk-clean` |
| `web/src/components/TerminalView.vue` | 挂载 `DiskCleanTool` |
| `web/src/components/ToolSidebar.vue` | `disk-clean` 返回 `null` |
| `shared/i18n/zh-CN.js` / `en.js` | 词条 |

测试：

| 文件 | 覆盖 |
|---|---|
| `server/test/disk-clean-catalog.test.js` | 类别解析、默认勾选、需管理员 |
| `server/test/disk-clean-walk.test.js` | 通配、测量、年龄、截断、符号链接 |
| `server/test/disk-clean-validate.test.js` | 自定义目录校验、排除匹配 |
| `server/test/disk-clean-store.test.js` | 设置/历史读写 |
| `server/test/disk-clean-scan.test.js` | 扫描状态、排除生效、过期 |
| `server/test/disk-clean-clean.test.js` | job 结构、risky 确认、过期、helper BOM、dry-run |
| `server/test/disk-clean-mount.test.js` | HTTP 路由、501、参数校验 |
| `web/src/tools/disk-clean/selection.test.ts` | 默认勾选、汇总、risky 门槛 |
| `web/src/components/MiniTools.test.ts` | 磁贴数量与点击 |

---

## Task 1: 类别表 `catalog.js`

**Files:**
- Create: `server/disk-clean/catalog.js`
- Test: `server/test/disk-clean-catalog.test.js`

- [ ] **Step 1: 写失败测试**

```js
// server/test/disk-clean-catalog.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

test('类别表：解析出的目标都在给定根内，且带 mode', () => {
  const local = tmp('dfdc-local-');
  const root = tmp('dfdc-root-');
  fs.mkdirSync(path.join(local, 'Temp'), { recursive: true });
  fs.mkdirSync(path.join(local, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Temp'), { recursive: true });
  process.env.LOCALAPPDATA = local;
  process.env.SystemRoot = root;
  process.env.SystemDrive = path.parse(root).root.replace(/[\\/]+$/, '');
  const { listCategories, resolveTargets } = await_import();
  const cats = listCategories();
  const ids = cats.map((c) => c.id);
  assert.ok(ids.includes('user-temp'));
  assert.ok(ids.includes('windows-temp'));
  const targets = resolveTargets('user-temp');
  assert.equal(targets.length, 1);
  assert.equal(path.resolve(targets[0].path), path.resolve(path.join(local, 'Temp')));
  assert.equal(targets[0].mode, 'contents');
  const win = resolveTargets('windows-temp');
  assert.equal(win[0].needsAdmin, true);
  const u = cats.find((c) => c.id === 'user-temp');
  assert.equal(u.risk, 'safe');
  assert.equal(u.defaultChecked, true);
  const up = cats.find((c) => c.id === 'update-cache');
  assert.equal(up.defaultChecked, false);
});

test('类别表：缺失的类目不出现在列表里', () => {
  process.env.LOCALAPPDATA = tmp('dfdc-empty-');
  process.env.SystemRoot = tmp('dfdc-empty-win-');
  const { listCategories } = await_import();
  const ids = listCategories().map((c) => c.id);
  assert.equal(ids.includes('chrome'), false);
});

test('类别表：自定义目录作为 custom 类别，默认不勾选', () => {
  const custom = tmp('dfdc-custom-');
  const { listCategories, resolveTargets } = await_import();
  const cats = listCategories({ customDirs: [custom] });
  const c = cats.find((x) => x.id === 'custom');
  assert.ok(c);
  assert.equal(c.group, 'custom');
  assert.equal(c.risk, 'risky');
  assert.equal(c.defaultChecked, false);
  const t = resolveTargets('custom', { customDirs: [custom] });
  assert.equal(t.length, 1);
  assert.equal(t[0].mode, 'contents');
});

async function await_import() {
  return import('../disk-clean/catalog.js');
}
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/disk-clean-catalog.test.js"`
Expected: FAIL（找不到 `server/disk-clean/catalog.js`）

- [ ] **Step 3: 实现 `catalog.js`**

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const env = (k) => process.env[k] || '';
const home = () => os.homedir();
const localAppData = () => env('LOCALAPPDATA') || path.join(home(), 'AppData', 'Local');
const roamingAppData = () => env('APPDATA') || path.join(home(), 'AppData', 'Roaming');
const systemRoot = () => env('SystemRoot') || env('windir') || path.join(path.parse(os.homedir()).root, 'Windows');
const systemDrive = () => env('SystemDrive') || path.parse(systemRoot()).root.replace(/[\\/]+$/, '');

function dirExists(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function subdirs(base) {
  try {
    return fs.readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(base, e.name));
  } catch { return []; }
}

const C = (p, extra = {}) => ({ path: p, mode: 'contents', ...extra });
const E = (p, patterns, extra = {}) => ({ path: p, mode: 'entry', patterns, ...extra });
const F = (p, extra = {}) => ({ path: p, mode: 'file', ...extra });

function browserTargets(appRoot) {
  const out = [];
  for (const profile of subdirs(appRoot)) {
    out.push(C(path.join(profile, 'Cache')));
    out.push(C(path.join(profile, 'Code Cache')));
    out.push(C(path.join(profile, 'GPUCache')));
    out.push(C(path.join(profile, 'Service Worker', 'ScriptCache')));
  }
  return out;
}

const CATEGORIES = [
  { id: 'user-temp', group: 'system', risk: 'safe', minAgeDays: 0, targets: () => [C(path.join(localAppData(), 'Temp'))] },
  { id: 'windows-temp', group: 'system', risk: 'safe', minAgeDays: 0, targets: () => [C(path.join(systemRoot(), 'Temp'), { needsAdmin: true })] },
  { id: 'recycle-bin', group: 'system', risk: 'caution', minAgeDays: 0, targets: () => [{ path: systemDrive(), mode: 'recycle-bin' }] },
  { id: 'update-cache', group: 'system', risk: 'caution', minAgeDays: 0, targets: () => [C(path.join(systemRoot(), 'SoftwareDistribution', 'Download'), { needsAdmin: true })] },
  {
    id: 'crash-dumps', group: 'system', risk: 'caution', minAgeDays: 0,
    targets: () => [
      C(path.join(localAppData(), 'CrashDumps')),
      F(path.join(systemRoot(), 'MEMORY.DMP'), { needsAdmin: true }),
    ],
  },
  {
    id: 'wer-reports', group: 'system', risk: 'caution', minAgeDays: 0,
    targets: () => [
      C(path.join(localAppData(), 'Microsoft', 'Windows', 'WER', 'ReportQueue')),
      C(path.join(localAppData(), 'Microsoft', 'Windows', 'WER', 'ReportArchive')),
    ],
  },
  {
    id: 'thumbnails', group: 'system', risk: 'caution', minAgeDays: 0,
    targets: () => [E(path.join(localAppData(), 'Microsoft', 'Windows', 'Explorer'), ['thumbcache_*.db', 'iconcache_*.db'])],
  },
  { id: 'system-logs', group: 'system', risk: 'caution', minAgeDays: 7, targets: () => [C(path.join(systemRoot(), 'Logs', 'CBS'), { needsAdmin: true })] },
  { id: 'windows-old', group: 'system', risk: 'risky', minAgeDays: 0, targets: () => [{ path: path.join(path.parse(systemRoot()).root, 'Windows.old'), mode: 'contents', needsAdmin: true, removeRoot: true }] },

  { id: 'npm', group: 'app', risk: 'safe', minAgeDays: 0, targets: () => [C(path.join(localAppData(), 'npm-cache', '_cacache'))] },
  { id: 'yarn', group: 'app', risk: 'safe', minAgeDays: 0, targets: () => [C(path.join(localAppData(), 'Yarn', 'Cache'))] },
  { id: 'pnpm', group: 'app', risk: 'caution', minAgeDays: 0, targets: () => [C(path.join(localAppData(), 'pnpm', 'store'))] },
  { id: 'pip', group: 'app', risk: 'safe', minAgeDays: 0, targets: () => [C(path.join(localAppData(), 'pip', 'Cache'))] },
  { id: 'nuget', group: 'app', risk: 'caution', minAgeDays: 0, targets: () => [C(path.join(home(), '.nuget', 'packages'))] },
  { id: 'go-build', group: 'app', risk: 'safe', minAgeDays: 0, targets: () => [C(path.join(localAppData(), 'go-build'))] },
  { id: 'go-mod', group: 'app', risk: 'caution', minAgeDays: 0, targets: () => [C(env('GOMODCACHE') || path.join(home(), 'go', 'pkg', 'mod', 'cache'))] },
  { id: 'cargo', group: 'app', risk: 'caution', minAgeDays: 0, targets: () => [C(path.join(home(), '.cargo', 'registry', 'cache'))] },
  { id: 'maven', group: 'app', risk: 'caution', minAgeDays: 0, targets: () => [C(path.join(home(), '.m2', 'repository'))] },
  { id: 'gradle', group: 'app', risk: 'caution', minAgeDays: 0, targets: () => [C(path.join(home(), '.gradle', 'caches'))] },
  { id: 'office-cache', group: 'app', risk: 'safe', minAgeDays: 0, targets: () => [C(path.join(localAppData(), 'Microsoft', 'Office', '16.0', 'OfficeFileCache'))] },
  { id: 'netease-music', group: 'app', risk: 'safe', minAgeDays: 0, targets: () => [C(path.join(localAppData(), 'Netease', 'CloudMusic', 'Cache'))] },
  {
    id: 'electron-apps', group: 'app', risk: 'safe', minAgeDays: 0,
    targets: () => [
      C(path.join(roamingAppData(), 'Slack', 'Cache')),
      C(path.join(roamingAppData(), 'Microsoft', 'Teams', 'Cache')),
      C(path.join(roamingAppData(), 'Code', 'CachedExtensionVSIXs')),
    ],
  },
  {
    id: 'wechat', group: 'app', risk: 'caution', minAgeDays: 0,
    targets: () => [
      ...subdirs(path.join(home(), 'Documents', 'WeChat Files')).map((p) => C(path.join(p, 'FileStorage', 'Cache'))),
      ...subdirs(path.join(home(), 'Documents', 'xwechat_files')).map((p) => C(path.join(p, 'cache'))),
    ],
  },
  {
    id: 'qq', group: 'app', risk: 'risky', minAgeDays: 0,
    targets: () => subdirs(path.join(home(), 'Documents', 'Tencent Files')).map((p) => C(path.join(p, 'Image'))),
  },
  {
    id: 'dingtalk', group: 'app', risk: 'caution', minAgeDays: 0,
    targets: () => [
      C(path.join(roamingAppData(), 'DingTalk', 'cache')),
      C(path.join(localAppData(), 'DingTalk', 'cache')),
    ],
  },
  {
    id: 'wps', group: 'app', risk: 'caution', minAgeDays: 0,
    targets: () => [
      C(path.join(roamingAppData(), 'kingsoft', 'office6', 'backup')),
      C(path.join(localAppData(), 'Kingsoft', 'WPS Office', 'cache')),
    ],
  },
  {
    id: 'steam', group: 'app', risk: 'caution', minAgeDays: 0,
    targets: () => {
      const roots = [
        path.join(env('ProgramFiles(x86)'), 'Steam'),
        path.join(env('ProgramFiles'), 'Steam'),
      ].filter(dirExists);
      const out = [];
      for (const r of roots) {
        out.push(C(path.join(r, 'appcache', 'httpcache')));
        out.push(C(path.join(r, 'steamapps', 'downloading')));
        out.push(C(path.join(r, 'steamapps', 'shadercache')));
      }
      return out;
    },
  },
  {
    id: 'downloads-partial', group: 'app', risk: 'safe', minAgeDays: 1,
    targets: () => [E(path.join(home(), 'Downloads'), ['*.part', '*.crdownload', '*.tmp', '*.download'])],
  },

  { id: 'chrome', group: 'browser', risk: 'safe', minAgeDays: 0, targets: () => browserTargets(path.join(localAppData(), 'Google', 'Chrome', 'User Data')) },
  { id: 'edge', group: 'browser', risk: 'safe', minAgeDays: 0, targets: () => browserTargets(path.join(localAppData(), 'Microsoft', 'Edge', 'User Data')) },
  { id: 'brave', group: 'browser', risk: 'safe', minAgeDays: 0, targets: () => browserTargets(path.join(localAppData(), 'BraveSoftware', 'Brave-Browser', 'User Data')) },
  {
    id: 'firefox', group: 'browser', risk: 'safe', minAgeDays: 0,
    targets: () => subdirs(path.join(localAppData(), 'Mozilla', 'Firefox', 'Profiles')).map((p) => C(path.join(p, 'cache2'))),
  },
];

function existingTargets(targets) {
  return targets.filter((t) => (t.mode === 'recycle-bin' ? true : fs.existsSync(t.path)));
}

function needsAdminOf(targets) {
  return targets.some((t) => Boolean(t.needsAdmin));
}

export function isSupportedPlatform() {
  return process.platform === 'win32';
}

export function resolveTargets(id, { customDirs = [] } = {}) {
  if (id === 'custom') {
    return (customDirs || []).filter(Boolean).map((p) => C(p));
  }
  const cat = CATEGORIES.find((c) => c.id === id);
  if (!cat) return [];
  return existingTargets(cat.targets()).map((t) => ({ minAgeDays: cat.minAgeDays, ...t }));
}

export function listCategories({ customDirs = [] } = {}) {
  const out = [];
  for (const cat of CATEGORIES) {
    const targets = existingTargets(cat.targets());
    if (!targets.length) continue;
    out.push({
      id: cat.id,
      group: cat.group,
      risk: cat.risk,
      defaultChecked: cat.risk === 'safe',
      needsAdmin: needsAdminOf(targets),
      minAgeDays: cat.minAgeDays,
    });
  }
  if (customDirs.length) {
    out.push({ id: 'custom', group: 'custom', risk: 'risky', defaultChecked: false, needsAdmin: false, minAgeDays: 0 });
  }
  return out;
}
```

> `steam` 使用 `C:\Program Files*` 属于安装目录探测；如担心写死盘符，可改成从注册表读取，但第 1 期按规格允许「候选路径」。

- [ ] **Step 4: 运行测试通过**

Run: `node --test "server/test/disk-clean-catalog.test.js"`
Expected: PASS（3 tests）

- [ ] **Step 5: 提交**

```bash
git add server/disk-clean/catalog.js server/test/disk-clean-catalog.test.js
git commit -m "feat(disk-clean): 类别表与路径解析"
```

---

## Task 2: 遍历与统计 `fs-walk.js`

**Files:**
- Create: `server/disk-clean/fs-walk.js`
- Test: `server/test/disk-clean-walk.test.js`

- [ ] **Step 1: 写失败测试**

```js
// server/test/disk-clean-walk.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globToRegExp, measureDir, listEntries } from '../disk-clean/fs-walk.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfdc-walk-')); }

test('globToRegExp：* 与 ? 匹配文件名', () => {
  assert.ok(globToRegExp('*.log').test('a.log'));
  assert.ok(globToRegExp('a?.txt').test('ab.txt'));
  assert.equal(globToRegExp('*.log').test('a.txt'), false);
});

test('measureDir：统计文件数与字节，遵守年龄阈值', () => {
  const dir = tmp();
  const old = path.join(dir, 'old.txt');
  const fresh = path.join(dir, 'fresh.txt');
  fs.writeFileSync(old, 'aaaa');
  fs.writeFileSync(fresh, 'bbbb');
  const past = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  fs.utimesSync(old, past, past);
  const all = measureDir(dir);
  assert.equal(all.files, 2);
  assert.equal(all.bytes, 8);
  const aged = measureDir(dir, { minAgeDays: 1 });
  assert.equal(aged.files, 1);
  assert.equal(aged.bytes, 4);
});

test('measureDir：跳过符号链接（无权限时也能返回）', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  try { fs.symlinkSync(path.join(dir, 'a.txt'), path.join(dir, 'link.txt')); } catch { return; }
  const r = measureDir(dir, { recursive: false });
  assert.ok(r.files >= 1);
});

test('measureDir：超过 maxFiles 标记 truncated', () => {
  const dir = tmp();
  for (let i = 0; i < 5; i += 1) fs.writeFileSync(path.join(dir, `f${i}.txt`), 'x');
  const r = measureDir(dir, { maxFiles: 2 });
  assert.equal(r.truncated, true);
});

test('measureDir：skip 命中时不统计也不下钻', () => {
  const dir = tmp();
  const keep = path.join(dir, 'keep');
  fs.mkdirSync(keep);
  fs.writeFileSync(path.join(keep, 'a.txt'), 'aaaa');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'bb');
  const r = measureDir(dir, { skip: (p) => p.toLowerCase().includes('keep') });
  assert.equal(r.files, 1);
  assert.equal(r.bytes, 2);
});

test('listEntries：只返回匹配条目与满足年龄的文件', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.part'), 'aa');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'bb');
  const past = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  fs.utimesSync(path.join(dir, 'a.part'), past, past);
  const r = listEntries(dir, { patterns: ['*.part'], minAgeDays: 1 });
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].path, path.resolve(path.join(dir, 'a.part')));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/disk-clean-walk.test.js"`
Expected: FAIL

- [ ] **Step 3: 实现 `fs-walk.js`**

```js
import fs from 'node:fs';
import path from 'node:path';

export const MAX_FILES = 200_000;
export const MAX_MS = 30_000;

export function globToRegExp(pattern) {
  let out = '^';
  for (const ch of String(pattern || '')) {
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  out += '$';
  return new RegExp(out, 'i');
}

function ageCutoff(minAgeDays, now) {
  return minAgeDays > 0 ? now - minAgeDays * 86400000 : 0;
}

export function measureDir(dir, { minAgeDays = 0, recursive = true, maxFiles = MAX_FILES, maxMs = MAX_MS, skip = null } = {}) {
  const started = Date.now();
  const cutoff = ageCutoff(minAgeDays, started);
  let files = 0;
  let bytes = 0;
  let truncated = false;

  function walk(current) {
    if (truncated) return;
    let list;
    try { list = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (files >= maxFiles || Date.now() - started > maxMs) { truncated = true; return; }
      const full = path.join(current, e.name);
      if (skip && skip(full)) continue;
      let st;
      try { st = fs.lstatSync(full); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (recursive) walk(full);
      } else if (st.isFile()) {
        if (cutoff && st.mtimeMs > cutoff) continue;
        files += 1;
        bytes += st.size;
      }
    }
  }

  walk(dir);
  return { bytes, files, truncated };
}

export function listEntries(dir, { patterns = [], minAgeDays = 0, maxFiles = MAX_FILES, skip = null } = {}) {
  const cutoff = ageCutoff(minAgeDays, Date.now());
  const regs = patterns.map(globToRegExp);
  const entries = [];
  let truncated = false;
  let list;
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { entries, truncated }; }
  for (const e of list) {
    if (entries.length >= maxFiles) { truncated = true; break; }
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (skip && skip(full)) continue;
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (regs.length && !regs.some((r) => r.test(e.name))) continue;
    if (cutoff && st.mtimeMs > cutoff) continue;
    entries.push({ path: full, size: st.isFile() ? st.size : 0, isDir: st.isDirectory() });
  }
  return { entries, truncated };
}
```

- [ ] **Step 4: 运行测试通过**

Run: `node --test "server/test/disk-clean-walk.test.js"`
Expected: PASS（6 tests）

- [ ] **Step 5: 提交**

```bash
git add server/disk-clean/fs-walk.js server/test/disk-clean-walk.test.js
git commit -m "feat(disk-clean): 目录遍历与通配匹配"
```

---

## Task 3: 校验与存储 `validate.js` / `store.js`

**Files:**
- Create: `server/disk-clean/validate.js`
- Create: `server/disk-clean/store.js`
- Test: `server/test/disk-clean-validate.test.js`
- Test: `server/test/disk-clean-store.test.js`

- [ ] **Step 1: 写失败测试**

```js
// server/test/disk-clean-validate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateCustomDir, isExcluded } from '../disk-clean/validate.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfdc-val-')); }

test('validateCustomDir：接受普通目录并返回绝对路径', () => {
  const dir = tmp();
  const r = validateCustomDir(dir, { home: tmp() });
  assert.equal(r.ok, true);
  assert.equal(r.path, path.resolve(dir));
});

test('validateCustomDir：拒绝相对路径/不存在/文件/盘符根/系统目录/用户主目录', () => {
  const base = tmp();
  const file = path.join(base, 'a.txt');
  fs.writeFileSync(file, 'x');
  assert.equal(validateCustomDir('relative/path', { home: base }).ok, false);
  assert.equal(validateCustomDir(path.join(base, 'missing'), { home: base }).ok, false);
  assert.equal(validateCustomDir(file, { home: base }).ok, false);
  assert.equal(validateCustomDir(path.parse(base).root, { home: base }).ok, false);
  assert.equal(validateCustomDir(base, { home: tmp(), forbidden: [base] }).ok, false);
  for (const bad of ['sysroot', 'app', 'data', 'home']) {
    const target = { sysroot: base, app: base, data: base, home: base }[bad];
    const r = validateCustomDir(target, { home: base, forbidden: [target] });
    assert.equal(r.ok, false, bad);
  }
});

test('isExcluded：目录前缀与文件名通配', () => {
  const ex = { dirs: ['C:/keep/cache'], patterns: ['*.log'] };
  assert.equal(isExcluded('C:\\keep\\cache\\a.bin', ex), true);
  assert.equal(isExcluded('C:\\keep\\other\\a.log', ex), true);
  assert.equal(isExcluded('C:\\keep\\other\\a.bin', ex), false);
});
```

```js
// server/test/disk-clean-store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiskCleanStore } from '../disk-clean/store.js';

test('store：默认设置与写入回读', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfdc-store-'));
  const s = createDiskCleanStore({ dir });
  assert.deepEqual(s.readSettings(), { exclusions: { dirs: [], patterns: [] }, customDirs: [] });
  s.writeSettings({ exclusions: { dirs: ['C:\\x'], patterns: ['*.log'] }, customDirs: ['C:\\tmp'] });
  assert.deepEqual(s.readSettings(), { exclusions: { dirs: ['C:\\x'], patterns: ['*.log'] }, customDirs: ['C:\\tmp'] });
  assert.ok(fs.existsSync(path.join(dir, 'exclusions.json')));
  assert.ok(fs.existsSync(path.join(dir, 'custom.json')));
});

test('store：历史追加与读取上限', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfdc-store-h-'));
  const s = createDiskCleanStore({ dir });
  for (let i = 0; i < 5; i += 1) s.appendHistory({ ts: i, removed: i, bytes: 10 });
  const list = s.readHistory(3);
  assert.equal(list.length, 3);
  assert.equal(list[2].ts, 4);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/disk-clean-validate.test.js" "server/test/disk-clean-store.test.js"`
Expected: FAIL

- [ ] **Step 3: 实现 `validate.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { globToRegExp } from './fs-walk.js';

const norm = (p) => path.resolve(String(p || '')).replace(/[\\/]+$/, '').toLowerCase();

export function isUnder(parent, child) {
  const p = norm(parent);
  const c = norm(child);
  return c === p || c.startsWith(p + path.sep.toLowerCase());
}

export function validateCustomDir(raw, { home = '', forbidden = [] } = {}) {
  const input = String(raw || '').trim();
  if (!input || !path.isAbsolute(input)) return { ok: false, error: 'not_absolute' };
  const resolved = path.resolve(input);
  let st;
  try { st = fs.statSync(resolved); } catch { return { ok: false, error: 'not_found' }; }
  if (!st.isDirectory()) return { ok: false, error: 'not_dir' };
  const parsed = path.parse(resolved);
  if (parsed.root.replace(/[\\/]+$/, '') === resolved.replace(/[\\/]+$/, '')) return { ok: false, error: 'drive_root' };
  if (home && norm(resolved) === norm(home)) return { ok: false, error: 'forbidden' };
  for (const f of forbidden) {
    if (!f) continue;
    if (norm(resolved) === norm(f)) return { ok: false, error: 'forbidden' };
  }
  return { ok: true, path: resolved };
}

export function isExcluded(fullPath, exclusions = {}) {
  const dirs = exclusions.dirs || [];
  const patterns = (exclusions.patterns || []).map(globToRegExp);
  const target = norm(fullPath);
  if (dirs.some((d) => isUnder(d, fullPath))) return true;
  const base = path.basename(fullPath);
  return patterns.some((r) => r.test(base));
}
```

- [ ] **Step 4: 实现 `store.js`**

```js
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({ exclusions: { dirs: [], patterns: [] }, customDirs: [] });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

export function createDiskCleanStore({ dir }) {
  const exclusionsFile = path.join(dir, 'exclusions.json');
  const customFile = path.join(dir, 'custom.json');
  const historyFile = path.join(dir, 'history.jsonl');

  function readSettings() {
    const base = EMPTY();
    const ex = readJson(exclusionsFile, base.exclusions);
    const custom = readJson(customFile, []);
    return {
      exclusions: {
        dirs: Array.isArray(ex.dirs) ? ex.dirs.filter((x) => typeof x === 'string') : [],
        patterns: Array.isArray(ex.patterns) ? ex.patterns.filter((x) => typeof x === 'string') : [],
      },
      customDirs: Array.isArray(custom) ? custom.filter((x) => typeof x === 'string') : [],
    };
  }

  function writeSettings(next) {
    const saved = {
      exclusions: {
        dirs: Array.isArray(next?.exclusions?.dirs) ? next.exclusions.dirs : [],
        patterns: Array.isArray(next?.exclusions?.patterns) ? next.exclusions.patterns : [],
      },
      customDirs: Array.isArray(next?.customDirs) ? next.customDirs : [],
    };
    writeJson(exclusionsFile, saved.exclusions);
    writeJson(customFile, saved.customDirs);
    return saved;
  }

  function appendHistory(entry) {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(historyFile, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  function readHistory(limit = 100) {
    let text = '';
    try { text = fs.readFileSync(historyFile, 'utf8'); } catch { return []; }
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }

  return { readSettings, writeSettings, appendHistory, readHistory };
}
```

- [ ] **Step 5: 运行测试通过**

Run: `node --test "server/test/disk-clean-validate.test.js" "server/test/disk-clean-store.test.js"`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add server/disk-clean/validate.js server/disk-clean/store.js server/test/disk-clean-validate.test.js server/test/disk-clean-store.test.js
git commit -m "feat(disk-clean): 自定义目录校验与设置/历史存储"
```

---

## Task 4: 扫描任务 `scan.js`

**Files:**
- Create: `server/disk-clean/scan.js`
- Test: `server/test/disk-clean-scan.test.js`

- [ ] **Step 1: 写失败测试**

```js
// server/test/disk-clean-scan.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiskCleanScanner } from '../disk-clean/scan.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfdc-scan-')); }

function waitDone(scanner, id, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const task = scanner.get(id);
      if (!task) return reject(new Error('missing task'));
      if (task.categories.every((c) => c.status === 'done' || c.status === 'error')) return resolve(task);
      if (Date.now() - started > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

test('扫描：统计大小与文件数，并应用排除', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'aaaa');
  fs.writeFileSync(path.join(dir, 'b.log'), 'bb');
  const scanner = createDiskCleanScanner({
    listCategories: () => [{ id: 'x', group: 'custom', risk: 'safe', defaultChecked: true, needsAdmin: false, minAgeDays: 0 }],
    resolveTargets: () => [{ path: dir, mode: 'contents', minAgeDays: 0 }],
    readSettings: () => ({ exclusions: { dirs: [], patterns: ['*.log'] }, customDirs: [] }),
  });
  const { scanId } = scanner.start();
  const task = await waitDone(scanner, scanId);
  const cat = task.categories[0];
  assert.equal(cat.status, 'done');
  assert.equal(cat.files, 1);
  assert.equal(cat.bytes, 4);
});

test('扫描：过期任务返回 null', () => {
  let now = 0;
  const scanner = createDiskCleanScanner({
    listCategories: () => [{ id: 'x', group: 'custom', risk: 'safe', defaultChecked: true, needsAdmin: false, minAgeDays: 0 }],
    resolveTargets: () => [{ path: tmp(), mode: 'contents', minAgeDays: 0 }],
    readSettings: () => ({ exclusions: { dirs: [], patterns: [] }, customDirs: [] }),
    ttlMs: 10,
    now: () => now,
  });
  const { scanId } = scanner.start();
  now = 100;
  assert.equal(scanner.get(scanId), null);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/disk-clean-scan.test.js"`
Expected: FAIL

- [ ] **Step 3: 实现 `scan.js`**

```js
import crypto from 'node:crypto';
import fs from 'node:fs';
import { measureDir, listEntries } from './fs-walk.js';
import { isExcluded } from './validate.js';

function filteredTargets(targets, exclusions) {
  return targets.filter((t) => {
    if (isExcluded(t.path, exclusions)) return false;
    if (t.mode === 'entry' && t.patterns) {
      const keep = t.patterns.filter((p) => !(exclusions.patterns || []).some((x) => x.toLowerCase() === String(p).toLowerCase()));
      return keep.length > 0;
    }
    return true;
  }).map((t) => {
    if (t.mode !== 'entry' || !t.patterns) return t;
    const keep = t.patterns.filter((p) => !(exclusions.patterns || []).some((x) => x.toLowerCase() === String(p).toLowerCase()));
    return { ...t, patterns: keep };
  });
}

export function createDiskCleanScanner({
  listCategories,
  resolveTargets,
  readSettings,
  ttlMs = 10 * 60 * 1000,
  now = () => Date.now(),
}) {
  const tasks = new Map();

  function purge() {
    const t = now();
    for (const [id, task] of tasks) {
      if (t - task.startedAt > ttlMs) tasks.delete(id);
    }
  }

  function start({ customDirs } = {}) {
    purge();
    const settings = readSettings();
    const dirs = Array.isArray(customDirs) ? customDirs : settings.customDirs;
    const cats = listCategories({ customDirs: dirs }).map((c) => ({
      ...c, status: 'pending', bytes: 0, files: 0, truncated: false, error: null,
    }));
    const scanId = crypto.randomUUID();
    const task = { id: scanId, startedAt: now(), customDirs: dirs, exclusions: settings.exclusions, categories: cats };
    tasks.set(scanId, task);
    void run(task);
    return { scanId };
  }

  async function run(task) {
    for (const cat of task.categories) {
      cat.status = 'scanning';
      try {
        const targets = filteredTargets(resolveTargets(cat.id, { customDirs: task.customDirs }), task.exclusions);
        const skip = (full) => isExcluded(full, task.exclusions);
        for (const t of targets) {
          if (t.mode === 'contents') {
            const r = measureDir(t.path, { minAgeDays: t.minAgeDays || 0, skip });
            cat.bytes += r.bytes;
            cat.files += r.files;
            cat.truncated = cat.truncated || r.truncated;
          } else if (t.mode === 'entry') {
            const r = listEntries(t.path, { patterns: t.patterns || [], minAgeDays: t.minAgeDays || 0, skip });
            cat.bytes += r.entries.reduce((s, e) => s + e.size, 0);
            cat.files += r.entries.length;
            cat.truncated = cat.truncated || r.truncated;
          } else if (t.mode === 'file') {
            try {
              const st = fs.statSync(t.path);
              if (st.isFile()) { cat.files += 1; cat.bytes += st.size; }
            } catch { /* ignore */ }
          } else if (t.mode === 'recycle-bin') {
            const r = measureDir(`${t.path}\\$Recycle.Bin`, {});
            cat.bytes += r.bytes;
            cat.files += r.files;
            cat.truncated = cat.truncated || r.truncated;
          }
        }
        cat.status = 'done';
      } catch (e) {
        cat.status = 'error';
        cat.error = String(e?.message || e);
      }
      await new Promise((r) => setImmediate(r));
    }
  }

  function get(scanId) {
    purge();
    return tasks.get(scanId) || null;
  }

  return { start, get };
}
```

- [ ] **Step 4: 运行测试通过**

Run: `node --test "server/test/disk-clean-scan.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/disk-clean/scan.js server/test/disk-clean-scan.test.js
git commit -m "feat(disk-clean): 后台扫描任务与排除过滤"
```

---

## Task 5: 清理任务与 PS 助手 `clean.js` / `helper.ps1`

**Files:**
- Create: `server/disk-clean/helper.ps1`
- Create: `server/disk-clean/clean.js`
- Test: `server/test/disk-clean-clean.test.js`

- [ ] **Step 1: 写失败测试**

```js
// server/test/disk-clean-clean.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiskCleanCleaner } from '../disk-clean/clean.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfdc-clean-')); }

function fakeScan(categories, customDirs = []) {
  return { id: 's1', startedAt: Date.now(), expired: false, customDirs, exclusions: { dirs: [], patterns: [] }, categories };
}

const cat = (id, risk = 'safe', needsAdmin = false) => ({ id, group: 'app', risk, needsAdmin, minAgeDays: 0, status: 'done', bytes: 1, files: 1, truncated: false });

test('clean：拒绝不属于该扫描的类别', () => {
  const dir = tmp();
  const c = createDiskCleanCleaner({ jobsDir: path.join(dir, 'jobs'), resolveTargets: () => [], appendHistory: () => {} });
  const r = c.start({ scan: fakeScan([cat('npm')]), categoryIds: ['nope'], permanent: false, confirmed: [] });
  assert.equal(r.error, 'bad_category');
});

test('clean：risky 类别必须逐项确认', () => {
  const dir = tmp();
  const c = createDiskCleanCleaner({ jobsDir: path.join(dir, 'jobs'), resolveTargets: () => [], appendHistory: () => {} });
  const r = c.start({ scan: fakeScan([cat('custom', 'risky')]), categoryIds: ['custom'], permanent: false, confirmed: [] });
  assert.equal(r.error, 'need_confirm');
});

test('clean：生成 job.json 与带 BOM 的 helper 拷贝，并注入 spawn', () => {
  const dir = tmp();
  const jobsDir = path.join(dir, 'jobs');
  const spawned = [];
  const c = createDiskCleanCleaner({
    jobsDir,
    helperPath: path.resolve('server/disk-clean/helper.ps1'),
    resolveTargets: () => [{ path: dir, mode: 'contents', minAgeDays: 0 }],
    appendHistory: () => {},
    spawnFn: (cmd, args) => { spawned.push({ cmd, args }); return { on: () => {}, exitCode: 0 }; },
  });
  const r = c.start({ scan: fakeScan([cat('npm')]), categoryIds: ['npm'], permanent: false, confirmed: [] });
  assert.ok(r.jobId);
  const jobFile = path.join(jobsDir, r.jobId, 'job.json');
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  assert.equal(job.mode, 'recycle');
  assert.equal(job.categories.length, 1);
  assert.ok(job.categories[0].targets.length >= 1);
  assert.equal(spawned.length, 1);
  assert.ok(fs.existsSync(spawned[0].args.at(-1)));
  const copy = fs.readFileSync(path.join(jobsDir, r.jobId, 'helper.ps1'));
  assert.deepEqual([...copy.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const st = c.get(r.jobId);
  assert.equal(st.status, 'running');
});

test('clean：读取 result.json', () => {
  const dir = tmp();
  const jobsDir = path.join(dir, 'jobs');
  let jobId = '';
  const c = createDiskCleanCleaner({
    jobsDir,
    helperPath: path.resolve('server/disk-clean/helper.ps1'),
    resolveTargets: () => [],
    appendHistory: () => {},
    spawnFn: () => ({ on: () => {}, exitCode: 0 }),
  });
  jobId = c.start({ scan: fakeScan([cat('npm')]), categoryIds: ['npm'], permanent: true, confirmed: [] }).jobId;
  fs.writeFileSync(path.join(jobsDir, jobId, 'result.json'), JSON.stringify({ status: 'done', removed: 2, bytes: 20, failed: [], skipped: 0, mode: 'permanent' }));
  const st = c.get(jobId);
  assert.equal(st.status, 'done');
  assert.equal(st.removed, 2);
  assert.equal(st.mode, 'permanent');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/disk-clean-clean.test.js"`
Expected: FAIL

- [ ] **Step 3: 写 `helper.ps1`（保持纯 ASCII；运行时拷贝会自动补 UTF-8 BOM）**

```powershell
param([Parameter(Mandatory=$true)][string]$Job)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic

$job = Get-Content -LiteralPath $Job -Raw -Encoding UTF8 | ConvertFrom-Json
$jobDir = Split-Path -Parent $Job
$resultFile = Join-Path $jobDir 'result.json'

$script:removed = 0
$script:bytes = [long]0
$script:skipped = 0
$script:failed = New-Object System.Collections.ArrayList

function Get-Reason($err) {
  if ($err -is [System.UnauthorizedAccessException]) { return 'denied' }
  if ($err -is [System.IO.IOException]) { return 'locked' }
  return 'other'
}

function Test-Allowed([string]$candidate, $target) {
  $full = [IO.Path]::GetFullPath($candidate)
  $root = [IO.Path]::GetFullPath([string]$target.path)
  if ($target.mode -eq 'file') {
    return $full.Equals($root, [StringComparison]::OrdinalIgnoreCase)
  }
  if ($target.removeRoot -and $full.Equals($root, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  $prefix = $root.TrimEnd('\') + '\'
  return $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Test-Excluded([string]$candidate) {
  $full = [IO.Path]::GetFullPath($candidate)
  foreach ($d in @($job.exclusions.dirs)) {
    if (-not $d) { continue }
    $root = [IO.Path]::GetFullPath([string]$d).TrimEnd('\')
    if ($full.Equals($root, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    if ($full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  $name = [IO.Path]::GetFileName($full)
  foreach ($pat in @($job.exclusions.patterns)) {
    if ($pat -and ($name -like [string]$pat)) { return $true }
  }
  return $false
}

function Measure-Path([string]$p) {
  try {
    $item = Get-Item -LiteralPath $p -Force -ErrorAction Stop
    if ($item.PSIsContainer) {
      $sum = (Get-ChildItem -LiteralPath $p -Recurse -Force -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
      if ($null -eq $sum) { return 0 }
      return [long]$sum
    }
    return [long]$item.Length
  } catch { return 0 }
}

function Remove-One([string]$p, [bool]$isDir, $target) {
  if (Test-Excluded $p) { $script:skipped += 1; return }
  if (-not (Test-Allowed $p $target)) { $script:skipped += 1; return }
  $size = Measure-Path $p
  try {
    if ($job.mode -eq 'permanent') {
      Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Stop
    } elseif ($isDir) {
      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
    } else {
      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
    }
    $script:removed += 1
    $script:bytes += $size
  } catch {
    [void]$script:failed.Add(@{ path = $p; reason = (Get-Reason $_.Exception) })
  }
}

function Remove-Tree([string]$dir, $target) {
  $items = Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue
  foreach ($it in $items) {
    if (($it.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $script:skipped += 1; continue }
    if (Test-Excluded $it.FullName) { $script:skipped += 1; continue }
    if ($it.PSIsContainer) {
      Remove-Tree $it.FullName $target
      try {
        if ((Get-ChildItem -LiteralPath $it.FullName -Force -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0) {
          Remove-One $it.FullName $true $target
        }
      } catch { }
    } else {
      Remove-One $it.FullName $false $target
    }
  }
}

try {
  foreach ($cat in $job.categories) {
    $minAge = 0
    if ($null -ne $cat.minAgeDays) { $minAge = [double]$cat.minAgeDays }
    $cutoff = (Get-Date).AddDays(-$minAge)
    foreach ($target in $cat.targets) {
      $root = [string]$target.path
      if ($target.mode -eq 'recycle-bin') {
        try {
          $letter = $root.TrimEnd('\').TrimEnd(':')
          Clear-RecycleBin -DriveLetter $letter -Force -ErrorAction Stop
          $script:removed += 1
        } catch {
          [void]$script:failed.Add(@{ path = $root; reason = (Get-Reason $_.Exception) })
        }
        continue
      }
      if ($target.mode -eq 'file') {
        if (Test-Path -LiteralPath $root) { Remove-One $root $false $target }
        continue
      }
      if (-not (Test-Path -LiteralPath $root)) { continue }
      $items = Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue
      foreach ($item in $items) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $script:skipped += 1; continue }
        if (Test-Excluded $item.FullName) { $script:skipped += 1; continue }
        if ($minAge -gt 0 -and $item.LastWriteTime -gt $cutoff) { $script:skipped += 1; continue }
        if ($target.mode -eq 'entry') {
          if ($item.PSIsContainer) { continue }
          $patterns = @($target.patterns)
          if ($patterns.Count -gt 0) {
            $hit = $false
            foreach ($pat in $patterns) { if ($item.Name -like [string]$pat) { $hit = $true; break } }
            if (-not $hit) { continue }
          }
          Remove-One $item.FullName $false $target
        } elseif ($item.PSIsContainer) {
          Remove-Tree $item.FullName $target
          try {
            if ((Get-ChildItem -LiteralPath $item.FullName -Force -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0) {
              Remove-One $item.FullName $true $target
            }
          } catch { }
        } else {
          Remove-One $item.FullName $false $target
        }
      }
      if ($target.removeRoot -and $target.mode -eq 'contents') {
        if ((Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0) {
          Remove-One $root $true $target
        }
      }
    }
  }
  $result = @{
    status = 'done'; removed = $script:removed; bytes = $script:bytes; skipped = $script:skipped;
    failed = @($script:failed); mode = $job.mode; elevated = [bool]$job.elevated;
  }
} catch {
  $result = @{
    status = 'error'; removed = $script:removed; bytes = $script:bytes; skipped = $script:skipped;
    failed = @($script:failed); mode = $job.mode; elevated = [bool]$job.elevated; error = [string]$_.Exception.Message
  }
}

$json = $result | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText($resultFile, $json, (New-Object System.Text.UTF8Encoding($false)))
```

- [ ] **Step 4: 实现 `clean.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isExcluded } from './validate.js';

const defaultHelper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'helper.ps1');

function psQuote(s) { return `'${String(s).replace(/'/g, "''")}'`; }

function safeTargets(targets, exclusions) {
  return targets.filter((t) => !isExcluded(t.path, exclusions));
}

export function createDiskCleanCleaner({
  jobsDir,
  helperPath = defaultHelper,
  resolveTargets,
  appendHistory = () => {},
  spawnFn = spawn,
  now = () => Date.now(),
  logger = console,
}) {
  const jobs = new Map();

  function start({ scan, categoryIds, permanent, confirmed = [] }) {
    if (!scan) return { error: 'scan_expired' };
    if (scan.expired) return { error: 'scan_expired' };
    const ids = Array.isArray(categoryIds) ? categoryIds : [];
    if (!ids.length) return { error: 'bad_category' };
    const cats = scan.categories.filter((c) => ids.includes(c.id));
    if (cats.length !== ids.length) return { error: 'bad_category' };
    const risky = cats.filter((c) => c.risk === 'risky').map((c) => c.id);
    if (risky.some((id) => !confirmed.includes(id))) return { error: 'need_confirm' };

    const jobId = crypto.randomUUID();
    const dir = path.join(jobsDir, jobId);
    fs.mkdirSync(dir, { recursive: true });
    const helperCopy = path.join(dir, 'helper.ps1');
    const rawHelper = fs.readFileSync(helperPath);
    const hasBom = rawHelper[0] === 0xef && rawHelper[1] === 0xbb && rawHelper[2] === 0xbf;
    fs.writeFileSync(helperCopy, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), hasBom ? rawHelper.subarray(3) : rawHelper]));

    const job = {
      jobId,
      createdAt: now(),
      mode: permanent ? 'permanent' : 'recycle',
      elevated: cats.some((c) => c.needsAdmin),
      exclusions: scan.exclusions || { dirs: [], patterns: [] },
      categories: cats.map((c) => ({
        id: c.id,
        minAgeDays: c.minAgeDays || 0,
        targets: safeTargets(resolveTargets(c.id, { customDirs: scan.customDirs }), scan.exclusions || {}),
      })).filter((c) => c.targets.length > 0),
    };
    const jobFile = path.join(dir, 'job.json');
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2), 'utf8');

    const state = {
      dir, jobFile, startedAt: now(), elevated: job.elevated, childExit: null,
      categoryIds: job.categories.map((c) => c.id),
    };
    jobs.set(jobId, state);

    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperCopy, '-Job', jobFile];
    if (job.elevated) {
      const launcher = `try { Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList @(${args.map(psQuote).join(',')}) } catch { exit 2 }`;
      const child = spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', launcher], { windowsHide: true });
      child.on?.('exit', (code) => { state.childExit = code; });
    } else {
      const child = spawnFn('powershell.exe', args, { windowsHide: true });
      child.on?.('exit', (code) => { state.childExit = code; });
    }
    return { jobId };
  }

  function get(jobId) {
    const state = jobs.get(jobId);
    if (!state) return null;
    const resultFile = path.join(state.dir, 'result.json');
    try {
      const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      if (result.status !== 'running') {
        if (!state.finished) {
          state.finished = true;
          appendHistory({
            ts: new Date().toISOString(),
            categories: state.categoryIds,
            removed: result.removed || 0,
            bytes: result.bytes || 0,
            failed: Array.isArray(result.failed) ? result.failed.length : 0,
            mode: result.mode,
            elevated: Boolean(result.elevated),
          });
        }
        return { ...result, jobId };
      }
    } catch { /* not ready */ }
    if (state.childExit === 2 && !fs.existsSync(resultFile)) return { status: 'cancelled', jobId };
    if (state.childExit !== null && state.childExit !== 0 && !fs.existsSync(resultFile)) {
      return { status: 'error', jobId, error: `helper exit ${state.childExit}` };
    }
    if (now() - state.startedAt > 30 * 60 * 1000) return { status: 'interrupted', jobId };
    return { status: 'running', jobId, elevated: state.elevated };
  }

  return { start, get };
}
```

- [ ] **Step 5: 运行测试通过**

Run: `node --test "server/test/disk-clean-clean.test.js"`
Expected: PASS（4 tests）

- [ ] **Step 6: 提交**

```bash
git add server/disk-clean/clean.js server/disk-clean/helper.ps1 server/test/disk-clean-clean.test.js
git commit -m "feat(disk-clean): 清理任务与 PowerShell 删除助手"
```

---

## Task 6: HTTP 路由 `mount.js`

**Files:**
- Create: `server/disk-clean/mount.js`
- Test: `server/test/disk-clean-mount.test.js`

- [ ] **Step 1: 写失败测试**

```js
// server/test/disk-clean-mount.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDiskCleanMount } from '../disk-clean/mount.js';

function req(server, url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({
      host: '127.0.0.1', port: server.address().port, path: url, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (data) r.end(data); else r.end();
  });
}

function start(mount) {
  const server = http.createServer((rq, rs) => {
    const url = new URL(rq.url, 'http://127.0.0.1');
    void mount(rq, rs, url);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const json = (r) => JSON.parse(r.text);

test('mount：非 Windows 返回 501', async (t) => {
  const mount = createDiskCleanMount({ platform: 'linux' });
  const server = await start(mount);
  t.after(() => server.close());
  const r = await req(server, '/api/disk-clean/overview');
  assert.equal(r.status, 501);
});

test('mount：settings 读写与非法自定义目录', async (t) => {
  let saved = { exclusions: { dirs: [], patterns: [] }, customDirs: [] };
  const store = {
    readSettings: () => saved,
    writeSettings: (v) => { saved = v; return saved; },
    readHistory: () => [],
    appendHistory: () => {},
  };
  const mount = createDiskCleanMount({
    platform: 'win32',
    store,
    validateCustomDir: () => ({ ok: false, error: 'drive_root' }),
    forbiddenRoots: [],
  });
  const server = await start(mount);
  t.after(() => server.close());
  assert.equal((await req(server, '/api/disk-clean/settings')).status, 200);
  const bad = await req(server, '/api/disk-clean/settings', { method: 'PUT', body: { customDirs: ['C:\\'] } });
  assert.equal(bad.status, 400);
  assert.equal(json(bad).error, 'drive_root');
});

test('mount：scan / clean 参数与状态', async (t) => {
  const scanner = {
    start: () => ({ scanId: 's1' }),
    get: (id) => (id === 's1' ? { id, categories: [] } : null),
  };
  const cleaner = {
    start: () => ({ jobId: 'j1' }),
    get: (id) => (id === 'j1' ? { status: 'done', removed: 1, bytes: 2, failed: [], skipped: 0 } : null),
  };
  const store = { readSettings: () => ({ exclusions: { dirs: [], patterns: [] }, customDirs: [] }), writeSettings: (v) => v, readHistory: () => [] };
  const mount = createDiskCleanMount({ platform: 'win32', store, scanner, cleaner, overview: () => ({ drive: 'C:', total: 100, free: 50 }) });
  const server = await start(mount);
  t.after(() => server.close());
  assert.deepEqual(json(await req(server, '/api/disk-clean/overview')), { drive: 'C:', total: 100, free: 50 });
  assert.deepEqual(json(await req(server, '/api/disk-clean/scan', { method: 'POST', body: {} })), { scanId: 's1' });
  assert.equal((await req(server, '/api/disk-clean/scan/nope')).status, 410);
  assert.deepEqual(json(await req(server, '/api/disk-clean/clean', { method: 'POST', body: { scanId: 's1', categoryIds: ['npm'] } })), { jobId: 'j1' });
  assert.equal((await req(server, '/api/disk-clean/clean/nope')).status, 404);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/disk-clean-mount.test.js"`
Expected: FAIL

- [ ] **Step 3: 实现 `mount.js`**

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function defaultOverview() {
  const fallback = path.parse(os.homedir()).root.replace(/[\\/]+$/, '');
  const drive = (process.env.SystemDrive || fallback).replace(/[\\/]+$/, '');
  try {
    const s = fs.statfsSync(`${drive}\\`);
    return { drive, total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return { drive, total: 0, free: 0 };
  }
}

export function createDiskCleanMount({
  platform = process.platform,
  store,
  scanner,
  cleaner,
  overview = defaultOverview,
  validateCustomDir = () => ({ ok: true }),
  forbiddenRoots = [],
} = {}) {
  const supported = platform === 'win32';

  return async function route(req, res, url) {
    if (!supported) { sendJson(res, 501, { error: 'unsupported_platform' }); return; }
    const seg = url.pathname.replace(/^\/api\/disk-clean\/?/, '').split('/').filter(Boolean);
    const head = seg[0] || '';
    let body = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
    }

    if (head === 'overview' && req.method === 'GET') { sendJson(res, 200, overview()); return; }

    if (head === 'settings') {
      if (req.method === 'GET') { sendJson(res, 200, store.readSettings()); return; }
      if (req.method === 'PUT') {
        const dirs = Array.isArray(body.customDirs) ? body.customDirs : [];
        const accepted = [];
        for (const raw of dirs) {
          const r = validateCustomDir(raw, { forbidden: forbiddenRoots });
          if (!r.ok) { sendJson(res, 400, { error: r.error || 'bad_dir', path: raw }); return; }
          accepted.push(r.path || path.resolve(String(raw)));
        }
        const saved = store.writeSettings({
          exclusions: {
            dirs: Array.isArray(body?.exclusions?.dirs) ? body.exclusions.dirs.map(String) : [],
            patterns: Array.isArray(body?.exclusions?.patterns) ? body.exclusions.patterns.map(String) : [],
          },
          customDirs: accepted,
        });
        sendJson(res, 200, saved);
        return;
      }
    }

    if (head === 'history' && req.method === 'GET') {
      sendJson(res, 200, { items: store.readHistory(100) });
      return;
    }

    if (head === 'scan' && seg.length === 1 && req.method === 'POST') {
      sendJson(res, 200, scanner.start({ customDirs: Array.isArray(body.customDirs) ? body.customDirs : undefined }));
      return;
    }
    if (head === 'scan' && seg.length === 2 && req.method === 'GET') {
      const task = scanner.get(seg[1]);
      if (!task) { sendJson(res, 410, { error: 'scan_expired' }); return; }
      sendJson(res, 200, task);
      return;
    }

    if (head === 'clean' && seg.length === 1 && req.method === 'POST') {
      const scan = scanner.get(String(body.scanId || ''));
      if (!scan) { sendJson(res, 410, { error: 'scan_expired' }); return; }
      const r = cleaner.start({
        scan,
        categoryIds: Array.isArray(body.categoryIds) ? body.categoryIds.map(String) : [],
        permanent: Boolean(body.permanent),
        confirmed: Array.isArray(body.confirmed) ? body.confirmed.map(String) : [],
      });
      if (r.error === 'bad_category') { sendJson(res, 400, { error: r.error }); return; }
      if (r.error === 'need_confirm') { sendJson(res, 400, { error: r.error }); return; }
      if (r.error === 'scan_expired') { sendJson(res, 410, { error: r.error }); return; }
      sendJson(res, 200, r);
      return;
    }
    if (head === 'clean' && seg.length === 2 && req.method === 'GET') {
      const st = cleaner.get(seg[1]);
      if (!st) { sendJson(res, 404, { error: 'not_found' }); return; }
      sendJson(res, 200, st);
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  };
}
```

- [ ] **Step 4: 运行测试通过**

Run: `node --test "server/test/disk-clean-mount.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/disk-clean/mount.js server/test/disk-clean-mount.test.js
git commit -m "feat(disk-clean): HTTP 路由与平台守卫"
```

---

## Task 7: 端口目录与后端装配

**Files:**
- Modify: `server/port-paths.js`
- Modify: `server/index.js`
- Test: `server/test/port-paths.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/port-paths.test.js` 追加：

```js
test('portPaths：包含 disk-clean 数据目录并自动创建', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dfpp-'));
  const paths = ensurePortDirs(portPaths(2222, { root }));
  assert.equal(paths.diskCleanDir, path.join(root, 'ports', '2222', 'disk-clean'));
  assert.ok(fs.existsSync(paths.diskCleanDir));
});
```

（文件顶部已有 `fs`/`os`/`path`/`portPaths`/`ensurePortDirs` 导入则复用；缺哪个就补 import。）

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/port-paths.test.js"`
Expected: FAIL（`diskCleanDir` undefined）

- [ ] **Step 3: 修改 `port-paths.js`**

在返回对象中 `aiSiteRunsDir` 后加：

```js
    diskCleanDir: path.join(dir, 'disk-clean'),
```

在 `ensurePortDirs` 的数组末尾加 `paths.diskCleanDir`：

```js
  for (const d of [paths.dir, paths.projectsDataDir, paths.schedulerDir, paths.collabDir, paths.statsCacheDir, paths.uploadDir, paths.downloadDir, paths.downloadsDir, paths.workflowsDir, paths.skillsRoot, paths.sessionLogsDir, paths.postmanDir, paths.notepadDir, paths.yamlDir, paths.jsDir, paths.translateDir, paths.markdownDir, paths.navicatDir, paths.proxyDir, paths.proxyCapturesDir, paths.aiSiteDir, paths.aiSiteRunsDir, paths.diskCleanDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
```

- [ ] **Step 4: 修改 `server/index.js`**

顶部 import 区（`createAiSite` 附近）加：

```js
import { createDiskCleanStore } from './disk-clean/store.js';
import { createDiskCleanScanner } from './disk-clean/scan.js';
import { createDiskCleanCleaner } from './disk-clean/clean.js';
import { createDiskCleanMount } from './disk-clean/mount.js';
import { listCategories, resolveTargets } from './disk-clean/catalog.js';
import { validateCustomDir } from './disk-clean/validate.js';
```

在 `buildWorkspace` 内、`aiSite` 创建之后加：

```js
  const diskCleanStore = createDiskCleanStore({ dir: paths.diskCleanDir });
  const diskCleanScanner = createDiskCleanScanner({
    listCategories,
    resolveTargets,
    readSettings: () => diskCleanStore.readSettings(),
  });
  const diskCleanCleaner = createDiskCleanCleaner({
    jobsDir: path.join(paths.diskCleanDir, 'jobs'),
    resolveTargets,
    appendHistory: (entry) => diskCleanStore.appendHistory(entry),
    logger: log,
  });
  const diskCleanMount = createDiskCleanMount({
    store: diskCleanStore,
    scanner: diskCleanScanner,
    cleaner: diskCleanCleaner,
    validateCustomDir,
    forbiddenRoots: [APP_DIR, paths.dir, os.homedir(), process.env.SystemRoot || ''],
    logger: log,
  });
```

> `os` 若未导入需在文件顶部 `import os from 'node:os';`；`APP_DIR` 已存在。

在 `return { ... }` 的对象里加 `diskCleanStore, diskCleanMount`。

在请求分发区（`/api/ai-site` 那行之后）加：

```js
  if (url.pathname.startsWith('/api/disk-clean')) { await ws.diskCleanMount(req, res, url); return; }
```

- [ ] **Step 5: 运行测试通过**

Run: `node --test "server/test/port-paths.test.js"`
Expected: PASS

- [ ] **Step 6: 启动冒烟**

```powershell
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev:server" -RedirectStandardOutput "logs\diskclean-smoke.log" -RedirectStandardError "logs\diskclean-smoke.err.log"
Start-Sleep -Seconds 4
Invoke-RestMethod -Uri "http://127.0.0.1:33333/api/disk-clean/overview"
```

Expected: 返回 `drive/total/free`（跑完记得停掉该进程）

- [ ] **Step 7: 提交**

```bash
git add server/port-paths.js server/index.js server/test/port-paths.test.js
git commit -m "feat(disk-clean): 端口数据目录与后端装配"
```

---

## Task 8: 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 在 `tools.security` 后加工具词条**

中文（zh-CN）：

```js
  'tools.disk-clean': '系统清理',
  'tools.desc.disk-clean': '分析并清理系统与应用缓存、临时文件',
```

英文（en）：

```js
  'tools.disk-clean': 'Disk cleanup',
  'tools.desc.disk-clean': 'Analyze and clean system/app caches and temp files',
```

- [ ] **Step 2: 在 `security.*` 区块后加 `diskclean.*` 词条**

中文：

```js
  'diskclean.title': '系统清理',
  'diskclean.desc': '分析后勾选要清理的类别；默认删除到回收站，可切换永久删除。',
  'diskclean.analyze': '分析',
  'diskclean.analyzing': '分析中…',
  'diskclean.clean': '清理',
  'diskclean.cleaning': '清理中…',
  'diskclean.cancel': '取消',
  'diskclean.settings': '设置',
  'diskclean.save': '保存',
  'diskclean.close': '关闭',
  'diskclean.unsupported': '该工具仅支持 Windows。',
  'diskclean.overview': '系统盘 {drive} 可用 {free} / {total}',
  'diskclean.not_analyzed': '—',
  'diskclean.selected': '已选 {count} 类',
  'diskclean.selected_size': '预计释放 {size}',
  'diskclean.permanent': '永久删除（不进回收站）',
  'diskclean.permanent_warn': '永久删除不可恢复，请确认。',
  'diskclean.mode.recycle': '回收站',
  'diskclean.mode.permanent': '永久删除',
  'diskclean.admin_badge': '需管理员',
  'diskclean.admin_hint': '清理时将弹出 UAC。',
  'diskclean.risk.safe': '安全',
  'diskclean.risk.caution': '谨慎',
  'diskclean.risk.risky': '危险',
  'diskclean.group.system': 'Windows 系统',
  'diskclean.group.app': '应用程序',
  'diskclean.group.browser': '浏览器缓存',
  'diskclean.group.custom': '自定义目录',
  'diskclean.status.pending': '等待',
  'diskclean.status.scanning': '扫描中',
  'diskclean.status.done': '完成',
  'diskclean.status.error': '失败',
  'diskclean.truncated': '已截断',
  'diskclean.progress': '{done}/{total} 类',
  'diskclean.need_select': '请至少勾选一个类别',
  'diskclean.confirm_title': '确认清理',
  'diskclean.confirm_body': '将清理 {count} 类，预计释放 {size}，删除方式：{mode}。',
  'diskclean.confirm_risky': '以下危险类别需要逐项确认：',
  'diskclean.confirm_risky_item': '我确认清理「{name}」',
  'diskclean.result_title': '清理结果',
  'diskclean.result_summary': '释放 {size}，删除 {removed} 项，跳过 {skipped} 项，失败 {failed} 项',
  'diskclean.result_recycle': '已删除项在回收站，可手动还原。',
  'diskclean.result_failed': '失败明细',
  'diskclean.result_reason.locked': '被占用',
  'diskclean.result_reason.denied': '无权限',
  'diskclean.result_reason.other': '其他',
  'diskclean.cancelled': '已取消（UAC 未确认）。',
  'diskclean.expired': '分析结果已过期，请重新分析。',
  'diskclean.settings_exclusions': '排除目录',
  'diskclean.settings_patterns': '排除通配（每行一个）',
  'diskclean.settings_custom': '自定义清理目录（内容会被删除）',
  'diskclean.settings_add_dir': '添加目录',
  'diskclean.settings_remove': '移除',
  'diskclean.settings_reanalyze': '设置已保存，需重新分析才生效。',
  'diskclean.settings_bad_dir': '目录不可用：{error}',
  'diskclean.history': '最近清理记录',
  'diskclean.history_empty': '暂无记录',
  'diskclean.load_failed': '请求失败：{msg}',
  'diskclean.cat.user-temp': '用户临时文件',
  'diskclean.cat.windows-temp': 'Windows 临时文件',
  'diskclean.cat.recycle-bin': '回收站',
  'diskclean.cat.update-cache': 'Windows 更新缓存',
  'diskclean.cat.crash-dumps': '崩溃转储',
  'diskclean.cat.wer-reports': '错误报告',
  'diskclean.cat.thumbnails': '缩略图缓存',
  'diskclean.cat.system-logs': '系统日志（7 天前）',
  'diskclean.cat.windows-old': '旧系统备份 Windows.old',
  'diskclean.cat.npm': 'npm 缓存',
  'diskclean.cat.yarn': 'Yarn 缓存',
  'diskclean.cat.pnpm': 'pnpm store',
  'diskclean.cat.pip': 'pip 缓存',
  'diskclean.cat.nuget': 'NuGet 包缓存',
  'diskclean.cat.go-build': 'Go 构建缓存',
  'diskclean.cat.go-mod': 'Go 模块缓存',
  'diskclean.cat.cargo': 'Cargo 注册表缓存',
  'diskclean.cat.maven': 'Maven 本地仓库',
  'diskclean.cat.gradle': 'Gradle 缓存',
  'diskclean.cat.office-cache': 'Office 文件缓存',
  'diskclean.cat.netease-music': '网易云音乐缓存',
  'diskclean.cat.electron-apps': 'Electron 应用缓存',
  'diskclean.cat.wechat': '微信缓存',
  'diskclean.cat.qq': 'QQ 图片缓存',
  'diskclean.cat.dingtalk': '钉钉缓存',
  'diskclean.cat.wps': 'WPS 缓存',
  'diskclean.cat.steam': 'Steam 缓存',
  'diskclean.cat.downloads-partial': '下载半成品',
  'diskclean.cat.chrome': 'Chrome 缓存',
  'diskclean.cat.edge': 'Edge 缓存',
  'diskclean.cat.brave': 'Brave 缓存',
  'diskclean.cat.firefox': 'Firefox 缓存',
  'diskclean.cat.custom': '自定义目录',
```

英文（en）：逐键对应：

```js
  'diskclean.title': 'Disk cleanup',
  'diskclean.desc': 'Analyze, then select categories to clean. Items go to the Recycle Bin unless permanent delete is on.',
  'diskclean.analyze': 'Analyze',
  'diskclean.analyzing': 'Analyzing…',
  'diskclean.clean': 'Clean',
  'diskclean.cleaning': 'Cleaning…',
  'diskclean.cancel': 'Cancel',
  'diskclean.settings': 'Settings',
  'diskclean.save': 'Save',
  'diskclean.close': 'Close',
  'diskclean.unsupported': 'This tool only supports Windows.',
  'diskclean.overview': 'System drive {drive}: {free} free of {total}',
  'diskclean.not_analyzed': '—',
  'diskclean.selected': '{count} categories selected',
  'diskclean.selected_size': 'About {size} to free',
  'diskclean.permanent': 'Permanent delete (skip Recycle Bin)',
  'diskclean.permanent_warn': 'Permanent delete cannot be undone.',
  'diskclean.mode.recycle': 'Recycle Bin',
  'diskclean.mode.permanent': 'Permanent delete',
  'diskclean.admin_badge': 'Admin',
  'diskclean.admin_hint': 'A UAC prompt will appear when cleaning.',
  'diskclean.risk.safe': 'Safe',
  'diskclean.risk.caution': 'Caution',
  'diskclean.risk.risky': 'Risky',
  'diskclean.group.system': 'Windows system',
  'diskclean.group.app': 'Applications',
  'diskclean.group.browser': 'Browser caches',
  'diskclean.group.custom': 'Custom folders',
  'diskclean.status.pending': 'Pending',
  'diskclean.status.scanning': 'Scanning',
  'diskclean.status.done': 'Done',
  'diskclean.status.error': 'Failed',
  'diskclean.truncated': 'truncated',
  'diskclean.progress': '{done}/{total} categories',
  'diskclean.need_select': 'Select at least one category',
  'diskclean.confirm_title': 'Confirm cleanup',
  'diskclean.confirm_body': 'Clean {count} categories, about {size}, method: {mode}.',
  'diskclean.confirm_risky': 'Confirm these risky categories individually:',
  'diskclean.confirm_risky_item': 'I confirm cleaning "{name}"',
  'diskclean.result_title': 'Cleanup result',
  'diskclean.result_summary': 'Freed {size}, removed {removed}, skipped {skipped}, failed {failed}',
  'diskclean.result_recycle': 'Removed items are in the Recycle Bin.',
  'diskclean.result_failed': 'Failures',
  'diskclean.result_reason.locked': 'in use',
  'diskclean.result_reason.denied': 'denied',
  'diskclean.result_reason.other': 'other',
  'diskclean.cancelled': 'Cancelled (UAC not approved).',
  'diskclean.expired': 'Analysis expired, please analyze again.',
  'diskclean.settings_exclusions': 'Excluded folders',
  'diskclean.settings_patterns': 'Excluded patterns (one per line)',
  'diskclean.settings_custom': 'Custom folders to clean (contents will be deleted)',
  'diskclean.settings_add_dir': 'Add folder',
  'diskclean.settings_remove': 'Remove',
  'diskclean.settings_reanalyze': 'Saved. Re-analyze to apply.',
  'diskclean.settings_bad_dir': 'Folder not usable: {error}',
  'diskclean.history': 'Recent cleanups',
  'diskclean.history_empty': 'No records',
  'diskclean.load_failed': 'Request failed: {msg}',
  'diskclean.cat.user-temp': 'User temp files',
  'diskclean.cat.windows-temp': 'Windows temp files',
  'diskclean.cat.recycle-bin': 'Recycle Bin',
  'diskclean.cat.update-cache': 'Windows Update cache',
  'diskclean.cat.crash-dumps': 'Crash dumps',
  'diskclean.cat.wer-reports': 'Error reports',
  'diskclean.cat.thumbnails': 'Thumbnail cache',
  'diskclean.cat.system-logs': 'System logs (older than 7 days)',
  'diskclean.cat.windows-old': 'Previous Windows installation',
  'diskclean.cat.npm': 'npm cache',
  'diskclean.cat.yarn': 'Yarn cache',
  'diskclean.cat.pnpm': 'pnpm store',
  'diskclean.cat.pip': 'pip cache',
  'diskclean.cat.nuget': 'NuGet package cache',
  'diskclean.cat.go-build': 'Go build cache',
  'diskclean.cat.go-mod': 'Go module cache',
  'diskclean.cat.cargo': 'Cargo registry cache',
  'diskclean.cat.maven': 'Maven local repository',
  'diskclean.cat.gradle': 'Gradle cache',
  'diskclean.cat.office-cache': 'Office file cache',
  'diskclean.cat.netease-music': 'NetEase Music cache',
  'diskclean.cat.electron-apps': 'Electron app caches',
  'diskclean.cat.wechat': 'WeChat cache',
  'diskclean.cat.qq': 'QQ image cache',
  'diskclean.cat.dingtalk': 'DingTalk cache',
  'diskclean.cat.wps': 'WPS cache',
  'diskclean.cat.steam': 'Steam cache',
  'diskclean.cat.downloads-partial': 'Partial downloads',
  'diskclean.cat.chrome': 'Chrome cache',
  'diskclean.cat.edge': 'Edge cache',
  'diskclean.cat.brave': 'Brave cache',
  'diskclean.cat.firefox': 'Firefox cache',
  'diskclean.cat.custom': 'Custom folders',
```

- [ ] **Step 3: 校验词条对称**

Run: `npm.cmd run check:i18n`
Expected: PASS（无缺失键）

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(disk-clean): 中英词条"
```

---

## Task 9: 工具注册

**Files:**
- Modify: `web/src/tools/catalog.ts`
- Modify: `web/src/components/TerminalView.vue`
- Modify: `web/src/components/ToolSidebar.vue`
- Test: `web/src/components/MiniTools.test.ts`

- [ ] **Step 1: 更新测试**

`web/src/components/MiniTools.test.ts` 中：

```ts
const IDS = ['notepad', 'postman', 'navicat', 'nginx', 'translate', 'yaml', 'markdown', 'js', 'base64', 'security', 'disk-clean'];
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- MiniTools`
Expected: FAIL（数量不一致）

- [ ] **Step 3: 修改 `catalog.ts`**

```ts
export type ToolId = 'translate' | 'yaml' | 'notepad' | 'postman' | 'navicat' | 'nginx' | 'markdown' | 'js' | 'base64' | 'security' | 'disk-clean';
```

数组末尾加：

```ts
  { id: 'disk-clean', icon: '🧹', labelKey: 'tools.disk-clean', descKey: 'tools.desc.disk-clean' },
```

- [ ] **Step 4: 修改 `TerminalView.vue`**

import 区加：

```ts
import DiskCleanTool from '../tools/disk-clean/DiskCleanTool.vue';
```

工具渲染区加：

```html
      <DiskCleanTool v-else-if="activeToolName === 'disk-clean'" />
```

- [ ] **Step 5: 修改 `ToolSidebar.vue`**

```ts
  if (props.tool === 'base64' || props.tool === 'nginx' || props.tool === 'security' || props.tool === 'disk-clean') return null;
```

- [ ] **Step 6: 运行测试通过**

Run: `npm.cmd --prefix web run test -- MiniTools`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add web/src/tools/catalog.ts web/src/components/TerminalView.vue web/src/components/ToolSidebar.vue web/src/components/MiniTools.test.ts
git commit -m "feat(disk-clean): 注册系统清理工具页签"
```

---

## Task 10: 前端纯函数 `selection.ts`

**Files:**
- Create: `web/src/tools/disk-clean/selection.ts`
- Test: `web/src/tools/disk-clean/selection.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { defaultSelection, selectionTotals, missingRiskyConfirmations, formatBytes } from './selection';
import type { DiskCategory } from './types';

const cat = (p: Partial<DiskCategory>): DiskCategory => ({
  id: 'x', group: 'app', risk: 'safe', defaultChecked: true, needsAdmin: false,
  status: 'done', bytes: 0, files: 0, truncated: false, error: null, ...p,
});

describe('disk-clean selection', () => {
  it('默认只勾选 safe 类别', () => {
    const cats = [cat({ id: 'a' }), cat({ id: 'b', risk: 'caution', defaultChecked: false }), cat({ id: 'c', risk: 'risky', defaultChecked: false })];
    expect([...defaultSelection(cats)]).toEqual(['a']);
  });

  it('汇总已选类别的字节与数量', () => {
    const cats = [cat({ id: 'a', bytes: 10 }), cat({ id: 'b', bytes: 20 })];
    const r = selectionTotals(cats, new Set(['a', 'b']));
    expect(r).toEqual({ count: 2, bytes: 30 });
  });

  it('risky 类别缺少确认时返回 id 列表', () => {
    const cats = [cat({ id: 'r', risk: 'risky', defaultChecked: false }), cat({ id: 's' })];
    expect(missingRiskyConfirmations(cats, new Set(['r', 's']), new Set(['s']))).toEqual(['r']);
    expect(missingRiskyConfirmations(cats, new Set(['r', 's']), new Set(['r', 's']))).toEqual([]);
  });

  it('formatBytes 走人类可读单位', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 * 3)).toBe('3.0 MB');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- disk-clean/selection`
Expected: FAIL

- [ ] **Step 3: 实现 `types.ts` 与 `selection.ts`**

```ts
// web/src/tools/disk-clean/types.ts
export type DiskGroup = 'system' | 'app' | 'browser' | 'custom';
export type DiskRisk = 'safe' | 'caution' | 'risky';
export type DiskStatus = 'pending' | 'scanning' | 'done' | 'error';

export interface DiskCategory {
  id: string;
  group: DiskGroup;
  risk: DiskRisk;
  defaultChecked: boolean;
  needsAdmin: boolean;
  minAgeDays?: number;
  status: DiskStatus;
  bytes: number;
  files: number;
  truncated: boolean;
  error: string | null;
}

export interface DiskScan {
  id: string;
  startedAt: number;
  categories: DiskCategory[];
}

export interface DiskSettings {
  exclusions: { dirs: string[]; patterns: string[] };
  customDirs: string[];
}

export interface DiskCleanResult {
  status: 'running' | 'done' | 'cancelled' | 'error' | 'interrupted';
  removed?: number;
  bytes?: number;
  skipped?: number;
  failed?: Array<{ path: string; reason: string }>;
  mode?: 'recycle' | 'permanent';
  elevated?: boolean;
  error?: string;
}
```

```ts
// web/src/tools/disk-clean/selection.ts
import type { DiskCategory } from './types';

export function defaultSelection(categories: DiskCategory[]): Set<string> {
  return new Set(categories.filter((c) => c.defaultChecked).map((c) => c.id));
}

export function selectionTotals(categories: DiskCategory[], selected: Set<string>) {
  const picked = categories.filter((c) => selected.has(c.id));
  return { count: picked.length, bytes: picked.reduce((s, c) => s + (c.bytes || 0), 0) };
}

export function missingRiskyConfirmations(categories: DiskCategory[], selected: Set<string>, confirmed: Set<string>): string[] {
  return categories
    .filter((c) => selected.has(c.id) && c.risk === 'risky' && !confirmed.has(c.id))
    .map((c) => c.id);
}

export function formatBytes(n: number): string {
  const v = Math.max(0, Number(n) || 0);
  if (v < 1024) return `${Math.round(v)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = v / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${value.toFixed(1)} ${units[i]}`;
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npm.cmd --prefix web run test -- disk-clean/selection`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/tools/disk-clean/types.ts web/src/tools/disk-clean/selection.ts web/src/tools/disk-clean/selection.test.ts
git commit -m "feat(disk-clean): 前端勾选与格式化纯函数"
```

---

## Task 11: 前端状态机 `useDiskClean.ts`

**Files:**
- Create: `web/src/tools/disk-clean/useDiskClean.ts`

- [ ] **Step 1: 实现**

```ts
import { computed, onBeforeUnmount, ref } from 'vue';
import { defaultSelection, missingRiskyConfirmations, selectionTotals } from './selection';
import type { DiskCategory, DiskCleanResult, DiskScan, DiskSettings } from './types';

export type DiskPhase = 'idle' | 'scanning' | 'ready' | 'cleaning' | 'done' | 'error';

export function useDiskClean() {
  const phase = ref<DiskPhase>('idle');
  const error = ref('');
  const scan = ref<DiskScan | null>(null);
  const selected = ref<Set<string>>(new Set());
  const confirmed = ref<Set<string>>(new Set());
  const permanent = ref(false);
  const settings = ref<DiskSettings>({ exclusions: { dirs: [], patterns: [] }, customDirs: [] });
  const result = ref<DiskCleanResult | null>(null);
  const history = ref<any[]>([]);
  const busy = computed(() => phase.value === 'scanning' || phase.value === 'cleaning');
  const totals = computed(() => selectionTotals(scan.value?.categories || [], selected.value));
  const canClean = computed(() => phase.value === 'ready' && totals.value.count > 0);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function stopPolling() {
    stopped = true;
    if (timer) { clearTimeout(timer); timer = null; }
  }
  onBeforeUnmount(stopPolling);

  async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async function loadBasics() {
    const [overview, s, h] = await Promise.all([
      api<any>('/api/disk-clean/overview').catch(() => null),
      api<DiskSettings>('/api/disk-clean/settings').catch(() => settings.value),
      api<{ items: any[] }>('/api/disk-clean/history').catch(() => ({ items: [] })),
    ]);
    settings.value = s;
    history.value = h.items || [];
    return overview;
  }

  async function analyze() {
    if (busy.value) return;
    stopPolling();
    stopped = false;
    phase.value = 'scanning';
    error.value = '';
    result.value = null;
    try {
      const { scanId } = await api<{ scanId: string }>('/api/disk-clean/scan', { method: 'POST', body: '{}' });
      const poll = async () => {
        if (stopped) return;
        try {
          const task = await api<DiskScan>(`/api/disk-clean/scan/${scanId}`);
          const first = !scan.value || scan.value.id !== task.id;
          scan.value = task;
          if (first) {
            selected.value = defaultSelection(task.categories);
            confirmed.value = new Set();
          }
          const done = task.categories.filter((c) => c.status === 'done' || c.status === 'error');
          if (done.length === task.categories.length) { phase.value = 'ready'; return; }
        } catch (e: any) {
          if (String(e?.message || '') === 'scan_expired') { error.value = 'scan_expired'; phase.value = 'error'; return; }
          throw e;
        }
        timer = setTimeout(poll, 500);
      };
      await poll();
    } catch (e: any) {
      error.value = String(e?.message || e);
      phase.value = 'error';
    }
  }

  function toggle(id: string) {
    const next = new Set(selected.value);
    if (next.has(id)) next.delete(id); else next.add(id);
    selected.value = next;
  }

  function toggleConfirm(id: string) {
    const next = new Set(confirmed.value);
    if (next.has(id)) next.delete(id); else next.add(id);
    confirmed.value = next;
  }

  function blockedRisky(): string[] {
    return missingRiskyConfirmations(scan.value?.categories || [], selected.value, confirmed.value);
  }

  async function clean() {
    if (!scan.value || !canClean.value) return;
    const missing = blockedRisky();
    if (missing.length) { error.value = 'need_confirm'; return; }
    phase.value = 'cleaning';
    error.value = '';
    try {
      const { jobId } = await api<{ jobId: string }>('/api/disk-clean/clean', {
        method: 'POST',
        body: JSON.stringify({
          scanId: scan.value.id,
          categoryIds: [...selected.value],
          permanent: permanent.value,
          confirmed: [...confirmed.value],
        }),
      });
      const poll = async () => {
        if (stopped) return;
        const st = await api<DiskCleanResult>(`/api/disk-clean/clean/${jobId}`);
        result.value = st;
        if (st.status === 'running') { timer = setTimeout(poll, 500); return; }
        phase.value = 'done';
      };
      await poll();
      history.value = (await api<{ items: any[] }>('/api/disk-clean/history').catch(() => ({ items: [] }))).items || [];
    } catch (e: any) {
      error.value = String(e?.message || e);
      phase.value = 'error';
    }
  }

  async function saveSettings(next: DiskSettings) {
    settings.value = await api<DiskSettings>('/api/disk-clean/settings', {
      method: 'PUT',
      body: JSON.stringify(next),
    });
    return settings.value;
  }

  return {
    phase, error, scan, selected, confirmed, permanent, settings, result, history,
    busy, totals, canClean, loadBasics, analyze, toggle, toggleConfirm, blockedRisky, clean, saveSettings,
  };
}
```

- [ ] **Step 2: 提交**

```bash
git add web/src/tools/disk-clean/useDiskClean.ts
git commit -m "feat(disk-clean): 前端状态机与轮询"
```

---

## Task 12: 页面 `DiskCleanTool.vue`

**Files:**
- Create: `web/src/tools/disk-clean/DiskCleanTool.vue`

- [ ] **Step 1: 实现页面**

```vue
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { t } from '../../i18n';
import { useProjects } from '../../useProjects';
import { useDiskClean } from './useDiskClean';
import { formatBytes } from './selection';
import type { DiskSettings } from './types';

const dc = useDiskClean();
const projects = useProjects();
const overview = ref<any>(null);
const showSettings = ref(false);
const showConfirm = ref(false);
const showResult = ref(false);
const draft = reactive<{ exclusionDirs: string[]; patternsText: string; customDirs: string[] }>({
  exclusionDirs: [], patternsText: '', customDirs: [],
});

const groups = computed(() => {
  const order: Array<{ key: string; labelKey: string }> = [
    { key: 'system', labelKey: 'diskclean.group.system' },
    { key: 'app', labelKey: 'diskclean.group.app' },
    { key: 'browser', labelKey: 'diskclean.group.browser' },
    { key: 'custom', labelKey: 'diskclean.group.custom' },
  ];
  const cats = dc.scan.value?.categories || [];
  return order.map((g) => ({ ...g, items: cats.filter((c) => c.group === g.key) })).filter((g) => g.items.length);
});

const totalCats = computed(() => dc.scan.value?.categories.length || 0);
const doneCats = computed(() => (dc.scan.value?.categories || []).filter((c) => c.status === 'done' || c.status === 'error').length);
const selectedCats = computed(() => (dc.scan.value?.categories || []).filter((c) => dc.selected.value.has(c.id)));
const riskyCats = computed(() => selectedCats.value.filter((c) => c.risk === 'risky'));
const errorText = computed(() => {
  const e = dc.error.value;
  if (!e) return '';
  if (e === 'scan_expired') return t('diskclean.expired');
  if (e === 'unsupported_platform') return t('diskclean.unsupported');
  if (e === 'need_confirm') return t('diskclean.need_select');
  return e;
});

onMounted(async () => {
  overview.value = await dc.loadBasics();
  if (!overview.value) dc.error.value = t('diskclean.unsupported');
  syncDraft(dc.settings.value);
});

function syncDraft(s: DiskSettings) {
  draft.exclusionDirs = [...(s.exclusions.dirs || [])];
  draft.patternsText = (s.exclusions.patterns || []).join('\n');
  draft.customDirs = [...(s.customDirs || [])];
}

function catName(c: DiskCategory) {
  const key = `diskclean.cat.${c.id}`;
  const text = t(key);
  return text === key ? c.id : text;
}
function riskText(c: DiskCategory) { return t(`diskclean.risk.${c.risk}`); }

async function pick(into: string[]) {
  try {
    const r = await projects.pickFolder();
    if (r?.path) into.push(r.path);
  } catch { /* ignore */ }
}

async function openSettings() {
  syncDraft(dc.settings.value);
  showSettings.value = true;
}

async function saveSettings() {
  try {
    const saved = await dc.saveSettings({
      exclusions: { dirs: draft.exclusionDirs, patterns: draft.patternsText.split('\n').map((s) => s.trim()).filter(Boolean) },
      customDirs: draft.customDirs,
    });
    syncDraft(saved);
    showSettings.value = false;
    dc.error.value = '';
    await dc.analyze();
  } catch (e: any) {
    dc.error.value = t('diskclean.settings_bad_dir', { error: String(e?.message || e) });
  }
}

function openConfirm() { if (dc.canClean.value) showConfirm.value = true; }

async function runClean() {
  showConfirm.value = false;
  await dc.clean();
  showResult.value = true;
  overview.value = await fetch('/api/disk-clean/overview').then((r) => r.json()).catch(() => overview.value);
}
</script>

<template>
  <div class="dc">
    <div class="head">
      <div>
        <div class="ttl">{{ $t('diskclean.title') }}</div>
        <div class="desc">{{ $t('diskclean.desc') }}</div>
      </div>
      <div class="ov" v-if="overview">
        {{ $t('diskclean.overview', { drive: overview.drive, free: formatBytes(overview.free), total: formatBytes(overview.total) }) }}
      </div>
    </div>

    <div class="bar">
      <button class="btn primary" :disabled="dc.busy.value" @click="dc.analyze()">
        {{ dc.phase.value === 'scanning' ? $t('diskclean.analyzing') : $t('diskclean.analyze') }}
      </button>
      <button class="btn" :disabled="!dc.canClean.value" @click="openConfirm">{{ $t('diskclean.clean') }}</button>
      <button class="btn" @click="openSettings">{{ $t('diskclean.settings') }}</button>
      <span v-if="dc.phase.value === 'scanning'" class="progress">{{ $t('diskclean.progress', { done: doneCats, total: totalCats }) }}</span>
    </div>

    <div v-if="errorText" class="err">{{ errorText }}</div>

    <div class="groups">
      <section v-for="g in groups" :key="g.key" class="group">
        <div class="ghead">{{ $t(g.labelKey) }}</div>
        <label v-for="c in g.items" :key="c.id" class="row" :class="c.risk">
          <input type="checkbox" :checked="dc.selected.value.has(c.id)" @change="dc.toggle(c.id)" />
          <span class="name">{{ catName(c) }}</span>
          <span class="badge" :class="c.risk">{{ riskText(c) }}</span>
          <span v-if="c.needsAdmin" class="badge admin">{{ $t('diskclean.admin_badge') }}</span>
          <span class="status" :class="c.status">{{ $t('diskclean.status.' + c.status) }}</span>
          <span v-if="c.truncated" class="badge warn">{{ $t('diskclean.truncated') }}</span>
          <span class="size">{{ c.status === 'done' ? formatBytes(c.bytes) : $t('diskclean.not_analyzed') }}</span>
          <span class="files">{{ c.status === 'done' ? c.files : '' }}</span>
        </label>
      </section>
    </div>

    <div class="foot">
      <span>{{ $t('diskclean.selected', { count: dc.totals.value.count }) }}</span>
      <span>{{ $t('diskclean.selected_size', { size: formatBytes(dc.totals.value.bytes) }) }}</span>
      <label class="perm"><input type="checkbox" v-model="dc.permanent.value" /> {{ $t('diskclean.permanent') }}</label>
      <button class="btn primary" :disabled="!dc.canClean.value" @click="openConfirm">{{ $t('diskclean.clean') }}</button>
    </div>

    <div v-if="showSettings" class="mask" @click.self="showSettings = false">
      <div class="dlg">
        <div class="dlg-title">{{ $t('diskclean.settings') }}</div>
        <div class="sect">
          <div class="label">{{ $t('diskclean.settings_exclusions') }}</div>
          <div v-for="(d, i) in draft.exclusionDirs" :key="'e' + i" class="rowline">
            <input v-model="draft.exclusionDirs[i]" />
            <button class="btn" @click="draft.exclusionDirs.splice(i, 1)">×</button>
          </div>
          <button class="btn" @click="pick(draft.exclusionDirs)">＋ {{ $t('diskclean.settings_add_dir') }}</button>
        </div>
        <div class="sect">
          <div class="label">{{ $t('diskclean.settings_patterns') }}</div>
          <textarea v-model="draft.patternsText" rows="4" />
        </div>
        <div class="sect">
          <div class="label">{{ $t('diskclean.settings_custom') }}</div>
          <div v-for="(d, i) in draft.customDirs" :key="'c' + i" class="rowline">
            <input v-model="draft.customDirs[i]" />
            <button class="btn" @click="draft.customDirs.splice(i, 1)">×</button>
          </div>
          <button class="btn" @click="pick(draft.customDirs)">＋ {{ $t('diskclean.settings_add_dir') }}</button>
        </div>
        <div class="dlg-actions">
          <button class="btn" @click="showSettings = false">{{ $t('diskclean.close') }}</button>
          <button class="btn primary" @click="saveSettings">{{ $t('diskclean.save') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showConfirm" class="mask" @click.self="showConfirm = false">
      <div class="dlg">
        <div class="dlg-title">{{ $t('diskclean.confirm_title') }}</div>
        <div class="body">
          {{ $t('diskclean.confirm_body', { count: dc.totals.value.count, size: formatBytes(dc.totals.value.bytes), mode: dc.permanent.value ? $t('diskclean.mode.permanent') : $t('diskclean.mode.recycle') }) }}
        </div>
        <div v-if="selectedCats.some((c) => c.needsAdmin)" class="warnbox">{{ $t('diskclean.admin_hint') }}</div>
        <div v-if="dc.permanent.value" class="warnbox">{{ $t('diskclean.permanent_warn') }}</div>
        <div v-if="riskyCats.length" class="sect">
          <div class="label">{{ $t('diskclean.confirm_risky') }}</div>
          <label v-for="c in riskyCats" :key="c.id" class="checkline">
            <input type="checkbox" :checked="dc.confirmed.value.has(c.id)" @change="dc.toggleConfirm(c.id)" />
            {{ $t('diskclean.confirm_risky_item', { name: catName(c) }) }}
          </label>
        </div>
        <div class="dlg-actions">
          <button class="btn" @click="showConfirm = false">{{ $t('diskclean.cancel') }}</button>
          <button class="btn primary" :disabled="dc.blockedRisky().length > 0" @click="runClean">{{ $t('diskclean.clean') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showResult" class="mask" @click.self="showResult = false">
      <div class="dlg">
        <div class="dlg-title">{{ $t('diskclean.result_title') }}</div>
        <div v-if="dc.result.value?.status === 'cancelled'" class="body">{{ $t('diskclean.cancelled') }}</div>
        <template v-else-if="dc.result.value">
          <div class="body">
            {{ $t('diskclean.result_summary', {
              size: formatBytes(dc.result.value.bytes || 0),
              removed: dc.result.value.removed || 0,
              skipped: dc.result.value.skipped || 0,
              failed: (dc.result.value.failed || []).length,
            }) }}
          </div>
          <div v-if="dc.result.value.mode === 'recycle'" class="hint">{{ $t('diskclean.result_recycle') }}</div>
          <div v-if="dc.result.value.error" class="err">{{ dc.result.value.error }}</div>
          <div v-if="(dc.result.value.failed || []).length" class="sect">
            <div class="label">{{ $t('diskclean.result_failed') }}</div>
            <div v-for="(f, i) in dc.result.value.failed" :key="i" class="failline">
              <span class="reason">{{ $t('diskclean.result_reason.' + (f.reason || 'other')) }}</span>
              <span class="path">{{ f.path }}</span>
            </div>
          </div>
        </template>
        <div class="dlg-actions">
          <button class="btn primary" @click="showResult = false">{{ $t('diskclean.close') }}</button>
        </div>
      </div>
    </div>

    <div class="hist" v-if="dc.history.value.length">
      <div class="label">{{ $t('diskclean.history') }}</div>
      <div v-for="(h, i) in dc.history.value.slice(-20).reverse()" :key="i" class="histline">
        {{ h.ts }} · {{ formatBytes(h.bytes || 0) }} · {{ h.removed || 0 }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.dc { height: 100%; overflow: auto; padding: 16px 18px; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.head .ttl { font-size: 16px; font-weight: 700; color: var(--tx1); }
.head .desc { margin-top: 4px; font-size: 12px; color: var(--tx3); }
.ov { font-size: 12px; color: var(--tx2); }
.bar, .foot { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.foot { position: sticky; bottom: 0; background: var(--bg1); padding: 8px 0; border-top: 1px solid var(--bd2); }
.btn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.btn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.btn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.btn:disabled { opacity: .5; cursor: default; }
.progress { font-size: 12px; color: var(--tx3); }
.err { color: var(--err); font-size: 12px; }
.groups { display: flex; flex-direction: column; gap: 10px; max-width: 1000px; }
.group { border: 1px solid var(--bd2); border-radius: 6px; overflow: hidden; }
.ghead { padding: 6px 10px; background: var(--bg2); font-size: 12px; font-weight: 700; color: var(--tx2); }
.row { display: grid; grid-template-columns: 18px 1fr auto auto auto auto 90px 60px; gap: 8px; align-items: center; padding: 6px 10px; border-top: 1px solid var(--bd2); font-size: 12px; cursor: pointer; }
.row .name { color: var(--tx1); }
.badge { font-size: 11px; border: 1px solid var(--bd); border-radius: 3px; padding: 1px 6px; color: var(--tx3); }
.badge.safe { color: var(--ok); border-color: var(--ok); }
.badge.caution { color: var(--warn2); }
.badge.risky { color: var(--err); border-color: var(--err); }
.badge.admin { color: var(--ac2); }
.badge.warn { color: var(--warn2); }
.status { color: var(--tx3); }
.size { text-align: right; color: var(--tx2); font-variant-numeric: tabular-nums; }
.files { text-align: right; color: var(--tx3); font-variant-numeric: tabular-nums; }
.perm { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--tx2); }
.mask { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 50; }
.dlg { width: min(720px, 92vw); max-height: 86vh; overflow: auto; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.dlg-title { font-size: 15px; font-weight: 700; color: var(--tx1); }
.body { font-size: 13px; color: var(--tx1); }
.hint { font-size: 12px; color: var(--tx3); }
.warnbox { font-size: 12px; color: var(--warn2); border: 1px solid var(--warn2); border-radius: 4px; padding: 6px 8px; }
.sect { display: flex; flex-direction: column; gap: 6px; }
.label { font-size: 12px; color: var(--tx2); font-weight: 600; }
.rowline { display: flex; gap: 6px; }
.rowline input, textarea { flex: 1; background: var(--bg2); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 8px; font-size: 12px; }
.checkline { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--tx1); }
.dlg-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.failline { display: grid; grid-template-columns: 70px 1fr; gap: 8px; font-size: 12px; color: var(--tx3); }
.failline .path { font-family: ui-monospace, Consolas, monospace; word-break: break-all; }
.hist { display: flex; flex-direction: column; gap: 4px; max-width: 1000px; }
.histline { font-size: 12px; color: var(--tx3); }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 3: 前端测试**

Run: `npm.cmd test`
Expected: PASS（含既有 server + web 测试）

- [ ] **Step 4: 提交**

```bash
git add web/src/tools/disk-clean/DiskCleanTool.vue
git commit -m "feat(disk-clean): 系统清理页面"
```

---

## Task 13: 全量验证与手动验收

**Files:** 无新增

- [ ] **Step 1: 服务端测试**

Run: `npm.cmd run test:server`
Expected: PASS

- [ ] **Step 2: 前端测试**

Run: `npm.cmd run test:web`
Expected: PASS

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 4: 词条检查**

Run: `npm.cmd run check:i18n`
Expected: PASS

- [ ] **Step 5: 敏感信息扫描**

```powershell
git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat_|-----BEGIN [A-Z ]*PRIVATE KEY-----"
git grep -n -I -i -E "passwd|password|passphrase|secret|api[_-]?key|token"
git ls-files env
```

Expected: 第一条无输出；第二条仅测试/占位符命中（人工确认）；`git ls-files env` 为空

- [ ] **Step 6: 启动 dev 并手动验收**

```powershell
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev:server" -RedirectStandardOutput "logs\dev-server.log" -RedirectStandardError "logs\dev-server.err.log"
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev:web" -RedirectStandardOutput "logs\dev-web.log" -RedirectStandardError "logs\dev-web.err.log"
```

打开 `http://localhost:5173`，逐项验收：

1. 市场/欢迎页出现「系统清理」磁贴，点击进入工具页签，无左侧树。
2. 点「分析」→ 分类逐类出大小/文件数，进度可见；结果与资源管理器大致一致。
3. 只勾 safe 类 → 点「清理」→ 确认弹窗 → 清理结果释放空间与系统盘可用空间差值为正。
4. 勾「Windows 临时文件」→ 弹 UAC → 取消 → 结果显示「已取消」；再点确认 → 完成后成功。
5. 打开「永久删除」→ 清理小文件 → 回收站中无该文件。
6. 设置里加排除目录/通配 → 保存自动重新分析 → 对应项不计入。
7. 设置里加自定义目录（试盘符根 `C:\`）→ 被拒绝；加普通目录 → 出现在「自定义目录」组且默认不勾。
8. 刷新页面/重启后端 → 历史记录仍在。
9. 非 Windows 分支（本地无法直接测）：单测已覆盖 501。

- [ ] **Step 7: 提交验证记录（可选）**

```bash
git add docs/superpowers/specs/2026-11-16-disk-clean-tool-design.md docs/superpowers/plans/2026-11-16-disk-clean-phase1.md
git commit -m "docs(disk-clean): 设计与第 1 期实施计划"
```

---

## 备注（执行时注意）

- PowerShell 5.1 读无 BOM 的 UTF-8 `.ps1` 会按 ANSI 解码；`helper.ps1` 仓库文件可无 BOM（纯 ASCII），运行时拷贝去掉已有 BOM 后统一补 BOM，测试已断言。
- `helper.ps1` 里 `@($script:failed)` 转数组，避免单条失败时 `ConvertTo-Json` 输出对象而非数组。
- 所有路径来自环境变量 / `os.homedir()` / 用户输入，不要写死盘符或用户名（`steam` 的 `Program Files` 属安装目录探测，符合规格）。
- 非 Windows 下 `catalog.js` 仍可导入，但接口层直接 501；单测用 `platform` 注入。
- 清理时按同一规则重新枚举，`result.bytes` 是实际删除累计，可能与扫描预计值不同。
