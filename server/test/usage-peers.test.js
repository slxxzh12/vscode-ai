import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UsagePeersStore, emptyPeers } from '../usage-peers.js';

function tmpFile(name = 'usage-peers.json') {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-peers-')), name);
}

test('空文件时返回空结构', () => {
  const s = new UsagePeersStore({ file: tmpFile() });
  assert.deepEqual(s.snapshot(), emptyPeers());
  assert.equal(s.get('nobody'), null);
});

test('upsert 落盘并按 machineId 只留最新一份', () => {
  const file = tmpFile();
  const s = new UsagePeersStore({ file });
  s.upsert({ machineId: 'm1', username: 'u1', sessions: 1, days: 7, messages: 2, input: 100, output: 10 }, 1000);
  s.upsert({ machineId: 'm1', username: 'u1', sessions: 3, days: 7, messages: 9, input: 999, output: 99 }, 2000);
  s.upsert({ machineId: 'm2', username: 'u2', sessions: 5 }, 3000);

  const snap = s.snapshot();
  assert.equal(snap.updatedAt, 3000);
  assert.deepEqual(Object.keys(snap.peers).sort(), ['m1', 'm2']);
  assert.equal(snap.peers.m1.sessions, 3);
  assert.equal(snap.peers.m1.input, 999);
  assert.equal(snap.peers.m1.receivedAt, 2000);

  const again = new UsagePeersStore({ file });
  assert.equal(again.get('m1').messages, 9);
  assert.equal(again.get('m2').receivedAt, 3000);
});

test('缺 machineId 不落库，返回 null', () => {
  const s = new UsagePeersStore({ file: tmpFile() });
  assert.equal(s.upsert({ sessions: 1 }, 1000), null);
  assert.deepEqual(s.snapshot().peers, {});
});

test('文件损坏时回退空结构而不是抛错', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ not json', 'utf8');
  const s = new UsagePeersStore({ file, logger: { warn() {} } });
  assert.deepEqual(s.snapshot(), emptyPeers());
});
