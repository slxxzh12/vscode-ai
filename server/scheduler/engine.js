import { computeNextRun } from './schedule.js';

const TICK_MS = 1000;

export function createEngine({ store, queue, logger = console, now = () => Date.now(), tickMs = TICK_MS, onStop = null, createMachineId = null } = {}) {
  const nextAt = new Map();
  const listeners = new Set();
  let timer = null;
  let ticking = false;

  function emit(evt, payload) { for (const cb of listeners) { try { cb(evt, payload); } catch (e) { logger.error('sched listener', e); } } }
  function onEvent(cb) { listeners.add(cb); return () => listeners.delete(cb); }
  function scheduleTask(task, from = now()) {
    const n = computeNextRun(task.schedule, from);
    if (n == null) nextAt.delete(task.id); else nextAt.set(task.id, n);
    return n;
  }
  function nextRunAtOf(id) { return nextAt.has(id) ? nextAt.get(id) : null; }
  function refreshAll() { for (const t of store.listTasks()) scheduleTask(t); }
  function reschedule(task) { scheduleTask(task); }
  function notifyTasksChanged() { emit('tasks-changed', {}); }

  // 同一任务已有排队/调度中/待审作业时视为活跃，避免重复入队。
  async function hasActiveJob(taskId) {
    try {
      if (typeof queue.listJobs !== 'function') return false;
      const rows = await queue.listJobs({ taskIds: [taskId], status: [0, 3, 4], limit: 1 });
      return Array.isArray(rows) && rows.length > 0;
    } catch { return false; }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const t = now();
      for (const task of store.listTasks()) {
        if (!task.enabled) continue;
        if (!nextAt.has(task.id)) { scheduleTask(task, t); continue; }
        if (nextAt.get(task.id) > t) continue;
        scheduleTask(task, t);
        if (await hasActiveJob(task.id)) continue;
        try {
          const r = await queue.enqueueTask(task, { trigger: 'schedule', scheduledAt: t, createMachineId });
          if (r && r.error && r.error !== 'unique-conflict') logger.warn?.('scheduler enqueue failed', r.error);
        } catch (e) { logger.error('scheduler enqueue failed', e); }
      }
    } finally { ticking = false; }
  }
  async function manualRun(taskId) {
    const task = store.getTask(taskId);
    if (!task) return { error: 'not-found' };
    if (await hasActiveJob(taskId)) return { error: 'active-job' };
    return queue.enqueueTask(task, { trigger: 'manual', createMachineId });
  }
  function stop(taskId) { return onStop ? onStop(taskId) : Promise.resolve(false); }
  function start() { refreshAll(); if (!timer) { timer = setInterval(() => { void tick(); }, tickMs); timer.unref?.(); } }
  function stopAll() { if (timer) { clearInterval(timer); timer = null; } }

  return { start, stopAll, tick, onEvent, manualRun, stop, scheduleTask, reschedule, nextRunAtOf, refreshAll, notifyTasksChanged };
}
