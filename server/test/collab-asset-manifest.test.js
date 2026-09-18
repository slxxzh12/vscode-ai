import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip } from '../collaboration/zip.js';
import { buildManifest, parseManifest, deriveType, manifestSummary, ASSET_FORMAT } from '../collaboration/asset-manifest.js';

function zipWith(entries) { return buildZip(entries); }

test('buildManifest + parseManifest 往返，含类型与明细', () => {
  const manifest = buildManifest({
    selection: { skills: ['foo'], command: [], agent: [], workflow: ['w1'] },
    details: { skills: [{ name: 'foo', files: 2, hash: 'h1' }], workflow: [{ id: 'w1', label: 'W1', stages: 3 }] },
    source: { machineId: 'm1', host: '127.0.0.1', port: 22222, employeeId: 'e1' },
    now: 123,
  });
  assert.equal(manifest.format, ASSET_FORMAT);
  assert.equal(manifest.type, 'mixed');
  assert.deepEqual(manifest.kinds, ['skills', 'workflow']);
  assert.equal(manifest.exportedAt, 123);
  const zip = zipWith([
    { name: 'Manifest.json', data: JSON.stringify(manifest) },
    { name: 'skills/foo/SKILL.md', data: 'x' },
  ]);
  const parsed = parseManifest(zip);
  assert.equal(parsed.type, 'mixed');
  assert.equal(parsed.skills[0].name, 'foo');
  assert.equal(parsed.workflow[0].stages, 3);
});

test('deriveType：仅 skills → skills，仅 workflow → workflow，两者 → mixed', () => {
  assert.equal(deriveType({ skills: [{ name: 'a' }] }), 'skills');
  assert.equal(deriveType({ workflow: [{ id: 'w' }] }), 'workflow');
  assert.equal(deriveType({ command: [{ name: 'c' }], workflow: [{ id: 'w' }] }), 'mixed');
  assert.equal(deriveType({}), 'skills');
});

test('parseManifest 严格拒绝：缺 Manifest / 坏 JSON / format 不对 / 非法 zip', () => {
  assert.throws(() => parseManifest(zipWith([{ name: 'skills/a/SKILL.md', data: 'x' }])), (e) => e.code === 'manifest-missing');
  assert.throws(() => parseManifest(zipWith([{ name: 'Manifest.json', data: '{not json' }])), (e) => e.code === 'bad-manifest');
  assert.throws(() => parseManifest(zipWith([{ name: 'Manifest.json', data: JSON.stringify({ format: 'other', version: 1 }) }])), (e) => e.code === 'bad-format');
  assert.throws(() => parseManifest(Buffer.from('nope')), (e) => e.code === 'invalid-zip');
});

test('manifestSummary 计数', () => {
  const s = manifestSummary({ type: 'skills', skills: [{ name: 'a' }, { name: 'b' }], command: [{ name: 'c' }], workflow: [] });
  assert.equal(s.counts.skills, 2);
  assert.equal(s.counts.command, 1);
  assert.equal(s.type, 'skills');
});
