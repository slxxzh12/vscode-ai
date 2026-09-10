// 定时任务子系统独立常量（勿并入 shared/index.js，避免与 master 冲突）
export const SchedulerS2C = Object.freeze({
  SCHED_TASKS_CHANGED: 'sched-tasks-changed',
  SCHED_RUN_START: 'sched-run-start',
  SCHED_RUN_END: 'sched-run-end',
});
