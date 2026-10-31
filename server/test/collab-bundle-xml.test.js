import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPairHarness } from '../collaboration/engine.js';
import { readZip, buildZip } from '../collaboration/zip.js';
import { installBundleZip } from '../collaboration/bundle-installer.js';
import { parseWorkflowsXml, serializeWorkflowsFragment } from '@devflow/shared/workflow-xml';
import { createSeedStore } from '../seed-store.js';

const WORKFLOWS = [{ id: 'dev', label: '开发', stages: [{ id: 's1', label: '一', group: '', prompts: ['p'] }] }];

test('buildPackage：勾选工作流打成 XML zip，且同时落一份到 download 目录', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const A = h.nodes[0];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-pkg-'));
    A.uploadDir = path.join(dir, 'upload');
    A.downloadDir = path.join(dir, 'download');
    A.downloadsDir = path.join(dir, 'downloads');
    A.seedStore = createSeedStore({ file: path.join(dir, 'seed.db'), logger: { warn() {} } });
    A.getWorkflows = () => WORKFLOWS;

    const rec = await A.buildPackage({ workflow: ['dev'] });
    const up = path.join(A.uploadDir, rec.storedFile);
    const dl = path.join(A.downloadDir, rec.storedFile);
    assert.ok(fs.existsSync(up), 'upload 里有 zip');
    assert.ok(fs.existsSync(dl), 'download 目录里也有同一个 zip');
    assert.ok(fs.existsSync(path.join(A.downloadsDir, rec.storedFile)), 'downloads 目录里也有同一个 zip');
    const seeds = A.seedStore.list();
    assert.equal(seeds.length, 1, '打包写入种子表');
    assert.equal(seeds[0].fileName, rec.storedFile);
    assert.deepEqual(seeds[0].workflow, ['dev']);
    assert.equal(seeds[0].sent, false);

    const entries = readZip(fs.readFileSync(up));
    assert.deepEqual(entries.map((e) => e.name), ['workflow/workflows.xml', 'Manifest.json'], '工作流打成一份 XML + Manifest');
    const parsed = parseWorkflowsXml(entries.find((e) => e.name === 'workflow/workflows.xml').data.toString('utf8'));
    assert.deepEqual(parsed, WORKFLOWS);
  } finally { await h.stop(); }
});

test('installBundleZip：能装新格式的 workflow/workflows.xml，也兼容旧的 workflow/<id>.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-bundle-xml-'));
  const entries = [
    { name: 'workflow/workflows.xml', data: Buffer.from(serializeWorkflowsFragment(WORKFLOWS), 'utf8') },
    { name: 'workflow/legacy.json', data: Buffer.from(JSON.stringify({ id: 'legacy', label: '旧', stages: [] }), 'utf8') },
  ];
  const applied = [];
  const r = installBundleZip({
    zip: buildZip(entries),
    skillRoot: path.join(dir, 'skills'),
    configRoot: path.join(dir, 'cfg'),
    installWorkflows: (list) => applied.push(...list),
  });
  assert.equal(r.counts.workflow, 2);
  assert.deepEqual(applied.map((w) => w.id), ['dev', 'legacy']);
});
