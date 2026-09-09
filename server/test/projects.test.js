import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Projects } from '../projects.js';

function makeProjects(roots) {
  return new Projects({ projects: roots.map((r, i) => ({ id: 'p' + i, name: 'P' + i, root: r })) });
}
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dftree-')); }

test('listProjects 返回概要', () => {
  const dir = tmpDir();
  const p = makeProjects([dir]);
  assert.equal(p.listProjects()[0].id, 'p0');
});

test('tree 列出顶层并分类排序（目录优先）', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'b.txt'), '');
  fs.mkdirSync(path.join(dir, 'a-dir'));
  const p = makeProjects([dir]);
  const items = p.tree('p0', '');
  assert.deepEqual(items, [{ name: 'a-dir', type: 'dir' }, { name: 'b.txt', type: 'file' }]);
});

test('tree 支持相对子目录', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'x.js'), '');
  const p = makeProjects([dir]);
  assert.deepEqual(p.tree('p0', 'src'), [{ name: 'x.js', type: 'file' }]);
});

test('未知项目抛 code=not-found', () => {
  const dir = tmpDir();
  const p = makeProjects([dir]);
  assert.throws(() => p.tree('nope', ''), (e) => e.code === 'not-found');
});

test('目录不存在抛 code=not-found', () => {
  const dir = tmpDir();
  const p = makeProjects([dir]);
  assert.throws(() => p.tree('p0', 'missing'), (e) => e.code === 'not-found');
});

test('越界路径 403（.. 逃逸）', () => {
  const dir = tmpDir();
  const p = makeProjects([dir]);
  assert.throws(() => p.tree('p0', '..'), (e) => e.code === 'forbidden');
});

test('绝对路径攻击 403', () => {
  const dir = tmpDir();
  const p = makeProjects([dir]);
  const outside = path.join(os.tmpdir(), 'other');
  assert.throws(() => p.tree('p0', outside), (e) => e.code === 'forbidden');
});

test('符号链接逃逸 403（junction）', (t) => {
  const dir = tmpDir();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dfout-'));
  try {
    fs.symlinkSync(outside, path.join(dir, 'escape'), 'junction');
  } catch {
    t.skip('无 junction 权限');
    return;
  }
  const p = makeProjects([dir]);
  assert.throws(() => p.tree('p0', 'escape'), (e) => e.code === 'forbidden');
});

test('revealTarget �������ڵ��ļ���Ŀ¼', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  fs.mkdirSync(path.join(dir, 'sub'));
  const p = makeProjects([dir]);
  const f = p.revealTarget('p0', 'a.txt');
  assert.equal(f.isDir, false);
  assert.equal(f.name, 'a.txt');
  const d = p.revealTarget('p0', 'sub');
  assert.equal(d.isDir, true);
});

test('revealTarget ������/Խ���״�', () => {
  const dir = tmpDir();
  const p = makeProjects([dir]);
  assert.throws(() => p.revealTarget('p0', 'ghost'), (e) => e.code === 'not-found');
  assert.throws(() => p.revealTarget('p0', '..%2F..'), (e) => e.code === 'forbidden' || e.code === 'not-found');
});
