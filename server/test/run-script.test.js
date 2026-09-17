import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript, RUNNABLE_EXT } from '../run-script.js';

function fakeSpawn(record) {
  return (file, args, opts) => {
    record.push({ file, args, opts });
    return { unref() { record.push({ unref: true }); } };
  };
}

test('RUNNABLE_EXT 覆盖 bat/cmd/ps1/sh', () => {
  assert.deepEqual([...RUNNABLE_EXT].sort(), ['bat', 'cmd', 'ps1', 'sh']);
});

test('runScript: 非 win 仅 sh 可运行，其余返回 false', () => {
  const rec = [];
  assert.equal(runScript('/x/a.sh', 'sh', { platform: 'linux', spawn: fakeSpawn(rec) }), true);
  assert.equal(rec[0].file, 'bash');
  assert.deepEqual(rec[0].args, ['/x/a.sh']);
  assert.equal(rec[1].unref, true);
  assert.equal(runScript('/x/a.bat', 'bat', { platform: 'linux', spawn: fakeSpawn([]) }), false);
  assert.equal(runScript('/x/a.ps1', 'ps1', { platform: 'darwin', spawn: fakeSpawn([]) }), false);
});

test('runScript: win 下 bat/cmd 走 Start-Process，ps1 走独立策略，sh/未知返回 false', () => {
  const rec = [];
  const sp = fakeSpawn(rec);
  assert.equal(runScript('C:\\x\\a.bat', 'bat', { platform: 'win32', spawn: sp }), true);
  assert.equal(runScript('C:\\x\\b.cmd', 'cmd', { platform: 'win32', spawn: sp }), true);
  assert.equal(runScript('C:\\x\\c.ps1', 'ps1', { platform: 'win32', spawn: sp }), true);
  assert.equal(runScript('C:\\x\\d.sh', 'sh', { platform: 'win32', spawn: sp }), false);
  assert.equal(runScript('C:\\x\\e.txt', 'txt', { platform: 'win32', spawn: sp }), false);
  const ps = rec.filter((r) => r.file === 'powershell.exe');
  assert.equal(ps.length, 3);
  assert.ok(ps[0].args[2].includes('Start-Process -FilePath'));
  assert.ok(ps[2].args[2].includes('-ExecutionPolicy'));
  assert.ok(ps[2].args[2].includes('-File'));
});
