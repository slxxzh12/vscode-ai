import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../session-manager.js';
import { makeFakePtyFactory } from './helpers/fake-pty.js';
import { restoreSessions, restoreRecord } from '../session-restore.js';

function makeLedger(sessions, logs = {}) {
  return { read: () => ({ sessions }), readLog: (id) => logs[id] ?? null };
}
// 老用例用的是极小的合成时间戳；用真实 now 作为基准，避免被「久远会话不恢复」的年龄过滤误伤
const NOW = Date.now();
function rec(id, extra = {}) {
  return { id, name: `name-${id}`, projectId: 'p1', cwd: process.cwd(), kind: 'agent',
    agentId: 'opencode', agentCmd: 'opencode', agentSessionId: 'ses_1',
    cols: 80, rows: 24, createdAt: NOW - 2000, updatedAt: NOW - 1000, state: 'running', ...extra };
}

test('恢复：复用 id/cwd/name、预填回滚、agent 注入续会话命令', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const ledger = makeLedger([rec('s_a', { createdAt: 100 }), rec('s_b', { createdAt: 200, agentSessionId: null })], { s_a: 'history-a\n' });
  const res = await restoreSessions({ ledger, sessionManager: sm, agents: [{ id: 'opencode', name: 'OpenCode', cmd: 'opencode' }], resumeDelayMs: 0 });
  assert.equal(res.restored, 2);
  assert.equal(sm.get('s_a').cwd, process.cwd());
  assert.equal(sm.get('s_a').name, 'name-s_a');
  assert.equal(sm.get('s_a').ring.content, 'history-a\n');
  assert.equal(sm.summary(sm.get('s_a')).restored, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(instances[0].pty.writes.includes('opencode --session ses_1\r'), true);   // s_a 续接
  assert.equal(instances[1].pty.writes.includes('opencode\r'), true);                   // s_b 无 id：退化重开 agent
});

test('恢复：默认最多自动恢复 8 个（按 updatedAt 取最新），其余标记 exited', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const sessions = Array.from({ length: 10 }, (_, i) => rec(`s_${i + 1}`, { updatedAt: NOW + (i + 1) * 100 }));
  const updates = [];
  const ledger = { read: () => ({ sessions }), readLog: () => null, upsert: (e) => updates.push(e) };
  const res = await restoreSessions({ ledger, sessionManager: sm, agents: [], resumeDelayMs: 0, exists: () => true });
  assert.equal(res.restored, 8);
  assert.deepEqual(res.deferred.sort(), ['s_1', 's_2']);
  for (let i = 3; i <= 10; i++) assert.notEqual(sm.get(`s_${i}`), null);
  assert.equal(sm.get('s_2'), null);
  assert.equal(sm.get('s_1'), null);
  assert.deepEqual(updates.map((u) => u.id).sort(), ['s_1', 's_2']);
  assert.ok(updates.every((u) => u.state === 'exited'));
});

test('恢复：maxRestore 可覆盖默认上限', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const ledger = makeLedger([rec('s_a'), rec('s_b'), rec('s_c'), rec('s_d')]);
  const res = await restoreSessions({ ledger, sessionManager: sm, agents: [], resumeDelayMs: 0, maxRestore: 2 });
  assert.equal(res.restored, 2);
  assert.equal(res.deferred.length, 2);
});

test('恢复：workflow 会话跳过；cwd 缺失跳过且不抛', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const ledger = makeLedger([
    rec('s_wf', { kind: 'workflow' }),
    rec('s_gone', { cwd: 'C:\\no-such-dir' }),
  ]);
  const res = await restoreSessions({ ledger, sessionManager: sm, agents: [], resumeDelayMs: 0, exists: (p) => p !== 'C:\\no-such-dir' });
  assert.equal(res.restored, 0);
  assert.deepEqual(res.skipped.map((x) => x.reason), ['cwd-missing']);
  assert.equal(sm.list().length, 0);
});

test('恢复：单条失败不阻断其它', async () => {
  const instances = [];
  let n = 0;
  const sm = new SessionManager({ ptyFactory: async () => { if (n++ === 0) throw new Error('boom'); return makeFakePtyFactory(instances)({ cwd: process.cwd() }); } });
  const ledger = makeLedger([rec('s_1'), rec('s_2')]);
  const res = await restoreSessions({ ledger, sessionManager: sm, agents: [], resumeDelayMs: 0, exists: () => true });
  assert.equal(res.restored, 1);
  assert.deepEqual(res.skipped, [{ id: 's_1', reason: 'boom' }]);
});

test('恢复：state=exited 的记录跳过（关闭的会话不随启动自动拉起）', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const ledger = makeLedger([rec('s_live'), rec('s_closed', { state: 'exited' })]);
  const res = await restoreSessions({ ledger, sessionManager: sm, agents: [], resumeDelayMs: 0 });
  assert.equal(res.restored, 1);
  assert.equal(sm.list().length, 1);
  assert.equal(sm.get('s_live') !== null, true);
  assert.equal(sm.get('s_closed'), null);
});

