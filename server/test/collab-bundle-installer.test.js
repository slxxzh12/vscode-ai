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
