import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { pickFile, pickAnyFile, pickFolder, askPortConflict } from '../native-dialog.js';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

function spawnOnce(child, rec = []) {
  return (file, args, opts) => { rec.push({ file, args, opts }); return child; };
}

test('pickFile: 非 win 返回 unsupported 且不 spawn', async () => {
  let called = false;
  const r = await pickFile({ platform: 'linux', spawnFn: () => { called = true; } });
  assert.deepEqual(r, { error: 'unsupported' });
  assert.equal(called, false);
});

test('pickFile: spawn 抛异常 → spawn-failed', async () => {
  const r = await pickFile({ platform: 'win32', spawnFn: () => { throw new Error('boom'); } });
  assert.deepEqual(r, { error: 'spawn-failed' });
});

test('pickFile: 选中文件返回 path', async () => {
  const child = fakeChild();
  const rec = [];
  const p = pickFile({ platform: 'win32', spawnFn: spawnOnce(child, rec) });
  child.stdout.emit('data', Buffer.from('C:\\a\\b.txt'));
  child.emit('close');
  assert.deepEqual(await p, { path: 'C:\\a\\b.txt' });
  assert.equal(rec[0].file, 'powershell.exe');
  assert.equal(rec[0].opts.windowsHide, true);
});

test('pickAnyFile: 无输出视为取消', async () => {
  const child = fakeChild();
  const p = pickAnyFile({ platform: 'win32', spawnFn: spawnOnce(child) });
  child.emit('close');
  assert.deepEqual(await p, { cancelled: true });
});

test('pickFolder: stderr 非空返回 dialog-failed（截断 500）', async () => {
  const child = fakeChild();
  const p = pickFolder({ platform: 'win32', spawnFn: spawnOnce(child) });
  child.stderr.emit('data', Buffer.from('x'.repeat(600)));
  child.emit('close');
  const r = await p;
  assert.equal(r.error, 'dialog-failed');
  assert.equal(r.message.length, 500);
});

test('pickFile: child error 事件 → spawn-failed', async () => {
  const child = fakeChild();
  const p = pickFile({ platform: 'win32', spawnFn: spawnOnce(child) });
  child.emit('error', new Error('ENOENT'));
  assert.deepEqual(await p, { error: 'spawn-failed' });
});

test('pickFile: 超时 kill 并返回 cancelled', async () => {
  const child = fakeChild();
  const p = pickFile({ platform: 'win32', spawnFn: spawnOnce(child), timeoutMs: 10 });
  assert.deepEqual(await p, { cancelled: true });
  assert.equal(child.killed, true);
});

test('askPortConflict: 非 win → unsupported', async () => {
  const r = await askPortConflict({ platform: 'darwin', spawnFn: () => { throw new Error('x'); } });
  assert.deepEqual(r, { error: 'unsupported' });
});

test('askPortConflict: kill 且环境变量带候选端口', async () => {
  const child = fakeChild();
  const rec = [];
  const p = askPortConflict({ platform: 'win32', spawnFn: spawnOnce(child, rec), candidates: [22222, 33333] });
  child.stdout.emit('data', Buffer.from('kill'));
  child.emit('close');
  assert.deepEqual(await p, { action: 'kill' });
  assert.equal(rec[0].opts.env.DF_PC_CANDIDATES, '["22222","33333"]');
});

test('askPortConflict: switch 合法端口', async () => {
  const child = fakeChild();
  const p = askPortConflict({ platform: 'win32', spawnFn: spawnOnce(child) });
  child.stdout.emit('data', Buffer.from('switch:1234'));
  child.emit('close');
  assert.deepEqual(await p, { action: 'switch', port: 1234 });
});

test('askPortConflict: switch 非法端口 → bad-port（0/越界/非数字）', async () => {
  for (const out of ['switch:0', 'switch:70000', 'switch:abc']) {
    const child = fakeChild();
    const p = askPortConflict({ platform: 'win32', spawnFn: spawnOnce(child) });
    child.stdout.emit('data', Buffer.from(out));
    child.emit('close');
    assert.deepEqual(await p, { error: 'bad-port' }, out);
  }
});

test('askPortConflict: 空输出 → cancel', async () => {
  const child = fakeChild();
  const p = askPortConflict({ platform: 'win32', spawnFn: spawnOnce(child) });
  child.emit('close');
  assert.deepEqual(await p, { action: 'cancel' });
});

test('askPortConflict: 超时 kill → cancel', async () => {
  const child = fakeChild();
  const p = askPortConflict({ platform: 'win32', spawnFn: spawnOnce(child), timeoutMs: 10 });
  assert.deepEqual(await p, { action: 'cancel' });
  assert.equal(child.killed, true);
});

test('askPortConflict: spawn 抛异常 / child error → spawn-failed', async () => {
  assert.deepEqual(await askPortConflict({ platform: 'win32', spawnFn: () => { throw new Error('x'); } }), { error: 'spawn-failed' });
  const child = fakeChild();
  const p = askPortConflict({ platform: 'win32', spawnFn: spawnOnce(child) });
  child.emit('error', new Error('ENOENT'));
  assert.deepEqual(await p, { error: 'spawn-failed' });
});
