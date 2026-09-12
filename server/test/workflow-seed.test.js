import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSeed, updateSeed, seedFileFor } from '../workflow-seed.js';

function cfgFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfseed-')), 'devflow.xml'); }
const WF = (label = 'A') => ({ id: 'a', label, stages: [{ id: 's', label: 'S', prompts: ['p'] }] });

test('首次写入 version=1，清单含 hash', () => {
  const f = cfgFile();
  const s = updateSeed(f, [WF()]);
  assert.equal(s.version, 1);
  assert.equal(s.workflows.length, 1);
  assert.ok(s.workflows[0].hash);
  assert.ok(fs.existsSync(seedFileFor(f)));
});

test('内容不变不递增 version，变化才递增', () => {
  const f = cfgFile();
  updateSeed(f, [WF('A')]);
  const same = updateSeed(f, [WF('A')]);
  assert.equal(same.version, 1);
  const changed = updateSeed(f, [WF('B')]);
  assert.equal(changed.version, 2);
});

test('读写往返一致', () => {
  const f = cfgFile();
  const s = updateSeed(f, [WF()]);
  assert.deepEqual(readSeed(f), s);
});
