import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revealInOs, makeFocus } from '../reveal.js';

function fakeSpawn(record) {
  return (file, args, opts) => {
    record.push({ file, args, opts });
    return { unref() { record.push({ file: 'unref' }); } };
  };
}

test('revealInOs: win 文件用 /select 定位，目录直接打开', () => {
  const rec = [];
  assert.equal(revealInOs('C:\\a\\b.txt', false, { platform: 'win32', spawn: fakeSpawn(rec), focus: () => {} }), true);
  assert.equal(rec[0].file, 'explorer');
  assert.deepEqual(rec[0].args, ['/select,C:\\a\\b.txt']);
  assert.equal(rec[0].opts.detached, true);

  const rec2 = [];
  assert.equal(revealInOs('C:\\a\\dir', true, { platform: 'win32', spawn: fakeSpawn(rec2), focus: () => {} }), true);
  assert.deepEqual(rec2[0].args, ['C:\\a\\dir']);
});

test('revealInOs: darwin 文件 -R、目录 open', () => {
  const rec = [];
  assert.equal(revealInOs('/u/a.txt', false, { platform: 'darwin', spawn: fakeSpawn(rec) }), true);
  assert.equal(rec[0].file, 'open');
  assert.deepEqual(rec[0].args, ['-R', '/u/a.txt']);

  const rec2 = [];
  assert.equal(revealInOs('/u/dir', true, { platform: 'darwin', spawn: fakeSpawn(rec2) }), true);
  assert.deepEqual(rec2[0].args, ['/u/dir']);
});

test('revealInOs: linux 文件开父目录、目录直接开', () => {
  const rec = [];
  assert.equal(revealInOs('/u/sub/a.txt', false, { platform: 'linux', spawn: fakeSpawn(rec) }), true);
  assert.equal(rec[0].file, 'xdg-open');
  assert.deepEqual(rec[0].args, ['/u/sub']);

  const rec2 = [];
  assert.equal(revealInOs('/u/sub', true, { platform: 'linux', spawn: fakeSpawn(rec2) }), true);
  assert.deepEqual(rec2[0].args, ['/u/sub']);
});

test('revealInOs: 未知平台返回 false 且不 spawn', () => {
  let called = false;
  assert.equal(revealInOs('/u/a', false, { platform: 'sunos', spawn: () => { called = true; return { unref() {} }; } }), false);
  assert.equal(called, false);
});

test('makeFocus 到点后拉起 powershell 尝试置顶', async () => {
  const rec = [];
  makeFocus(fakeSpawn(rec), 0)();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(rec[0].file, 'powershell.exe');
  assert.ok(rec[0].args.includes('-WindowStyle'));
  assert.equal(rec[0].opts.windowsHide, true);
});
