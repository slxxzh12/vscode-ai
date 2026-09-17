import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeLedger, createSessionLedger, MAX_SESSIONS, MAX_LOG_BYTES,
} from '../session-ledger.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-ledger-')); }
const entry = (id, extra = {}) => ({
  id, name: 'N', projectId: 'p1', cwd: 'C:\\proj', kind: 'agent',
  agentId: 'opencode', agentCmd: 'opencode', cols: 80, rows: 24,
  createdAt: 1000, updatedAt: 1000, ...extra,
});

test('normalizeLedger 丢弃非法项并按 updatedAt 降序、上限截断', () => {
  const out = normalizeLedger({ sessions: [
    entry('s1', { updatedAt: 1 }), null, { id: '' }, { id: 's2', cwd: '' },
    entry('s3', { updatedAt: 3 }), entry('s4', { updatedAt: 2 }),
  ] });
  assert.deepEqual(out.sessions.map((s) => s.id), ['s3', 's4', 's1']);
  assert.equal(normalizeLedger({ sessions: 'nope' }).sessions.length, 0);
});

test('normalizeLedger 强制 kind 白名单与数值兜底（workflow 保留，未知归 shell）', () => {
  const out = normalizeLedger({ sessions: [
    entry('s1', { kind: 'workflow', cols: 0, rows: -2 }),
    entry('s2', { kind: 'bogus' }),
  ] });
  assert.equal(out.sessions.find((s) => s.id === 's1').kind, 'workflow');
  assert.equal(out.sessions.find((s) => s.id === 's1').cols, 80);
  assert.equal(out.sessions.find((s) => s.id === 's1').rows, 24);
  assert.equal(out.sessions.find((s) => s.id === 's2').kind, 'shell');
});

test('normalizeLedger 上限 MAX_SESSIONS', () => {
  const many = Array.from({ length: MAX_SESSIONS + 5 }, (_, i) => entry(`s${i}`, { updatedAt: i }));
  assert.equal(normalizeLedger({ sessions: many }).sessions.length, MAX_SESSIONS);
});

test('upsert 幂等合并、保留已有 agentSessionId', () => {
  const dir = tmpDir();
  const ledger = createSessionLedger({ file: path.join(dir, 'sessions.json'), logsDir: path.join(dir, 'session-logs') });
  ledger.upsert(entry('s1'));
  ledger.upsert({ ...entry('s1'), agentSessionId: 'ses_x' });
  ledger.upsert({ ...entry('s1'), name: 'renamed' });     // 不含 agentSessionId
  const got = ledger.read().sessions.find((s) => s.id === 's1');
  assert.equal(got.name, 'renamed');
  assert.equal(got.agentSessionId, 'ses_x');
});

test('appendLog 截头留尾，readLog 可回读内存缓冲', () => {
  const dir = tmpDir();
  const ledger = createSessionLedger({ file: path.join(dir, 'sessions.json'), logsDir: path.join(dir, 'session-logs') });
  ledger.appendLog('s1', 'a'.repeat(MAX_LOG_BYTES));
  ledger.appendLog('s1', 'TAIL');
  const content = ledger.readLog('s1');
  assert.equal(content.length, MAX_LOG_BYTES);
  assert.equal(content.endsWith('TAIL'), true);
});

test('flushLog 落盘、flushAll 批量、readLog 从盘回读', () => {
  const dir = tmpDir();
  const ledger = createSessionLedger({ file: path.join(dir, 'sessions.json'), logsDir: path.join(dir, 'session-logs') });
  ledger.appendLog('s1', 'hello\n');
  ledger.flushLog('s1');
  const file = path.join(dir, 'session-logs', 's1.log');
  assert.equal(fs.readFileSync(file, 'utf8'), 'hello\n');
  const fresh = createSessionLedger({ file: path.join(dir, 'sessions.json'), logsDir: path.join(dir, 'session-logs') });
  assert.equal(fresh.readLog('s1'), 'hello\n');
});

test('remove 删记录与回滚文件', () => {
  const dir = tmpDir();
  const ledger = createSessionLedger({ file: path.join(dir, 'sessions.json'), logsDir: path.join(dir, 'session-logs') });
  ledger.upsert(entry('s1'));
  ledger.appendLog('s1', 'x');
  ledger.flushLog('s1');
  ledger.remove('s1');
  assert.equal(ledger.read().sessions.length, 0);
  assert.equal(fs.existsSync(path.join(dir, 'session-logs', 's1.log')), false);
  assert.equal(ledger.readLog('s1'), null);
});

test('文件损坏回退空账本', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'sessions.json');
  fs.writeFileSync(file, '{ not json', 'utf8');
  const ledger = createSessionLedger({ file, logsDir: path.join(dir, 'session-logs') });
  assert.deepEqual(ledger.read(), { sessions: [] });
});
