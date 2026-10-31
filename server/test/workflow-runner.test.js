import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../session-manager.js';
import { WorkflowRunner } from '../workflow-runner.js';
import { makeFakePtyFactory } from './helpers/fake-pty.js';

const WFS = [{
  id: 'w1', name: 'W1', steps: [
    { id: 's1', advance: 'auto', cmd: 'npm run build' },
    { id: 's2', advance: 'auto', cmd: 'echo deploy' },
    { id: 's3', advance: 'manual', cmd: 'pm2 restart app', hint: '确认后下一步' },
  ],
}];

async function makeRunner() {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({ name: 'T' });
  const runner = new WorkflowRunner({ sessionManager: sm, workflows: WFS });
  return { sm, instances, session, runner };
}

test('auto 步注入含 OSC 标记的命令', async () => {
  const { session, runner, instances } = await makeRunner();
  const res = runner.start('w1', session.id);
  assert.equal(res.ok, true);
  const first = instances[0].pty.writes[0];
  assert.ok(first.startsWith('npm run build; printf'));
  assert.ok(first.includes('dfdone;'));
  runner.stopAll();
});

test('auto 标记匹配后自动进入下一条', async () => {
  const { session, runner, instances } = await makeRunner();
  const res = runner.start('w1', session.id);
  const run = res.run;
  assert.equal(run.snapshot().steps[0].status, 'running');
  const marker = `\x1b]777;dfdone;${run.runId}_0\x07`;
  instances[0].pty.__emitData('build ok\n' + marker);
  assert.equal(run.snapshot().steps[0].status, 'done');
  assert.equal(run.snapshot().steps[1].status, 'running');
  assert.equal(instances[0].pty.writes.length, 2);
  runner.stopAll();
});

test('manual 步注入后暂停，advance() 注入下一条', async () => {
  const { session, runner, instances } = await makeRunner();
  const res = runner.start('w1', session.id);
  const run = res.run;
  const m1 = `\x1b]777;dfdone;${run.runId}_0\x07`;
  instances[0].pty.__emitData(m1);
  const m2 = `\x1b]777;dfdone;${run.runId}_1\x07`;
  instances[0].pty.__emitData(m2);
  assert.equal(run.snapshot().status, 'paused');
  assert.equal(run.snapshot().steps[2].status, 'manual');
  const writesBefore = instances[0].pty.writes.length;
  run.advance();
  assert.equal(run.snapshot().steps[2].status, 'done');
  assert.equal(run.snapshot().status, 'done');
  assert.equal(instances[0].pty.writes.length, writesBefore);
  runner.stopAll();
});

test('整个 auto 跑完自动 done', async () => {
  const W = [{ id: 'a', name: 'A', steps: [{ id: 'x', advance: 'auto', cmd: 'ls' }] }];
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({});
  const runner = new WorkflowRunner({ sessionManager: sm, workflows: W });
  const res = runner.start('a', session.id);
  const run = res.run;
  instances[0].pty.__emitData(`\x1b]777;dfdone;${run.runId}_0\x07`);
  assert.equal(run.snapshot().status, 'done');
  runner.stopAll();
});

test('会话不存在返回 not-found', async () => {
  const { runner } = await makeRunner();
  const res = runner.start('w1', 'ghost');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'not-found');
});

test('会话已退出返回 session-not-running', async () => {
  const { session, runner, instances } = await makeRunner();
  instances[0].pty.__emitExit(0);
  const res = runner.start('w1', session.id);
  assert.equal(res.code, 'session-not-running');
});

test('同会话并发运行第二次返回 busy', async () => {
  const { session, runner } = await makeRunner();
  assert.equal(runner.start('w1', session.id).ok, true);
  const res2 = runner.start('w1', session.id);
  assert.equal(res2.code, 'busy');
  runner.stopAll();
});

test('abort 停止并清理', async () => {
  const { session, runner } = await makeRunner();
  const res = runner.start('w1', session.id);
  res.run.abort();
  assert.equal(res.run.snapshot().status, 'aborted');
  assert.equal(runner.get(res.run.runId), null);
});

test('run 期间会话退出 → run 中止为 aborted', async () => {
  const { session, runner, instances } = await makeRunner();
  const res = runner.start('w1', session.id);
  instances[0].pty.__emitExit(130);
  assert.equal(res.run.snapshot().status, 'aborted');
  runner.stopAll();
});

