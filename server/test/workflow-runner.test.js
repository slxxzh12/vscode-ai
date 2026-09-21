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
