import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPairHarness } from '../collaboration/engine.js';
import { createTaskStore } from '../task-store.js';
import { buildZip } from '../collaboration/zip.js';

function tmpDir(name) { return fs.mkdtempSync(path.join(os.tmpdir(), name)); }

test('acceptTask：本地无包 → peer 拉取 → 装 skills 到 skillRoot、workflow 融合 → done', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const dir = tmpDir('df-accept-');
    B.taskStore = createTaskStore({ file: path.join(dir, 'void.db'), logger: { warn() {} } });
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    const r = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    const group = r.group;

    // hub 侧放一个真 zip 到共享 downloads 并写 manifest
    const zip = buildZip([
      { name: 'skills/demo/SKILL.md', data: Buffer.from('# demo') },
      { name: 'workflow/workflows.xml', data: Buffer.from('<workflows><workflow id="w1" label="流程A"><stage id="s1" label="S1"><prompt>p</prompt></stage></workflow></workflows>') },
    ]);
    const name = 'skills/pkg-1.zip';
    A.writeDownload(name, zip, 'skill');

    // 成员侧建任务（模拟 ingest 结果）
    B.taskStore.upsert({
      id: 'task-1', groupId: group.id, hubId: A.pub.machineId, kind: 'skills', hash: 'h1',
      name, url: 'http://x/y', payload: { skills: ['demo'] }, status: 'pending',
      messageId: 'm1', createdAt: 1, updatedAt: 1,
    });

    const merged = [];
    B.skillRoot = () => path.join(dir, 'skills-opencode');
    B.configRoot = () => path.join(dir, 'config');
    B.mergeWorkflows = (list) => { merged.push(...list); return list; };

    const res = await B.acceptTask('task-1');
    assert.equal(res.code, 'ok');
    assert.ok(fs.existsSync(path.join(dir, 'skills-opencode', 'demo', 'SKILL.md')), 'skills 落到本机技能目录');
    assert.equal(merged.length, 1, 'workflow 交给融合');
    assert.equal(merged[0].label, '流程A');
    assert.equal(B.taskStore.get('task-1').status, 'done');
  } finally { await h.stop(); }
});

test('acceptTask：拉不到包 → failed + lastError；已 done/ignored → not-pending', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const dir = tmpDir('df-accept2-');
    B.taskStore = createTaskStore({ file: path.join(dir, 'void.db'), logger: { warn() {} } });
    B.skillRoot = () => path.join(dir, 'skills-opencode');
    B.taskStore.upsert({
      id: 'task-x', groupId: 'g-none', hubId: A.pub.machineId, kind: 'skills', hash: 'h1',
      name: 'skills/missing.zip', url: '', payload: {}, status: 'pending', messageId: 'm', createdAt: 1, updatedAt: 1,
    });
    const res = await B.acceptTask('task-x');
    assert.equal(res.code, 'file-missing');
    assert.equal(B.taskStore.get('task-x').status, 'failed');
    assert.equal(B.taskStore.get('task-x').payload.lastError, 'file-missing');

    assert.equal(B.ignoreTask('nope').code, 'not-found');
    assert.equal(B.ignoreTask('task-x').code, 'ignored');
    assert.equal(B.taskStore.get('task-x').status, 'ignored');
    assert.equal((await B.acceptTask('task-x')).code, 'not-pending');
  } finally { await h.stop(); }
});
