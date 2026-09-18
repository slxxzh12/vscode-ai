import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createPairHarness } from '../collaboration/engine.js';
import { createTaskStore } from '../task-store.js';
import { buildZip } from '../collaboration/zip.js';

function tmpDir(name) { return fs.mkdtempSync(path.join(os.tmpdir(), name)); }

async function joinedPair() {
  const h = await createPairHarness({ skipSkills: true });
  const [A, B] = h.nodes;
  const dir = tmpDir('df-upload-');
  A.taskStore = createTaskStore({ file: path.join(dir, 'a.db'), logger: { warn() {} } });
  B.taskStore = createTaskStore({ file: path.join(dir, 'b.db'), logger: { warn() {} } });
  A.verifyAccessToken = (tk) => tk === 'good';
  A.ensureGroup();
  const r = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
  return { h, A, B, group: r.group, dir };
}

function memberPack(B, dir, id, fileName) {
  B.uploadDir = path.join(dir, id);
  fs.mkdirSync(B.uploadDir, { recursive: true });
  const zip = buildZip([{ name: 'skills/demo/SKILL.md', data: Buffer.from('# demo') }]);
  fs.writeFileSync(path.join(B.uploadDir, fileName), zip);
  const hash = crypto.createHash('sha256').update(zip).digest('hex');
  B.store.addOutbox({
    id, kind: 'file', fileName, storedFile: fileName, size: zip.length, hash, createdAt: 1,
    package: { skills: ['demo'], command: [], agent: [], workflow: [] },
  });
  return zip;
}

test('成员上传：文件落到群主 upload/，群主据聊天消息建 upload 任务', async () => {
  const { h, A, B, group, dir } = await joinedPair();
  try {
    memberPack(B, dir, 'pkg-b1', 'assets-1.zip');
    const up = await B.uploadPackageToMaster('pkg-b1', group.id);
    assert.equal(up.code, 'ok');
    assert.ok(up.packageId, '群主返回 packageId');
    assert.ok(fs.readdirSync(A.uploadDir).some((f) => f.endsWith('.zip')), '群主 upload/ 有 zip');
    const pending = A.taskStore.list({ status: 'pending' });
    assert.equal(pending.length, 1, '群主生成待审核任务');
    assert.equal(pending[0].kind, 'upload');
    assert.ok(A.store.listChatMessages(group.id).some((m) => m.kind === 'pkg-upload'), '群里发通知消息');
  } finally { await h.stop(); }
});

test('群主接受 upload 任务：发布到群 → done + 广播 dist', async () => {
  const { h, A, B, group, dir } = await joinedPair();
  try {
    memberPack(B, dir, 'pkg-b2', 'assets-2.zip');
    await B.uploadPackageToMaster('pkg-b2', group.id);
    const task = A.taskStore.list({ status: 'pending' })[0];
    const res = await A.acceptTask(task.id);
    assert.equal(res.code, 'ok');
    assert.equal(A.taskStore.get(task.id).status, 'done');
    assert.ok(A.readUpdate().version, '生成升级种子');
    assert.ok(A.store.listChatMessages(group.id).some((m) => m.kind === 'dist'), '广播 dist');
  } finally { await h.stop(); }
});

test('群主拒绝 upload 任务：任务 ignored + 删除 upload/ 文件', async () => {
  const { h, A, B, group, dir } = await joinedPair();
  try {
    memberPack(B, dir, 'pkg-b3', 'assets-3.zip');
    await B.uploadPackageToMaster('pkg-b3', group.id);
    const task = A.taskStore.list({ status: 'pending' })[0];
    const res = A.ignoreTask(task.id);
    assert.equal(res.code, 'ignored');
    assert.equal(A.taskStore.get(task.id).status, 'ignored');
    assert.equal(fs.readdirSync(A.uploadDir).filter((f) => f.endsWith('.zip')).length, 0, 'upload/ 文件被删');
  } finally { await h.stop(); }
});
