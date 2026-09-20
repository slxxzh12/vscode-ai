import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SchedulerStore } from '../scheduler/store.js';
import { MANIFEST_NAME } from '../scheduler/manifest.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-import-')); }
function manifest(over = {}) {
  return {
    format: 'void_manifest', version: 1, name: 'x', type: 'shell', enabled: true,
    command: 'echo hi', schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } },
    ...over,
  };
}
function writeAt(dir, obj) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, MANIFEST_NAME), JSON.stringify(obj)); }

test('importManifestDir 新建任务，cwd = 清单所在目录', () => {
  const root = tmpDir();
  const proj = path.join(root, 'proj');
  writeAt(proj, manifest());
  const store = new SchedulerStore({ dir: tmpDir() });
  const s = store.importManifestDir(root);
  assert.equal(s.imported, 1);
  assert.equal(s.overwritten, 0);
  assert.equal(store.listTasks()[0].cwd, proj);
});

test('importManifestDir 再次导入覆盖（沿用 id）', () => {
  const root = tmpDir();
  const proj = path.join(root, 'proj');
  writeAt(proj, manifest());
  const store = new SchedulerStore({ dir: tmpDir() });
  store.importManifestDir(root);
  const firstId = store.listTasks()[0].id;
  writeAt(proj, manifest({ name: 'x2' }));
  const s = store.importManifestDir(root);
  assert.equal(s.overwritten, 1);
  assert.equal(store.listTasks().length, 1);
  assert.equal(store.listTasks()[0].id, firstId);
  assert.equal(store.listTasks()[0].name, 'x2');
});

test('importManifestDir 单条失败不中断', () => {
  const root = tmpDir();
  writeAt(path.join(root, 'bad'), { oops: true });
  writeAt(path.join(root, 'good'), manifest({ name: 'g' }));
  const store = new SchedulerStore({ dir: tmpDir() });
  const s = store.importManifestDir(root);
  assert.equal(s.imported, 1);
  assert.equal(s.failed.length, 1);
  assert.equal(s.failed[0].error, 'bad-format');
});

test('importManifestDir 覆盖时旧类型字段不残留', () => {
  const root = tmpDir();
  const proj = path.join(root, 'proj');
  writeAt(proj, manifest());
  const store = new SchedulerStore({ dir: tmpDir() });
  store.importManifestDir(root);
  fs.writeFileSync(path.join(proj, 'run.ps1'), 'x');
  writeAt(proj, manifest({ type: 'script', command: undefined, script: { path: 'run.ps1' } }));
  store.importManifestDir(root);
  const t = store.listTasks()[0];
  assert.equal(t.type, 'script');
  assert.equal(t.command, undefined);
  assert.equal(t.script.path, path.join(proj, 'run.ps1'));
});
