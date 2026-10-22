import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '../session-manager.js';
import { WorkflowRunner } from '../workflow-runner.js';
import { createWorkflowExecutor } from '../scheduler/workflow-executor.js';
import { makeFakePtyFactory } from './helpers/fake-pty.js';

const WFS = [{ id: 'dev', label: 'DEV', stages: [{ id: 's1', label: 'S1', group: '', prompts: ['p-1'] }] }];

async function harness({ agent = { id: 'opencode', name: 'OpenCode', cmd: 'opencode' } } = {}) {
  const instances = [];
  const created = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const realCreate = sm.create.bind(sm);
  sm.create = async (opts) => { created.push(opts); return realCreate(opts); };
  const runner = new WorkflowRunner({ sessionManager: sm, getWorkflows: () => WFS, doneMarker: (token) => `DONE>${token}` });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfexec-'));
  const executor = createWorkflowExecutor({
    sessionManager: sm,
    workflowRunner: runner,
    resolveAgent: (id) => (agent && id === agent.id ? agent : null),
    logger: console,
  });
  return { sm, instances, created, runner, executor, dir };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('start：新建 agent 会话并启动整条工作流，成功回写 success', async () => {
  const { instances, created, executor, dir } = await harness();
  const logFile = path.join(dir, 't', 'r.log');
  const statuses = [];
  const task = { id: 't1', name: '夜间', projectId: null, cwd: process.cwd(), workflow: { workflowId: 'dev', agentId: 'opencode' } };
  const handle = executor.start({ task, runId: 'r1', logFile, runContextPath: 'C:/ctx.json', onStatus: (s) => statuses.push(s) });
  await tick();
  assert.equal(handle.error, undefined);
  assert.equal(created.length, 1);
  assert.equal(created[0].kind, 'agent');
  assert.equal(created[0].agentId, 'opencode');
  assert.equal(created[0].agentCmd, 'opencode');
  assert.equal(created[0].env.DEVFLOW_RUN_CONTEXT, 'C:/ctx.json');
  assert.ok(handle.sessionId);
  assert.equal(instances[0].pty.writes.length, 1);
  instances[0].pty.__emitData(`DONE>DF_DONE:${handle.runId}:0`);
  await tick();
  assert.ok(statuses.some((s) => s.status === 'success' && s.sessionId === handle.sessionId));
  assert.match(fs.readFileSync(logFile, 'utf8'), /session/);
});

test('start：agent 不存在 → failed agent-not-found，不建会话', async () => {
  const { created, executor, dir } = await harness();
  const task = { id: 't2', name: 'x', workflow: { workflowId: 'dev', agentId: 'ghost' } };
  const statuses = [];
  const r = executor.start({ task, runId: 'r2', logFile: path.join(dir, 'r2.log'), onStatus: (s) => statuses.push(s) });
  assert.equal(r.error, 'agent-not-found');
  assert.equal(created.length, 0);
  await tick();
  assert.equal(statuses[0].status, 'failed');
});

test('start：工作流不存在 → failed workflow-not-found', async () => {
  const { created, executor, dir } = await harness();
  const task = { id: 't3', name: 'x', workflow: { workflowId: 'ghost', agentId: 'opencode' } };
  const statuses = [];
  const r = executor.start({ task, runId: 'r3', logFile: path.join(dir, 'r3.log'), onStatus: (s) => statuses.push(s) });
  await tick();
  assert.equal(created.length, 1);
  assert.ok(statuses.some((s) => s.status === 'failed' && s.error === 'workflow-not-found'));
  assert.equal(typeof r.abort, 'function');
});

test('abort：中止工作流 run', async () => {
  const { executor, dir } = await harness();
  const task = { id: 't4', name: 'x', workflow: { workflowId: 'dev', agentId: 'opencode' } };
  const handle = executor.start({ task, runId: 'r4', logFile: path.join(dir, 'r4.log'), onStatus: () => {} });
  await tick();
  assert.equal(handle.abort(), undefined);
});
