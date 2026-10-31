import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXTENSIONS, prefFile, loadPref, savePref, available, parseDefaults, getState, runAssoc } from '../file-assoc.js';

const ALL = ['.pdf', '.txt', '.md', '.markdown', '.csv', '.yaml', '.yml', '.js', '.mjs', '.cjs', '.json', '.http', '.rest', '.curl'];
const DEFAULT_SEL = ALL.filter((e) => e !== '.txt');   // 默认勾选：除 .txt 外全部

function tmpApp({ withBat = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-assoc-'));
  if (withBat) fs.writeFileSync(path.join(dir, 'start.bat'), '@echo off\n', 'utf8');
  fs.mkdirSync(path.join(dir, 'script'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'script', 'launch.ps1'), '# void launcher\n', 'utf8');
  return dir;
}

test('EXTENSIONS：pdf/txt 在最前，共 14 个', () => {
  assert.deepEqual(EXTENSIONS, ALL);
});

test('prefFile 落在传入目录根部（端口数据目录，非包内 data/）', () => {
  assert.equal(prefFile(path.join('C:', 'p', '22222')), path.join('C:', 'p', '22222', 'file-assoc.json'));
});

test('loadPref：端口目录缺省时从包内 data/ 迁移旧偏好（selected 缺省=txt 不选）', () => {
  const app = tmpApp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-port-'));
  fs.mkdirSync(path.join(app, 'data'), { recursive: true });
  fs.writeFileSync(path.join(app, 'data', 'file-assoc.json'), JSON.stringify({ enabled: true, prompted: true }), 'utf8');
  assert.deepEqual(loadPref(dir, { appDir: app }), { enabled: true, prompted: true, selected: DEFAULT_SEL });
  assert.equal(fs.existsSync(prefFile(dir)), true, '迁移后写入端口数据目录');
});

test('旧偏好（无 rev）自动补 .csv；rev=2 后尊重用户勾选', () => {
  const dir = tmpApp();
  fs.writeFileSync(prefFile(dir), JSON.stringify({ enabled: true, prompted: true, selected: ['.md'] }), 'utf8');
  assert.deepEqual(loadPref(dir).selected, ['.md', '.csv']);
  assert.equal(JSON.parse(fs.readFileSync(prefFile(dir), 'utf8')).rev, 2);
  savePref(dir, { enabled: true, prompted: true, selected: ['.md'] });
  assert.deepEqual(loadPref(dir).selected, ['.md']);
});

test('loadPref：端口目录已有偏好时不读旧路径', () => {
  const app = tmpApp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-port-'));
  fs.mkdirSync(path.join(app, 'data'), { recursive: true });
  fs.writeFileSync(path.join(app, 'data', 'file-assoc.json'), JSON.stringify({ enabled: true, prompted: true }), 'utf8');
  savePref(dir, { enabled: false, prompted: true, selected: ['.txt'] });
  assert.deepEqual(loadPref(dir, { appDir: app }), { enabled: false, prompted: true, selected: ['.txt'] });
});

test('loadPref 缺省返回未启用未提示、selected 默认（txt 不选）', () => {
  const dir = tmpApp();
  assert.deepEqual(loadPref(dir), { enabled: false, prompted: false, selected: DEFAULT_SEL });
});

test('savePref / loadPref 往返（含 selected）', () => {
  const dir = tmpApp();
  savePref(dir, { enabled: true, prompted: true, selected: ['.pdf', '.md'] });
  assert.deepEqual(loadPref(dir), { enabled: true, prompted: true, selected: ['.pdf', '.md'] });
  assert.equal(fs.existsSync(prefFile(dir)), true);
});

test('selected 归一化：去未知、去重、保序；显式空数组保留为空', () => {
  const dir = tmpApp();
  savePref(dir, { enabled: true, prompted: true, selected: ['.md', '.nope', '.md', '.txt'] });
  assert.deepEqual(loadPref(dir).selected, ['.md', '.txt']);
  savePref(dir, { enabled: true, prompted: true, selected: [] });
  assert.deepEqual(loadPref(dir).selected, []);
  savePref(dir, { enabled: true, prompted: true });
  assert.deepEqual(loadPref(dir).selected, DEFAULT_SEL, '未传 selected 视为默认（txt 不选）');
});

test('available：仅 win32 且绿色包（start.bat 存在）可用', () => {
  const plain = tmpApp();
  assert.equal(available({ appDir: plain, platform: 'win32', envPort: '' }).ok, false);
  const win = tmpApp({ withBat: true });
  assert.equal(available({ appDir: win, platform: 'win32', envPort: '' }).ok, true);
  assert.equal(available({ appDir: win, platform: 'darwin', envPort: '' }).ok, false);
  assert.equal(available({ appDir: win, platform: 'win32', envPort: '33333' }).ok, false);
});

test('parseDefaults：只认 true，坏输入回退空对象', () => {
  assert.deepEqual(parseDefaults(JSON.stringify({ '.md': true, '.yaml': false })), { '.md': true, '.yaml': false });
  assert.deepEqual(parseDefaults('not json'), {});
  assert.deepEqual(parseDefaults(''), {});
});

test('getState：不可用时扩展名全 false 且不跑 PS', async () => {
  const dir = tmpApp();
  let called = false;
  const st = await getState({ appDir: dir, platform: 'win32', envPort: '', runPs: async () => { called = true; return '{}'; } });
  assert.equal(st.available, false);
  assert.equal(called, false);
  assert.equal(st.extensions.length, EXTENSIONS.length);
  assert.equal(st.extensions.every((x) => x.isDefault === false), true);
});

test('getState：可用时按 PS 输出标记 isDefault', async () => {
  const dir = tmpApp({ withBat: true });
  const st = await getState({ appDir: dir, platform: 'win32', envPort: '', runPs: async () => JSON.stringify({ '.md': true }) });
  assert.equal(st.available, true);
  assert.equal(st.extensions.find((x) => x.ext === '.md').isDefault, true);
  assert.equal(st.extensions.find((x) => x.ext === '.yaml').isDefault, false);
});

test('runAssoc：调 launch.ps1 -Assoc <action> 且分离进程', () => {
  const calls = [];
  const fakeSpawn = (bin, args, opts) => { calls.push({ bin, args, opts }); return { unref() { calls.push({ unref: true }); } }; };
  runAssoc(path.join('C:', 'app'), 'apply', { spawnFn: fakeSpawn, platform: 'win32' });
  assert.equal(calls[0].bin, 'powershell.exe');
  assert.deepEqual(calls[0].args.slice(0, 4), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File']);
  assert.equal(calls[0].args[4], path.join('C:', 'app', 'script', 'launch.ps1'));
  assert.deepEqual(calls[0].args.slice(-2), ['-Assoc', 'apply']);
  assert.equal(calls[0].opts.detached, true);
  assert.deepEqual(calls[1], { unref: true });
});
