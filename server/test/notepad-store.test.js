import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNotepadStore, MAX_FILE_BYTES } from '../notepad-store.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-notepad-')); }
function make() { return createNotepadStore({ dir: tmpDir() }); }

test('write/read/createFile/list', () => {
  const s = make();
  const { id } = s.createFile('', 'a.txt');
  assert.equal(id, 'a.txt');
  s.write('a.txt', 'hello\nworld');
  assert.equal(s.read('a.txt').content, 'hello\nworld');
  const { items } = s.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'a.txt');
  assert.ok(s.list().folders.length === 0);
});

test('createFile 已存在抛 exists；read 不存在抛 not-found', () => {
  const s = make();
  s.createFile('', 'a.txt');
  assert.throws(() => s.createFile('', 'a.txt'), (e) => e.code === 'exists');
  assert.throws(() => s.read('nope.txt'), (e) => e.code === 'not-found');
});

test('文件夹：createFolder/listFolders/renameFolder/removeFolder', () => {
  const s = make();
  s.createFolder('x/y');
  assert.deepEqual(s.listFolders().sort(), ['x', 'x/y']);
  assert.equal(s.renameFolder('x/y', 'z'), 'x/z');
  assert.ok(s.listFolders().includes('x/z'));
  assert.equal(s.removeFolder('x'), true);
  assert.deepEqual(s.listFolders(), []);
});

test('renameItem/moveItem/removeItem', () => {
  const s = make();
  s.createFolder('d');
  s.createFile('', 'a.txt');
  s.write('a.txt', '1');
  assert.equal(s.renameItem('a.txt', 'b.txt'), 'b.txt');
  assert.equal(s.moveItem('b.txt', 'd'), true);
  assert.equal(s.read('d/b.txt').content, '1');
  assert.equal(s.removeItem('d/b.txt'), true);
  assert.deepEqual(s.list().items, []);
});

test('路径穿越与非法规段被拒', () => {
  const s = make();
  for (const bad of ['../x.txt', 'a/../../x.txt', 'C:/x.txt', 'a b.txt', 'a//b.txt']) {
    assert.throws(() => s.write(bad, 'x'), (e) => e.code === 'bad-path' || e.code === 'bad-id', bad);
  }
  // 前导斜杠被安全地当作相对路径处理
  s.write('/abs.txt', 'x');
  assert.ok(fs.existsSync(path.join(s.dir, 'abs.txt')));
});

test('超过大小上限抛 too-large', () => {
  const s = make();
  s.createFile('', 'big.txt');
  assert.throws(() => s.write('big.txt', 'x'.repeat(MAX_FILE_BYTES + 1)), (e) => e.code === 'too-large');
});
