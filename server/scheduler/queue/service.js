import crypto from 'node:crypto';
import { hashPartition } from './partition.js';
import {
  SCHED_QUEUE_TOPIC, SCHED_PARTITION_COUNT_DEFAULT, SchedulerJobStatus as S,
} from '@devflow/shared/scheduler';

const DEFAULT_MS = { ai: 1800000, shell: 600000 };

function maxRunFor(task) {
  return Number(task.maxRunMilliSecond) > 0 ? Number(task.maxRunMilliSecond) : (DEFAULT_MS[task.type] || 600000);
}

export function buildSnapshot(task, trigger, scheduledAt, createMachineId) {
  return {
    task: {
      id: task.id, name: task.name, type: task.type, enabled: task.enabled !== false,
      projectId: task.projectId || null, cwd: task.cwd || null, filePath: task.filePath || null,
      command: task.command, ai: task.ai,
      approvalRequired: !!task.approvalRequired, onlyLocal: !!task.onlyLocal,
      uniqueKey: task.uniqueKey || null, weight: Number(task.weight) || 0,
      maxRunMilliSecond: maxRunFor(task), groupName: task.groupName || 'default',
    },
    trigger,
    scheduledAt: scheduledAt || null,
    createMachineId: createMachineId || null,
  };
}

function failedResult(reason, error = null) {
  return JSON.stringify({ exitCode: null, error: error || reason, durationMs: null, reportFile: null, reportMarkdown: null, logPath: null, sessionId: null, reason });
}

