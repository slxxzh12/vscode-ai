import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CollabEngine, createPairHarness } from '../collaboration/engine.js';
import { createCollabDb } from '../collab-db.js';

function tmpDb() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-collabflow-')), 'collab.db'); }

test('入群注册：成员把自己的 command 报给 hub，hub 落到成员/命令表', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });

    A.collabDb = createCollabDb({ file: tmpDb(), logger: { warn() {} } });
    B.collabDb = createCollabDb({ file: tmpDb(), logger: { warn() {} } });
    B.assetDir = () => null;                       // 没有 command 目录也不报错
    const r = await B.registerSelfAssets();
    assert.equal(r.ok, true);
    await new Promise((res) => setTimeout(res, 200));

    const members = A.collabDb.listMembers(A.store.getGroup().id);
    assert.ok(members.find((m) => m.machineId === B.pub.machineId), 'hub 侧有该成员');
    assert.deepEqual(A.collabDb.listCommands({ groupId: A.store.getGroup().id, machineId: B.pub.machineId }), []);
    const memberInGroup = A.store.getGroup().members.find((m) => m.machineId === B.pub.machineId);
    assert.deepEqual(memberInGroup.commands, [], '群成员资料里也带上 command 名单');
  } finally { await h.stop(); }
});

test('群消息：hub 把聊天与远程命令写进 message 表', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    A.collabDb = createCollabDb({ file: tmpDb(), logger: { warn() {} } });
    const gid = A.store.getGroup().id;
    await A.sendChat({ groupId: gid, text: 'hello hub' });
    const rows = A.collabDb.listMessages({ groupId: gid });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].src, A.pub.machineId);
    assert.equal(rows[0].message, 'hello hub');
    assert.equal(rows[0].target, null);
  } finally { await h.stop(); }
});
