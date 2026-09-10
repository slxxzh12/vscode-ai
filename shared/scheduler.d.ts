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
  type: 'shell' | 'ai' | 'script';
  command?: string;
  ai?: { source: 'command' | 'prompt'; commandName?: string; prompt?: string };
  script?: { path: string };
  schedule: Schedule;
  createdAt: number;
  updatedAt: number;
}

export type RunStatus = 'running' | 'success' | 'failed' | 'timeout' | 'killed';

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
  error: string | null;
}

export const SchedulerS2C: Readonly<{
  SCHED_TASKS_CHANGED: 'sched-tasks-changed';
  SCHED_RUN_START: 'sched-run-start';
  SCHED_RUN_END: 'sched-run-end';
}>;
