import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CollabEngine } from '../collaboration/engine.js';
import { CollabStore } from '../collaboration/store.js';
import { loadIdentity } from '../collaboration/identity.js';
import { createSeedStore } from '../seed-store.js';
import { readZip } from '../collaboration/zip.js';

function tmpDir(name) { return fs.mkdtempSync(path.join(os.tmpdir(), name)); }

test('buildPackage 在 seed 明细里记录每个 skill 的 updatedAt/size/hash', async () => {
  const dir = tmpDir('df-pack-detail-');
  const skillsRoot = path.join(dir, 'skills');
  const demo = path.join(skillsRoot, 'demo');
  fs.mkdirSync(demo, { recursive: true });
  fs.writeFileSync(path.join(demo, 'SKILL.md'), '# demo', 'utf8');
  const engine = new CollabEngine({
    store: new CollabStore({ file: path.join(dir, 'collab.json') }),
    identity: loadIdentity({ file: path.join(dir, 'identity.json'), username: 'u', host: '127.0.0.1', port: 0 }),
    skillsRoot,
    uploadDir: path.join(dir, 'upload'),
    downloadDir: path.join(dir, 'download'),
    downloadsDir: path.join(dir, 'downloads'),
    seedStore: createSeedStore({ file: path.join(dir, 'void.db'), logger: { warn() {} } }),
  });
  const rec = await engine.buildPackage({ skills: ['demo'] });
  const seed = engine.seedStore.get(rec.id);
  assert.ok(seed, 'seed 已记录');
  const s = seed.detail.skills[0];
  assert.equal(s.name, 'demo');
  assert.ok(s.size > 0, 'size > 0');
  assert.equal(String(s.hash).length, 64, 'sha256 十六进制');
  assert.ok(s.updatedAt > 0, 'updatedAt > 0');
  engine.seedStore.close();
});

test('buildPackage 的 zip 内含 Manifest.json（含类型与明细）', async () => {
  const dir = tmpDir('df-pack-manifest-');
  const skillsRoot = path.join(dir, 'skills');
  const demo = path.join(skillsRoot, 'demo');
  fs.mkdirSync(demo, { recursive: true });
  fs.writeFileSync(path.join(demo, 'SKILL.md'), '# demo', 'utf8');
  const engine = new CollabEngine({
    store: new CollabStore({ file: path.join(dir, 'collab.json') }),
    identity: loadIdentity({ file: path.join(dir, 'identity.json'), username: 'u', host: '127.0.0.1', port: 0 }),
    skillsRoot,
    uploadDir: path.join(dir, 'upload'),
    downloadDir: path.join(dir, 'download'),
    downloadsDir: path.join(dir, 'downloads'),
  });
  const rec = await engine.buildPackage({ skills: ['demo'] });
  const zip = fs.readFileSync(path.join(engine.uploadDir, rec.storedFile));
  const entry = readZip(zip).find((e) => e.name === 'Manifest.json');
  assert.ok(entry, 'Manifest.json 存在');
  const manifest = JSON.parse(entry.data.toString('utf8'));
  assert.equal(manifest.type, 'skills');
  assert.equal(manifest.skills[0].name, 'demo');
});
