import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSeedStore } from '../seed-store.js';

function tmpDb() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-seed-')), 'seed.db');
}

test('种子表：add / get / list 往返，数组字段可还原', () => {
  const store = createSeedStore({ file: tmpDb(), logger: { warn() {} } });
  store.add({
    id: 'p1', fileName: 'assets-2-ab12cd.zip', hash: 'ab12cd', size: 1234, count: 2,
    skills: ['demo'], workflow: ['dev'], createdAt: 1000,
  });
  const got = store.get('p1');
  assert.equal(got.fileName, 'assets-2-ab12cd.zip');
  assert.equal(got.size, 1234);
  assert.deepEqual(got.skills, ['demo']);
  assert.deepEqual(got.workflow, ['dev']);
  assert.deepEqual(got.command, []);
  assert.equal(got.sent, false);
  assert.equal(got.createdAt, 1000);

  store.add({ id: 'p2', fileName: 'b.zip', createdAt: 2000, agent: ['a1'] });
  const list = store.list();
  assert.deepEqual(list.map((r) => r.id), ['p2', 'p1'], '按时间倒序');
  assert.deepEqual(list[0].agent, ['a1']);
  store.close();
});

test('种子表：markSent 记下发送状态与群', () => {
  const store = createSeedStore({ file: tmpDb(), logger: { warn() {} } });
  store.add({ id: 'p9', fileName: 'x.zip', createdAt: 1 });
  store.markSent('p9', 'group-1');
  const got = store.get('p9');
  assert.equal(got.sent, true);
  assert.equal(got.groupId, 'group-1');
  store.close();
});

test('种子表：落盘后重新打开仍在（持久化）', () => {
  const file = tmpDb();
  const a = createSeedStore({ file, logger: { warn() {} } });
  a.add({ id: 'keep', fileName: 'keep.zip', createdAt: 5 });
  a.close();
  const b = createSeedStore({ file, logger: { warn() {} } });
  assert.equal(b.get('keep').fileName, 'keep.zip');
  b.close();
});
