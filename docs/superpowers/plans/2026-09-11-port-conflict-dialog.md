# 端口占用弹窗（不自动换端口）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 端口被占用时不再自动回退，而是弹 Windows 原生对话框，让用户选择「结束占用进程并同端口重启」或「更换端口（候选 + 自定义输入）」，取消则退出。

**Architecture:** 新增纯函数模块 `server/port-conflict.js`（解析 netstat / taskkill / 端口探测，可注入 exec 便于单测）；在 `server/native-dialog.js` 增加基于 PowerShell + WinForms 的 `askPortConflict()`；`server/index.js` 把原来的 `CANDIDATE_PORTS` 自动回退替换为「EADDRINUSE → 弹窗 → 分支处理」。文案全部走 i18n。

**Tech Stack:** Node ESM、`node:test`、`node:child_process`（netstat/taskkill）、`node:net`、PowerShell WinForms、项目 i18n（`shared/i18n`）。

**Spec:** `docs/superpowers/specs/2026-09-11-port-conflict-dialog-design.md`

---

## 文件结构

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `server/port-conflict.js` | 端口占用探测/杀死：`parseListeningPids` / `findPidsOnPort` / `killPids` / `isPortFree` | Create |
| `server/test/port-conflict.test.js` | 上述纯函数的单测 | Create |
| `shared/i18n/zh-CN.js` | 中文词条 | Modify：追加 `port.in_use.*` |
| `shared/i18n/en.js` | 英文词条 | Modify：追加 `port.in_use.*` |
| `server/test/i18n.test.js` | i18n 对称断言 | Modify：追加 `port.in_use.*` 断言 |
| `server/native-dialog.js` | 原生对话框 | Modify：新增 `askPortConflict()` |
| `server/index.js` | 启动监听 | Modify：删自动回退，接入弹窗分支 |
| `scripts/build.js` | 绿色包使用说明 | Modify：端口措辞 |

---

## Task 1: `server/port-conflict.js`（TDD）

**Files:**
- Create: `server/port-conflict.js`
- Test: `server/test/port-conflict.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/port-conflict.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { parseListeningPids, findPidsOnPort, killPids, isPortFree } from '../port-conflict.js';

const NETSTAT = [
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:22222          0.0.0.0:0              LISTENING       4321',
  '  TCP    127.0.0.1:22222        0.0.0.0:0              LISTENING       4321',
  '  TCP    [::]:22222             [::]:0                 LISTENING       9876',
  '  TCP    127.0.0.1:22223        0.0.0.0:0              LISTENING       5555',
  '  TCP    127.0.0.1:22222        127.0.0.1:50000        ESTABLISHED     6666',
  '  UDP    0.0.0.0:22222          *:*                                    7777',
].join('\r\n');

test('parseListeningPids 只取目标端口的 LISTENING 去重', () => {
  assert.deepEqual(parseListeningPids(NETSTAT, 22222).sort((a, b) => a - b), [4321, 9876]);
});

test('parseListeningPids 其他端口不误伤', () => {
  assert.deepEqual(parseListeningPids(NETSTAT, 22223), [5555]);
});

test('findPidsOnPort 用注入的 exec 解析 netstat', async () => {
  const calls = [];
  const exec = (cmd, args, opts, cb) => { calls.push([cmd, ...args]); cb(null, NETSTAT); };
  const pids = await findPidsOnPort(22222, { exec });
  assert.deepEqual(pids.sort((a, b) => a - b), [4321, 9876]);
  assert.deepEqual(calls[0], ['netstat', '-ano', '-p', 'tcp']);
});

test('killPids 逐 PID 调 taskkill /F /T', async () => {
  const calls = [];
  const exec = (cmd, args, opts, cb) => { calls.push([cmd, ...args]); cb(null, ''); };
  const killed = await killPids([4321, 9876], { exec });
  assert.deepEqual(killed, [4321, 9876]);
  assert.deepEqual(calls, [
    ['taskkill', '/F', '/T', '/PID', '4321'],
    ['taskkill', '/F', '/T', '/PID', '9876'],
  ]);
});

test('isPortFree 已占用端口返回 false', async () => {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  assert.equal(await isPortFree('127.0.0.1', port), false);
  await new Promise((r) => srv.close(r));
});

test('isPortFree 空闲端口返回 true', async () => {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise((r) => srv.close(r));
  assert.equal(await isPortFree('127.0.0.1', port), true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/port-conflict.test.js"`
