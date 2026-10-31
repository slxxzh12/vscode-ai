import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { CollabEngine } from '../collaboration/engine.js';
import { CollabStore } from '../collaboration/store.js';
import { loadIdentity } from '../collaboration/identity.js';
import { createCollabMount } from '../collaboration/http-mount.js';
import { buildZip } from '../collaboration/zip.js';
import { buildManifest } from '../collaboration/asset-manifest.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'collab-import-')); }

export function makeImportZip() {
  const manifest = buildManifest({
    selection: { skills: ['demo'], command: [], agent: [], workflow: ['w1'] },
    details: { skills: [{ name: 'demo', files: 1, hash: 'h' }], workflow: [{ id: 'w1', label: 'W1', stages: 1 }] },
    source: { machineId: 'm1', host: '127.0.0.1', port: 1, employeeId: 'e1' },
  });
  return buildZip([
    { name: 'Manifest.json', data: JSON.stringify(manifest) },
    { name: 'skills/demo/SKILL.md', data: '# demo' },
    { name: 'workflow/workflows.xml', data: '<workflows><workflow id="w1" label="W1"><stage id="s1" label="S1"><prompt>p</prompt></stage></workflow></workflows>' },
  ]);
}

function makeEngine(name) {
  const dir = path.join(tmp(), name);
  const skillsRoot = path.join(dir, 'skills');
  const downloadDir = path.join(dir, 'download');
  fs.mkdirSync(downloadDir, { recursive: true });
  fs.mkdirSync(skillsRoot, { recursive: true });
  let merged = null;
  const engine = new CollabEngine({
    store: new CollabStore({ file: path.join(dir, 'collab.json') }),
    identity: loadIdentity({ file: path.join(dir, 'identity.json'), username: name, host: '127.0.0.1', port: 0 }),
    skillsRoot, downloadDir,
    mergeWorkflows: (list) => { merged = list; return list; },
  });
  return { engine, skillsRoot, downloadDir, getMerged: () => merged };
}

test('engine.stageImport/applyImport 安装 skills 并合并 workflow；discardImport 清理', async () => {
  const { engine, skillsRoot, getMerged } = makeEngine('eng');
  const r = engine.stageImport(makeImportZip());
  assert.equal(r.code, 'ok');
  assert.equal(r.manifest.type, 'mixed');
  assert.equal(r.summary.counts.skills, 1);
  const ap = engine.applyImport(r.id);
  assert.equal(ap.code, 'ok');
  assert.ok(fs.existsSync(path.join(skillsRoot, 'demo', 'SKILL.md')));
  assert.equal(getMerged()[0].id, 'w1');
  assert.equal(engine.applyImport(r.id).code, 'not-found');   // 已消费
  const r2 = engine.stageImport(makeImportZip());
  assert.equal(engine.discardImport(r2.id).code, 'ok');
});

test('engine.stageImport 缺 Manifest 返回 manifest-missing', () => {
  const { engine } = makeEngine('eng2');
  const r = engine.stageImport(buildZip([{ name: 'skills/a/SKILL.md', data: 'x' }]));
  assert.equal(r.code, 'manifest-missing');
});

test('engine.cleanupStagedImports 删除残留', () => {
  const { engine } = makeEngine('eng3');
  engine.stageImport(makeImportZip());
  assert.ok(engine.cleanupStagedImports() >= 1);
});

async function startHttpNode(name) {
  const { engine, skillsRoot, getMerged } = makeEngine(name);
  const mount = createCollabMount({ engine, logger: console });
  const server = http.createServer((req, res) => mount(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { engine, server, port: server.address().port, skillsRoot, getMerged };
}

test('HTTP 导入：stage 返回 Manifest 预览，apply 落位并合并', async () => {
  const n = await startHttpNode('http1');
  try {
    const up = await fetch(`http://127.0.0.1:${n.port}/api/collab/import`, { method: 'POST', body: makeImportZip() });
    assert.equal(up.status, 200);
    const upBody = await up.json();
    assert.equal(upBody.manifest.type, 'mixed');
    assert.equal(upBody.summary.counts.workflow, 1);
    const ap = await fetch(`http://127.0.0.1:${n.port}/api/collab/import/${upBody.id}/apply`, { method: 'POST' });
    const apBody = await ap.json();
    assert.equal(apBody.code, 'ok');
    assert.ok(fs.existsSync(path.join(n.skillsRoot, 'demo', 'SKILL.md')));
    assert.equal(n.getMerged()[0].id, 'w1');
  } finally { n.server.close(); }
});

test('HTTP 导入：缺 Manifest / 非法 zip 返回 400', async () => {
  const n = await startHttpNode('http2');
  try {
    const noManifest = await fetch(`http://127.0.0.1:${n.port}/api/collab/import`, { method: 'POST', body: buildZip([{ name: 'skills/a/SKILL.md', data: 'x' }]) });
    assert.equal(noManifest.status, 400);
    assert.equal((await noManifest.json()).error, 'manifest-missing');
    const bad = await fetch(`http://127.0.0.1:${n.port}/api/collab/import`, { method: 'POST', body: Buffer.from('nope') });
    assert.equal(bad.status, 400);
  } finally { n.server.close(); }
});

test('HTTP 导入：DELETE 丢弃后 apply 返回 not-found', async () => {
  const n = await startHttpNode('http3');
  try {
    const up = await fetch(`http://127.0.0.1:${n.port}/api/collab/import`, { method: 'POST', body: makeImportZip() });
    const { id } = await up.json();
    const del = await fetch(`http://127.0.0.1:${n.port}/api/collab/import/${id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    const ap = await fetch(`http://127.0.0.1:${n.port}/api/collab/import/${id}/apply`, { method: 'POST' });
    assert.equal(ap.status, 400);
    assert.equal((await ap.json()).error, 'not-found');
  } finally { n.server.close(); }
});
