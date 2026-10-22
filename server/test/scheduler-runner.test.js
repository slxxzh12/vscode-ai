import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { buildSpawnSpec, createRunner, resolveCwd } from '../scheduler/runner.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-run-')); }

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => child.emit('close', null);
  return child;
}

test('resolveCwd 优先级：task.cwd > 项目根 > fallback', () => {
  assert.equal(resolveCwd({ cwd: 'C:/a' }, 'C:/proj', 'C:/fb'), 'C:/a');
  assert.equal(resolveCwd({ cwd: null }, 'C:/proj', 'C:/fb'), 'C:/proj');
  assert.equal(resolveCwd({ cwd: null }, null, 'C:/fb'), 'C:/fb');
});

test('buildSpawnSpec：shell / ai / script', () => {
  const shell = buildSpawnSpec({ type: 'shell', command: 'echo hi' }, { cwd: 'C:/p' });
  if (process.platform === 'win32') {
    assert.equal(shell.bin, 'powershell.exe');
    assert.deepEqual(shell.args, ['-NoProfile', '-NonInteractive', '-Command', 'echo hi']);
  } else {
    assert.deepEqual(shell.args, ['-c', 'echo hi']);
  }
  assert.equal(shell.cwd, 'C:/p');

  const ai = buildSpawnSpec({ type: 'ai' }, { cwd: 'C:/p', aiBin: 'myopencode', aiPrompt: 'do it' });
  assert.equal(ai.bin, 'myopencode');
  assert.deepEqual(ai.args, ['run', 'do it']);

  const aiFm = buildSpawnSpec({ type: 'ai' }, { cwd: 'C:/p', aiBin: 'myopencode', aiPrompt: '---\ndescription: x\n---\nHello' });
  assert.deepEqual(aiFm.args, ['run', 'Hello']);

  const aiCmd = buildSpawnSpec({ type: 'ai', ai: { source: 'command', commandName: 'review.md' } }, { cwd: 'C:/p', aiBin: 'myopencode' });
  assert.deepEqual(aiCmd.args, ['run', '--command', 'review']);

  const aiFile = buildSpawnSpec({ type: 'ai', filePath: 'C:/x/run.md', ai: { source: 'file', prompt: 'go' } }, { cwd: 'C:/p', aiBin: 'myopencode' });
  assert.deepEqual(aiFile.args, ['run', 'go', '--file', 'C:/x/run.md']);
  const aiFileNoMsg = buildSpawnSpec({ type: 'ai', filePath: 'C:/x/run.md', ai: { source: 'file' } }, { cwd: 'C:/p', aiBin: 'myopencode' });
  assert.deepEqual(aiFileNoMsg.args, ['run', '--file', 'C:/x/run.md']);

  const aiEnv = buildSpawnSpec({ type: 'ai', ai: { source: 'prompt', prompt: 'x' } }, { cwd: 'C:/p', opencodeDataDir: 'C:/oc-data' });
  assert.deepEqual(aiEnv.env, { OPENCODE_SKIP_SAFE_CHECK: '1', XDG_DATA_HOME: 'C:/oc-data' });
  const aiNoData = buildSpawnSpec({ type: 'ai', ai: { source: 'prompt', prompt: 'x' } }, { cwd: 'C:/p' });
  assert.deepEqual(aiNoData.env, { OPENCODE_SKIP_SAFE_CHECK: '1' });

  const ps = buildSpawnSpec({ type: 'script', script: { path: 'x/y.ps1' } }, { cwd: 'C:/p' });
  assert.deepEqual(ps.args.slice(0, 4), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File']);
  assert.ok(ps.args[4].endsWith(path.join('x', 'y.ps1')));

  const py = buildSpawnSpec({ type: 'script', script: { path: 'x/y.py' } }, { cwd: 'C:/p' });
  assert.equal(py.bin, 'python');
  assert.ok(py.args[0].endsWith(path.join('x', 'y.py')));
});

test('buildSpawnSpec：不支持的脚本扩展名抛错', () => {
  assert.throws(() => buildSpawnSpec({ type: 'script', script: { path: 'a.txt' } }, { cwd: '.' }), /unsupported script type/);
});

test('run 把 stdout/stderr 写入日志并返回退出码', async () => {
  const dir = tmpDir();
  const child = fakeChild();
  let captured = null;
  const runner = createRunner({ spawnFn: (bin, args, opts) => { captured = { bin, args, opts }; return child; }, killChild: () => {} });
  const logPath = path.join(dir, 'r1.log');
  const p = runner.run({ runId: 'r1', spec: { bin: 'echo', args: ['hi'], cwd: dir }, logPath, timeoutMs: 0 });
  child.stdout.emit('data', 'out-');
  child.stderr.emit('data', 'err');
  child.emit('close', 0);
  const res = await p;
  assert.equal(res.exitCode, 0);
  assert.equal(res.timedOut, false);
  assert.equal(fs.readFileSync(logPath, 'utf8'), 'out-err');
  assert.equal(captured.bin, 'echo');
});

test('run：Windows 上 .cmd 走 cmd.exe /d /s /c 包装（CVE-2024-27980）', { skip: process.platform !== 'win32' }, async () => {
  const dir = tmpDir();
  const child = fakeChild();
  let captured = null;
  const runner = createRunner({ spawnFn: (bin, args) => { captured = { bin, args }; return child; }, killChild: () => {} });
  const p = runner.run({ runId: 'r4', spec: { bin: 'C:/tools/nga.cmd', args: ['run', 'x'], cwd: dir }, logPath: path.join(dir, 'r4.log'), timeoutMs: 0 });
  child.emit('close', 0);
  await p;
  assert.equal(captured.bin, process.env.ComSpec || 'cmd.exe');
  assert.deepEqual(captured.args, ['/d', '/s', '/c', 'C:/tools/nga.cmd', 'run', 'x']);
});

test('run 超时 kill 子进程并标记 timedOut', async () => {
  const dir = tmpDir();
  const child = fakeChild();
  let killed = false;
  const runner = createRunner({ spawnFn: () => child, killChild: () => { killed = true; } });
  const p = runner.run({ runId: 'r2', spec: { bin: 'sleep', args: [], cwd: dir }, logPath: path.join(dir, 'r2.log'), timeoutMs: 20 });
  const res = await p;
  assert.equal(res.timedOut, true);
  assert.equal(killed, true);
});

test('stop 终止运行中的子进程', () => {
  const dir = tmpDir();
  const child = fakeChild();
  let killed = 0;
  const runner = createRunner({ spawnFn: () => child, killChild: () => { killed++; child.emit('close', null); } });
  runner.run({ runId: 'r3', spec: { bin: 'x', args: [], cwd: dir }, logPath: path.join(dir, 'r3.log'), timeoutMs: 0 });
  assert.equal(runner.isRunning('r3'), true);
  assert.equal(runner.stop('r3'), true);
  assert.equal(killed, 1);
});

test('buildSpawnSpec：传入 runContextPath 时注入 DEVFLOW_RUN_CONTEXT', () => {
  const ctx = 'C:/data/scheduler/tasks/t/r/run.json';
  const shell = buildSpawnSpec({ type: 'shell', command: 'echo' }, { cwd: 'C:/p', runContextPath: ctx });
  assert.equal(shell.env.DEVFLOW_RUN_CONTEXT, ctx);

  const script = buildSpawnSpec({ type: 'script', script: { path: 'x.ps1' } }, { cwd: 'C:/p', runContextPath: ctx });
  assert.equal(script.env.DEVFLOW_RUN_CONTEXT, ctx);

  const ai = buildSpawnSpec({ type: 'ai', ai: { source: 'prompt', prompt: 'x' } }, { cwd: 'C:/p', runContextPath: ctx });
  assert.equal(ai.env.DEVFLOW_RUN_CONTEXT, ctx);
  assert.equal(ai.env.OPENCODE_SKIP_SAFE_CHECK, '1');
});

test('buildSpawnSpec：脚本任务按命令行追加 run.json 与 report.md 路径', () => {
  const ctx = 'C:/data/scheduler/tasks/t/r/run.json';
  const report = 'C:/data/scheduler/tasks/t/r/report.md';
  const ps = buildSpawnSpec({ type: 'script', script: { path: 'x.ps1' } }, { cwd: 'C:/p', runContextPath: ctx, reportPath: report });
  assert.deepEqual(ps.args.slice(-2), [ctx, report]);

  const py = buildSpawnSpec({ type: 'script', script: { path: 'x.py' } }, { cwd: 'C:/p', runContextPath: ctx, reportPath: report });
  assert.deepEqual(py.args.slice(1), [ctx, report]);

  const cmd = buildSpawnSpec({ type: 'script', script: { path: 'x.bat' } }, { cwd: 'C:/p', runContextPath: ctx, reportPath: report });
  assert.deepEqual(cmd.args.slice(2), [ctx, report]);
});

test('buildSpawnSpec：非脚本任务不追加位置参数', () => {
  const ctx = 'C:/data/scheduler/tasks/t/r/run.json';
  const report = 'C:/data/scheduler/tasks/t/r/report.md';
  const shell = buildSpawnSpec({ type: 'shell', command: 'echo' }, { cwd: 'C:/p', runContextPath: ctx, reportPath: report });
  assert.ok(!shell.args.includes(report));
  const ai = buildSpawnSpec({ type: 'ai', ai: { source: 'prompt', prompt: 'x' } }, { cwd: 'C:/p', runContextPath: ctx, reportPath: report });
  assert.ok(!ai.args.includes(report));
});

test('buildSpawnSpec：EXE 任务直接运行程序并追加进度文件与报告目录', () => {
  const progress = 'C:/data/scheduler/tasks/t/r/result.json';
  const dir = 'C:/data/scheduler/tasks/t/r/report';
  const spec = buildSpawnSpec(
    { type: 'script', script: { path: 'C:/tools/scan.exe', exe: true } },
    { cwd: 'C:/p', runContextPath: 'C:/ctx.json', reportPath: 'C:/report.md', reportDir: dir, progressPath: progress },
  );
  assert.equal(spec.bin, 'C:/tools/scan.exe');
  assert.deepEqual(spec.args, [progress, dir]);
});
