import { describe, it, expect } from 'vitest';
import { appendPromptToWorkflow } from './promptCollect';
import type { Workflow } from '../workflowModel';

function seed(): Workflow[] {
  return [
    {
      id: 'w1', label: 'W1',
      stages: [
        { id: 's1', label: 'S1', prompts: ['a', 'b'] },
        { id: 's2', label: 'S2', prompts: [] },
      ],
    },
    { id: 'w2', label: 'W2', stages: [] },
  ];
}

describe('appendPromptToWorkflow', () => {
  it('追加成功：返回 ok，目标阶段末尾新增原文本，入参不被修改', () => {
    const list = seed();
    const snapshot = JSON.stringify(list);
    const r = appendPromptToWorkflow(list, 'w1', 's2', 'hello');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.list[0].stages[1].prompts).toEqual(['hello']);
    expect(JSON.stringify(list)).toBe(snapshot);
    expect(r.list).not.toBe(list);
    expect(r.list[0]).not.toBe(list[0]);
    expect(r.list[0].stages).not.toBe(list[0].stages);
    expect(r.list[0].stages[1]).not.toBe(list[0].stages[1]);
  });

  it('保留原始文本（含换行与首尾空白）', () => {
    const r = appendPromptToWorkflow(seed(), 'w1', 's2', '  line1\nline2  ');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.list[0].stages[1].prompts).toEqual(['  line1\nline2  ']);
  });

  it('同阶段已有相同 trim 文本 → exists，列表不变', () => {
    const list = seed();
    const r = appendPromptToWorkflow(list, 'w1', 's1', '  a  ');
    expect(r.status).toBe('exists');
    if (r.status !== 'exists') return;
    expect(r.list[0].stages[0].prompts).toEqual(['a', 'b']);
  });

  it('不同阶段相同文本不算重复', () => {
    const r = appendPromptToWorkflow(seed(), 'w1', 's2', 'a');
    expect(r.status).toBe('ok');
  });

  it('空 / 纯空白文本 → exists，不追加', () => {
    expect(appendPromptToWorkflow(seed(), 'w1', 's2', '').status).toBe('exists');
    expect(appendPromptToWorkflow(seed(), 'w1', 's2', '   ').status).toBe('exists');
  });

  it('工作流不存在 → no-workflow', () => {
    expect(appendPromptToWorkflow(seed(), 'nope', 's1', 'x').status).toBe('no-workflow');
  });

  it('阶段不存在 / 工作流无阶段 / 空列表 → no-stage / no-workflow', () => {
    expect(appendPromptToWorkflow(seed(), 'w1', 'nope', 'x').status).toBe('no-stage');
    expect(appendPromptToWorkflow(seed(), 'w2', 's1', 'x').status).toBe('no-stage');
    expect(appendPromptToWorkflow([], 'w1', 's1', 'x').status).toBe('no-workflow');
  });
});
