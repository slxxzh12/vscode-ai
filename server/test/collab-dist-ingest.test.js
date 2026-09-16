import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPairHarness } from '../collaboration/engine.js';
import { createTaskStore } from '../task-store.js';

function tmpFile(name) { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-ingest-')), name); }

async function setup() {
  const h = await createPairHarness({ skipSkills: true });
  const [A, B] = h.nodes;
  const file = tmpFile('void.db');
  B.taskStore = createTaskStore({ file, logger: { warn() {} } });
  A.verifyAccessToken = (tk) => tk === 'good';
  A.ensureGroup();
  const r = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
  return { h, A, B, group: r.group };
}

// 直接在 hub 侧造一条 dist 消息并广播（等价 Task 5 的 _broadcastDist 效果）
function pushDist(A, groupId, meta) {
  const msg = {
    id: meta.__id || `d-${Math.random().toString(36).slice(2)}`, groupId, kind: 'dist', fromId: A.pub.machineId,
    text: 'dist', toId: null, ts: meta.__ts || Date.now(), seq: A.store.nextChatSeq(), meta,
  };
  A.store.addChatMessage(msg);
  return A._broadcastChat(groupId, msg).then(() => msg);
}
const meta = (over = {}) => ({
  target: 'all', type: 'skills', name: 'skills/a.zip', url: 'http://h:1/d', hash: 'h1', count: 1,
  skills: ['a'], command: [], agent: [], workflow: [], ...over,
});

test('技能包 → 1 条 skills 任务；工作流包 → 1 条 workflow 任务；混合 → 2 条', async () => {
  const { h, A, B, group } = await setup();
  try {
    await pushDist(A, group.id, meta());
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(B.taskStore.list().map((t) => t.kind), ['skills']);

    await pushDist(A, group.id, meta({ hash: 'h2', name: 'skills/b.zip', skills: [], workflow: [{ id: 'wf', label: 'W' }] }));
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(B.taskStore.list().map((t) => t.kind).sort(), ['skills', 'workflow']);

    await pushDist(A, group.id, meta({ hash: 'h3', name: 'skills/c.zip', skills: ['x'], workflow: [{ id: 'wf', label: 'W' }] }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(B.taskStore.list().length, 4, '混合包建 2 条');
    assert.equal(B.taskStore.list({ status: 'pending' }).length, 4);
  } finally { await h.stop(); }
});

test('同 hash 重复通知不新增、不动状态；hash 变则新建', async () => {
  const { h, A, B, group } = await setup();
  try {
    await pushDist(A, group.id, meta());
    await pushDist(A, group.id, meta({ __id: 'd-2', name: 'skills/renamed.zip' }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(B.taskStore.list().length, 1, '同 hash 一行');
    const id = B.taskStore.list()[0].id;
    B.taskStore.setStatus(id, 'done');
    await pushDist(A, group.id, meta({ __id: 'd-3' }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(B.taskStore.list()[0].status, 'done', '已完成的同 hash 通知不翻回');

    await pushDist(A, group.id, meta({ __id: 'd-4', hash: 'h9', name: 'skills/new.zip' }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(B.taskStore.list().length, 2);
    assert.equal(B.taskStore.list({ status: 'pending' }).length, 1);
  } finally { await h.stop(); }
});

test('群主本机不建任务；非群主发的 dist 不建任务', async () => {
  const { h, A, B, group } = await setup();
  try {
    A.taskStore = createTaskStore({ file: tmpFile('hub.db'), logger: { warn() {} } });
    const fromHub = { id: 'd-a', groupId: group.id, kind: 'dist', fromId: A.pub.machineId, text: 'x', toId: null, ts: 1, meta: meta() };
    assert.equal(A.ingestDist(fromHub).code, 'self', '群主本机跳过');
    assert.equal(A.taskStore.list().length, 0);

    const fromMember = { ...fromHub, id: 'd-b', fromId: B.pub.machineId, meta: meta({ hash: 'hf', name: 'skills/f.zip' }) };
    assert.equal(A.ingestDist(fromMember).code, 'not-hub', '只认群主的通知');
    assert.equal(A.taskStore.list().length, 0);
    assert.equal(B.taskStore.list().length, 0, 'B 侧没收到广播就不会有任务');
  } finally { await h.stop(); }
});

test('游标：applyChatPull 批量扫描后推进，重复扫不再新建', async () => {
  const { h, A, B, group } = await setup();
  try {
    const d1 = { id: 'd-1', groupId: group.id, kind: 'dist', fromId: A.pub.machineId, text: 'x', toId: null, ts: 1000, meta: meta() };
    const d2 = { id: 'd-2', groupId: group.id, kind: 'dist', fromId: A.pub.machineId, text: 'x', toId: null, ts: 2000, meta: meta({ hash: 'h2', name: 'skills/b.zip' }) };
    B.applyChatPull({ groupId: group.id, messages: [d1, d2] });
    assert.equal(B.taskStore.list().length, 2);
    assert.equal(B.taskStore.getCursor(group.id).lastTs, 2000);
    B.applyChatPull({ groupId: group.id, messages: [d1, d2] });
    assert.equal(B.taskStore.list().length, 2, '重复批量扫描不新增');
  } finally { await h.stop(); }
});

test('backfillDistTasks：从 hub 拉历史消息补任务', async () => {
  const { h, A, B, group } = await setup();
  try {
    A.store.addChatMessage({ id: 'old-1', groupId: group.id, kind: 'dist', fromId: A.pub.machineId, text: 'x', toId: null, ts: 500, seq: A.store.nextChatSeq(), meta: meta() });
    const r = await B.backfillDistTasks();
    assert.equal(r.code, 'ok');
    assert.equal(B.taskStore.list().length, 1, '补扫建出任务');
  } finally { await h.stop(); }
});