Expected: FAIL —— `Cannot find module '../port-conflict.js'`

- [ ] **Step 3: 写最小实现**

创建 `server/port-conflict.js`：

```js
import net from 'node:net';
import { execFile } from 'node:child_process';

// 从 netstat 文本解析指定端口处于 LISTENING 的 PID（IPv4 / IPv6）。
export function parseListeningPids(output, port) {
  const want = Number(port);
  const pids = new Set();
  for (const line of String(output || '').split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (!m) continue;
    if (Number(m[2]) !== want) continue;
    pids.add(Number(m[3]));
  }
  return [...pids];
}

function run(cmd, args, execFn) {
  return new Promise((resolve) => {
    execFn(cmd, args, { windowsHide: true }, (err, stdout) => resolve({ err, stdout: stdout || '' }));
  });
}

export async function findPidsOnPort(port, { exec = execFile } = {}) {
  const { err, stdout } = await run('netstat', ['-ano', '-p', 'tcp'], exec);
  if (err) return [];
  return parseListeningPids(stdout, port);
}

export async function killPids(pids, { exec = execFile } = {}) {
  const killed = [];
  for (const raw of pids || []) {
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const { err } = await run('taskkill', ['/F', '/T', '/PID', String(pid)], exec);
    if (!err) killed.push(pid);
  }
  return killed;
}

// 探测 host:port 是否可监听（EADDRINUSE / 其他绑定错误 / 超时 => false）。
export function isPortFree(host, port, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { srv.close(); } catch { /* ignore */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    srv.once('error', () => finish(false));
    srv.once('listening', () => finish(true));
    try { srv.listen(port, host); } catch { finish(false); }
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/port-conflict.test.js"`
Expected: PASS（6 tests）

- [ ] **Step 5: 提交**

```bash
git add server/port-conflict.js server/test/port-conflict.test.js
git commit -m "feat(server): 端口占用探测与结束占用进程工具"
```

---

## Task 2: i18n 词条 + 断言

**Files:**
- Modify: `shared/i18n/zh-CN.js`（末尾 `};` 之前）
- Modify: `shared/i18n/en.js`（末尾 `};` 之前）
- Modify: `server/test/i18n.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/i18n.test.js` 末尾追加：

```js
test('端口占用词条中英均存在', () => {
  const suffix = ['title', 'message', 'kill', 'switch', 'warn', 'killed', 'kill_failed', 'switched', 'exit', 'unsupported'];
  for (const loc of ['zh-CN', 'en']) {
    for (const s of suffix) {
      const key = `port.in_use.${s}`;
      assert.notEqual(translate(loc, key), key);
    }
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/i18n.test.js"`
Expected: FAIL —— `port.in_use.title` 未命中，回退为 key 本身

- [ ] **Step 3: 加词条**

在 `shared/i18n/zh-CN.js` 末尾（`'fp.retry': '点击重试',` 之后、`};` 之前）追加：

```js
  'port.in_use.title': '端口被占用',
  'port.in_use.message': '端口 {port} 已被占用。',
  'port.in_use.kill': '结束占用进程并重启（端口 {port}）',
  'port.in_use.switch': '更换端口',
  'port.in_use.warn': '更换端口后，之前该端口的历史数据可能无法自动找到（需在页面中选择数据档案）。',
  'port.in_use.killed': '已结束占用端口 {port} 的进程 {pids}，正在重启。',
  'port.in_use.kill_failed': '结束占用进程失败：{err}',
  'port.in_use.switched': '端口已改为 {port}（已写入配置）。',
  'port.in_use.exit': '端口 {port} 被占用且未处理，服务退出。',
  'port.in_use.unsupported': '当前系统不支持弹窗，端口 {port} 被占用，服务退出。',
```

