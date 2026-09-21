import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../session-manager.js';
import { WorkflowRunner } from '../workflow-runner.js';
import { startTestServer } from './helpers/test-server.js';
import { makeFakePtyFactory } from './helpers/fake-pty.js';
import { C2S, S2C } from '@devflow/shared';

const WFS = [{ id: 'w', name: 'W', steps: [
  { id: 'a', advance: 'auto', cmd: 'npm run build' },
  { id: 'm', advance: 'manual', cmd: 'pm2 restart app' },
] }];

async function harness() {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({ name: 'S' });
  const runner = new WorkflowRunner({ sessionManager: sm, workflows: WFS });
  const t = await startTestServer({ sessionManager: sm, workflowRunner: runner });
  return { sm, session, runner, t, instances };
}

test('端到端: 面板看到自动步推进到 manual 并收到 wf 消息', async (t) => {
  const { session, t: ts, instances } = await harness();
  const c = await ts.connect();
  t.after(() => ts.stop());
  c.send(C2S.WF_LIST, {});
  const list = await c.wait((m) => m.type === S2C.WF_LIST_RESULT);
  assert.equal(list.workflows.length, 1);

  c.send(C2S.WF_RUN, { workflowId: 'w', sessionId: session.id });
  const started = await c.wait((m) => m.type === S2C.WF_STARTED);
  assert.equal(started.run.steps[0].status, 'running');

  const marker = `\x1b]777;dfdone;${started.run.runId}_0\x07`;
  instances[0].pty.__emitData(marker);
  const paused = await c.wait((m) => m.type === S2C.WF_STATUS && m.run.status === 'paused');
  assert.equal(paused.run.steps[1].status, 'manual');

  c.send(C2S.WF_NEXT, { runId: started.run.runId });
  const done = await c.wait((m) => m.type === S2C.WF_FINISHED && m.status === 'done');
  assert.equal(done.runId, started.run.runId);

  c.send(C2S.WF_ABORT, { runId: started.run.runId });
  const err = await c.wait((m) => m.type === S2C.ERROR);
  assert.equal(err.code, 'not-found');
  c.close();
});

test('同一会话重复 run 返回 busy', async (t) => {
  const { session, t: ts } = await harness();
  const c = await ts.connect();
  t.after(() => ts.stop());
  c.send(C2S.WF_RUN, { workflowId: 'w', sessionId: session.id });
  await c.wait((m) => m.type === S2C.WF_STARTED);
  c.send(C2S.WF_RUN, { workflowId: 'w', sessionId: session.id });
  const err = await c.wait((m) => m.type === S2C.ERROR);
  assert.equal(err.code, 'busy');
  c.close();
});

const GWFS = [{ id: 'gw', label: 'GW', stages: [
  { id: 'a', label: 'A', group: 'G1', prompts: ['p-a0', 'p-a1'] },
  { id: 'b', label: 'B', group: 'G1', prompts: ['p-b0'] },
] }];

async function groupHarness() {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({ name: 'G' });
  const runner = new WorkflowRunner({
    sessionManager: sm, getWorkflows: () => GWFS, doneMarker: (token) => `DONE>${token}`,
  });
  const t = await startTestServer({ sessionManager: sm, workflowRunner: runner });
  return { sm, session, runner, t, instances };
}

test('端到端: groupAnchor 启动分组并收到 wf-started/status', async (t) => {
  const { session, t: ts, instances } = await groupHarness();
  const c = await ts.connect();
  t.after(() => ts.stop());
  c.send(C2S.WF_RUN, { workflowId: 'gw', groupAnchor: 'a', sessionId: session.id });
  const started = await c.wait((m) => m.type === S2C.WF_STARTED);
  assert.equal(started.run.groupName, 'G1');
  assert.deepEqual(started.run.steps.map((s) => s.id), ['a#0', 'a#1', 'b#0']);

  instances[0].pty.__emitData(`DF_DONE:${started.run.runId}:0`);
  await c.wait((m) => m.type === S2C.WF_STATUS && m.run.steps[0].status === 'done');

  c.send(C2S.WF_ROLLBACK, { runId: started.run.runId, stepId: 'a#1' });
  const rb = await c.wait((m) => m.type === S2C.WF_STATUS && m.run.steps[1].status === 'running');
  assert.equal(rb.run.steps[0].status, 'done');

  c.send(C2S.WF_ROLLBACK, { runId: started.run.runId, stepId: 'nope#0' });
  const err = await c.wait((m) => m.type === S2C.ERROR);
  assert.equal(err.code, 'not-found');
  c.close();
});