test('标记跨 chunk 分片也能匹配', async () => {
  const { session, runner, instances } = await makeRunner();
  const res = runner.start('w1', session.id);
  const run = res.run;
  const marker = `\x1b]777;dfdone;${run.runId}_0\x07`;
  const a = marker.slice(0, 5);
  const b = marker.slice(5);
  instances[0].pty.__emitData(a);
  assert.equal(run.snapshot().steps[0].status, 'running');
  instances[0].pty.__emitData(b);
  assert.equal(run.snapshot().steps[0].status, 'done');
  runner.stopAll();
});

test('运行中被 kill 会话 → run 中止为 aborted', async () => {
  const { sm, session, runner } = await makeRunner();
  const res = runner.start('w1', session.id);
  assert.equal(res.run.snapshot().status, 'running');
  sm.kill(session.id);
  assert.equal(res.run.snapshot().status, 'aborted');
  assert.equal(res.run.snapshot().errorMessage, 'session removed');
});

test('force advance 可越过卡住的 auto 步', async () => {
  const { session, runner } = await makeRunner();
  const res = runner.start('w1', session.id);
  const run = res.run;
  assert.equal(run.snapshot().steps[0].status, 'running');
  run.advance();                       // 未等到标记，用户强推
  assert.equal(run.snapshot().steps[0].status, 'done');
  assert.equal(run.snapshot().steps[1].status, 'running');
  runner.stopAll();
});

const GWFS = [{
  id: 'gw', label: 'GW', stages: [
    { id: 'a', label: 'A', group: 'G1', prompts: ['p-a0', 'p-a1'] },
    { id: 'b', label: 'B', group: 'G1', prompts: ['p-b0'] },
    { id: 'c', label: 'C', group: 'G2', prompts: ['p-c0'] },
  ],
}];

async function makeGroupRunner({ stepTimeoutMs = 30 * 60 * 1000 } = {}) {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({ name: 'G' });
  const runner = new WorkflowRunner({
    sessionManager: sm,
    getWorkflows: () => GWFS,
    stepTimeoutMs,
    doneMarker: (token) => `DONE>${token}`,
  });
  return { sm, instances, session, runner };
}

test('startGroup 展开分组并把完成指令追加到首个提示词', async () => {
  const { session, runner, instances } = await makeGroupRunner();
  const res = runner.startGroup({ workflowId: 'gw', groupAnchor: 'a', sessionId: session.id });
  assert.equal(res.ok, true);
  const snap = res.run.snapshot();
  assert.equal(snap.groupName, 'G1');
  assert.deepEqual(snap.steps.map((s) => s.id), ['a#0', 'a#1', 'b#0']);
  assert.equal(snap.steps[0].status, 'running');
  assert.equal(instances[0].pty.writes.length, 1);
  const write = instances[0].pty.writes[0];
  assert.ok(write.startsWith('p-a0'));
  assert.ok(write.includes(`DONE>DF_DONE:${res.run.runId}:0`));
  runner.stopAll();
});

test('匹配 token 后组内自动串行，组末 paused 且不清理', async () => {
  const { session, runner, instances } = await makeGroupRunner();
  const res = runner.startGroup({ workflowId: 'gw', groupAnchor: 'a', sessionId: session.id });
  const { runId } = res.run;
  instances[0].pty.__emitData(`DF_DONE:${runId}:0`);
  assert.equal(res.run.snapshot().steps[0].status, 'done');
  assert.equal(res.run.snapshot().steps[1].status, 'running');
  assert.equal(instances[0].pty.writes.length, 2);
  instances[0].pty.__emitData(`DF_DONE:${runId}:1`);
  instances[0].pty.__emitData(`DF_DONE:${runId}:2`);
  assert.equal(res.run.snapshot().status, 'paused');
  assert.ok(res.run.snapshot().steps.every((s) => s.status === 'done'));
  assert.equal(runner.get(runId), res.run);   // paused 不清理，供回退
  runner.stopAll();
});

