import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeWorkflowList, preferLocalFirst } from '../collaboration/workflow-merge.js';

const wf = (id, label, stageCount = 1) => ({
  id, label, stages: Array.from({ length: stageCount }, (_, i) => ({ id: `${id}-s${i}`, label: `S${i}`, prompts: ['p'] })),
});

test('同名（label）覆盖内容，保留本地 id', () => {
  const cur = [wf('local-1', '开发流程', 1)];
  const out = mergeWorkflowList(cur, [wf('remote-9', '开发流程', 3)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'local-1', 'id 保留本地');
  assert.equal(out[0].label, '开发流程');
  assert.equal(out[0].stages.length, 3, '内容用新版本');
});

test('label 比较去首尾空格；未命中的按 id 新增', () => {
  const cur = [wf('a', '流程A')];
  const out = mergeWorkflowList(cur, [wf('b', ' 流程A '), wf('c', '流程B')]);
  assert.equal(out.length, 2);
  assert.equal(out.find((w) => w.label === '流程A').id, 'a');
  assert.ok(out.find((w) => w.id === 'c'), '新工作流按 id 落库');
});

test('同 id 不同名：兼容旧行为，仍然覆盖', () => {
  const cur = [wf('same', '旧名', 1)];
  const out = mergeWorkflowList(cur, [wf('same', '新名', 2)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, '新名');
  assert.equal(out[0].stages.length, 2);
});

test('忽略脏数据；本地顺序稳定', () => {
  const cur = [wf('a', 'A'), wf('b', 'B')];
  const out = mergeWorkflowList(cur, [null, {}, { id: 'x' }]);
  assert.deepEqual(out.map((w) => w.id), ['a', 'b'], '无 label/stages 的项不落库');
  const out2 = mergeWorkflowList(cur, [wf('c', 'C')]);
  assert.deepEqual(out2.map((w) => w.id), ['a', 'b', 'c'], '新增追加在末尾');
});

test('preferLocalFirst 把本地自定义工作流排在最前，其余保持原顺序', () => {
  const list = [wf('a', 'A'), wf('b', 'B'), wf('c', 'C')];
  const out = preferLocalFirst(list, [{ id: 'b-remote', label: 'B' }, { id: 'c-remote', label: 'C' }]);
  assert.deepEqual(out.map((w) => w.id), ['b', 'c', 'a']);
  assert.deepEqual(list.map((w) => w.id), ['a', 'b', 'c'], '不修改入参');
});
