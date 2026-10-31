import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTaskStore } from '../task-store.js';

function tmpDb() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-task-')), 'void.db'); }
function rec(over = {}) {
  return {
    id: 't1', groupId: 'g1', hubId: 'hub', kind: 'skills', hash: 'h1', name: 'skills/a.zip',
    url: 'http://h:1/api/collab/downloads/file/skills%2Fa.zip',
    payload: { skills: ['a'], workflow: [], count: 1, size: 10 },
    status: 'pending', messageId: 'm1', createdAt: 1, updatedAt: 1, ...over,
  };
}

test('upsert 新增后可按 id / 状态查回，字段完整', () => {
  const s = createTaskStore({ file: tmpDb() });
  const r = s.upsert(rec());
  assert.equal(r.created, true);
  const got = s.get('t1');
  assert.equal(got.groupId, 'g1');
  assert.equal(got.kind, 'skills');
  assert.equal(got.hash, 'h1');
  assert.deepEqual(got.payload.skills, ['a']);
  assert.equal(got.status, 'pending');
  assert.equal(s.list().length, 1);
  assert.equal(s.list({ status: 'pending' }).length, 1);
  assert.equal(s.list({ status: 'done' }).length, 0);
  assert.equal(s.list({ groupId: 'g1' }).length, 1);
  assert.equal(s.list({ groupId: 'g2' }).length, 0);
  s.close();
});

test('同 (group,kind,hash) 再 upsert：更新 url/name/payload，不新增行、不翻状态', () => {
  const s = createTaskStore({ file: tmpDb() });
  s.upsert(rec());
  s.setStatus('t1', 'done');
  const r = s.upsert({ ...rec(), id: 't2', name: 'skills/b.zip', url: 'http://h:1/x', payload: { skills: ['a', 'b'] } });
  assert.equal(r.created, false, '同 hash 不算新建');
  assert.equal(r.task.id, 't1', '保留原行 id');
  assert.equal(s.list().length, 1);
  assert.equal(s.get('t1').name, 'skills/b.zip');
  assert.deepEqual(s.get('t1').payload.skills, ['a', 'b']);
  assert.equal(s.get('t1').status, 'done', '不把 done 拉回 pending');
  s.close();
});

test('dedupe 命中行按 (group,kind,hash) 精确匹配，hash 变则新建', () => {
  const s = createTaskStore({ file: tmpDb() });
  s.upsert(rec());
  const r = s.upsert(rec({ id: 't9', hash: 'h2' }));
  assert.equal(r.created, true);
  assert.equal(s.list().length, 2);
  assert.equal(s.upsert(rec({ id: 't3', kind: 'workflow', hash: 'h1' })).created, true);
  assert.equal(s.list({ kind: 'workflow' }).length, 1);
  s.close();
});

test('setStatus 可带 payload 补丁（错误信息），未知 id 返回 null', () => {
  const s = createTaskStore({ file: tmpDb() });
  s.upsert(rec());
  const r = s.setStatus('t1', 'failed', { payload: { skills: ['a'], lastError: 'file-missing' } });
  assert.equal(r.status, 'failed');
  assert.equal(r.payload.lastError, 'file-missing');
  assert.equal(s.setStatus('nope', 'done'), null);
  s.close();
});

test('游标按群存取，advance 只增不减', () => {
  const s = createTaskStore({ file: tmpDb() });
  assert.equal(s.getCursor('g1'), null);
  s.advanceCursor('g1', 100, 'm2');
  assert.deepEqual({ ts: s.getCursor('g1').lastTs, id: s.getCursor('g1').lastId }, { ts: 100, id: 'm2' });
  s.advanceCursor('g1', 50, 'm1');
  assert.equal(s.getCursor('g1').lastTs, 100, '旧 ts 不回退');
  s.advanceCursor('g1', 200, 'm3');
  assert.equal(s.getCursor('g1').lastId, 'm3');
  assert.equal(s.advanceCursor('g2', 7, 'x').lastTs, 7);
  s.close();
});

test('落盘后重新打开仍在', () => {
  const file = tmpDb();
  const a = createTaskStore({ file });
  a.upsert(rec());
  a.advanceCursor('g1', 5, 'm1');
  a.close();
  const b = createTaskStore({ file });
  assert.equal(b.get('t1').name, 'skills/a.zip');
  assert.equal(b.getCursor('g1').lastTs, 5);
  b.close();
});
