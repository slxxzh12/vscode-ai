export type ScheduleUnit = 'second' | 'minute' | 'hour' | 'day';

export type Schedule =
  | { mode: 'interval'; interval: { every: number; unit: ScheduleUnit } }
  | { mode: 'daily'; daily: { at: string; weekdays: number[] } };

export interface SchedulerTask {
  id: string;
  name: string;
  enabled: boolean;
  projectId: string | null;
  cwd: string | null;
  type: 'shell' | 'ai';
  filePath?: string | null;
  command?: string;
  ai?: { source: 'command' | 'prompt' | 'file'; commandName?: string; prompt?: string };
  schedule: Schedule;
  approvalRequired?: boolean;
  onlyLocal?: boolean;
  uniqueKey?: string | null;
  weight?: number;
  maxRunMilliSecond?: number | null;
  groupName?: string | null;
  createdAt: number;
  updatedAt: number;
}

export type RunStatus = 'running' | 'success' | 'failed' | 'timeout' | 'killed' | 'paused';

export interface SchedulerRun {
  id: string;
  taskId: string;
  status: RunStatus;
  trigger: 'schedule' | 'manual';
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  durationMs: number | null;
  logFile: string;
  reportFile?: string | null;
  reportDir?: string | null;
  reportCount?: number | null;
  error: string | null;
  sessionId?: string | null;
}

export interface SchedulerSummary {
  total: number;
  success: number;
  failed: number;
  running: number;
  queued?: number;
  pending?: number;
}

export interface SchedulerJob {
  jobId: string;
  taskId?: string | null;
  parentJobId?: string | null;
  topic?: string;
  groupName?: string | null;
  partitionId: number;
  status: number;
  weight?: number;
  runtime?: number | null;
  createIP?: string | null;
  workIP?: string | null;
  traceId?: string | null;
  createTime: number;
  lastUpdateTime: number;
  paramStr?: string;
  result?: string | null;
  maxRunMilliSecond?: number;
}

export interface SchedulerRunContext {
  runId: string;
  taskId: string;
  taskName: string;
  trigger: 'schedule' | 'manual';
  startedAt: number;
  reportPath: string;
  reportDir: string;
  logPath: string;
  outputDir: string;
  callback?: { jobId: string; token: string; url: string };
}

export const SchedulerS2C: Readonly<{
  SCHED_TASKS_CHANGED: 'sched-tasks-changed';
  SCHED_RUN_START: 'sched-run-start';
  SCHED_RUN_END: 'sched-run-end';
}>;

export const SchedulerQueueS2C: Readonly<{
  SCHED_JOBS_CHANGED: 'sched-jobs-changed';
}>;

export const SchedulerJobStatus: Readonly<{
  QUEUED: 0;
  SUCCESS: 1;
  FAILED: 2;
  RUNNING: 3;
  PENDING: 4;
}>;

export const SCHED_QUEUE_TOPIC: string;
export const SCHED_PARTITION_COUNT_DEFAULT: number;
export const SCHED_HEARTBEAT_MS: number;
export const SCHED_WORKER_OFFLINE_MS: number;
export const SCHED_REPORT_MAX_BYTES: number;
