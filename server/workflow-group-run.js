import crypto from 'node:crypto';
import { buildMarkerCmd } from './pty-runner.js';

const newRunId = () => 'grp_' + crypto.randomBytes(4).toString('hex');

// 分组运行：组内自动串行，组末暂停（暂停边界）。
// status: running | paused | failed | aborted
export class GroupRun {
  constructor(runner, workflow, group, steps, session, finalStatus = 'paused') {
    this.runner = runner;
    this.runId = newRunId();
    this.workflowId = workflow.id;
    this.workflowName = workflow.label;
    this.groupName = group;
    this.sessionId = session.id;
    this.status = 'running';
    this.currentIndex = 0;
    this.errorMessage = null;
    this.steps = steps;
    this._tail = '';
    this._timer = null;
    this.finalStatus = finalStatus;
  }
  snapshot() {
    return {
      runId: this.runId, workflowId: this.workflowId, workflowName: this.workflowName,
      groupName: this.groupName, sessionId: this.sessionId, status: this.status,
      currentIndex: this.currentIndex, steps: this.steps, errorMessage: this.errorMessage,
    };
  }
  _emit() { this.runner._emit(this); }
  _current() { return this.steps[this.currentIndex] || null; }
  _marker(i) { return `\x1b]777;dfdone;${this.runId}_${i}\x07`; }
  _token(i) { return `DF_DONE:${this.runId}:${i}`; }

  _beginStep(i) {
    const step = this.steps[i];
    if (!step) { this._finishGroup(); return; }
    step.status = 'running';
    step.startedAt = Date.now();
    this.status = 'running';
    const session = this.runner.sm.get(this.sessionId);
    if (!session || !session.alive) { this._fail('session exited'); return; }
    let line = step.text;
    if (step.type === 'cmd') line = buildMarkerCmd(step.text, this.runId, i, session.pty.shell);
    else line = `${step.text}\n\n${this.runner.doneMarker(this._token(i))}`;
    const ok = this.runner.sm.write(this.sessionId, line + '\r');
    if (!ok) { this._fail('write failed'); return; }
    this._armTimeout();
    this._emit();
  }
  _armTimeout() {
    this._clearTimeout();
    this._timer = setTimeout(() => this._fail('step timeout'), this.runner.stepTimeoutMs);
    this._timer.unref?.();
  }
  _clearTimeout() { if (this._timer) { clearTimeout(this._timer); this._timer = null; } }
  _succeedStep(i) {
    const step = this.steps[i];
    step.status = 'done';
    step.finishedAt = Date.now();
    this._clearTimeout();
    this._tail = '';
    this.currentIndex += 1;
    if (step.advance === 'manual') { this.status = 'paused'; this._emit(); return; }
    if (this.currentIndex < this.steps.length) this._beginStep(this.currentIndex);
    else this._finishGroup();
  }
  _finishGroup() {
    this._clearTimeout();
    this.status = this.finalStatus;
    this._emit();
  }
  _fail(msg) {
    this._clearTimeout();
    this.errorMessage = msg;
    this.status = 'failed';
    const step = this._current();
    if (step && step.status !== 'done') step.status = 'error';
    this._emit();
  }
  onData(session, chunk) {
    if (session.id !== this.sessionId) return;
    if (this.status !== 'running') return;
    const step = this._current();
    if (!step) return;
    this._tail = (this._tail + chunk).slice(-256);
    const needle = step.type === 'cmd' ? this._marker(this.currentIndex) : this._token(this.currentIndex);
    if (this._tail.includes(needle)) this._succeedStep(this.currentIndex);
  }
  rollback(stepId) {
    const idx = this.steps.findIndex((s) => s.id === stepId);
    if (idx < 0) return false;
    this._clearTimeout();
    for (let i = idx; i < this.steps.length; i += 1) {
      this.steps[i].status = 'waiting';
      this.steps[i].startedAt = null;
      this.steps[i].finishedAt = null;
    }
    this.errorMessage = null;
    this.currentIndex = idx;
    this._beginStep(idx);
    return true;
  }
  advance() {
    const cur = this._current();
    if (cur && cur.status === 'waiting') { this._beginStep(this.currentIndex); return; }
    if (cur) { this._succeedStep(this.currentIndex); return; }
    this._finishGroup();
  }
  abort() {
    this._clearTimeout();
    const step = this._current();
    if (step && step.status !== 'done') step.status = 'error';
    this.status = 'aborted';
    this.errorMessage = this.errorMessage || 'aborted by user';
    this._emit();
  }
}
