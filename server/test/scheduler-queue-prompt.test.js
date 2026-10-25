import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createQueue } from '../scheduler/queue/index.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-prompt-')); }

test('提示词按 hash 去重，内容变化追加新记录并带 IP/工号', async () => {
  const dir = tmpDir();
  const queue = createQueue({ dir, dbFile: path.join(dir, 'void.db') });
  const meta = { createIP: '10.0.0.8', employeeId: 'E100' };

  const first = await queue.recordPrompt('t1', '分析日志', meta);
  assert.ok(first.id);
  assert.match(first.hash, /^[0-9a-f]{64}$/);
  assert.equal(first.createIP, '10.0.0.8');
  assert.equal(first.employeeId, 'E100');

  const same = await queue.recordPrompt('t1', '分析日志', meta);
  assert.equal(same.skipped, true);

  const changed = await queue.recordPrompt('t1', '分析错误日志', { createIP: '10.0.0.9', employeeId: 'E200' });
  assert.notEqual(changed.hash, first.hash);

  const list = await queue.listPrompts('t1');
  assert.equal(list.length, 2);
  assert.equal(list[0].prompt, '分析错误日志');
  assert.equal(list[0].employeeId, 'E200');
  assert.equal(list[1].prompt, '分析日志');

  const byHash = await queue.getPromptByHash('t1', first.hash);
  assert.equal(byHash.id, first.id);

  assert.equal(await queue.deleteTaskPrompts('t1'), 2);
  assert.deepEqual(await queue.listPrompts('t1'), []);
  await queue.close();
});
