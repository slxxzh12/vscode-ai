import type { Schedule, SchedulerTask } from '@devflow/shared/scheduler';

export function scheduleEqual(a: Schedule, b: Schedule): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function findWorkflowTasks(tasks: SchedulerTask[], workflowId: string): SchedulerTask[] {
  return (tasks || []).filter((x) => x.type === 'workflow' && x.workflow?.workflowId === workflowId);
}

export function findWorkflowTask(tasks: SchedulerTask[], workflowId: string, schedule: Schedule): SchedulerTask | null {
  return findWorkflowTasks(tasks, workflowId).find((x) => scheduleEqual(x.schedule, schedule)) || null;
}

export function buildWorkflowTask({ workflowId, label, agentId, schedule }: { workflowId: string; label: string; agentId: string; schedule: Schedule }) {
  return { name: label, type: 'workflow' as const, enabled: true, workflow: { workflowId, agentId }, schedule };
}
