import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPairHarness } from '../collaboration/engine.js';
import { createTaskStore } from '../task-store.js';

function tmpFile(name) { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-poll-')), name); }

function fakePackage(A, { skills = [], id = 'pkg-1' } = {}) {
  const zip = Buffer.from('PK-fake-' + id);
  const name = `${id}.zip`;
  fs.mkdirSync(A.downloadDir, { recursive: true });
  fs.writeFileSync(path.join(A.downloadDir, name), zip);
  A.uploadDir = A.downloadDir;
  return A.store.addOutbox({
    id, kind: 'file', groupId: null, skillName: null, fileName: name, storedFile: name,
    size: zip.length, hash: `hash-${id}`, createdAt: Date.now(),
    package: { sent: false, skills, command: [], agent: [], workflow: [] },
  });
}

test('pollDistTasks：成员侧从 hub 补出 pending 任务并返回统计', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const file = tmpFile('void.db');
    for (const n of [A, B]) n.taskStore = createTaskStore({ file, logger: { warn() {} } });
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    fakePackage(A, { skills: ['demo'], id: 'pkg-1' });
    A.publishPackage('pkg-1');
    const r = await B.pollDistTasks();
    assert.equal(r.code, 'ok');
    assert.ok(r.tasks >= 1, '有 pending 任务');
    assert.equal(B.listTasks({ status: 'pending' }).length, 1);
  } finally { await h.stop(); }
});
