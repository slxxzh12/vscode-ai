import crypto from 'node:crypto';
import { buildMarkerCmd } from './pty-runner.js';
import { expandGroupSteps, expandAllSteps } from '@devflow/shared/workflow-group';
import { GroupRun } from './workflow-group-run.js';

const runId = () => 'run_' + crypto.randomBytes(4).toString('hex');

class Run {
  constructor(runner, workflow, session) {
    this.runner = runner;
    this.runId = runId();
    this.workflow = workflow;
    this.sessionId = session.id;
    this.status = 'running';
    this.currentIndex = 0;
    this.errorMessage = null;
    this.steps = workflow.steps.map((s) => ({ ...s, status: 'waiting', startedAt: null, finishedAt: null }));
    this._tail = '';
  }
  snapshot() {
    return { runId: this.runId, workflowId: this.workflow.id, workflowName: this.workflow.name,
      sessionId: this.sessionId, status: this.status, currentIndex: this.currentIndex,
      steps: this.steps, errorMessage: this.errorMessage };
  }
  _emit() { this.runner._emit(this); }
  _current() { return this.steps[this.currentIndex]; }
  _marker(i) { return `\x1b]777;dfdone;${this.runId}_${i}\x07`; }
  _beginStep(i) {
    const step = this.steps[i];
    step.status = 'running';
    step.startedAt = Date.now();
    this.status = 'running';
    const session = this.runner.sm.get(this.sessionId);
    if (!session || !session.alive) { this._fail('session exited'); return; }
    let line = step.cmd;
    if (step.advance === 'auto') line = buildMarkerCmd(step.cmd, this.runId, i, session.pty.shell);
    const ok = this.runner.sm.write(this.sessionId, line + '\r');
    if (!ok) { this._fail('write failed'); return; }
    this._emit();
  }
  _fail(msg) {
    this.errorMessage = msg;
    this.status = 'aborted';
    const step = this._current();
    if (step && step.status !== 'done') step.status = 'error';
    this._emit();
  }
  _finish() {
    this.status = 'done';
    this._emit();
  }
  onData(session, chunk) {
    if (session.id !== this.sessionId) return;
    if (this.status !== 'running') return;
    const step = this._current();
    if (!step || step.advance !== 'auto') return;
    this._tail = (this._tail + chunk).slice(-96);
    if (this._tail.includes(this._marker(this.currentIndex))) {
      step.status = 'done';
      step.finishedAt = Date.now();
      this._tail = '';
      this.currentIndex += 1;
      if (this.currentIndex < this.steps.length) {
        if (this.steps[this.currentIndex].advance === 'manual') this._beginManual();
        else this._beginStep(this.currentIndex);
      } else {
        this._finish();
      }
    }
  }
  _beginManual() {
    const step = this._current();
    step.status = 'manual';
    step.startedAt = Date.now();
    this.status = 'paused';
    const session = this.runner.sm.get(this.sessionId);
    if (session && session.alive) this.runner.sm.write(this.sessionId, step.cmd + '\r');
    this._emit();
  }
  advance() {
    const step = this._current();
    if (!step) return;
    step.status = 'done';
    step.finishedAt = Date.now();
    this._tail = '';
    this.currentIndex += 1;
    if (this.currentIndex < this.steps.length) {
      if (this.steps[this.currentIndex].advance === 'manual') this._beginManual();
      else this._beginStep(this.currentIndex);
    } else {
      this._finish();
    }
  }
  abort() {
    const step = this._current();
    if (step && step.status !== 'done') step.status = 'error';
    this.status = 'aborted';
    this.errorMessage = this.errorMessage || 'aborted by user';
    this._emit();
  }
}

