import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadJson, loadProjects, loadWorkflows, ensureDefaults } from '../config.js';

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

test('loadWorkflows 校验 advance 取值', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'w.json');
  fs.writeFileSync(file, JSON.stringify([{ id: 'w', name: 'W', steps: [{ id: 's', cmd: 'ls', advance: 'weird' }] }]));
  assert.throws(() => loadWorkflows(file), /advance/);
});

test('ensureDefaults 生成示例文件', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'projects.json');
  const w = path.join(dir, 'workflows.json');
  ensureDefaults(p, w);
  assert.ok(fs.existsSync(p) && fs.existsSync(w));
  assert.equal(loadProjects(p)[0].root, process.cwd());
});

test('loadJson 文件不存在返回 null', () => {
  assert.equal(loadJson('D:\\no-such-file-xyz.json'), null);
});