在 `shared/i18n/en.js` 末尾（`'fp.retry': 'Click to retry',` 之后、`};` 之前）追加：

```js
  'port.in_use.title': 'Port in use',
  'port.in_use.message': 'Port {port} is already in use.',
  'port.in_use.kill': 'Kill the occupying process and restart (port {port})',
  'port.in_use.switch': 'Use another port',
  'port.in_use.warn': 'After changing the port, previous data for that port may not be found automatically (you may need to select a data profile in the UI).',
  'port.in_use.killed': 'Killed process(es) {pids} on port {port}, restarting.',
  'port.in_use.kill_failed': 'Failed to kill the occupying process: {err}',
  'port.in_use.switched': 'Port changed to {port} (written to config).',
  'port.in_use.exit': 'Port {port} is in use and was not resolved; exiting.',
  'port.in_use.unsupported': 'Native dialogs are unsupported on this OS; port {port} is in use; exiting.',
```

- [ ] **Step 4: 跑测试与 i18n 检查确认通过**

Run: `node --test "server/test/i18n.test.js"`
Expected: PASS

Run: `npm.cmd run check:i18n`
Expected: PASS（中英键集合对称）

- [ ] **Step 5: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js server/test/i18n.test.js
git commit -m "feat(i18n): 端口占用弹窗中英词条"
```

---

## Task 3: `server/native-dialog.js` 新增 `askPortConflict()`

**Files:**
- Modify: `server/native-dialog.js`（文件末尾）

- [ ] **Step 1: 追加实现**

在 `server/native-dialog.js` 末尾追加：

```js
// 端口占用对话框：三选一（结束进程重启 / 换端口 / 取消）。
// 返回 { action:'kill' } | { action:'switch', port:n } | { action:'cancel' } | { error }
// 文案经环境变量传给 PowerShell，避免中英文引号/换行在 -Command 中转义出错。
export function askPortConflict({
  port,
  candidates = [],
  title = '',
  message = '',
  killLabel = '',
  switchLabel = '',
  warnLabel = '',
  okLabel = 'OK',
  cancelLabel = 'Cancel',
  timeoutMs = 120000,
} = {}) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve({ error: 'unsupported' }); return; }
    const env = {
      ...process.env,
      DF_PC_TITLE: String(title),
      DF_PC_MESSAGE: String(message),
      DF_PC_KILL: String(killLabel),
      DF_PC_SWITCH: String(switchLabel),
      DF_PC_WARN: String(warnLabel),
      DF_PC_OK: String(okLabel),
      DF_PC_CANCEL: String(cancelLabel),
      DF_PC_CANDIDATES: JSON.stringify((candidates || []).map(String)),
    };
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$f = New-Object System.Windows.Forms.Form',
      '$f.Text = $env:DF_PC_TITLE',
      '$f.TopMost = $true',
      '$f.StartPosition = "CenterScreen"',
      '$f.FormBorderStyle = "FixedDialog"',
      '$f.MaximizeBox = $false; $f.MinimizeBox = $false',
      '$f.Width = 520; $f.Height = 262',
      '$msg = New-Object System.Windows.Forms.Label',
      '$msg.Text = $env:DF_PC_MESSAGE; $msg.SetBounds(16,12,480,22)',
      '$kill = New-Object System.Windows.Forms.RadioButton',
      '$kill.Text = $env:DF_PC_KILL; $kill.SetBounds(16,44,480,24); $kill.Checked = $true',
      '$sw = New-Object System.Windows.Forms.RadioButton',
      '$sw.Text = $env:DF_PC_SWITCH; $sw.SetBounds(16,76,480,24)',
      '$cb = New-Object System.Windows.Forms.ComboBox',
      '$cb.DropDownStyle = "DropDown"; $cb.SetBounds(36,106,160,24)',
      '$cands = ConvertFrom-Json $env:DF_PC_CANDIDATES',
      'foreach ($c in $cands) { [void]$cb.Items.Add([string]$c) }',
      'if ($cb.Items.Count -gt 0) { $cb.Text = [string]$cb.Items[0] }',
      '$warn = New-Object System.Windows.Forms.Label',
      '$warn.Text = $env:DF_PC_WARN; $warn.SetBounds(16,138,480,46); $warn.ForeColor = "Firebrick"',
      '$ok = New-Object System.Windows.Forms.Button; $ok.Text = $env:DF_PC_OK; $ok.SetBounds(300,190,90,28); $ok.DialogResult = "OK"',
      '$cx = New-Object System.Windows.Forms.Button; $cx.Text = $env:DF_PC_CANCEL; $cx.SetBounds(400,190,90,28); $cx.DialogResult = "Cancel"',
      '$f.Controls.AddRange(@($msg,$kill,$sw,$cb,$warn,$ok,$cx))',
      '$f.AcceptButton = $ok; $f.CancelButton = $cx',
      '$r = $f.ShowDialog()',
      'if ($r -eq [System.Windows.Forms.DialogResult]::OK) { if ($kill.Checked) { [Console]::Out.Write("kill") } else { [Console]::Out.Write("switch:" + $cb.Text) } }',
      '$f.Dispose()',
    ].join('; ');
    let out = '';
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    let child;
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true, env });
    } catch { done({ error: 'spawn-failed' }); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } done({ action: 'cancel' }); }, timeoutMs);
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', () => { clearTimeout(timer); done({ error: 'spawn-failed' }); });
    child.on('close', () => {
      clearTimeout(timer);
      const p = out.trim();
      if (p === 'kill') return done({ action: 'kill' });
      if (p.startsWith('switch:')) {
        const n = Number(p.slice('switch:'.length));
        if (Number.isInteger(n) && n >= 1 && n <= 65535) return done({ action: 'switch', port: n });
        return done({ error: 'bad-port' });
      }
      done({ action: 'cancel' });
    });
  });
}
```

- [ ] **Step 2: 语法/导入检查**

Run: `node -e "import('./server/native-dialog.js').then(m => console.log(typeof m.askPortConflict))"`
Expected: 输出 `function`

- [ ] **Step 3: 提交**

```bash
git add server/native-dialog.js
git commit -m "feat(server): 端口占用原生对话框"
```

---

## Task 4: `server/index.js` 接入（删自动回退）

**Files:**
- Modify: `server/index.js:26`（import 区）
- Modify: `server/index.js:475-546`（端口启动块）

- [ ] **Step 1: 加 import**

在 `server/index.js` 顶部 `import { createWorkspaceHttp } from './workspace-http.js';` 之后追加：

```js
import { askPortConflict } from './native-dialog.js';
import { findPidsOnPort, killPids, isPortFree } from './port-conflict.js';
```

- [ ] **Step 2: 替换端口启动块**

把 `server/index.js` 从 `// 端口占用时自动回退：默认端口 → 33333 → 44444` 起、到 `startListening();`（含）为止的整段，替换为：

