import fs from 'node:fs';
import { buildSpawnSpec } from '../runner.js';
import { writeRunContext, ensureReport } from '../report.js';
import { SchedulerJobStatus as S, SCHED_REPORT_MAX_BYTES } from '@devflow/shared/scheduler';

function readReport(store, reportFile) {
  if (!reportFile) return '';
  try { return fs.readFileSync(store.reportPath(reportFile), 'utf8'); } catch { return ''; }
}

export function createConsumer({
  queue, store, runner, workflowExecutor, aiPromptLoader = () => '',
  worker, logger = console, now = () => Date.now(), pollMs = 1000,
  aiBin = 'opencode', opencodeDataDir = null, projectResolver = () => null, onEvent = () => {},
}) {
  const loops = new Map();
  const running = new Map();
  let stopped = false;

  async function execute(job) {
    let snap;
    try { snap = await queue.parseParam(job); } catch {
      await queue.complete(job.jobId, {
        status: S.FAILED, runtime: 0, workIP: worker.hostport,
        result: { error: 'bad-snapshot', reason: 'failed', reportMarkdown: '' },
      });
      return;
    }
    const task = snap.task;
    const startedAt = now();
    const logFile = store.logFileFor(task.id, job.jobId);
    const run = { id: job.jobId, taskId: task.id, status: 'running', trigger: snap.trigger, startedAt, logFile };
    let ctx;
    try {
      ctx = writeRunContext({ store, task, run });
    } catch (e) {
      await queue.complete(job.jobId, {
        status: S.FAILED, runtime: 0, workIP: worker.hostport,
        result: { error: String(e?.message || e), reason: 'failed', reportMarkdown: '' },
      });
      return;
    }
    const cwd = task.cwd || projectResolver(task.projectId) || process.cwd();
    let status = S.FAILED;
    let result = { exitCode: null, error: null, durationMs: null, reason: 'failed' };
    try {
      if (task.type === 'workflow' && workflowExecutor) {
        const statusPromise = new Promise((resolve) => {
          let timer = null;
          let done = false;
          const handle = workflowExecutor.start({
            task, runId: job.jobId, logFile, runContextPath: ctx.contextPath,
            onStatus: (s) => {
              if (s.status === 'success' || s.status === 'failed' || s.status === 'aborted') {
                done = true;
                if (timer) clearTimeout(timer);
                resolve(s);
              }
            },
          });
          if (!handle || handle.error) {
            resolve({ status: 'failed', error: (handle && handle.error) || 'executor-error' });
            return;
          }
          running.set(job.jobId, { kind: 'workflow', handle });
          if (!done) {
            timer = setTimeout(() => {
              try { handle.abort?.(); } catch { /* ignore */ }
              resolve({ status: 'failed', error: 'timeout' });
            }, job.maxRunMilliSecond);
          }
        });
        const res = await statusPromise;
        status = res.status === 'success' ? S.SUCCESS : S.FAILED;
        result = { exitCode: null, error: res.error || null, durationMs: now() - startedAt, sessionId: res.sessionId || null, reason: res.error || res.status };
      } else {
        let prompt = null;
        if (task.type === 'ai') prompt = task.ai?.source === 'command' ? (aiPromptLoader(task.ai.commandName) || '') : (task.ai?.prompt || '');
        const spec = buildSpawnSpec(task, {
          cwd, aiPrompt: prompt, aiBin, opencodeDataDir,
          runContextPath: ctx.contextPath, reportPath: ctx.reportPath, reportDir: ctx.reportDir, progressPath: ctx.progressPath,
        });
        const res = await runner.run({ runId: job.jobId, spec, logPath: store.logPath(logFile), timeoutMs: job.maxRunMilliSecond });
        status = res.spawnError || res.timedOut || res.exitCode !== 0 ? S.FAILED : S.SUCCESS;
        result = {
          exitCode: res.exitCode ?? null, error: res.error || (res.timedOut ? 'timeout' : null),
          durationMs: res.durationMs ?? (now() - startedAt), reason: res.timedOut ? 'timeout' : (res.exitCode === 0 ? 'success' : 'failed'),
        };
      }
    } catch (e) {
      result = { exitCode: null, error: String(e?.message || e), durationMs: now() - startedAt, reason: 'failed' };
    } finally {
      running.delete(job.jobId);
    }
    let info = null;
    try {
      info = ensureReport({ store, task, run: { ...run, status, exitCode: result.exitCode, durationMs: result.durationMs, error: result.error }, result });
    } catch (e) { logger?.error?.('scheduler report failed', e); }
    const reportMarkdown = (readReport(store, info?.reportFile) || '').slice(0, SCHED_REPORT_MAX_BYTES);
    const final = {
      ...result,
      reportFile: info?.reportFile || null,
      reportMarkdown,
      logPath: store.logPath(logFile),
    };
    const cur = queue.getJob ? await queue.getJob(job.jobId).catch(() => null) : null;
    if (cur && cur.status !== S.RUNNING) { onEvent('run-end', { jobId: job.jobId, taskId: task.id, status: cur.status }); return; }
    await queue.complete(job.jobId, { status, runtime: result.durationMs, workIP: worker.hostport, result: final });
    onEvent('run-end', { jobId: job.jobId, taskId: task.id, status });
  }

  async function runOnce(partitionId) {
    const loop = loops.get(partitionId) || {};
    if (stopped || loop.busy) return;
    loop.busy = true;
    loops.set(partitionId, loop);
    try {
      const job = await queue.claim({ partitionId, worker });
      if (job) await execute(job);
    } catch (e) {
      logger?.error?.('scheduler consumer failed', e);
    } finally {
      loop.busy = false;
    }
  }

  function setPartitions(ids) {
    for (const [pid, loop] of loops) {
      if (!ids.includes(pid)) { clearInterval(loop.timer); loops.delete(pid); }
    }
    for (const pid of ids) {
      if (loops.has(pid)) continue;
      const loop = { busy: false, timer: null };
      loops.set(pid, loop);
      loop.timer = setInterval(() => { void runOnce(pid); }, pollMs);
      loop.timer.unref?.();
      void runOnce(pid);
    }
  }

  async function stopJob(jobId) {
    const h = running.get(jobId);
    if (h) {
      if (h.kind === 'workflow') { try { h.handle?.abort?.(); } catch { /* ignore */ } }
      else runner.stop(jobId);
    }
    await queue.complete(jobId, { status: S.FAILED, runtime: null, workIP: worker.hostport, result: { error: 'cancelled', reason: 'cancelled' } });
    return true;
  }

  async function stopTask(taskId) {
    const jobs = await queue.listJobs({ taskIds: [taskId], status: S.RUNNING, limit: 1 });
    const job = jobs[0];
    if (!job) return false;
    return stopJob(job.jobId);
  }

  function stop() { stopped = true; for (const loop of loops.values()) clearInterval(loop.timer); loops.clear(); }
  return { execute, runOnce, setPartitions, stopJob, stopTask, stop };
}
