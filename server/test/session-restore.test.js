import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../session-manager.js';
import { makeFakePtyFactory } from './helpers/fake-pty.js';
import { restoreSessions } from '../session-restore.js';

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