```js
// 端口被占用时弹窗询问（不自动换端口）
let currentPort = PORT;
let conflictAttempts = 0;
const MAX_CONFLICT_ATTEMPTS = 5;
const PORT_CANDIDATES = [33333, 44444];

function writeRuntimePort(port) {
  try { fs.writeFileSync(path.join(__dirname, '..', 'config', 'runtime-port.txt'), String(port), 'utf8'); } catch { /* ignore */ }
}

async function freeCandidatePorts() {
  const free = [];
  for (const p of PORT_CANDIDATES) {
    if (p === currentPort) continue;
    if (await isPortFree(HOST, p)) free.push(p);
  }
  return free;
}

async function handlePortConflict(port) {
  if (conflictAttempts++ >= MAX_CONFLICT_ATTEMPTS) {
    log.error(t('port.in_use.exit', { port }));
    process.exit(1);
  }
  if (process.platform !== 'win32') {
    log.error(t('port.in_use.unsupported', { port }));
    process.exit(1);
  }
  const candidates = await freeCandidatePorts();
  const r = await askPortConflict({
    port,
    candidates,
    title: t('port.in_use.title'),
    message: t('port.in_use.message', { port }),
    killLabel: t('port.in_use.kill', { port }),
    switchLabel: t('port.in_use.switch'),
    warnLabel: t('port.in_use.warn'),
    okLabel: t('common.ok'),
    cancelLabel: t('common.cancel'),
  });
  if (r && r.action === 'kill') {
    const pids = await findPidsOnPort(port);
    const killed = pids.length ? await killPids(pids) : [];
    if (killed.length) log.info(t('port.in_use.killed', { port, pids: killed.join(',') }));
    else log.warn(t('port.in_use.kill_failed', { err: `no process found on port ${port}` }));
    await new Promise((res) => setTimeout(res, 500));
    startListening(port);
    return;
  }
  if (r && r.action === 'switch' && Number.isInteger(r.port)) {
    currentPort = r.port;
    try { updateServerAttrs(configFile, { port: r.port }); log.info(t('port.in_use.switched', { port: r.port })); }
    catch (e) { log.warn('failed to persist port', e && e.message); }
    startListening(r.port);
    return;
  }
  log.error(t('port.in_use.exit', { port }));
  process.exit(1);
}

function startListening(port = currentPort) {
  const onError = (err) => {
    server.removeListener('listening', onListening);
    if (err && err.code === 'EADDRINUSE') {
      log.warn(`port ${port} in use, asking user`);
      handlePortConflict(port);
    } else { log.error('listen error', err); process.exit(1); }
  };
  const onListening = () => {
    server.removeListener('error', onError);
    const actual = server.address().port;
    actualPort = actual;
    currentPort = actual;
    writeRuntimePort(actual);
    log.info(`listening on http://${HOST}:${actual}  (ws: ws://${HOST}:${actual}/ws)`);

    if (NODE) {   // 逃生通道：沿用 nodes/<name> 机制，不进入端口档案系统
      const seedDir = instanceSeedDir(NODE);
      const identity = loadIdentity({ file: path.join(seedDir, 'identity.json'), host: HOST, port: actual });
      const stateRoot = instanceFpRoot(publicFingerprint(identity.publicKey));
      const paths = {
        id: `node-${NODE}`,
        dir: stateRoot,
        identityFile: path.join(seedDir, 'identity.json'),
        storeFile: path.join(stateRoot, 'collab.json'),
        uploadDir: path.join(stateRoot, 'upload'),
        downloadDir: path.join(stateRoot, 'download'),
        downloadsDir: path.join(stateRoot, 'downloads'),
        skillsRoot: process.env.DEVFLOW_COLLAB_SKILLS || path.join(stateRoot, 'skills-opencode'),
        projectsFile: path.join(dataHome(), 'projects.json'),
        workflowsFile: path.join(dataHome(), 'workflows.json'),
        schedulerDir: path.join(dataHome(), 'scheduler'),
        historyFile: path.join(stateRoot, 'message-history.jsonc'),
      };
      fs.mkdirSync(paths.uploadDir, { recursive: true });
      fs.mkdirSync(paths.downloadDir, { recursive: true });
      fs.mkdirSync(paths.downloadsDir, { recursive: true });
      fs.mkdirSync(paths.skillsRoot, { recursive: true });
      initWorkspace(paths, actual);
      return;
    }

    migrateLegacy(dataHome());      // 首次：复制旧数据为档案 22222
    const r = resolveProfile({ listenPort: actual });
    if (r.status === 'ready') {
      const prof = r.profile || createProfile(dataHome(), { id: String(actual), name: t('ws.default_profile_name', { port: actual }), port: actual });
      bindProfile(dataHome(), actual, prof.id);
      touchProfile(dataHome(), prof.id);
      initWorkspace(profilePaths(dataHome(), prof.id), actual);
    } else {
      const service = createWorkspaceService({
        root: dataHome(), listenPort: actual,
        onProfile: (paths) => initWorkspace(paths, actual),
        logger: log,
      });
      workspaceHttp = createWorkspaceHttp({ service });
      log.info(`workspace: ${r.profiles.length} profiles found, awaiting selection`);
    }
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, HOST);
}
startListening();
```

> 注意：`onListening` 主体与原代码一致（含 `writeRuntimePort(actual)`），只是把 `port` 参数化、去掉 `CANDIDATE_PORTS`/`listenAttempt` 自动回退。替换后确认没有残留 `CANDIDATE_PORTS` / `listenAttempt`。

- [ ] **Step 3: 确认无残留并做语法检查**

Run: `Select-String -Path "server\index.js" -Pattern "CANDIDATE_PORTS|listenAttempt"`
Expected: 无输出

Run: `node --check server/index.js`
Expected: 无输出（语法 OK）

- [ ] **Step 4: 跑服务端测试**

Run: `npm.cmd run test:server`
Expected: PASS（全绿）

- [ ] **Step 5: 提交**

```bash
git add server/index.js
git commit -m "feat(server): 端口被占用改为弹窗选择，不自动换端口"
```

---

## Task 5: 绿色包使用说明措辞

**Files:**
- Modify: `scripts/build.js:151`

- [ ] **Step 1: 改措辞**

把 `scripts/build.js` 中这一行：

```js
  "端口：默认 22222，被占用时自动切换 33333 / 44444",
