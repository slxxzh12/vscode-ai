import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildSpawnSpec } from '../runner.js';
import { writeRunContext, ensureReport, stripAnsi } from '../report.js';
import { SchedulerJobStatus as S, SCHED_REPORT_MAX_BYTES } from '@devflow/shared/scheduler';

function readReport(store, reportFile) {
  if (!reportFile) return '';
  try { return fs.readFileSync(store.reportPath(reportFile), 'utf8'); } catch { return ''; }
}

function writePromptFile(promptPath, text) {
  fs.mkdirSync(path.dirname(promptPath), { recursive: true });
  fs.writeFileSync(promptPath, String(text ?? ''), 'utf8');
  return promptPath;
}

// 从 Nga --format json 事件流里提取最终文本，作为 Markdown 报告。
function markdownFromEvents(text) {
  const parts = [];
  const normalized = String(text || '').replace(/}\s*{/g, '}\n{');
  for (const line of normalized.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      const evt = JSON.parse(s);
      if (evt.type === 'text' && evt.part && typeof evt.part.text === 'string' && evt.part.text.trim()) {
        parts.push(evt.part.text.trim());
      }
    } catch { /* not a JSON event line */ }
  }
  return parts.join('\n\n');
}

function writeAiReport(store, task, jobId, output) {
  const markdown = markdownFromEvents(output);
  if (!markdown) return;
  const file = store.reportPath(store.reportFileFor(task.id, jobId));
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${markdown}\n`, 'utf8');
}

function parseResult(job) {
  if (!job || !job.result) return {};
  try { return JSON.parse(job.result); } catch { return {}; }
}

function baseUrlOf(hostport) {
  const m = String(hostport || '').match(/:(\d+)$/);
  return `http://127.0.0.1:${m ? m[1] : '22222'}`;
}

function normalizeStatus(v) {
  if (v === 'success') return S.SUCCESS;
  if (v === 'failed') return S.FAILED;
  if (v === 'running') return S.RUNNING;
  const n = Number(v);
  return n === S.SUCCESS || n === S.FAILED || n === S.RUNNING ? n : null;
}

