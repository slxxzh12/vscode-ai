import { describe, it, expect } from 'vitest';
import { appendPromptToWorkflow, promptAbbr, collectToMyWorkflow, updatePromptText, MY_WF_ID, MY_STAGE_ID } from './promptCollect';
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

describe('updatePromptText', () => {
  it('覆盖指定下标文本，返回 ok，入参不被修改', () => {
    const list = seed();
    const snapshot = JSON.stringify(list);
    const r = updatePromptText(list, 'w1', 's1', 1, 'B2');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.list[0].stages[0].prompts).toEqual(['a', 'B2']);
    expect(JSON.stringify(list)).toBe(snapshot);
    expect(r.list).not.toBe(list);
    expect(r.list[0].stages[0]).not.toBe(list[0].stages[0]);
  });

  it('保留原始文本（含换行与首尾空白）', () => {
    const r = updatePromptText(seed(), 'w1', 's1', 0, '  line1\nline2  ');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.list[0].stages[0].prompts[0]).toBe('  line1\nline2  ');
  });

  it('空 / 纯空白 → empty，列表不变', () => {
    expect(updatePromptText(seed(), 'w1', 's1', 0, '').status).toBe('empty');
    expect(updatePromptText(seed(), 'w1', 's1', 0, '   ').status).toBe('empty');
  });

  it('工作流 / 阶段 / 下标不存在 → 对应错误', () => {
    expect(updatePromptText(seed(), 'nope', 's1', 0, 'x').status).toBe('no-workflow');
    expect(updatePromptText(seed(), 'w1', 'nope', 0, 'x').status).toBe('no-stage');
    expect(updatePromptText(seed(), 'w1', 's1', 9, 'x').status).toBe('out-of-range');
    expect(updatePromptText(seed(), 'w1', 's2', 0, 'x').status).toBe('out-of-range');
  });
});

const LABELS = { wfId: MY_WF_ID, wfLabel: 'Mine', stageId: MY_STAGE_ID, stageLabel: 'Common' };

describe('promptAbbr', () => {
  it('取第一个换行前的内容并 trim', () => {
    expect(promptAbbr('  line1\nline2  ')).toBe('line1');
  });
  it('单行原样返回', () => {
    expect(promptAbbr('hello')).toBe('hello');
  });
  it('超过 max 截断并加省略号', () => {
    const s = promptAbbr('x'.repeat(50), 40);
    expect(s).toBe('x'.repeat(40) + '…');
  });
  it('空 / 纯空白返回空串', () => {
    expect(promptAbbr('')).toBe('');
    expect(promptAbbr('   \n ')).toBe('');
    expect(promptAbbr(null as unknown as string)).toBe('');
  });
});

describe('collectToMyWorkflow', () => {
  it('空列表 → 新建「我的工作流」，完整原文写入', () => {
    const list: Workflow[] = [];
    const snapshot = JSON.stringify(list);
    const r = collectToMyWorkflow(list, 'hello', LABELS);
    expect(r.status).toBe('ok');
    expect(r.workflowId).toBe(MY_WF_ID);
    expect(r.stageId).toBe(MY_STAGE_ID);
    expect(r.list[0].id).toBe(MY_WF_ID);
    expect(r.list[0].label).toBe('Mine');
    expect(r.list[0].stages[0].id).toBe(MY_STAGE_ID);
    expect(r.list[0].stages[0].label).toBe('Common');
    expect(r.list[0].stages[0].prompts).toEqual(['hello']);
    expect(JSON.stringify(list)).toBe(snapshot);
  });

  it('已有同 id 工作流 → 复用它并追加（不新建重复）', () => {
    const list: Workflow[] = [{ id: MY_WF_ID, label: 'Mine', stages: [{ id: MY_STAGE_ID, label: 'Common', prompts: ['a'] }] }];
    const r = collectToMyWorkflow(list, 'b', LABELS);
    expect(r.status).toBe('ok');
    expect(r.list).toHaveLength(1);
    expect(r.list[0].stages[0].prompts).toEqual(['a', 'b']);
  });

  it('已有同 id 工作流但无阶段 → 补一个阶段后写入', () => {
    const list: Workflow[] = [{ id: MY_WF_ID, label: 'Mine', stages: [] }];
    const r = collectToMyWorkflow(list, 'b', LABELS);
    expect(r.status).toBe('ok');
    expect(r.list[0].stages[0].id).toBe(MY_STAGE_ID);
    expect(r.list[0].stages[0].prompts).toEqual(['b']);
  });

  it('重复文本 → exists 且列表不变', () => {
    const list: Workflow[] = [{ id: MY_WF_ID, label: 'Mine', stages: [{ id: MY_STAGE_ID, label: 'Common', prompts: ['a'] }] }];
    const r = collectToMyWorkflow(list, '  a  ', LABELS);
    expect(r.status).toBe('exists');
    expect(r.list[0].stages[0].prompts).toEqual(['a']);
  });

  it('空 / 纯空白文本 → exists 且不创建工作流', () => {
    const r = collectToMyWorkflow([], '   ', LABELS);
    expect(r.status).toBe('exists');
    expect(r.list).toEqual([]);
  });
});
