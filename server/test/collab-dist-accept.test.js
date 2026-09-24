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

test('acceptTask：群记录 hub 地址过期 → 回退用 task.url 主机拉取 → done', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const dir = tmpDir('df-accept-addr-');
    B.taskStore = createTaskStore({ file: path.join(dir, 'void.db'), logger: { warn() {} } });
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    const r = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    const group = r.group;

    const zip = buildZip([{ name: 'skills/demo/SKILL.md', data: Buffer.from('# demo') }]);
    const name = 'skills/pkg-addr.zip';
    A.writeDownload(name, zip, 'skill');

    // 群记录里 hub 的地址过期（模拟群主换网/IP）
    const g = B.store.findGroup(group.id);
    g.members.find((m) => m.machineId === A.pub.machineId).host = '192.168.126.142';
    B.store.upsertGroup(g);

    // peer 通道：旧地址不可达；其余转发到 A（直连）
    B.peer = { post: async (host, port, env) => {
      if (host === '192.168.126.142') return { ok: false, error: 'unreachable' };
      const res = await A.handleIncoming(JSON.parse(JSON.stringify(env)));
      return res.ok ? { ok: true, data: res.data } : { ok: false, error: res.error };
    } };

    B.skillRoot = () => path.join(dir, 'skills-opencode');
    B.configRoot = () => path.join(dir, 'config');
    B.mergeWorkflows = (list) => list;
    B.taskStore.upsert({
      id: 'task-addr', groupId: group.id, hubId: A.pub.machineId, kind: 'skills', hash: 'h1',
      name, url: `http://127.0.0.1:39991/api/collab/downloads/file/${encodeURIComponent(name)}`,
      payload: { skills: ['demo'] }, status: 'pending', messageId: 'm', createdAt: 1, updatedAt: 1,
    });

    const res = await B.acceptTask('task-addr');
    assert.equal(res.code, 'ok');
    assert.ok(fs.existsSync(path.join(dir, 'skills-opencode', 'demo', 'SKILL.md')), '回退拉取后装到本机技能目录');
    assert.equal(B.taskStore.get('task-addr').status, 'done');
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

test('群主接受成员上传：把 workflow 合并进群主本地 workflowStore', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const dir = tmpDir('df-accept-upload-');
    A.taskStore = createTaskStore({ file: path.join(dir, 'a.db'), logger: { warn() {} } });
    B.taskStore = createTaskStore({ file: path.join(dir, 'b.db'), logger: { warn() {} } });

    A.getWorkflows = () => [];
    B.getWorkflows = () => [{ id: 'dev', label: '开发流程', stages: [{ id: 's1', label: 'S1', group: '', prompts: ['p'] }] }];
    const mergedA = [];
    A.mergeWorkflows = (list) => { mergedA.push(...list); return list; };
    B.mergeWorkflows = (list) => list;

    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    const r = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    const group = r.group;

    const rec = await B.buildPackage({ workflow: ['dev'] });
    const up = await B.uploadPackageToMaster(rec.id, group.id);
    assert.equal(up.code, 'ok');
    assert.ok(up.packageId, '上传应返回群主侧 packageId');
    assert.ok(up.name && up.name.startsWith('skills/'), '上传应返回群主侧下载 name');
    assert.ok(up.url && up.url.includes('/api/collab/downloads/file/'), '上传应返回群主侧下载 url');

    // 群主侧 ingest 上传请求 → 建 upload 任务（带下载地址）
    const notices = A.store.listChatMessages(group.id).filter((m) => m.kind === 'pkg-upload');
    assert.equal(notices.length, 1);
    assert.equal(notices[0].meta.url, up.url, '上传通知 meta 应带下载地址');
    for (const m of notices) A.ingestUploadRequest(m);
    const upTask = A.taskStore.list({ kind: 'upload' })[0];
    assert.ok(upTask, '群主应有 upload 任务');
    assert.equal(upTask.url, up.url, '群主 upload 任务应带下载地址');

    const accept = await A.acceptTask(upTask.id);
    assert.equal(accept.code, 'ok');
    assert.equal(mergedA.length, 1, '群主本地应融合 workflow');
    assert.equal(mergedA[0].id, 'dev');
    assert.equal(mergedA[0].label, '开发流程');
  } finally { await h.stop(); }
});
