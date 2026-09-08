import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePseudoPty, buildMarkerCmd, pickShell } from '../pty-runner.js';

test('makePseudoPty 归一化 node-pty 的 onData/onExit', () => {
  const rawCalls = [];
  const raw = {
    pid: 42,
    write: (s) => rawCalls.push(['write', s]),
    resize: (c, r) => rawCalls.push(['resize', c, r]),
    kill: () => rawCalls.push(['kill']),
    onData: (cb) => rawCalls.push(['onData', cb]),
    onExit: (cb) => rawCalls.push(['onExit', cb]),
  };
  const wrapped = makePseudoPty(raw, 'unix');
  const dataSeen = [];
  const exitSeen = [];
  wrapped.onData((d) => dataSeen.push(d));
  wrapped.onExit((c) => exitSeen.push(c));
  wrapped.write('hi');
  wrapped.resize(100, 30);
  wrapped.kill();
  const [, dcb] = rawCalls.find((c) => c[0] === 'onData');
  const [, ecb] = rawCalls.find((c) => c[0] === 'onExit');
  dcb('hello');
  ecb({ exitCode: 3 });
  assert.equal(wrapped.shell, 'unix');
  assert.deepEqual(dataSeen, ['hello']);
  assert.deepEqual(exitSeen, [3]);
  assert.deepEqual(rawCalls.filter((c) => c[0] !== 'onData' && c[0] !== 'onExit'),
    [['write', 'hi'], ['resize', 100, 30], ['kill']]);
});

test('makePseudoPty 重复 onData 注册即抛（强制唯一扇出）', () => {
  const raw = { pid: 1, onData() {}, onExit() {}, write() {}, resize() {}, kill() {} };
  const wrapped = makePseudoPty(raw, 'unix');
  wrapped.onData(() => {});
  assert.throws(() => wrapped.onData(() => {}), /already/i);
});

test('pickShell 按平台返回', () => {
  const s = pickShell();
  assert.equal(typeof s.file, 'string');
  assert.ok(Array.isArray(s.args));
});

test('buildMarkerCmd: unix 用 printf OSC', () => {
  const cmd = buildMarkerCmd('npm run build', 'run_ab_0', 1, 'unix');
  assert.ok(cmd.startsWith('npm run build; printf '));
  assert.ok(cmd.includes('\\x1b]777;dfdone;run_ab_0_1\\x07'));
});

test('buildMarkerCmd: win 用 [Console]::Write + [char]27（PS 不解析 \\u 转义）', () => {
  const cmd = buildMarkerCmd('dir', 'run_x_9', 0, 'win');
  assert.ok(cmd.includes('[Console]::Write'));
  assert.ok(cmd.includes('[char]27'));
  assert.ok(cmd.includes('dfdone;run_x_9_0'));
  assert.ok(!cmd.includes('\\u001b'));
});
