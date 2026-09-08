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
