import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createOpenCodeRunner } from '../collaboration/remote-runner.js';

function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.kill = () => {};
  return c;
}

test('execute：默认拼 opencode run <text> 并收集输出', async () => {
  let captured = null;
  const child = fakeChild();
  const runner = createOpenCodeRunner({ bin: 'opencode', spawnFn: (bin, args) => { captured = { bin, args }; return child; } });
  const p = runner.execute({ text: 'hi' });
  child.stdout.emit('data', 'ok');
  child.emit('close', 0);
  const r = await p;
  assert.equal(captured.bin, 'opencode');
  assert.deepEqual(captured.args, ['run', 'hi']);
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, 'ok');
});

test('execute：Windows 上 .cmd 走 cmd.exe /d /s /c 包装（CVE-2024-27980）', { skip: process.platform !== 'win32' }, async () => {
  let captured = null;
  const child = fakeChild();
  const runner = createOpenCodeRunner({ bin: 'C:/tools/nga.cmd', spawnFn: (bin, args) => { captured = { bin, args }; return child; } });
  const p = runner.execute({ text: 'hi' });
  child.emit('close', 0);
  await p;
  assert.equal(captured.bin, process.env.ComSpec || 'cmd.exe');
  assert.deepEqual(captured.args, ['/d', '/s', '/c', 'C:/tools/nga.cmd', 'run', 'hi']);
});
