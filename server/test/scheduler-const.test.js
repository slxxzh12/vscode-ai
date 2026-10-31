import test from 'node:test';
import assert from 'node:assert/strict';
import { SchedulerS2C, SchedulerJobStatus, SCHED_PARTITION_COUNT_DEFAULT } from '@devflow/shared/scheduler';

test('SchedulerS2C 已冻结且值唯一', () => {
  assert.ok(Object.isFrozen(SchedulerS2C));
  const vals = Object.values(SchedulerS2C);
  assert.equal(new Set(vals).size, vals.length);
  assert.equal(SchedulerS2C.SCHED_TASKS_CHANGED, 'sched-tasks-changed');
  assert.equal(SchedulerS2C.SCHED_RUN_START, 'sched-run-start');
  assert.equal(SchedulerS2C.SCHED_RUN_END, 'sched-run-end');
});

test('队列常量值', () => {
  assert.equal(SchedulerJobStatus.QUEUED, 0);
  assert.equal(SchedulerJobStatus.PENDING, 4);
  assert.equal(SCHED_PARTITION_COUNT_DEFAULT, 16);
});
