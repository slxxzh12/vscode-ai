# 文件关联「用 Void 打开并在界面展示」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Windows「打开方式」登记 Void；双击目标文件后启动/复用服务，浏览器深链 `?open=<绝对路径>` 并在 `FilePreview` 展示（项目外文件自动以内存临时项目打开）。

**Architecture:** 启动器负责注册表与深链；服务端新增 `POST /api/open-file` + `Projects.resolveAbsolute`（命中已有项目或建内存临时项目）；前端 `deeplink.ts` 解析 `?open` → 选中项目 → `openFile`。

**Tech Stack:** PowerShell 5.1（启动器/注册表）、Node ESM、Vue 3 + TS、Vitest / node:test。

**Spec:** `docs/superpowers/specs/2026-09-12-file-association-open-in-app-design.md`

**通用约定：**
- 命令在仓库根执行；npm 一律 `npm.cmd`，PowerShell 用 `;` 链接。
- 只 `git add` 本任务列出的文件，禁止 `git add -A`。
- 用户可见文案走 i18n（启动器弹窗按 language 出中/英在内联脚本里）。

---

## Task 1: 服务端 Projects —— addTempProject / resolveAbsolute

**Files:**
- Modify: `shared/index.d.ts`
- Modify: `server/projects.js`
- Test: `server/test/projects.test.js`

- [ ] **Step 1: 扩展 ProjectInfo 类型**

把 `shared/index.d.ts:18` 改为：

```ts
export interface ProjectInfo { id: string; name: string; root: string; temp?: boolean; }
```

- [ ] **Step 2: 写失败测试**

在 `server/test/projects.test.js` 末尾追加：

```js
test('resolveAbsolute 命中已有项目', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.md'), '# hi');
  const p = makeProjects([dir]);
  const r = p.resolveAbsolute(path.join(dir, 'a.md'));
  assert.equal(r.projectId, 'p0');
  assert.equal(r.rel, 'a.md');
  assert.equal(r.project.temp, false);
});

test('resolveAbsolute 项目外建临时项目并可复用', () => {
  const dir = tmpDir();
  const other = tmpDir();
  fs.writeFileSync(path.join(other, 'b.yaml'), 'x: 1');
  const p = makeProjects([dir]);
  const r1 = p.resolveAbsolute(path.join(other, 'b.yaml'));
  assert.equal(r1.rel, 'b.yaml');
  assert.equal(r1.project.temp, true);
  assert.ok(r1.projectId.startsWith('tmp:'));
  const r2 = p.resolveAbsolute(path.join(other, 'b.yaml'));
  assert.equal(r2.projectId, r1.projectId);
});

test('resolveAbsolute 不存在/目录抛错', () => {
  const dir = tmpDir();
  const p = makeProjects([dir]);
  assert.throws(() => p.resolveAbsolute(path.join(dir, 'ghost.md')), (e) => e.code === 'not-found');
  assert.throws(() => p.resolveAbsolute(dir), (e) => e.code === 'not-file');
});

test('addTempProject 不写 XML（projects 数组含 temp 标记）', () => {
  const dir = tmpDir();
  const p = makeProjects([dir]);
  const proj = p.addTempProject({ root: dir, name: 'D' });
  assert.equal(proj.temp, true);
  assert.equal(p.rawProjects().some((x) => x.id === proj.id), true);
});
```

- [ ] **Step 3: 运行确认失败**

Run: `node --test server/test/projects.test.js`
Expected: FAIL，`p.resolveAbsolute is not a function`。

- [ ] **Step 4: 实现**

在 `server/projects.js` 的 `addProject` 方法之后追加：