// 模拟会回显输入的 TUI（opencode）：写入什么就把什么画回输出流。
// 回归：完成指令里若含连续 token，会被自己的回显误命中而抢跑，整组提示词一次灌进去。
function makeEchoPtyFactory(instances) {
  return () => {
    const handlers = { data: [], exit: [] };
    const pty = {
      pid: 1, shell: 'unix', writes: [],
      onData(cb) { handlers.data.push(cb); },
      onExit(cb) { handlers.exit.push(cb); },
      write(s) {
        s = String(s);
        pty.writes.push(s);
        for (const cb of handlers.data.slice()) cb(s);
      },
      resize() {}, kill() {},
      __emitData(c) { for (const cb of handlers.data.slice()) cb(String(c)); },
    };
    instances.push({ pty });
    return pty;
  };
}

test('prompt 步完成指令不含连续 token：TUI 回显不会误判（回归）', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeEchoPtyFactory(instances)() });
  const session = await sm.create({ name: 'E' });
  // 与生产一致的「拆段」指令：三段拼接起来才是 token，发送文本里没有连续 token
  const runner = new WorkflowRunner({
    sessionManager: sm,
    getWorkflows: () => GWFS,
    doneMarker: (token, { runId, index }) => `JOIN "DF_DONE:", "${runId}", ":${index}"`,
  });
  const res = runner.startGroup({ workflowId: 'gw', groupAnchor: 'a', sessionId: session.id });
  const { runId } = res.run;
  const write = instances[0].pty.writes[0];
  assert.ok(!write.includes(`DF_DONE:${runId}:0`));            // 发送文本里没有连续 token
  assert.equal(instances[0].pty.writes.length, 1);             // 回显没有触发抢跑
  assert.equal(res.run.snapshot().steps[0].status, 'running');
  instances[0].pty.__emitData(`DF_DONE:${runId}:0`);           // Agent 真正回答后正常推进
  assert.equal(res.run.snapshot().steps[0].status, 'done');
  assert.equal(instances[0].pty.writes.length, 2);
  runner.stopAll();
});

test('空分组直接 paused 且不写入', async () => {
  const EMPTY = [{ id: 'e', label: 'E', stages: [{ id: 'empty', label: 'X', group: 'G', prompts: [] }] }];
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({});
  const runner = new WorkflowRunner({ sessionManager: sm, getWorkflows: () => EMPTY });
  const res = runner.startGroup({ workflowId: 'e', groupAnchor: 'empty', sessionId: session.id });
  assert.equal(res.ok, true);
  assert.equal(res.run.snapshot().status, 'paused');
  assert.equal(instances[0].pty.writes.length, 0);
  runner.stopAll();
});

test('startGroup 未知分组返回 not-found', async () => {
  const { session, runner } = await makeGroupRunner();
  const res = runner.startGroup({ workflowId: 'gw', groupAnchor: 'ghost', sessionId: session.id });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'not-found');
});

test('超时未完成 → 该步 error、run failed', async () => {
  const { session, runner } = await makeGroupRunner({ stepTimeoutMs: 20 });
  const res = runner.startGroup({ workflowId: 'gw', groupAnchor: 'a', sessionId: session.id });
  await new Promise((r) => setTimeout(r, 50));
  const snap = res.run.snapshot();
  assert.equal(snap.status, 'failed');
  assert.equal(snap.steps[0].status, 'error');
  assert.equal(snap.errorMessage, 'step timeout');
  runner.stopAll();
});

test('会话退出 → run failed 且该步 error', async () => {
  const { session, runner, instances } = await makeGroupRunner();
  const res = runner.startGroup({ workflowId: 'gw', groupAnchor: 'a', sessionId: session.id });
  instances[0].pty.__emitExit(1);
  assert.equal(res.run.snapshot().status, 'failed');
  assert.equal(res.run.snapshot().steps[0].status, 'error');
  runner.stopAll();
});

test('rollback 重置目标步及之后并从该步重跑', async () => {
  const { session, runner, instances } = await makeGroupRunner();
  const res = runner.startGroup({ workflowId: 'gw', groupAnchor: 'a', sessionId: session.id });
  const { runId } = res.run;
  instances[0].pty.__emitData(`DF_DONE:${runId}:0`);
  instances[0].pty.__emitData(`DF_DONE:${runId}:1`);
  instances[0].pty.__emitData(`DF_DONE:${runId}:2`);
  const writesBefore = instances[0].pty.writes.length;
  const ok = runner.rollback(runId, 'a#1');
  assert.equal(ok, true);
  const snap = res.run.snapshot();
  assert.equal(snap.status, 'running');
  assert.equal(snap.steps[0].status, 'done');       // 回退点之前不受影响
  assert.equal(snap.steps[1].status, 'running');    // 从回退点重跑
  assert.equal(snap.steps[2].status, 'waiting');
  assert.equal(instances[0].pty.writes.length, writesBefore + 1);
  assert.ok(instances[0].pty.writes[writesBefore].startsWith('p-a1'));
  runner.stopAll();
});

