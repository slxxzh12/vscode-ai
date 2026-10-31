import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadJson, loadProjects, ensureDefaults } from '../config.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfcfg-')); }

test('loadProjects 校验结构', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'projects.json');
  fs.writeFileSync(file, JSON.stringify({ projects: [{ id: 'a', name: 'A', root: 'C:\\x' }] }));
  assert.deepEqual(loadProjects(file), [{ id: 'a', name: 'A', root: 'C:\\x' }]);
});

test('loadProjects 缺字段抛错', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'p.json');
  fs.writeFileSync(file, JSON.stringify({ projects: [{ name: 'no-id' }] }));
  assert.throws(() => loadProjects(file), /id/);
});

test('ensureDefaults 生成示例项目文件', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'projects.json');
  ensureDefaults(p);
  assert.ok(fs.existsSync(p));
  assert.deepEqual(loadProjects(p), []);
});

test('loadJson 文件不存在返回 null', () => {
  assert.equal(loadJson('D:\\no-such-file-xyz.json'), null);
});
