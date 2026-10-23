import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPartition, assignPartitions } from '../scheduler/queue/partition.js';

test('hashPartition 稳定且落在范围内', () => {
  assert.equal(hashPartition('scheduler.jobs', 't_1', 16), hashPartition('scheduler.jobs', 't_1', 16));
  for (const id of ['t_1', 't_2', 't_3', 't_4']) {
    const p = hashPartition('scheduler.jobs', id, 16);
    assert.ok(p >= 0 && p < 16);
  }
});

test('assignPartitions 轮转均分', () => {
  const map = assignPartitions(['a', 'b', 'c'], 16);
  assert.deepEqual(map.get('a'), [0, 3, 6, 9, 12, 15]);
  assert.deepEqual(map.get('b'), [1, 4, 7, 10, 13]);
  assert.deepEqual(map.get('c'), [2, 5, 8, 11, 14]);
});

test('没有 worker 时返回空 Map', () => {
  assert.equal(assignPartitions([], 16).size, 0);
});
