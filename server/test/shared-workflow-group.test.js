import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptStepId, expandGroupSteps, groupAnchorStages } from '@devflow/shared/workflow-group';

const STAGES = [
  { id: 'a', label: 'A', group: 'G1', prompts: ['p-a0', 'p-a1'] },
  { id: 'b', label: 'B', group: 'G1', prompts: ['p-b0'] },
  { id: 'c', label: 'C', group: 'G2', prompts: ['p-c0'] },
  { id: 'd', label: 'D', group: '', prompts: ['p-d0'] },
  { id: 'e', label: 'E', group: '', prompts: [] },
];

test('promptStepId 拼接 stageId 与序号', () => {
  assert.equal(promptStepId('a', 0), 'a#0');
  assert.equal(promptStepId('code', 3), 'code#3');
});

test('groupAnchorStages 取连续同名 group', () => {
  const band = groupAnchorStages(STAGES, 'b');
  assert.equal(band.group, 'G1');
  assert.deepEqual(band.stages.map((s) => s.id), ['a', 'b']);
  assert.equal(groupAnchorStages(STAGES, 'ghost'), null);
});

test('expandGroupSteps 摊平为线性步骤并带稳定 ID', () => {
  const out = expandGroupSteps(STAGES, 'a');
  assert.equal(out.group, 'G1');
  assert.deepEqual(out.steps.map((s) => s.id), ['a#0', 'a#1', 'b#0']);
  assert.deepEqual(out.steps.map((s) => s.index), [0, 1, 2]);
  assert.equal(out.steps[0].text, 'p-a0');
  assert.equal(out.steps[0].type, 'prompt');
});

test('expandGroupSteps 空分组返回空 steps', () => {
  const out = expandGroupSteps(STAGES, 'd');
  assert.deepEqual(out.steps.map((s) => s.id), ['d#0']);
});

test('stage type=cmd 时步骤类型为 cmd', () => {
  const stages = [{ id: 'x', label: 'X', group: 'G', type: 'cmd', prompts: ['npm test'] }];
  const out = expandGroupSteps(stages, 'x');
  assert.equal(out.steps[0].type, 'cmd');
});
