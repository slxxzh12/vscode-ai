import test from 'node:test';
import assert from 'node:assert/strict';
import { SchedulerS2C } from '@devflow/shared/scheduler';

test('SchedulerS2C 已冻结且值唯一', () => {
  assert.ok(Object.isFrozen(SchedulerS2C));
  const vals = Object.values(SchedulerS2C);
  assert.equal(new Set(vals).size, vals.length);
  assert.equal(SchedulerS2C.SCHED_TASKS_CHANGED, 'sched-tasks-changed');
  assert.equal(SchedulerS2C.SCHED_RUN_START, 'sched-run-start');
  assert.equal(SchedulerS2C.SCHED_RUN_END, 'sched-run-end');
});