test('restoreRecord：可续会话注入续命令且 resumed=true', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const ledger = makeLedger([rec('s_a')]);
  const out = await restoreRecord({ ledger, sessionManager: sm, agents: [{ id: 'opencode', cmd: 'opencode' }], rec: rec('s_a'), resumeDelayMs: 0 });
  assert.equal(out.resumed, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(instances[0].pty.writes.includes('opencode --session ses_1\r'), true);
});

test('restoreRecord：agentSessionId 被占用时退化为原命令且 resumed=false', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const ledger = makeLedger([rec('s_a')]);
  const out = await restoreRecord({
    ledger, sessionManager: sm, agents: [{ id: 'opencode', cmd: 'opencode' }],
    rec: rec('s_a'), resumeDelayMs: 0, isAgentSessionIdTaken: () => true,
  });
  assert.equal(out.resumed, false);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(instances[0].pty.writes.includes('opencode\r'), true);
});

test('restoreRecord：无 agentSessionId 时现场 discover 并续接 + 回写账本', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const upserts = [];
  const ledger = {
    read: () => ({ sessions: [rec('s_a', { agentSessionId: null })] }),
    readLog: () => null,
    upsert: (e) => upserts.push(e),
  };
  const out = await restoreRecord({
    ledger, sessionManager: sm, agents: [{ id: 'opencode', cmd: 'opencode' }],
    rec: rec('s_a', { agentSessionId: null }), resumeDelayMs: 0,
    discover: async () => 'ses_found',
  });
  assert.equal(out.resumed, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(instances[0].pty.writes.includes('opencode --session ses_found\r'), true);
  assert.equal(upserts.some((u) => u.id === 's_a' && u.agentSessionId === 'ses_found'), true);
});

test('restoreRecord：discover 找不到时退化为原命令', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const ledger = makeLedger([rec('s_a', { agentSessionId: null })]);
  const out = await restoreRecord({
    ledger, sessionManager: sm, agents: [{ id: 'opencode', cmd: 'opencode' }],
    rec: rec('s_a', { agentSessionId: null }), resumeDelayMs: 0,
    discover: async () => null,
  });
  assert.equal(out.resumed, false);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(instances[0].pty.writes.includes('opencode\r'), true);
});

test('restoreSessions：把 discover 透传给缺 id 的 agent 记录', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const ledger = makeLedger([rec('s_x', { agentSessionId: null })]);
  const res = await restoreSessions({
    ledger, sessionManager: sm, agents: [{ id: 'opencode', cmd: 'opencode' }],
    resumeDelayMs: 0, discover: async () => 'ses_z',
  });
  assert.equal(res.restored, 1);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(instances[0].pty.writes.includes('opencode --session ses_z\r'), true);
});

test('恢复：按会话日志 mtime 判断最近活跃（账本 updatedAt 过期时也能按活跃度取 3 个）', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const now = 10_000_000;
  // 账本 updatedAt：s_newer_created_idle 最“新”，但日志显示它早已不用；s_recent_used 账本时间很旧但刚刚用过
  const sessions = [
    rec('s_recent_used', { updatedAt: 100, createdAt: 100 }),
    rec('s_newer_created_idle', { updatedAt: 900, createdAt: 900 }),
    rec('s_second', { updatedAt: 200, createdAt: 200 }),
    rec('s_third', { updatedAt: 300, createdAt: 300 }),
  ];
  const mtimes = {
    s_recent_used: now - 1000,
    s_newer_created_idle: now - 500_000,
    s_second: now - 2000,
    s_third: now - 3000,
  };
  const ledger = { read: () => ({ sessions }), readLog: () => null, logMtime: (id) => mtimes[id] || 0, upsert: () => {} };
  const res = await restoreSessions({
    ledger, sessionManager: sm, agents: [], resumeDelayMs: 0, exists: () => true,
    now: () => now, maxAgeMs: Infinity, maxRestore: 3,
  });
  assert.equal(res.restored, 3);
  assert.notEqual(sm.get('s_recent_used'), null);
  assert.notEqual(sm.get('s_second'), null);
  assert.notEqual(sm.get('s_third'), null);
  assert.equal(sm.get('s_newer_created_idle'), null);
  // 恢复出来的会话保留“上次活跃时间”，供前端选最近活跃的那个
  assert.equal(sm.summary(sm.get('s_recent_used')).lastActiveAt, now - 1000);
});

test('恢复：久远会话超过 maxAgeMs 不自动恢复，并标记 exited', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const now = 10_000_000;
  const sessions = [
    rec('s_ancient', { updatedAt: now - 10_000, createdAt: now - 10_000 }),
    rec('s_fresh', { updatedAt: now - 1000, createdAt: now - 1000 }),
  ];
  const updates = [];
  const ledger = { read: () => ({ sessions }), readLog: () => null, logMtime: () => 0, upsert: (e) => updates.push(e) };
  const res = await restoreSessions({
    ledger, sessionManager: sm, agents: [], resumeDelayMs: 0, exists: () => true,
    now: () => now, maxAgeMs: 5000,
  });
  assert.equal(res.restored, 1);
  assert.notEqual(sm.get('s_fresh'), null);
  assert.equal(sm.get('s_ancient'), null);
  assert.ok(updates.some((u) => u.id === 's_ancient' && u.state === 'exited'));
});