```js
  addTempProject({ root, name }) {
    const rootReal = this._realOrResolved(root);
    const id = 'tmp:' + crypto.createHash('sha1').update(rootReal).digest('hex').slice(0, 8);
    const exist = this._byId.get(id);
    if (exist) return exist;
    const proj = { id, name: name || path.basename(rootReal), root, temp: true };
    this.projects.push(proj);
    this._byId.set(id, proj);
    return proj;
  }
  // 绝对路径 → 命中已有项目则返回其 projectId/rel；否则以所在目录建内存临时项目
  resolveAbsolute(abs) {
    const target = path.resolve(abs);
    let st;
    try { st = fs.statSync(target); } catch { const e = new Error('file not found'); e.code = 'not-found'; throw e; }
    if (st.isDirectory()) { const e = new Error('is a directory'); e.code = 'not-file'; throw e; }
    const targetReal = this._realOrResolved(target);
    for (const p of this.projects) {
      const rootReal = this._realOrResolved(p.root);
      if (targetReal === rootReal || !targetReal.startsWith(rootReal + path.sep)) continue;
      const rel = path.relative(rootReal, targetReal).split(path.sep).join('/');
      return { projectId: p.id, rel, project: { id: p.id, name: p.name, root: path.resolve(p.root), temp: !!p.temp } };
    }
    const root = path.dirname(targetReal);
    const proj = this.addTempProject({ root, name: path.basename(root) });
    return { projectId: proj.id, rel: path.basename(targetReal), project: { id: proj.id, name: proj.name, root: path.resolve(root), temp: true } };
  }
```

并把 `listProjects()` 改为在 temp 时附带标记（避免破坏现有断言）：

```js
  listProjects() {
    return this.projects.map((p) => ({ id: p.id, name: p.name, root: path.resolve(p.root), ...(p.temp ? { temp: true } : {}) }));
  }
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test server/test/projects.test.js`
Expected: PASS（含原有用例）。

- [ ] **Step 6: Commit**

```bash
git add shared/index.d.ts server/projects.js server/test/projects.test.js
git commit -m "feat(server): 绝对路径解析与内存临时项目"
```

---

## Task 2: 服务端 `POST /api/open-file`

**Files:**
- Modify: `server/http-api.js`
- Test: `server/test/http-api.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/http-api.test.js` 末尾追加（沿用文件内已有 `post`/`start`/`tmpDir`）：

```js
test('/api/open-file 项目内文件返回 projectId/rel', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.md'), '# hi');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await post(server, '/api/open-file', { path: path.join(dir, 'a.md') });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.ok, true);
  assert.equal(j.project.id, 'a');
  assert.equal(j.rel, 'a.md');
});

test('/api/open-file 项目外建临时项目', async (t) => {
  const dir = tmpDir();
  const other = tmpDir();
  fs.writeFileSync(path.join(other, 'b.yaml'), 'x: 1');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await post(server, '/api/open-file', { path: path.join(other, 'b.yaml') });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.project.temp, true);
  assert.equal(j.rel, 'b.yaml');
});

test('/api/open-file 不存在返回 404', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await post(server, '/api/open-file', { path: path.join(dir, 'ghost.md') });
  assert.equal(r.status, 404);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/http-api.test.js`
Expected: FAIL，返回 404（路由未实现）。

- [ ] **Step 3: 实现路由**

在 `server/http-api.js` 的 `/api/projects` 分支之后（`/api/projects/pick` 之前）插入：

```js
      if (url.pathname === '/api/open-file' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const r = projects.resolveAbsolute(String(body.path || ''));
        sendJson(res, 200, { ok: true, project: r.project, rel: r.rel });
        return;
      }
```

