import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildZip } from '../collaboration/zip.js';
import { installBundleZip } from '../collaboration/bundle-installer.js';

test('installBundleZip 解包 skills/command/agent 到各自根', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  const skillRoot = path.join(dir, 'skills');
  const configRoot = path.join(dir, 'cfg');
  const zip = buildZip([
    { name: 'skills/foo/SKILL.md', data: 'skill' },
    { name: 'skills/foo/lib/a.txt', data: 'lib' },
    { name: 'command/c.md', data: 'cmd' },
    { name: 'agent/ag.md', data: 'ag' },
  ]);
  const r = installBundleZip({ zip, skillRoot, configRoot });
  assert.ok(fs.existsSync(path.join(skillRoot, 'foo', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(skillRoot, 'foo', 'lib', 'a.txt')));
  assert.ok(fs.existsSync(path.join(configRoot, 'command', 'c.md')));
  assert.ok(fs.existsSync(path.join(configRoot, 'agent', 'ag.md')));
  assert.equal(r.counts.skills, 2);
  assert.equal(r.counts.command, 1);
  assert.equal(r.counts.agent, 1);
});

test('installBundleZip 拒绝无效 zip', () => {
  assert.throws(() => installBundleZip({ zip: Buffer.from('nope'), skillRoot: 'x', configRoot: 'y' }));
});

test('installBundleZip 合并 workflow/*.json（按 id 覆盖/追加）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  const zip = buildZip([
    { name: 'workflow/w1.json', data: JSON.stringify({ id: 'w1', label: 'W1', stages: [] }) },
    { name: 'workflow/w2.json', data: JSON.stringify({ id: 'w2', label: 'W2', stages: [] }) },
  ]);
  let merged = null;
  const r = installBundleZip({ zip, skillRoot: path.join(dir, 's'), configRoot: path.join(dir, 'c'), installWorkflows: (list) => { merged = list; } });
  assert.equal(r.counts.workflow, 2);
  assert.deepEqual(merged.map((w) => w.id).sort(), ['w1', 'w2']);
});