test('rollback 未知 stepId 返回 false', async () => {
  const { session, runner } = await makeGroupRunner();
  const res = runner.startGroup({ workflowId: 'gw', groupAnchor: 'a', sessionId: session.id });
  assert.equal(runner.rollback(res.run.runId, 'nope#9'), false);
  runner.stopAll();
});

const ALLWFS = [{
  id: 'all', label: 'ALL', stages: [
    { id: 's1', label: 'S1', group: 'G1', prompts: ['p-1'] },
    { id: 's2', label: 'S2', group: 'G2', prompts: ['p-2', 'p-3'] },
  ],
}];

async function makeAllRunner() {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({ name: 'ALL' });
  const runner = new WorkflowRunner({
    sessionManager: sm,
    getWorkflows: () => ALLWFS,
    doneMarker: (token) => `DONE>${token}`,
  });
  return { sm, instances, session, runner };
}

test('startAll 展开全部 stage 并全自动跑到 done', async () => {
  const { session, runner, instances } = await makeAllRunner();
  const res = runner.startAll({ workflowId: 'all', sessionId: session.id });
  assert.equal(res.ok, true);
  const snap = res.run.snapshot();
  assert.deepEqual(snap.steps.map((s) => s.id), ['s1#0', 's2#0', 's2#1']);
  assert.equal(snap.groupName, 'ALL');
  assert.equal(snap.steps[0].status, 'running');
  const { runId } = res.run;
  instances[0].pty.__emitData(`DONE>DF_DONE:${runId}:0`);
  assert.equal(res.run.snapshot().steps[1].status, 'running');
  instances[0].pty.__emitData(`DONE>DF_DONE:${runId}:1`);
  instances[0].pty.__emitData(`DONE>DF_DONE:${runId}:2`);
  assert.equal(res.run.snapshot().status, 'done');
  assert.ok(res.run.snapshot().steps.every((s) => s.status === 'done'));
  assert.equal(runner.get(runId), null);
  runner.stopAll();
});

test('startAll 未知 workflow / 会话不存在返回 not-found', async () => {
  const { session, runner } = await makeAllRunner();
  assert.equal(runner.startAll({ workflowId: 'ghost', sessionId: session.id }).code, 'not-found');
  assert.equal(runner.startAll({ workflowId: 'all', sessionId: 'ghost' }).code, 'not-found');
  runner.stopAll();
});

test('startAll 遇 advance=manual 步在该步后 paused，advance 续跑到 done', async () => {
  const W = [{ id: 'm', label: 'M', stages: [
    { id: 'x', label: 'X', group: '', advance: 'manual', prompts: ['p-x'] },
    { id: 'y', label: 'Y', group: '', prompts: ['p-y'] },
  ] }];
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({});
  const runner = new WorkflowRunner({ sessionManager: sm, getWorkflows: () => W, doneMarker: (token) => `DONE>${token}` });
  const res = runner.startAll({ workflowId: 'm', sessionId: session.id });
  const { runId } = res.run;
  instances[0].pty.__emitData(`DONE>DF_DONE:${runId}:0`);
  assert.equal(res.run.snapshot().status, 'paused');
  assert.equal(res.run.snapshot().steps[0].status, 'done');
  assert.equal(res.run.snapshot().steps[1].status, 'waiting');
  res.run.advance();
  assert.equal(res.run.snapshot().steps[1].status, 'running');
  instances[0].pty.__emitData(`DONE>DF_DONE:${runId}:1`);
  assert.equal(res.run.snapshot().status, 'done');
  runner.stopAll();
});

test('onStatus 返回退订函数', async () => {
  const { runner } = await makeAllRunner();
  const off = runner.onStatus(() => {});
  assert.equal(typeof off, 'function');
  off();
});
