import crypto from 'node:crypto';
import { computeNextRun } from './schedule.js';
import { buildSpawnSpec, createRunner } from './runner.js';
import { writeRunContext, ensureReport } from './report.js';

const TICK_MS = 1000;
const runIdGen = () => 'r_' + crypto.randomBytes(4).toString('hex');

function timeoutFor(task) {
  const env = Number(process.env.DEVFLOW_SCHED_TIMEOUT_MS);
  if (Number.isFinite(env) && env >= 0) return env;
  return task.type === 'ai' ? 1800000 : 600000;
}

export function createEngine({
  store, runner = createRunner(), logger = console,
  now = () => Date.now(), tickMs = TICK_MS, aiBin = 'opencode',
  opencodeDataDir = null, workflowExecutor = null,
  maxConcurrent = Number(process.env.DEVFLOW_SCHED_MAX_CONCURRENT) || 3,
} = {}) {
  const nextAt = new Map();
  const taskRuns = new Map();
  const activeWorkflow = new Map();   // taskId -> { runId, handle }
  const listeners = new Set();
  let timer = null;
  let projectResolver = () => null;
  let aiPromptLoader = null;

  function emit(evt, payload) { for (const cb of listeners) { try { cb(evt, payload); } catch (e) { logger.error('sched listener', e); } } }
  function onEvent(cb) { listeners.add(cb); return () => listeners.delete(cb); }
  function setProjectResolver(fn) { projectResolver = fn; }
  function setAiPromptLoader(fn) { aiPromptLoader = fn; }

  function scheduleTask(task, from = now()) {
    // 无论启用与否都算出「下次运行时间」，供界面展示；是否真正触发由 tick 按 enabled 判断
    const n = computeNextRun(task.schedule, from);
    if (n == null) nextAt.delete(task.id); else nextAt.set(task.id, n);
    return n;
  }
  function nextRunAtOf(id) { return nextAt.has(id) ? nextAt.get(id) : null; }
  function refreshAll() { for (const t of store.listTasks()) scheduleTask(t); }
  function reschedule(task) { scheduleTask(task); }
  function notifyTasksChanged() { emit('tasks-changed', {}); }

  function reportPatch(info) {
    return info ? { reportFile: info.reportFile, reportDir: info.reportDir, reportCount: info.files.length } : {};
  }

  function finishImmediate(task, trigger, message) {
    const id = runIdGen();
    const logFile = store.logFileFor(task.id, id);
    const run = { id, taskId: task.id, status: 'failed', trigger, startedAt: now(), finishedAt: now(), exitCode: null, durationMs: 0, logFile, error: message };
    store.addRun(run);
    let info = null;
    try {
      writeRunContext({ store, task, run });
      info = ensureReport({ store, task, run, result: { status: 'failed', error: message, exitCode: null, durationMs: 0 } });
    } catch (e) {
      logger.error('scheduler report failed', e);
    }
    const updated = store.updateRun(id, reportPatch(info));
    emit('run-end', { run: { ...(updated || run) } });
    return updated || run;
  }

  function startRun(task, trigger) {
    if (task.type === 'workflow') return startWorkflowRun(task, trigger);
    if (taskRuns.has(task.id)) return { error: 'already-running' };
    if (runner.count() >= maxConcurrent) return { error: 'max-concurrent' };
    const cwd = task.cwd || projectResolver(task.projectId) || process.cwd();
    let aiPrompt = null;
    if (task.type === 'ai') {
      if (task.ai.source === 'command') {
        // 命令可能只定义在 opencode 配置里（没有 command/*.md 源文件），loader 失败不能阻断运行
        try { aiPrompt = aiPromptLoader ? aiPromptLoader(task.ai.commandName) : ''; } catch { aiPrompt = ''; }
      } else {
        aiPrompt = task.ai.prompt || '';
      }
    }
    const id = runIdGen();
    const logFile = store.logFileFor(task.id, id);
    const run = { id, taskId: task.id, status: 'running', trigger, startedAt: now(), finishedAt: null, exitCode: null, durationMs: null, logFile, error: null };
    store.addRun(run);
    let ctx;
    try {
      ctx = writeRunContext({ store, task, run });
    } catch (e) {
      let info = null;
      try {
        info = ensureReport({ store, task, run, result: { status: 'failed', error: String(e && e.message || e), durationMs: 0 } });
      } catch { /* ignore */ }
      const updated = store.updateRun(id, { status: 'failed', finishedAt: now(), durationMs: 0, error: String(e && e.message || e), ...reportPatch(info) });
      emit('run-end', { run: { ...(updated || run) } });
      return { run: { ...(updated || run) } };
    }
    let spec;
    try {
      spec = buildSpawnSpec(task, { cwd, aiPrompt, aiBin, opencodeDataDir, runContextPath: ctx.contextPath, reportPath: ctx.reportPath, reportDir: ctx.reportDir, progressPath: ctx.progressPath });
    } catch (e) {
      let info = null;
      try {
        info = ensureReport({ store, task, run, result: { status: 'failed', error: String(e && e.message || e), durationMs: 0 } });
      } catch { /* ignore */ }
      const updated = store.updateRun(id, { status: 'failed', finishedAt: now(), durationMs: 0, error: String(e && e.message || e), ...reportPatch(info) });
      emit('run-end', { run: { ...(updated || run) } });
      return { run: { ...(updated || run) } };
    }
    taskRuns.set(task.id, id);
    emit('run-start', { run: { ...run } });
    runner.run({ runId: id, spec, logPath: store.logPath(logFile), timeoutMs: timeoutFor(task) })
      .then((res) => {
        const status = res.spawnError ? 'failed' : res.timedOut ? 'timeout' : (res.exitCode === 0 ? 'success' : 'failed');
        complete(task, id, status, res);
      })
      .catch((e) => complete(task, id, 'failed', { exitCode: null, durationMs: 0, error: String(e && e.message || e) }));
    return { run: { ...run } };
  }

  function startWorkflowRun(task, trigger) {
    if (taskRuns.has(task.id)) return { error: 'already-running' };
    if (!workflowExecutor) {
      const run = finishImmediate(task, trigger, 'executor-unavailable');
      return { run: { ...run } };
    }
    if (runner.count() + activeWorkflow.size >= maxConcurrent) return { error: 'max-concurrent' };
    const id = runIdGen();
    const logFile = store.logFileFor(task.id, id);
    const run = { id, taskId: task.id, status: 'running', trigger, startedAt: now(), finishedAt: null, exitCode: null, durationMs: null, logFile, error: null, sessionId: null };
    store.addRun(run);
    let ctx;
    try {
      ctx = writeRunContext({ store, task, run });
    } catch (e) {
      let info = null;
      try { info = ensureReport({ store, task, run, result: { status: 'failed', error: String(e && e.message || e), durationMs: 0 } }); } catch { /* ignore */ }
      const updated = store.updateRun(id, { status: 'failed', finishedAt: now(), durationMs: 0, error: String(e && e.message || e), ...reportPatch(info) });
      emit('run-end', { run: { ...(updated || run) } });
      return { run: { ...(updated || run) } };
    }
    taskRuns.set(task.id, id);
    const finish = (status, extra = {}) => {
      const cur = activeWorkflow.get(task.id);
      if (!cur || cur.runId !== id) return;
      activeWorkflow.delete(task.id);
      taskRuns.delete(task.id);
      let info = null;
      try {
        info = ensureReport({ store, task, run: store.getRun(id) || run, result: { status, ...extra } });
      } catch (e) { logger.error('scheduler report failed', e); }
      const patch = { status, finishedAt: now(), durationMs: now() - run.startedAt, ...extra, ...reportPatch(info) };
      const updated = store.updateRun(id, patch);
      const fresh = store.getTask(task.id);
      if (fresh) scheduleTask(fresh, now());
      emit('run-end', { run: updated ? { ...updated } : { id, taskId: task.id, ...patch } });
    };
    const onStatus = (s = {}) => {
      if (s.sessionId) store.updateRun(id, { sessionId: s.sessionId });
      if (s.status === 'success') finish('success', { sessionId: s.sessionId || null });
      else if (s.status === 'failed') finish('failed', { error: s.error || 'workflow failed' });
      else if (s.status === 'aborted') finish('killed');
      else if (s.status === 'paused') store.updateRun(id, { status: 'paused' });
    };
    // 先占位并 emit run-start，再启动执行器；执行器的状态回调均为异步（queueMicrotask）
    activeWorkflow.set(task.id, { runId: id, handle: null });
    emit('run-start', { run: { ...run } });
    let handle = null;
    try {
      handle = workflowExecutor.start({ task, runId: id, logFile, runContextPath: ctx.contextPath, onStatus });
    } catch (e) {
      finish('failed', { error: String(e && e.message || e) });
      return { run: { ...store.getRun(id) } };
    }
    if (!handle || handle.error) {
      finish('failed', { error: (handle && handle.error) || 'executor-error' });
      return { run: { ...store.getRun(id) } };
    }
    const cur = activeWorkflow.get(task.id);
    if (cur && cur.runId === id) cur.handle = handle;
    return { run: { ...run } };
  }

  function complete(task, id, status, res) {
    taskRuns.delete(task.id);
    const cur = store.getRun(id) || { id, taskId: task.id, logFile: store.logFileFor(task.id, id), startedAt: now(), trigger: 'schedule' };
    let info = null;
    try {
      info = ensureReport({ store, task, run: cur, result: { ...res, status } });
    } catch (e) {
      logger.error('scheduler report failed', e);
    }
    const patch = { status, finishedAt: now(), exitCode: res.exitCode ?? null, durationMs: res.durationMs ?? null, error: res.error || null, ...reportPatch(info) };
    const run = store.updateRun(id, patch);
    const fresh = store.getTask(task.id);
    if (fresh) scheduleTask(fresh, now());
    emit('run-end', { run: run ? { ...run } : { id, taskId: task.id, ...patch } });
  }

  function manualRun(taskId) {
    const task = store.getTask(taskId);
    if (!task) return { error: 'not-found' };
    return startRun(task, 'manual');
  }
  function stop(taskId) {
    const wf = activeWorkflow.get(taskId);
    if (wf) { try { wf.handle?.abort?.(); } catch { /* ignore */ } return true; }
    const rid = taskRuns.get(taskId);
    if (!rid) return false;
    return runner.stop(rid);
  }
  function tick() {
    const t = now();
    for (const task of store.listTasks()) {
      if (!task.enabled) continue;
      if (!nextAt.has(task.id)) { scheduleTask(task, t); continue; }
      if (nextAt.get(task.id) > t) continue;
      scheduleTask(task, t);
      if (taskRuns.has(task.id)) continue;
      startRun(task, 'schedule');
    }
  }
  function start() {
    refreshAll();
    if (!timer) { timer = setInterval(tick, tickMs); if (timer.unref) timer.unref(); }
  }
  function stopAll() { if (timer) { clearInterval(timer); timer = null; } }

  return {
    start, stopAll, tick, onEvent, manualRun, stop, scheduleTask, reschedule,
    nextRunAtOf, refreshAll, notifyTasksChanged, setProjectResolver, setAiPromptLoader,
    isRunning: (id) => taskRuns.has(id),
    runIdOf: (id) => (taskRuns.has(id) ? taskRuns.get(id) : null),
  };
}