export class WorkflowRunner {
  constructor({ sessionManager, workflows = [], getWorkflows = null, stepTimeoutMs = 30 * 60 * 1000, doneMarker = null, logger = console }) {
    this.sm = sessionManager;
    this.workflows = workflows;
    this.getWorkflows = getWorkflows;
    this.stepTimeoutMs = stepTimeoutMs;
    // 完成指令里不能出现连续的 token 本身：TUI 会把输入回显到输出流，明文 token 会被自己的回显误命中而抢跑。
    // 因此把 token 拆成三段、用分隔符隔开表述，只有 Agent 真正回答时才出现连续 token（见 _token 的拼法）。
    this.doneMarker = doneMarker || ((token, info = {}) => {
      const runId = info.runId ?? '';
      const index = info.index ?? '';
      return `[DevFlow] When finished, output a single line as the completion marker: drop the quotes on these three parts and join them directly with no characters between them — "DF_DONE:", "${runId}", ":${index}".`;
    });
    this.log = logger;
    this.runs = new Map();
    this._sessionRun = new Map();
    this._conns = new Map();
    this._statusCbs = [];
    this._onData = (session, chunk) => {
      const rid = this._sessionRun.get(session.id);
      if (rid) this.runs.get(rid)?.onData(session, chunk);
    };
    this._onExit = (session) => {
      const rid = this._sessionRun.get(session.id);
      if (rid) this.runs.get(rid)?._fail('session exited');
    };
    this._onRemoved = (sessionId) => {
      const rid = this._sessionRun.get(sessionId);
      if (rid) this.runs.get(rid)?._fail('session removed');
    };
    this.sm.on('data', this._onData);
    this.sm.on('exit', this._onExit);
    this.sm.on('removed', this._onRemoved);
  }
  list() {
    return this.workflows.map((w) => ({ id: w.id, name: w.name, steps: w.steps }));
  }
  get(runId) { return this.runs.get(runId) || null; }
  start(workflowId, sessionId) {
    const wf = this.workflows.find((w) => w.id === workflowId);
    if (!wf) return { ok: false, code: 'not-found', message: 'workflow not found' };
    const session = this.sm.get(sessionId);
    if (!session) return { ok: false, code: 'not-found', message: 'session not found' };
    if (session.state !== 'running') return { ok: false, code: 'session-not-running', message: 'session not running' };
    if (this._sessionRun.has(sessionId)) return { ok: false, code: 'busy', message: 'session busy with another workflow' };
    const run = new Run(this, wf, session);
    this.runs.set(run.runId, run);
    this._sessionRun.set(sessionId, run.runId);
    const first = run.steps[0];
    if (first.advance === 'manual') run._beginManual();
    else run._beginStep(0);
    return { ok: true, run };
  }
  startGroup({ workflowId, groupAnchor, sessionId }) {
    const wfs = this.getWorkflows ? this.getWorkflows(sessionId) : [];
    const wf = wfs.find((w) => w.id === workflowId);
    if (!wf) return { ok: false, code: 'not-found', message: 'workflow not found' };
    const expanded = expandGroupSteps(wf.stages || [], groupAnchor);
    if (!expanded) return { ok: false, code: 'not-found', message: 'group not found' };
    const session = this.sm.get(sessionId);
    if (!session) return { ok: false, code: 'not-found', message: 'session not found' };
    if (session.state !== 'running') return { ok: false, code: 'session-not-running', message: 'session not running' };
    const prevId = this._sessionRun.get(sessionId);
    if (prevId) { const prev = this.runs.get(prevId); if (prev) { try { prev.abort(); } catch { /* noop */ } } }
    const steps = expanded.steps.map((s) => ({ ...s, status: 'waiting', startedAt: null, finishedAt: null }));
    const run = new GroupRun(this, wf, expanded.group, steps, session);
    this.runs.set(run.runId, run);
    this._sessionRun.set(sessionId, run.runId);
    if (steps.length) run._beginStep(0);
    else run._finishGroup();
    return { ok: true, run };
  }
  startAll({ workflowId, sessionId, finalStatus = 'done' }) {
    const wfs = this.getWorkflows ? this.getWorkflows(sessionId) : [];
    const wf = wfs.find((w) => w.id === workflowId);
    if (!wf) return { ok: false, code: 'not-found', message: 'workflow not found' };
    const session = this.sm.get(sessionId);
    if (!session) return { ok: false, code: 'not-found', message: 'session not found' };
    if (session.state !== 'running') return { ok: false, code: 'session-not-running', message: 'session not running' };
    const prevId = this._sessionRun.get(sessionId);
    if (prevId) { const prev = this.runs.get(prevId); if (prev) { try { prev.abort(); } catch { /* noop */ } } }
    const steps = expandAllSteps(wf.stages || []).map((s) => ({ ...s, status: 'waiting', startedAt: null, finishedAt: null }));
    const run = new GroupRun(this, { id: wf.id, label: wf.label || wf.id }, wf.label || wf.id, steps, session, finalStatus);
    this.runs.set(run.runId, run);
    this._sessionRun.set(sessionId, run.runId);
    if (steps.length) run._beginStep(0);
    else run._finishGroup();
    return { ok: true, run };
  }
  rollback(runId, stepId) {
    const run = this.runs.get(runId);
    if (!run || typeof run.rollback !== 'function') return false;
    return run.rollback(stepId);
  }
  _emit(run) {
    for (const cb of this._statusCbs) { try { cb(run); } catch (e) { this.log.error('wf status cb', e); } }
    this._maybeCleanup(run);
  }
  _maybeCleanup(run) {
    if (run.status === 'done' || run.status === 'aborted') {
      this._sessionRun.delete(run.sessionId);
      this._conns.delete(run.runId);
      this.runs.delete(run.runId);
    }
  }
  onStatus(cb) {
    this._statusCbs.push(cb);
    return () => { const i = this._statusCbs.indexOf(cb); if (i >= 0) this._statusCbs.splice(i, 1); };
  }
  attachConn(runId, conn) { this._conns.set(runId, conn); }
  connOf(runId) { return this._conns.get(runId) || null; }
  detachConn(runId) { this._conns.delete(runId); }
  stopAll() {
    for (const run of [...this.runs.values()]) { try { run.abort(); } catch { /* noop */ } }
  }
}