（错误映射已存在于 catch：`not-found`→404、`not-file`→400。）

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/http-api.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/http-api.js server/test/http-api.test.js
git commit -m "feat(server): POST /api/open-file 路由"
```

---

## Task 3: 前端深链纯函数 `deeplink.ts`

**Files:**
- Create: `web/src/deeplink.ts`
- Test: `web/src/deeplink.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `web/src/deeplink.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseOpenParam } from './deeplink';

describe('parseOpenParam', () => {
  it('解析并解码 open 参数', () => {
    expect(parseOpenParam('?open=C%3A%5Ctmp%5Ca.md')).toBe('C:\\tmp\\a.md');
  });
  it('无 open 返回 null', () => {
    expect(parseOpenParam('')).toBeNull();
    expect(parseOpenParam('?x=1')).toBeNull();
  });
  it('允许省略问号', () => {
    expect(parseOpenParam('open=%2Fhome%2Fb.yaml')).toBe('/home/b.yaml');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- src/deeplink.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

新建 `web/src/deeplink.ts`：

```ts
// 解析 URL 上的 ?open=<绝对路径>（URLSearchParams 会自动解码一次）。
export function parseOpenParam(search: string): string | null {
  const s = search.startsWith('?') ? search.slice(1) : search;
  const v = new URLSearchParams(s).get('open');
  return v ? v : null;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- src/deeplink.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/deeplink.ts web/src/deeplink.test.ts
git commit -m "feat(web): 深链 ?open 解析纯函数"
```

---

## Task 4: 前端 `useProjects.openPath`

**Files:**
- Modify: `web/src/useProjects.ts`

- [ ] **Step 1: 实现**

在 `useProjects.ts` 的 `add` 方法之后插入：

```ts
    async openPath(path: string): Promise<{ project: ProjectInfo & { temp?: boolean }; rel: string }> {
      const res = await fetch('/api/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.message || j.error || msg; } catch { /* keep */ }
        throw new Error(msg);
      }
      return res.json();
    },
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add web/src/useProjects.ts
git commit -m "feat(web): useProjects.openPath"
```

---

## Task 5: i18n `open.failed`

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 中文词条**

在 `shared/i18n/zh-CN.js` 的 `'top.add_failed': '添加目录失败：{msg}',` 之后追加：

```js
  'open.failed': '打开文件失败：{msg}',
```

- [ ] **Step 2: 英文词条**

在 `shared/i18n/en.js` 的 `'top.add_failed': 'Failed to add folder: {msg}',` 之后追加：

```js
  'open.failed': 'Failed to open file: {msg}',
```

- [ ] **Step 3: 校验**

Run: `npm.cmd run check:i18n`
Expected: exit 0（无中文命中/键缺失）。

- [ ] **Step 4: Commit**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n: 打开文件失败提示"
```

---

## Task 6: 前端 App.vue 处理 `?open`

**Files:**
- Modify: `web/src/App.vue`

- [ ] **Step 1: 引入**

在 `App.vue` 顶部 import 区（`import { useWorkspace, type WorkspaceState } from './useWorkspace';` 附近）加入：

```ts
import { parseOpenParam } from './deeplink';
```

- [ ] **Step 2: 处理函数**

在 `function openFile(projectId: string, path: string) { ... }`（`App.vue:366`）之后插入：

```ts
async function processOpenParam() {
  const p = parseOpenParam(window.location.search);
  if (!p) return;
  try {
    const r = await projectsApi.openPath(p);
    await loadProjects();
    if (r.project?.id) selectProject(r.project.id);
    openFile(r.project.id, r.rel);
    const u = new URL(window.location.href);
    u.searchParams.delete('open');
    window.history.replaceState({}, '', u.pathname + u.search + u.hash);
  } catch (e) {
    alert(t('open.failed', { msg: (e as Error)?.message || String(e) }));
  }
}
```

- [ ] **Step 3: 挂载时调用**

在 `onMounted` 里 `loadProjects();` 之后插入：

```ts
  processOpenParam();
```

（若 `needSelect` 会提前 return 且 `WorkspacePicker` 选择后 `location.reload()`，`?open` 仍在 URL 上，重载后会再处理。）

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/App.vue
git commit -m "feat(web): 处理 ?open 深链并展示文件"
```

---

## Task 7: 启动器 —— 参数透传 + `-Open` + 首次弹窗注册「打开方式」

**Files:**
- Modify: `scripts/build.js`

- [ ] **Step 1: 替换 launch.ps1 生成块**

把 `scripts/build.js` 中 `const launchPs1 = [` … `].join("\r\n");` 整段替换为：

```js
const launchPs1 = [
  "param([switch]$NoBrowser, [switch]$NoShortcut, [string]$Open = '')",
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$scriptDir = $PSScriptRoot",
  "if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }",
  "$root = Split-Path -Parent $scriptDir",
  "$port = " + CFG_PORT,
  "$portFile = Join-Path $root 'config\\runtime-port.txt'",
  "if (Test-Path $portFile) { $t = (Get-Content -Raw $portFile).Trim(); if ($t -match '^\\d+$') { $port = [int]$t } }",
  "function Test-Port([int]$p) {",
  "  try {",
  "    $c = New-Object System.Net.Sockets.TcpClient",
  "    $iar = $c.BeginConnect('127.0.0.1', $p, $null, $null)",
  "    if (-not $iar.AsyncWaitHandle.WaitOne(300)) { $c.Close(); return $false }",
  "    $c.EndConnect($iar); $c.Close(); return $true",
  "  } catch { return $false }",
  "}",
  "if (-not (Test-Port $port)) {",
  "  Start-Process -FilePath (Join-Path $root 'runtime\\node.exe') -ArgumentList 'server\\index.js' -WorkingDirectory $root -WindowStyle Minimized",
  "  $deadline = (Get-Date).AddSeconds(15)",
  "  while ((Get-Date) -lt $deadline -and -not (Test-Port $port)) { Start-Sleep -Milliseconds 400 }",
  "}",
  "if (-not $NoBrowser) {",
  "  if ($Open) { Start-Process ('http://127.0.0.1:{0}/?open={1}' -f $port, [uri]::EscapeDataString($Open)) }",
  "  else { Start-Process ('http://127.0.0.1:{0}' -f $port) }",
  "}",
  "if (-not $NoShortcut) {",
  "  try {",
  "    $desktop = [Environment]::GetFolderPath('Desktop')",
  "    if ($desktop -and (Test-Path $desktop)) {",
  "      $ws = New-Object -ComObject WScript.Shell",
  "      $lnk = $ws.CreateShortcut((Join-Path $desktop ([char]0x9ED1 + [char]0x6D1E + '.lnk')))",
  "      $lnk.TargetPath = Join-Path $root 'start.bat'",
  "      $lnk.WorkingDirectory = $root",
  "      $lnk.IconLocation = (Join-Path $root 'icon.ico')",
  "      $lnk.Description = 'Void'",
  "      $lnk.Save()",
  "    }",
  "  } catch { }",
  "}",
  "# 首次运行：询问是否登记到「打开方式」（只问一次，不修改默认程序）",
  "$marker = Join-Path $env:APPDATA 'devflow\\assoc-prompted.txt'",
  "if (-not (Test-Path $marker)) {",
  "  $lang = 'zh-CN'",
  "  $cfg = Join-Path $env:USERPROFILE '.local\\share\\devflow\\downloads\\devflow.xml'",
  "  if (-not (Test-Path $cfg)) { $cfg = Join-Path $root 'config\\devflow.xml' }",
  "  if (Test-Path $cfg) { if ((Get-Content -Raw $cfg) -match 'language\\s*=\\s*\"en\"') { $lang = 'en' } }",
  "  if ($lang -eq 'en') { $msg = 'Register Void in the \"Open with\" menu for Markdown, YAML, JavaScript, JSON and cURL files? (The default app is not changed.)' }",
  "  else { $msg = '是否把 Void 登记到 .md/.markdown/.yaml/.js/.mjs/.json/.http 等文件的「打开方式」列表？（不会修改默认程序）' }",
  "  $yes = $false",
  "  try {",
  "    $wsh = New-Object -ComObject WScript.Shell",
  "    $r = $wsh.Popup($msg, 0, 'Void', 4 + 32 + 4096)",
  "    if ($r -eq 6) { $yes = $true }",
  "  } catch { }",
  "  if ($yes) {",
  "    try {",
  "      $cu = [Microsoft.Win32.Registry]::CurrentUser",
  "      $prog = $cu.CreateSubKey('Software\\Classes\\Void')",
  "      $prog.SetValue('', 'Void')",
  "      $cmd = $prog.CreateSubKey('shell\\open\\command')",
  "      $cmd.SetValue('', ('\"' + (Join-Path $root 'start.bat') + '\" \"%1\"'))",
  "      $cmd.Close()",
  "      $icon = $prog.CreateSubKey('DefaultIcon')",
  "      $icon.SetValue('', (Join-Path $root 'icon.ico'))",
  "      $icon.Close()",
  "      $prog.Close()",
  "      $exts = @('.md', '.markdown', '.yaml', '.yml', '.js', '.mjs', '.cjs', '.json', '.http', '.rest', '.curl')",
  "      foreach ($e in $exts) {",
  "        $k = $cu.CreateSubKey(\"Software\\Classes\\$($e)\\OpenWithProgids\")",
  "        $k.SetValue('Void', (New-Object byte[] 0), [Microsoft.Win32.RegistryValueKind]::None)",
  "        $k.Close()",
  "      }",
  "    } catch { }",
  "  }",
  "  try {",
  "    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $marker) | Out-Null",
  "    Set-Content -Path $marker -Value '1'",
  "  } catch { }",
  "}",
  "",
].join("\r\n");
```

- [ ] **Step 2: start.bat 透传参数**

把 `const bat = [` 块改为：

```js
const bat = [
  "@echo off",
  'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0script\\launch.ps1" %*',
  "",
].join("\r\n");
```

- [ ] **Step 3: 构建并检查生成物**

Run: `node scripts/build.js --no-zip`
Expected: 成功。

Run: `Select-String -Path dist-portable/vscode-ai/start.bat -Pattern '%\*'`
Expected: 命中 `%*`。

Run: `Select-String -Path dist-portable/vscode-ai/script/launch.ps1 -Pattern '\-Open|OpenWithProgids|\\?open='`
Expected: 命中 `[string]$Open`、`OpenWithProgids`、`?open=`。

- [ ] **Step 4: 语法快速校验（PowerShell 解析）**

Run:
```powershell
$null = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'dist-portable/vscode-ai/script/launch.ps1'), [ref]$null, [ref]$errs); if ($errs) { $errs } else { 'ps1 syntax ok' }
```
Expected: `ps1 syntax ok`（`$errs` 定义：`$errs = $null` 先声明）。

完整命令：
```powershell
$errs = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'dist-portable/vscode-ai/script/launch.ps1').Path, [ref]$null, [ref]$errs); if ($errs) { $errs | ForEach-Object { $_.Message } } else { 'ps1 syntax ok' }
```
Expected: `ps1 syntax ok`。

- [ ] **Step 5: Commit**

```bash
git add scripts/build.js
git commit -m "feat(build): 绿色包支持 -Open 深链与首次登记「打开方式」"
```

---

## Task 8: 全量验证与人工验收

**Files:** 无（验证）

- [ ] **Step 1: 测试 / 类型 / i18n / 构建**

Run: `npm.cmd test`
Expected: server + web 全部 PASS。

Run: `npm.cmd run typecheck`
Expected: PASS。

Run: `npm.cmd run check:i18n`
Expected: exit 0。

Run: `npm.cmd run build:web`
Expected: 成功。

- [ ] **Step 2: 人工验收（可选）**

1. `node scripts/build.js` 打包，进入 `dist-portable/vscode-ai`，删除 `%APPDATA%\devflow\assoc-prompted.txt` 后双击 `start.bat` → 弹窗选“是”。
2. 右键任一 `.md` →「打开方式」列表出现 `Void`（不改变默认）。
3. 双击项目内 `.md` → 浏览器打开并在 `FilePreview` 展示。
4. 双击项目外目录的 `.yaml` → 自动以临时项目打开并展示，`devflow.xml` 未被修改。

- [ ] **Step 3: Commit（如验收中有微调）**

```bash
git add <按实际改动文件>
git commit -m "fix: 文件关联验收修正"
```

---

## Self-Review 记录

- **Spec 覆盖：** 启动器参数/深链/弹窗/注册表（Task 7）、`resolveAbsolute`+临时项目（Task 1）、路由（Task 2）、深链解析（Task 3）、前端集成（Task 4/6）、i18n（Task 5）、验收（Task 8）。Spec §4-9 均有任务。
- **占位符：** 无 TBD；每步含完整代码/命令。
- **类型一致性：** `ProjectInfo.temp?`（Task 1）在 `openPath` 返回与 `App.vue` 使用一致；`parseOpenParam`（Task 3）在 Task 6 使用；`resolveAbsolute` 返回 `{projectId, rel, project}` 与路由 `{project, rel}` 一致。
- **注意点：** `listProjects()` 只在 temp 时附带 `temp`，保持既有 `deepEqual` 断言不破；`PowerShell` 注册表写入用 `[Microsoft.Win32.Registry]::CurrentUser`（用户级、免管理员）；弹窗在打开浏览器之后，不阻塞。
