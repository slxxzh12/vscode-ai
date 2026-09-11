import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createPairHarness } from '../collaboration/engine.js';

async function joinGroup(A, B) {
  A.verifyAccessToken = (tk) => tk === 'good';
  A.ensureGroup();
  const r = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
  assert.equal(r.code, 'joined');
}

test('slave 上报 → hub 汇总写 downloads/usage.json', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    await joinGroup(A, B);
    const usage = { agent: 'opencode', days: 7, sessions: 3, messages: 40, input: 100, output: 20, totalCost: 0.5 };
    await B.reportHeartbeat(usage);
    assert.equal(A.store.getHeartbeat(B.pub.machineId).messages, 40);
    const usageFile = path.join(A.downloadsDir, 'usage.json');
    assert.ok(fs.existsSync(usageFile), 'hub 写 usage.json');
    const j = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
    assert.equal(j.members[B.pub.machineId].sessions, 3);
  } finally { await h.stop(); }
});

test('slave 点击拉取 → 本地 downloads 出现 usage.json', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    await joinGroup(A, B);
    await A.reportHeartbeat({ agent: 'opencode', days: 7, messages: 7 });
    const r = await B.pullDownloads();
    assert.equal(r.code, 'ok');
    assert.ok(r.files.includes('usage.json'));
    assert.equal(B.store.getHeartbeat(A.pub.machineId).messages, 7);
    assert.ok(fs.existsSync(path.join(B.downloadsDir, 'usage.json')));
  } finally { await h.stop(); }
});

test('createHeartbeat 采集并上报（注入 collect）', async () => {
  const { createHeartbeat } = await import('../collaboration/heartbeat.js');
  const calls = [];
  const hb = createHeartbeat({
    engine: { reportHeartbeat: async (u) => { calls.push(u); } },
    cmd: 'opencode', days: 7,
    intervalMinMs: 5 * 60 * 1000, intervalMaxMs: 10 * 60 * 1000,
    collect: async () => ({ agent: 'opencode', days: 7, messages: 1 }),
  });
  const u = await hb.collectOnce();
  assert.equal(u.messages, 1);
  assert.equal(calls.length, 1);
});
