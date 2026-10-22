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
  type: 'shell' | 'ai' | 'script' | 'workflow';
  filePath?: string | null;
  command?: string;
  ai?: { source: 'command' | 'prompt' | 'file'; commandName?: string; prompt?: string };
  script?: { path: string; exe?: boolean };
  workflow?: { workflowId: string; agentId: string };
  schedule: Schedule;
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
}

export interface SchedulerRunContext {
  runId: string;
  taskId: string;
  taskName: string;
  trigger: 'schedule' | 'manual';
  startedAt: number;
  reportPath: string;
  reportDir: string;
  progressPath: string;
  logPath: string;
  outputDir: string;
}

export const SchedulerS2C: Readonly<{
  SCHED_TASKS_CHANGED: 'sched-tasks-changed';
  SCHED_RUN_START: 'sched-run-start';
  SCHED_RUN_END: 'sched-run-end';
}>;
