import { describe, it, expect } from 'vitest';
import { scheduleEqual, findWorkflowTask, findWorkflowTasks, buildWorkflowTask } from './workflowTask';

const S1 = { mode: 'interval' as const, interval: { every: 1, unit: 'hour' as const } };
const S2 = { mode: 'daily' as const, daily: { at: '09:30', weekdays: [] as number[] } };
const T = (over: any = {}) => ({ id: 't1', type: 'workflow', name: 'DEV', schedule: S1, workflow: { workflowId: 'dev', agentId: 'opencode' }, ...over }) as any;

describe('workflowTask', () => {
  it('scheduleEqual 深度比较', () => {
    expect(scheduleEqual(S1, { mode: 'interval', interval: { every: 1, unit: 'hour' } })).toBe(true);
    expect(scheduleEqual(S1, S2)).toBe(false);
  });

  it('findWorkflowTask 按 workflowId + schedule 命中', () => {
    const tasks = [T()];
    expect(findWorkflowTask(tasks, 'dev', S1)?.id).toBe('t1');
    expect(findWorkflowTask(tasks, 'dev', S2)).toBe(null);
    expect(findWorkflowTask(tasks, 'other', S1)).toBe(null);
  });

  it('findWorkflowTasks 按 workflowId 过滤', () => {
    const tasks = [T(), T({ id: 't2', schedule: S2 }), T({ id: 't3', workflow: { workflowId: 'x', agentId: 'a' } })];
    expect(findWorkflowTasks(tasks, 'dev').map((x) => x.id)).toEqual(['t1', 't2']);
  });

  it('buildWorkflowTask 构造合法任务体', () => {
    expect(buildWorkflowTask({ workflowId: 'dev', label: 'DEV', agentId: 'opencode', schedule: S1 }))
      .toEqual({ name: 'DEV', type: 'workflow', enabled: true, workflow: { workflowId: 'dev', agentId: 'opencode' }, schedule: S1 });
  });
});
