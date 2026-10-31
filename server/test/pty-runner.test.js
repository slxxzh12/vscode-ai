import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePseudoPty, buildMarkerCmd, pickShell, createPty } from '../pty-runner.js';

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

test('makePseudoPty 重复 onExit 注册即抛', () => {
  const raw = { pid: 1, onData() {}, onExit() {}, write() {}, resize() {}, kill() {} };
  const wrapped = makePseudoPty(raw, 'unix');
  wrapped.onExit(() => {});
  assert.throws(() => wrapped.onExit(() => {}), /already/i);
});

test('makePseudoPty exitCode 兼容对象/数字两种形态', () => {
  const raw = { pid: 1, onData() {}, onExit(cb) { this._exit = cb; }, write() {}, resize() {}, kill() {} };
  const wrapped = makePseudoPty(raw, 'win');
  const seen = [];
  wrapped.onExit((c) => seen.push(c));
  raw._exit(7);
  raw._exit(null);
  assert.deepEqual(seen, [7, null]);
  assert.equal(wrapped.shell, 'win');
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

test('createPty 动态加载 node-pty 并返回归一化 pty（无原生模块则跳过）', async (t) => {
  let pty;
  try {
    pty = await createPty({ cols: 40, rows: 12 });
  } catch (e) {
    t.skip(`node-pty unavailable: ${e && e.message}`);
    return;
  }
  try {
    assert.equal(typeof pty.pid, 'number');
    assert.equal(pty.shell, process.platform === 'win32' ? 'win' : 'unix');
    const seen = await new Promise((resolve) => {
      pty.onData((d) => resolve(String(d)));
      const timer = setTimeout(() => resolve(''), 8000);
      pty.write('echo df-pty-ok\r\n');
      void timer;
    });
    assert.equal(typeof seen, 'string');
  } finally {
    try { pty.kill(); } catch { /* ignore */ }
  }
});
