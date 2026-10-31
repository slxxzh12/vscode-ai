import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildZip } from '../collaboration/zip.js';
import { buildManifest } from '../collaboration/asset-manifest.js';
import { stageImport, applyImport, discardImport, cleanupStagedImports } from '../collaboration/asset-import.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'asset-import-')); }
function pkg() {
  const manifest = buildManifest({
    selection: { skills: ['demo'], workflow: ['w1'] },
    details: { skills: [{ name: 'demo', files: 1 }], workflow: [{ id: 'w1', label: 'W1', stages: 1 }] },
  });
  return buildZip([
    { name: 'Manifest.json', data: JSON.stringify(manifest) },
    { name: 'skills/demo/SKILL.md', data: '# demo' },
  ]);
}

test('stageImport 落暂存并返回预览；applyImport 安装', () => {
  const dir = tmp();
  const staged = stageImport({ zip: pkg(), dir });
  assert.ok(fs.existsSync(staged.file));
  assert.equal(staged.summary.type, 'mixed');
  const skillRoot = path.join(dir, 'skills');
  const configRoot = path.join(dir, 'cfg');
  const r = applyImport({ id: staged.id, file: staged.file, manifest: staged.manifest, skillRoot, configRoot });
  assert.equal(r.code, 'ok');
  assert.ok(fs.existsSync(path.join(skillRoot, 'demo', 'SKILL.md')));
});

test('stageImport 拒绝无 Manifest 的 zip，且不留文件', () => {
  const dir = tmp();
  assert.throws(
    () => stageImport({ zip: buildZip([{ name: 'skills/a/SKILL.md', data: 'x' }]), dir }),
    (e) => e.code === 'manifest-missing',
  );
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('discardImport 与 cleanupStagedImports 清理', () => {
  const dir = tmp();
  const a = stageImport({ zip: pkg(), dir });
  discardImport(a.file);
  assert.ok(!fs.existsSync(a.file));
  const b = stageImport({ zip: pkg(), dir });
  cleanupStagedImports(dir);
  assert.ok(!fs.existsSync(b.file));
});
