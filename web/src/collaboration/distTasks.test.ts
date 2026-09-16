import { test, expect } from 'vitest';
import { groupTasksByStatus, kindKeyOf, taskItemCount, distCardOf, type DistTask } from './distTasks';

const task = (over: Partial<DistTask> = {}): DistTask => ({
  id: 't1', groupId: 'g1', hubId: 'h', kind: 'skills', hash: 'h1', name: 'skills/a.zip',
  url: 'http://x/y', status: 'pending', messageId: 'm1', createdAt: 1, updatedAt: 1,
  payload: { skills: ['a', 'b'], workflow: [], count: 2, size: 1024 }, ...over,
});

test('groupTasksByStatus：四组归类，缺失状态忽略', () => {
  const out = groupTasksByStatus([
    task(), task({ id: 't2', status: 'done' }), task({ id: 't3', status: 'ignored' }),
    task({ id: 't4', status: 'failed' }), task({ id: 't5', status: 'weird' }),
  ]);
  expect(out.pending.map((t) => t.id)).toEqual(['t1']);
  expect(out.done.map((t) => t.id)).toEqual(['t2']);
  expect(out.ignored.map((t) => t.id)).toEqual(['t3']);
  expect(out.failed.map((t) => t.id)).toEqual(['t4']);
});

test('kindKeyOf / taskItemCount', () => {
  expect(kindKeyOf('skills')).toBe('collab.task.skills');
  expect(kindKeyOf('workflow')).toBe('collab.task.workflow');
  expect(kindKeyOf('other')).toBe('collab.task.skills');
  expect(taskItemCount(task())).toBe(2);
  expect(taskItemCount(task({ payload: { skills: ['a'], workflow: [{ id: 'w', label: 'W' }], count: 0 } }))).toBe(2);
});

test('distCardOf：只有 dist 消息返回卡片模型，含类型与地址', () => {
  expect(distCardOf({ kind: 'text', meta: {} })).toBeNull();
  expect(distCardOf({ kind: 'dist' })).toBeNull();
  const card = distCardOf({
    kind: 'dist',
    meta: { type: 'workflow', name: 'skills/a.zip', url: 'http://x/y', count: 3, workflow: [{ id: 'w', label: 'W' }] },
  });
  expect(card).toEqual({ type: 'workflow', name: 'skills/a.zip', url: 'http://x/y', count: 3 });
});