export function createConsumer({
  queue, store, runner, aiPromptLoader = () => '',
  worker, logger = console, now = () => Date.now(), pollMs = 1000,
  aiBin = 'opencode', opencodeDataDir = null, projectResolver = () => null, onEvent = () => {},
}) {
  const loops = new Map();
  const running = new Map();
  const callbacks = new Map();
  let stopped = false;

  function issueCallback(jobId) {
    const token = crypto.randomUUID();
    callbacks.set(jobId, token);
    return {
      jobId,
      token,
      url: `${baseUrlOf(worker.hostport)}/api/scheduler/jobs/${encodeURIComponent(jobId)}/callback`,
    };
  }

  async function handleCallback(jobId, token, body = {}) {
    if (!token || callbacks.get(jobId) !== token) return { error: 'bad-token' };
    const status = normalizeStatus(body.status);
    const patch = {};
    if (status !== null) patch.status = status;
    if (body.result !== undefined || body.reportMarkdown !== undefined) {
      const cur = await queue.getJob(jobId);
      const prev = parseResult(cur);
      const merged = { ...prev, ...(body.result || {}) };
      if (body.reportMarkdown !== undefined) merged.reportMarkdown = String(body.reportMarkdown || '');
      patch.result = JSON.stringify(merged);
    }
    if (!Object.keys(patch).length) return { error: 'empty-callback' };
    const r = await queue.applyCallback(jobId, patch);
    if (r && r.error) return r;
    return { ok: true };
  }

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
    const callback = issueCallback(job.jobId);
    let ctx;
    try {
      ctx = writeRunContext({ store, task, run, callback });
    } catch (e) {
      callbacks.delete(job.jobId);
      await queue.complete(job.jobId, {
        status: S.FAILED, runtime: 0, workIP: worker.hostport,
        result: { error: String(e?.message || e), reason: 'failed', reportMarkdown: '' },
      });
      return;
    }
    const cwd = task.cwd || projectResolver(task.projectId) || process.cwd();
    const logPath = store.logPath(logFile);
    const deadline = job.maxRunMilliSecond > 0 ? startedAt + job.maxRunMilliSecond : Infinity;
    const remaining = () => Math.max(1, deadline - now());

    let status = S.FAILED;
    let result = { exitCode: null, error: null, durationMs: null, reason: 'failed' };
    let ngaSessionId = null;
    let aiBuf = '';
    const captureSessionId = (chunk) => {
      aiBuf += String(chunk || '');
      if (ngaSessionId) return;
      const m = aiBuf.match(/"sessionID"\s*:\s*"([^"]+)"/);
      if (!m) return;
      ngaSessionId = m[1];
      void (async () => {
        try {
          const curJob = queue.getJob ? await queue.getJob(job.jobId) : null;
          const prev = parseResult(curJob);
          await queue.applyCallback(job.jobId, { result: JSON.stringify({ ...prev, ngaSessionId }) });
        } catch { /* best-effort */ }
      })();
    };
    try {
      if (task.type === 'shell') {
        const shellRes = await runner.run({
          runId: job.jobId,
          spec: buildSpawnSpec(task, { cwd, runContextPath: ctx.contextPath }),
          logPath,
          timeoutMs: Number.isFinite(deadline) ? remaining() : 0,
        });
        if (shellRes.spawnError || shellRes.timedOut || shellRes.exitCode !== 0) {
          status = S.FAILED;
          result = {
            exitCode: shellRes.exitCode ?? null,
            shellExitCode: shellRes.exitCode ?? null,
            error: shellRes.error || (shellRes.timedOut ? 'timeout' : 'shell-failed'),
            durationMs: now() - startedAt,
            reason: shellRes.timedOut ? 'timeout' : 'shell-failed',
          };
        } else {
          const prompt = stripAnsi(shellRes.stdout || '').trim();
          if (!prompt) {
            status = S.FAILED;
            result = { exitCode: 0, shellExitCode: 0, error: 'empty-output', durationMs: now() - startedAt, reason: 'empty-output' };
          } else {
            const promptFile = writePromptFile(ctx.promptPath, prompt);
            const aiRes = await runner.run({
              runId: job.jobId,
              spec: buildSpawnSpec({ type: 'ai', ai: { source: 'prompt' } }, {
                cwd, aiPrompt: prompt, aiBin, opencodeDataDir,
                runContextPath: ctx.contextPath, jobCallback: callback, promptFilePath: promptFile, jsonFormat: true,
              }),
              logPath,
              timeoutMs: Number.isFinite(deadline) ? remaining() : 0,
              onData: captureSessionId,
            });
            status = aiRes.spawnError || aiRes.timedOut || aiRes.exitCode !== 0 ? S.FAILED : S.SUCCESS;
            result = {
              exitCode: aiRes.exitCode ?? null,
              shellExitCode: shellRes.exitCode ?? 0,
              aiExitCode: aiRes.exitCode ?? null,
              error: aiRes.error || (aiRes.timedOut ? 'timeout' : null),
              durationMs: now() - startedAt,
              reason: aiRes.timedOut ? 'timeout' : (aiRes.exitCode === 0 ? 'success' : 'failed'),
            };
          }
        }
      } else {
        let prompt = null;
        if (task.ai?.source === 'command') prompt = aiPromptLoader(task.ai.commandName) || '';
        else prompt = task.ai?.prompt || '';
        const promptFile = task.ai?.source === 'prompt' ? writePromptFile(ctx.promptPath, prompt) : null;
        const aiRes = await runner.run({
          runId: job.jobId,
          spec: buildSpawnSpec(task, {
            cwd, aiPrompt: prompt, aiBin, opencodeDataDir,
            runContextPath: ctx.contextPath, jobCallback: callback, promptFilePath: promptFile, jsonFormat: true,
          }),
          logPath,
          timeoutMs: Number.isFinite(deadline) ? remaining() : 0,
          onData: captureSessionId,
        });
        status = aiRes.spawnError || aiRes.timedOut || aiRes.exitCode !== 0 ? S.FAILED : S.SUCCESS;
        result = {
          exitCode: aiRes.exitCode ?? null,
          aiExitCode: aiRes.exitCode ?? null,
          error: aiRes.error || (aiRes.timedOut ? 'timeout' : null),
          durationMs: aiRes.durationMs ?? (now() - startedAt),
          reason: aiRes.timedOut ? 'timeout' : (aiRes.exitCode === 0 ? 'success' : 'failed'),
        };
      }
    } catch (e) {
      result = { exitCode: null, error: String(e?.message || e), durationMs: now() - startedAt, reason: 'failed' };
    } finally {
      if (ngaSessionId) result.ngaSessionId = ngaSessionId;
      running.delete(job.jobId);
      callbacks.delete(job.jobId);
    }

    const cur = queue.getJob ? await queue.getJob(job.jobId).catch(() => null) : null;
    if (cur && cur.status !== S.RUNNING) {
      onEvent('run-end', { jobId: job.jobId, taskId: task.id, status: cur.status });
      return;
    }
    try { writeAiReport(store, task, job.jobId, aiBuf); } catch { /* best-effort */ }
    let info = null;
    try {
      info = ensureReport({ store, task, run: { ...run, status, exitCode: result.exitCode, durationMs: result.durationMs, error: result.error }, result });
    } catch (e) { logger?.error?.('scheduler report failed', e); }
    const reportMarkdown = (readReport(store, info?.reportFile) || '').slice(0, SCHED_REPORT_MAX_BYTES);
    const reported = parseResult(cur);
    const final = {
      ...result,
      ...reported,
      reportFile: info?.reportFile || reported.reportFile || null,
      reportMarkdown: reported.reportMarkdown || reportMarkdown,
      logPath,
    };
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
    if (h) runner.stop(jobId);
    await queue.complete(jobId, { status: S.FAILED, runtime: null, workIP: worker.hostport, result: { error: 'cancelled', reason: 'cancelled' } });
    return true;
  }

  async function stopTask(taskId) {
    const jobs = await queue.listJobs({ taskIds: [taskId], status: S.RUNNING, limit: 1 });
    const job = jobs[0];
    if (!job) return false;
    return stopJob(job.jobId);
  }

  function stop() {
    stopped = true;
    for (const loop of loops.values()) clearInterval(loop.timer);
    loops.clear();
    callbacks.clear();
  }
  return { execute, runOnce, setPartitions, stopJob, stopTask, handleCallback, stop };
}
