import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPairHarness } from '../collaboration/engine.js';
import { createTaskStore } from '../task-store.js';
import { createCollabDb } from '../collab-db.js';

function tmpFile(name) { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-dist-')), name); }

async function setupMaster() {
  const h = await createPairHarness({ skipSkills: true });
  const [A, B] = h.nodes;
  const file = tmpFile('void.db');
  for (const n of [A, B]) {
    n.taskStore = createTaskStore({ file, logger: { warn() {} } });
    n.seedStore = null;
    n.collabDb = createCollabDb({ file, logger: { warn() {} } });
  }
  A.verifyAccessToken = (tk) => tk === 'good';
  A.ensureGroup();
  const r = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
  assert.equal(r.code, 'joined');
  return { h, A, B, group: r.group, file };
}

// 造一个可发布的包：写到 A.uploadDir + 建 outbox 记录（等价 buildPackage 的产物）
function fakePackage(A, { skills = [], workflow = [], id = 'pkg-1' } = {}) {
  const files = [];
  for (const n of skills) files.push({ rel: `skills/${n}/SKILL.md`, data: Buffer.from('# ' + n) });
  if (workflow.length) files.push({ rel: 'workflow/workflows.xml', data: Buffer.from('<workflows/>') });
  const zip = Buffer.from('PK-fake-' + JSON.stringify(files.map((f) => f.rel)));
  const name = `${id}.zip`;
  fs.mkdirSync(A.downloadDir, { recursive: true });
  fs.writeFileSync(path.join(A.downloadDir, name), zip);
  A.uploadDir = A.downloadDir;
  return A.store.addOutbox({
    id, kind: 'file', groupId: null, skillName: null, fileName: name, storedFile: name,
    size: zip.length, hash: `hash-${id}`, createdAt: Date.now(),
    package: { sent: false, skills, command: [], agent: [], workflow },
  });
}

test('publishPackage 后广播 kind:dist 消息：meta 结构化 + 正文含类型与地址 + 落库 target=all', async () => {
  const { h, A, B, group } = await setupMaster();
  try {
    A.getWorkflows = () => [{ id: 'wf1', label: '开发流程', stages: [{ id: 's1', label: 'S1', prompts: [] }] }];
    fakePackage(A, { skills: ['demo'], workflow: ['wf1'], id: 'pkg-1' });
    const r = A.publishPackage('pkg-1');
    assert.equal(r.code, 'ok');
    await new Promise((res) => setTimeout(res, 30));   // 等 CHAT_SEND 到达 B

    const bmsgs = B.store.listChatMessages(group.id).filter((m) => m.kind === 'dist');
    assert.equal(bmsgs.length, 1, 'B 收到 dist 消息');
    const msg = bmsgs[0];
    assert.equal(msg.meta.target, 'all');
    assert.equal(msg.meta.type, 'mixed');
    assert.equal(msg.meta.name, r.name);
    assert.ok(msg.meta.url.includes('/api/collab/downloads/file/skills%2F'), `url 应为共享下载路由：${msg.meta.url}`);
    assert.ok(msg.text.includes('/api/collab/downloads/file/'), '正文写明下载地址');
    assert.deepEqual(msg.meta.skills, ['demo']);
    assert.deepEqual(msg.meta.workflow.map((w) => w.label), ['开发流程']);

    const logged = A.collabDb.listMessages({ groupId: group.id }).filter((m) => m.id === msg.id);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].target, 'all');
  } finally { await h.stop(); }
});

test('只有技能 → type=skills；只有工作流 → type=workflow', async () => {
  const { h, A, group } = await setupMaster();
  try {
    A.getWorkflows = () => [];
    fakePackage(A, { skills: ['demo'], id: 'pkg-skills' });
    const r1 = A.publishPackage('pkg-skills');
    assert.equal(r1.code, 'ok');
    const m1 = A.store.listChatMessages(group.id).filter((m) => m.kind === 'dist').pop();
    assert.equal(m1.meta.type, 'skills');

    fakePackage(A, { workflow: ['wf1'], id: 'pkg-wf' });
    const r2 = A.publishPackage('pkg-wf');
    assert.equal(r2.code, 'ok');
    const m2 = A.store.listChatMessages(group.id).filter((m) => m.kind === 'dist').pop();
    assert.equal(m2.meta.type, 'workflow');
  } finally { await h.stop(); }
});
