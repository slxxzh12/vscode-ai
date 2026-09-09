import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOpenCodeRunner } from '../collaboration/remote-runner.js';

function shimPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-shim-'));
  const p = path.join(dir, 'shim.cjs');
  fs.writeFileSync(p, `
const args = process.argv.slice(2);
if (args[0] === 'echo') { process.stdout.write(args[1] || ''); process.exit(0); }
if (args[0] === 'fail') { process.stderr.write('boom'); process.exit(3); }
if (args[0] === 'slow') { setTimeout(() => process.exit(0), 5000); }
`, 'utf8');
  return p;
}

test('正常执行返回 stdout/exitCode', async () => {
  const shim = shimPath();
  const runner = createOpenCodeRunner({ bin: process.execPath, timeoutMs: 5000 });
  const r = await runner.execute({ args: [shim, 'echo', 'hello world'], cwd: os.tmpdir() });
  assert.equal(r.stdout, 'hello world');
  assert.equal(r.exitCode, 0);
});

test('stderr 与退出码透传', async () => {
  const shim = shimPath();
  const runner = createOpenCodeRunner({ bin: process.execPath, timeoutMs: 5000 });
  const r = await runner.execute({ args: [shim, 'fail'], cwd: os.tmpdir() });
  assert.equal(r.exitCode, 3);
  assert.equal(r.stderr, 'boom');
});

test('超时 kill 返回 timedOut', async () => {
  const shim = shimPath();
  const runner = createOpenCodeRunner({ bin: process.execPath, timeoutMs: 200 });
  const r = await runner.execute({ args: [shim, 'slow'], cwd: os.tmpdir() });
  assert.equal(r.timedOut, true);
});

test('输出截断', async () => {
  const shim = shimPath();
  const runner = createOpenCodeRunner({ bin: process.execPath, maxBytes: 8, timeoutMs: 5000 });
  const r = await runner.execute({ args: [shim, 'echo', '1234567890abcdef'], cwd: os.tmpdir() });
  assert.ok(r.stdout.length <= 8 + 14, '超出截断加省略标记');
  assert.ok(r.stdout.endsWith('...[truncated]'));
});

test('默认前缀=opencode run：bin 可注入', async () => {
  const shim = shimPath();
  // 模拟 opencode：bin=node，prefix=[shim,'echo']，execute({text}) → node shim echo <text>
  const runner = createOpenCodeRunner({ bin: process.execPath, opencodePrefix: [shim, 'echo'], timeoutMs: 5000 });
  const r = await runner.execute({ text: '远程文本', cwd: os.tmpdir() });
  assert.equal(r.stdout, '远程文本');
});
