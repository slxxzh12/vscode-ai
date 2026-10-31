import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPairHarness } from '../collaboration/engine.js';

test('USAGE_PULL：成员向群主拉取用量汇总', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    const jr = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    assert.equal(jr.code, 'joined');

    A.peers = { list: () => ({ m1: { machineId: 'm1', messages: 5 }, m2: { machineId: 'm2', messages: 8 } }) };
    const r = await B.pullUsageFrom();
    assert.equal(r.code, 'ok');
    assert.equal(r.members.m2.messages, 8);
  } finally { await h.stop(); }
});

test('USAGE_PULL：非成员被拒', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A] = h.nodes;
    A.ensureGroup();
    const r = A._inUsagePull({ from: { machineId: 'ghost' } });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'not-member');
  } finally { await h.stop(); }
});

test('pullDownloads / _inPullDownloads 不再透传 usage，也不改本地 peers', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    A.peers = { list: () => ({ m1: { machineId: 'm1', messages: 5 } }) };
    let upserted = 0;
    B.peers = { upsert: () => { upserted += 1; }, list: () => ({}) };

    const r = await B.pullDownloads();
    assert.equal(r.code, 'ok');
    assert.equal(upserted, 0, '不应把群主用量合并进本地 peers');

    const incoming = await A.handleIncoming(B._sign('pull-downloads', {}));
    assert.equal(incoming.ok, true);
    assert.equal(incoming.data.usage, undefined);
  } finally { await h.stop(); }
});