```

改为：

```js
  "端口：默认 22222；被占用时弹窗询问：结束占用进程并重启 / 更换端口",
```

- [ ] **Step 2: 语法检查**

Run: `node --check scripts/build.js`
Expected: 无输出（语法 OK）

- [ ] **Step 3: 提交**

```bash
git add scripts/build.js
git commit -m "docs(build): 更新绿色包端口占用说明"
```

---

## Task 6: 全量验证

- [ ] **Step 1: 服务端测试**

Run: `npm.cmd run test:server`
Expected: PASS

- [ ] **Step 2: 前端类型与测试（未改前端，回归确认）**

Run: `npm.cmd run typecheck`
Expected: PASS

Run: `npm.cmd run test:web`
Expected: PASS

- [ ] **Step 3: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: PASS

- [ ] **Step 4: 人工验收（Windows）**

1. 先起一个实例占用 22222（或手动生成端口占用），再启动后端 → 应弹对话框「端口被占用」。
2. 选「结束占用进程并重启」→ 原进程被 `taskkill`，服务在 22222 起来（日志出现 `listening on http://127.0.0.1:22222`）。
3. 重启后端，选「更换端口」→ 下拉只有空闲候选（如 33333）；确定后日志出现 `端口已改为 33333`，`config/devflow.xml` 的 `<server port>` 变为 33333；再次启动沿用 33333。
4. 选「取消」→ 进程退出、端口不变。

---

## 明确不做

- 不做自动换端口。
- 不做控制台 readline 提示（统一原生弹窗）。
- 不改档案/项目存储结构。
- 不新增前端 UI。

## 自检记录（spec 覆盖）

- 不自动换端口 → Task 4。
- 弹窗三选一（kill / switch / cancel）→ Task 3 + Task 4。
- 换端口候选 + 自定义输入 → Task 3（ComboBox）+ Task 4（`freeCandidatePorts`）。
- 换端口警告历史数据 → Task 2（`port.in_use.warn`）+ Task 3（warn 标签）。
- 端口工具与单测 → Task 1。
- i18n 中英对称 → Task 2。
- 使用说明措辞 → Task 5。
