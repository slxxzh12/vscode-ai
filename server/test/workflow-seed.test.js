import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkflowSeedStore, hashWorkflow } from '../workflow-seed.js';

function tmpDb() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfseed-')), 'void.db'); }
const WF = (label = 'A') => ({ id: 'a', label, stages: [{ id: 's', label: 'S', prompts: ['p'] }] });
const logger = { warn() {} };

test('首次写入 version=1，清单含 hash', () => {
  const store = createWorkflowSeedStore({ file: tmpDb(), logger });
  const s = store.update([WF()]);
  assert.equal(s.version, 1);
  assert.equal(s.workflows.length, 1);
  assert.ok(s.workflows[0].hash);
  store.close();
});

test('内容不变不递增 version，变化才递增', () => {
  const store = createWorkflowSeedStore({ file: tmpDb(), logger });
  store.update([WF('A')]);
  assert.equal(store.update([WF('A')]).version, 1);
  assert.equal(store.update([WF('B')]).version, 2);
  store.close();
});

test('读写往返一致（跨连接持久化）', () => {
  const file = tmpDb();
  const a = createWorkflowSeedStore({ file, logger });
  const s = a.update([WF()]);
  a.close();
  const b = createWorkflowSeedStore({ file, logger });
  assert.deepEqual(b.read(), s);
  b.close();
});

test('hashWorkflow 区分 priority（nonzero 才计入）', () => {
  const base = { id: 'w', label: 'W', stages: [] };
  assert.equal(hashWorkflow(base), hashWorkflow({ ...base, priority: 0 }));
  assert.notEqual(hashWorkflow(base), hashWorkflow({ ...base, priority: 3 }));
});
