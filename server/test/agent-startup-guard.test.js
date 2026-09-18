import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentStartupGuard } from '../agent-startup-guard.js';

// 手动时钟 harness：schedule 只登记任务，测试里手动 fire
function harness({ sessions = new Map() } = {}) {
  const tasks = [];
  const cleared = [];
  let seq = 0;
  const schedule = (fn, delay) => {
    const id = ++seq;
    tasks.push({ id, fn, delay });
    return id;
  };
  const clear = (id) => {
    cleared.push(id);
    const i = tasks.findIndex((t) => t.id === id);
    if (i >= 0) tasks.splice(i, 1);
  };
  const writes = [];
  const sessionManager = {
    get: (id) => sessions.get(id) || null,
    write: (id, data) => { writes.push([id, data]); return true; },
  };
  const guard = createAgentStartupGuard({ sessionManager, schedule, clear });
  return { guard, tasks, writes, cleared, sessions };
}

test('agent 会话到点各盲发一次 ESC', () => {
  const sessions = new Map([['s1', { id: 's1', kind: 'agent', alive: true }]]);
  const { guard, tasks, writes } = harness({ sessions });
  guard.arm(sessions.get('s1'));
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks.map((t) => t.delay), [3000, 4500]);
  for (const t of [...tasks]) t.fn();
  assert.deepEqual(writes, [['s1', '\x1b'], ['s1', '\x1b']]);
});

test('shell / workflow 会话不 arm', () => {
  const { guard, tasks } = harness();
  guard.arm({ id: 's1', kind: 'shell', alive: true });
  guard.arm({ id: 's2', kind: 'workflow', alive: true });
  assert.equal(tasks.length, 0);
});

test('会话不存在或已退出时到点跳过', () => {
  const sessions = new Map([['s1', { id: 's1', kind: 'agent', alive: false }]]);
  const { guard, tasks, writes } = harness({ sessions });
  guard.arm({ id: 's1', kind: 'agent', alive: true });
  guard.arm({ id: 's2', kind: 'agent', alive: true });   // 该会话不在 manager 里
  for (const t of [...tasks]) t.fn();
  assert.equal(writes.length, 0);
});

test('disarm 后到点不再写', () => {
  const sessions = new Map([['s1', { id: 's1', kind: 'agent', alive: true }]]);
  const { guard, tasks, writes, cleared } = harness({ sessions });
  guard.arm(sessions.get('s1'));
  guard.disarm('s1');
  assert.ok(cleared.length >= 2);
  for (const t of [...tasks]) t.fn();   // clear 后 tasks 已空
  assert.equal(writes.length, 0);
});

test('同一 id 重复 arm 只保留最新一批定时器', () => {
  const sessions = new Map([['s1', { id: 's1', kind: 'agent', alive: true }]]);
  const { guard, tasks } = harness({ sessions });
  guard.arm(sessions.get('s1'));
  guard.arm(sessions.get('s1'));
  assert.equal(tasks.length, 2);
});
