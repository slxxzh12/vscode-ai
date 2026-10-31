import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../session-manager.js';
import { makeFakePtyFactory } from './helpers/fake-pty.js';
import { restoreSessions, restoreRecord } from '../session-restore.js';

function makeLedger(sessions, logs = {}) {
  return { read: () => ({ sessions }), readLog: (id) => logs[id] ?? null };
}
function rec(id, extra = {}) {
  return { id, name: `name-${id}`, projectId: 'p1', cwd: process.cwd(), kind: 'agent',
    agentId: 'opencode', agentCmd: 'opencode', agentSessionId: 'ses_1',
    cols: 80, rows: 24, createdAt: 111, updatedAt: 222, state: 'running', ...extra };
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
