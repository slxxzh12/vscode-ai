import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCmdBin, wrapCmdBin } from '../win-spawn.js';

test('isCmdBin：识别 .cmd/.bat（大小写不敏感）', () => {
  assert.equal(isCmdBin('nga.cmd'), true);
  assert.equal(isCmdBin('C:\\tools\\nga.CMD'), true);
  assert.equal(isCmdBin('start.BAT'), true);
  assert.equal(isCmdBin('opencode.exe'), false);
  assert.equal(isCmdBin('opencode'), false);
  assert.equal(isCmdBin(''), false);
});

test('wrapCmdBin：win32 上 .cmd/.bat 用 cmd.exe /d /s /c 包装', () => {
  assert.deepEqual(wrapCmdBin('C:\\tools\\nga.cmd', ['stats', '--days', '7'], { platform: 'win32', comspec: 'cmd.exe' }), {
    bin: 'cmd.exe',
    args: ['/d', '/s', '/c', 'C:\\tools\\nga.cmd', 'stats', '--days', '7'],
  });
});

test('wrapCmdBin：非 win32 或非 .cmd/.bat 原样返回', () => {
  assert.deepEqual(wrapCmdBin('nga.cmd', ['x'], { platform: 'linux' }), { bin: 'nga.cmd', args: ['x'] });
  assert.deepEqual(wrapCmdBin('opencode.exe', ['stats'], { platform: 'win32' }), { bin: 'opencode.exe', args: ['stats'] });
  assert.deepEqual(wrapCmdBin('opencode', ['stats'], { platform: 'win32' }), { bin: 'opencode', args: ['stats'] });
});

test('wrapCmdBin：可注入 ComSpec，args 缺省为空数组', () => {
  assert.equal(wrapCmdBin('a.bat', [], { platform: 'win32', comspec: 'C:\\Windows\\System32\\cmd.exe' }).bin, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(wrapCmdBin('a.bat', undefined, { platform: 'win32' }).args, ['/d', '/s', '/c', 'a.bat']);
});
