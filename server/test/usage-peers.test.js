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
  assert.deepEqual(s.list(), {});
  assert.deepEqual(s.listDaily(), {});
  assert.equal(s.snapshot().updatedAt, 0);
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
  assert.deepEqual(s.snapshot(), { updatedAt: 0, peers: {} });
  assert.deepEqual(s.listDaily(), {});
});

test('daily��ͬһ���ظ��ϱ�ֻ��һ�������ǣ��������һ��', () => {
  const file = tmpFile();
  const s = new UsagePeersStore({ file });
  const d1 = Date.UTC(2026, 8, 16, 3, 0, 0);
  const d2 = Date.UTC(2026, 8, 17, 3, 0, 0);
  s.upsert({ machineId: 'm1', messages: 10, input: 100 }, d1);
  s.upsert({ machineId: 'm1', messages: 12, input: 150 }, d1 + 3600_000);
  s.upsert({ machineId: 'm1', messages: 20, input: 900 }, d2);

  const daily = s.listDaily('m1');
  assert.deepEqual(Object.keys(daily).sort(), ['2026-09-16', '2026-09-17']);
  assert.equal(daily['2026-09-16'].messages, 12, 'ͬһ��Ӧ����һ�θ���');
  assert.equal(daily['2026-09-16'].input, 150);
  assert.equal(daily['2026-09-17'].messages, 20);
});

test('daily��ÿ̨�����ֿ��棬��ֻ������� 30 ��', () => {
  const file = tmpFile();
  const s = new UsagePeersStore({ file });
  const base = Date.UTC(2026, 7, 1, 3, 0, 0);
  for (let i = 0; i < 35; i += 1) {
    s.upsert({ machineId: 'm1', messages: i }, base + i * 86400_000);
  }
  s.upsert({ machineId: 'm2', messages: 1 }, base + 34 * 86400_000);

  const m1 = s.listDaily('m1');
  assert.equal(Object.keys(m1).length, 30, 'ֻ���� 30 ��');
  assert.equal(m1['2026-08-01'], undefined, '��ɵ�Ӧ���õ�');
  assert.ok(m1['2026-08-06'], '�� 31 �쿪ʼ����');
  assert.ok(m1['2026-09-04']);
  assert.equal(Object.keys(s.listDaily('m2')).length, 1, '����������');
});

test('daily�����̺����¶�ȡ����', () => {
  const file = tmpFile();
  const ts = Date.UTC(2026, 8, 16, 3, 0, 0);
  new UsagePeersStore({ file }).upsert({ machineId: 'm1', messages: 5, output: 7 }, ts);
  const again = new UsagePeersStore({ file });
  const daily = again.listDaily('m1');
  assert.equal(daily['2026-09-16'].messages, 5);
  assert.equal(daily['2026-09-16'].output, 7);
  assert.ok(daily['2026-09-16'].at > 0);
});

test('daily���� JSON ���ÿ�������һ����Ǩ�ƽ� SQLite��JSON ���ٱ��� daily', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ updatedAt: 1, peers: {}, daily: { m1: { '2026-09-10': { sessions: 1, messages: 2, at: 123 } } } }), 'utf8');
  const s = new UsagePeersStore({ file, logger: { warn() {}, info() {} } });
  const days = s.listDaily('m1');
  assert.equal(days['2026-09-10'].messages, 2);
  assert.equal(days['2026-09-10'].sessions, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).daily, undefined);
  s.close();
});
