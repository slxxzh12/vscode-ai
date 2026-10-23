// 定时任务子系统独立常量（勿并入 shared/index.js，避免与 master 冲突）
export const SchedulerS2C = Object.freeze({
  SCHED_TASKS_CHANGED: 'sched-tasks-changed',
  SCHED_RUN_START: 'sched-run-start',
  SCHED_RUN_END: 'sched-run-end',
});

export const SchedulerQueueS2C = Object.freeze({
  SCHED_JOBS_CHANGED: 'sched-jobs-changed',
});

export const SchedulerJobStatus = Object.freeze({
  QUEUED: 0,
  SUCCESS: 1,
  FAILED: 2,
  RUNNING: 3,
  PENDING: 4,
});

export const SCHED_QUEUE_TOPIC = 'scheduler.jobs';
export const SCHED_PARTITION_COUNT_DEFAULT = 16;
export const SCHED_HEARTBEAT_MS = 10000;
export const SCHED_WORKER_OFFLINE_MS = 30000;
export const SCHED_REPORT_MAX_BYTES = 2 * 1024 * 1024;
