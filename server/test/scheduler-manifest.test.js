import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MANIFEST_NAME, toRel, toAbs, manifestDirOf, toManifest, fromManifest,
  writeManifest, removeManifest, scanManifests,
} from '../scheduler/manifest.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-manifest-')); }

test('toRel/toAbs 在目录内往返', () => {
  const base = tmpDir();
  const abs = path.join(base, 'scripts', 'build.ps1');
  assert.equal(toRel(abs, base), 'scripts/build.ps1');
  assert.equal(toAbs('scripts/build.ps1', base), abs);
});

test('toRel 对相对路径统一为正斜杠；toAbs 对绝对路径原样返回', () => {
  assert.equal(toRel('a\\b\\c.ps1', '/x'), 'a/b/c.ps1');
  const abs = path.join(tmpDir(), 'f.txt');
  assert.equal(toAbs(abs, '/other'), abs);
});

test('manifestDirOf：有 cwd 用 cwd，无 cwd 落到 manifestRoot/<id>', () => {
  const root = tmpDir();
  const cwd = tmpDir();
  assert.equal(manifestDirOf({ id: 't1', cwd }, root), path.resolve(cwd));
  assert.equal(manifestDirOf({ id: 't1', cwd: null }, root), path.join(root, 't1'));
});

test('toManifest/fromManifest 往返（script + runtime）', () => {
  const dir = tmpDir();
  const task = {
    id: 't1', name: 'build', enabled: false, type: 'script', cwd: dir,
    script: { path: path.join(dir, 'scripts', 'build.ps1') },
    schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } },
  };
  const m = toManifest(task, dir, { nextRunAt: 123, lastRun: { startedAt: 1, status: 'success', exitCode: 0, durationMs: 5 } });
  assert.equal(m.format, 'void_manifest');
  assert.equal(m.version, 1);
  assert.equal(m.script.path, 'scripts/build.ps1');
  assert.equal(m.runtime.nextRunAt, 123);
  assert.equal(m.runtime.lastRun.status, 'success');
  assert.equal('id' in m, false);
  assert.equal('cwd' in m, false);

  const back = fromManifest(m, dir);
  assert.equal(back.cwd, dir);
  assert.equal(back.script.path, path.join(dir, 'scripts', 'build.ps1'));
  assert.equal(back.enabled, false);
});

test('toManifest ai file 源转相对、fromManifest 转回绝对', () => {
  const dir = tmpDir();
  const task = {
    id: 't2', name: 'a', enabled: true, type: 'ai', cwd: dir,
    ai: { source: 'file', prompt: 'go' }, filePath: path.join(dir, 'commands', 'x.md'),
    schedule: { mode: 'daily', daily: { at: '09:00', weekdays: [] } },
  };
  const m = toManifest(task, dir);
  assert.equal(m.filePath, 'commands/x.md');
  const back = fromManifest(m, dir);
  assert.equal(back.filePath, path.join(dir, 'commands', 'x.md'));
  assert.deepEqual(back.ai, { source: 'file', prompt: 'go' });
});

test('fromManifest 校验 format/version', () => {
  const dir = tmpDir();
  assert.throws(() => fromManifest({ format: 'x', version: 1 }, dir), (e) => e.code === 'bad-format');
  assert.throws(() => fromManifest({ format: 'void_manifest', version: 99 }, dir), (e) => e.code === 'bad-version');
  assert.throws(() => fromManifest(null, dir), (e) => e.code === 'bad-manifest');
});

test('scanManifests 递归查找并跳过忽略目录', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(root, 'a', 'b', MANIFEST_NAME), '{}');
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg', MANIFEST_NAME), '{}');
  const found = scanManifests(root);
  assert.equal(found.length, 1);
  assert.equal(found[0], path.join(root, 'a', 'b', MANIFEST_NAME));
});

test('writeManifest / removeManifest', () => {
  const dir = tmpDir();
  const task = {
    id: 't3', name: 'n', enabled: true, type: 'shell', command: 'echo', cwd: dir,
    schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } },
  };
  writeManifest(dir, task, { nextRunAt: 9, lastRun: null });
  const file = path.join(dir, MANIFEST_NAME);
  assert.ok(fs.existsSync(file));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).runtime.nextRunAt, 9);
  removeManifest(dir);
  assert.equal(fs.existsSync(file), false);
});
