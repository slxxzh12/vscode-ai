import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

test('类别表：解析出的目标都在给定根内，且带 mode', async () => {
  const local = tmp('dfdc-local-');
  const root = tmp('dfdc-root-');
  fs.mkdirSync(path.join(local, 'Temp'), { recursive: true });
  fs.mkdirSync(path.join(local, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Temp'), { recursive: true });
  fs.mkdirSync(path.join(root, 'SoftwareDistribution', 'Download'), { recursive: true });
  process.env.LOCALAPPDATA = local;
  process.env.SystemRoot = root;
  process.env.SystemDrive = path.parse(root).root.replace(/[\\/]+$/, '');
  const { listCategories, resolveTargets } = await import('../disk-clean/catalog.js');
  const cats = listCategories();
  const ids = cats.map((c) => c.id);
  assert.ok(ids.includes('user-temp'));
  assert.ok(ids.includes('windows-temp'));
  const targets = resolveTargets('user-temp');
  assert.equal(targets.length, 1);
  assert.equal(path.resolve(targets[0].path), path.resolve(path.join(local, 'Temp')));
  assert.equal(targets[0].mode, 'contents');
  const win = resolveTargets('windows-temp');
  assert.equal(win[0].needsAdmin, true);
  const u = cats.find((c) => c.id === 'user-temp');
  assert.equal(u.risk, 'safe');
  assert.equal(u.defaultChecked, true);
  const up = cats.find((c) => c.id === 'update-cache');
  assert.equal(up.defaultChecked, false);
});

test('类别表：缺失的类目不出现在列表里', async () => {
  process.env.LOCALAPPDATA = tmp('dfdc-empty-');
  process.env.SystemRoot = tmp('dfdc-empty-win-');
  const { listCategories } = await import('../disk-clean/catalog.js');
  const ids = listCategories().map((c) => c.id);
  assert.equal(ids.includes('chrome'), false);
});

test('类别表：自定义目录作为 custom 类别，默认不勾选', async () => {
  const custom = tmp('dfdc-custom-');
  const { listCategories, resolveTargets } = await import('../disk-clean/catalog.js');
  const cats = listCategories({ customDirs: [custom] });
  const c = cats.find((x) => x.id === 'custom');
  assert.ok(c);
  assert.equal(c.group, 'custom');
  assert.equal(c.risk, 'risky');
  assert.equal(c.defaultChecked, false);
  const t = resolveTargets('custom', { customDirs: [custom] });
  assert.equal(t.length, 1);
  assert.equal(t[0].mode, 'contents');
});