export function createQueueService({ repo, topic = SCHED_QUEUE_TOPIC, now = () => Date.now(), logger = console } = {}) {
  async function partitionCount() {
    const n = Number(await repo.getConfig('partitionCount'));
    return n > 0 ? n : SCHED_PARTITION_COUNT_DEFAULT;
  }

  async function enqueueTask(task, { trigger = 'schedule', scheduledAt = null, createIP = null, createMachineId = null, parentJobId = null, traceId = null, useUniqueKey = true } = {}) {
    const count = await partitionCount();
    const at = now();
    const uniqueKey = useUniqueKey ? (task.uniqueKey || null) : null;
    const status = task.approvalRequired ? S.PENDING : S.QUEUED;
    const job = {
      jobId: 'j_' + crypto.randomBytes(8).toString('hex'),
      parentJobId: parentJobId || null,
      topic,
      groupName: task.groupName || 'default',
      taskId: task.id,
      partitionId: hashPartition(topic, task.id, count),
      uniqueKey,
      activeKey: status === S.QUEUED ? uniqueKey : null,
      classname: 'scheduler.task',
      methodName: task.type,
      paramStr: JSON.stringify(buildSnapshot(task, trigger, scheduledAt, createMachineId)),
      result: null,
      status,
      weight: Number(task.weight) || 0,
      runtime: null,
      maxRunMilliSecond: maxRunFor(task),
      createIP: createIP || null,
      workIP: null,
      traceId: traceId || crypto.randomUUID(),
      createTime: at,
      lastUpdateTime: at,
      createMachineId: createMachineId || null,
      onlyLocal: task.onlyLocal ? 1 : 0,
    };
    const r = await repo.insertJob(job);
    if (r.error) return { error: r.error };
    return { job };
  }

  async function approve(jobId) {
    const job = await repo.getJob(jobId);
    if (!job || job.status !== S.PENDING) return { error: 'not-pending' };
    const r = await repo.updateJob(jobId, { status: S.QUEUED, activeKey: job.uniqueKey || null, lastUpdateTime: now() });
    if (r.error) return r;
    return { job: { ...job, status: S.QUEUED, activeKey: job.uniqueKey || null } };
  }

  async function reject(jobId) {
    const job = await repo.getJob(jobId);
    if (!job || job.status !== S.PENDING) return { error: 'not-pending' };
    await repo.updateJob(jobId, { status: S.FAILED, activeKey: null, result: failedResult('rejected'), lastUpdateTime: now() });
    return { ok: true };
  }

  async function cancel(jobId) {
    const job = await repo.getJob(jobId);
    if (!job) return { error: 'not-found' };
    if (job.status === S.RUNNING) return { needsStop: job };
    if (job.status === S.PENDING) return reject(jobId);
    if (job.status !== S.QUEUED) return { error: 'not-cancellable' };
    await repo.updateJob(jobId, { status: S.FAILED, activeKey: null, result: failedResult('cancelled'), lastUpdateTime: now() });
    return { ok: true };
  }

  async function claim({ partitionId, worker }) {
    return repo.claim({ topic, partitionId, machineId: worker.machineId, hostport: worker.hostport, now: now() });
  }

  async function complete(jobId, { status, runtime = null, workIP = null, result = {} }) {
    await repo.updateJob(jobId, {
      status, runtime, workIP, result: JSON.stringify(result || {}), activeKey: null, lastUpdateTime: now(),
    });
  }

  async function applyCallback(jobId, patch = {}) {
    const job = await repo.getJob(jobId);
    if (!job || job.status !== S.RUNNING) return { error: 'not-running' };
    const r = await repo.updateJob(jobId, { ...patch, lastUpdateTime: now() });
    return r.error ? r : { ok: true };
  }

  async function retry(jobId, { createIP = null, createMachineId = null } = {}) {
    const job = await repo.getJob(jobId);
    if (!job || job.status !== S.FAILED) return { error: 'not-failed' };
    let snap;
    try { snap = JSON.parse(job.paramStr); } catch { return { error: 'bad-snapshot' }; }
    return enqueueTask(snap.task, {
      trigger: 'retry', createIP, createMachineId,
      parentJobId: job.jobId, traceId: job.traceId, useUniqueKey: false,
    });
  }

  async function cleanupFinished({ partitionId = null } = {}) {
    return repo.deleteFinished({ topic, partitionId });
  }

  async function purgeTaskJobs(taskId) {
    return repo.purgeTaskJobs(topic, taskId);
  }

  async function recordPrompt(taskId, prompt, { createIP = '', employeeId = '' } = {}) {
    const text = String(prompt ?? '');
    if (!text.trim()) return { skipped: true };
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const latest = await repo.getLatestPrompt(taskId);
    if (latest && latest.hash === hash) return { skipped: true, prompt: latest };
    const createdAt = now();
    const r = await repo.insertPrompt({
      taskId, prompt: text, hash, createdAt,
      createIP: String(createIP || '').slice(0, 64),
      employeeId: String(employeeId || '').slice(0, 64),
    });
    if (r.duplicate) {
      const existing = await repo.getPromptByHash(taskId, hash);
      return existing ? { skipped: true, prompt: existing } : { skipped: true };
    }
    return { id: r.id, taskId, prompt: text, hash, createIP, employeeId, createdAt };
  }

  async function getLatestPrompt(taskId) {
    return repo.getLatestPrompt(taskId);
  }

  async function getPromptByHash(taskId, hash) {
    if (!taskId || !hash) return null;
    return repo.getPromptByHash(taskId, String(hash));
  }

  async function listPrompts(taskId, limit = 50) {
    return repo.listPrompts(taskId, limit);
  }

  async function deleteTaskPrompts(taskId) {
    return repo.deleteTaskPrompts(taskId);
  }

  async function deleteTaskJobs(taskId) {
    const jobs = await repo.listJobs({ topic, taskIds: [taskId], status: [S.QUEUED, S.RUNNING, S.PENDING], limit: 5000 });
    const running = [];
    for (const job of jobs) {
      if (job.status === S.RUNNING) running.push(job.jobId);
      await repo.updateJob(job.jobId, { status: S.FAILED, activeKey: null, result: failedResult('task-deleted'), lastUpdateTime: now() });
    }
    return { running };
  }

  async function failRunningByWorker(hostport, reason = 'worker-offline') {
    const rows = await repo.listJobs({ topic, status: S.RUNNING, limit: 5000 });
    const hit = rows.filter((j) => j.workIP === hostport);
    for (const job of hit) {
      await repo.updateJob(job.jobId, { status: S.FAILED, activeKey: null, result: failedResult(reason), lastUpdateTime: now() });
    }
    return hit.map((j) => j.jobId);
  }

  async function recoverRunning(hostport) { return failRunningByWorker(hostport, 'interrupted'); }

  async function setPartitionCount(next) {
    const cur = await partitionCount();
    const n = Number(next);
    if (!Number.isInteger(n) || n < 1) return { error: 'bad-count' };
    if (n < cur) return { error: 'cannot-shrink' };
    if (n === cur) return { ok: true, count: n };
    await repo.setConfig('partitionCount', String(n));
    return { ok: true, count: n, restartRequired: true };
  }

  async function rehash() {
    const count = await partitionCount();
    return repo.rehash(topic, count, hashPartition);
  }

  return {
    topic, repo, partitionCount, enqueueTask, approve, reject, cancel, claim, complete,
    retry, cleanupFinished, deleteTaskJobs, purgeTaskJobs, failRunningByWorker, recoverRunning,
    setPartitionCount, rehash, applyCallback, recordPrompt, getLatestPrompt, getPromptByHash, listPrompts, deleteTaskPrompts,
    getJob: (id) => repo.getJob(id),
    get: (id) => repo.getJob(id),
    listJobs: (opts) => repo.listJobs({ topic, ...opts }),
    summary: () => repo.summary(topic),
    partitionStats: async () => repo.partitionStats(topic, await partitionCount()),
    parseParam: (job) => JSON.parse(job.paramStr),
  };
}
