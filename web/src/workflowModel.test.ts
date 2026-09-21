import { describe, it, expect } from 'vitest';
import {
  validateModel, groupBands, moveItem, moveStageToIndex, duplicateWorkflow,
  duplicateStage, newWorkflow, newStage, sanitizeModel,
  type Workflow, type WorkflowStage,
} from './workflowModel';

const s = (over: Partial<WorkflowStage> = {}): WorkflowStage => ({ id: 's1', label: 'S', group: '', prompts: ['p'], ...over });
const w = (over: Partial<Workflow> = {}): Workflow => ({ id: 'w1', label: 'W', stages: [s()], ...over });

describe('validateModel', () => {
  it('空 id 与重复 id 报 error', () => {
    const m = [w({ id: '' }), w({ id: 'dup' }), w({ id: 'dup' })];
    const r = validateModel(m);
    expect(r.errors.some((e) => e.key === 'wfe.err.empty_id')).toBe(true);
    expect(r.errors.some((e) => e.key === 'wfe.err.dup_id' && e.params?.id === 'dup')).toBe(true);
  });
  it('同工作流内阶段重复 id 报 error', () => {
    const m = [w({ stages: [s({ id: 'x' }), s({ id: 'x' })] })];
    expect(validateModel(m).errors.some((e) => e.key === 'wfe.err.dup_id')).toBe(true);
  });
  it('空 label 与无提示语报 warning', () => {
    const m = [w({ label: '', stages: [s({ prompts: ['', '  '] })] })];
    const r = validateModel(m);
    expect(r.warnings.some((e) => e.key === 'wfe.warn.empty_label')).toBe(true);
    expect(r.warnings.some((e) => e.key === 'wfe.warn.empty_prompts')).toBe(true);
  });
});

describe('groupBands', () => {
  it('连续同名 group 聚合，异名断开', () => {
    const stages = [s({ id: 'a', group: 'G' }), s({ id: 'b', group: 'G' }), s({ id: 'c', group: '' }), s({ id: 'd', group: 'G' })];
    const bands = groupBands(stages);
    expect(bands.map((b) => b.name)).toEqual(['G', '', 'G']);
    expect(bands[0].stages.map((x) => x.id)).toEqual(['a', 'b']);
    expect(bands[0].startIndex).toBe(0);
    expect(bands[2].startIndex).toBe(3);
  });
});

describe('moveItem / moveStageToIndex', () => {
  it('moveItem 按最终下标移动', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
  });
  it('moveStageToIndex 可同时改 group', () => {
    const stages = [s({ id: 'a', group: 'G1' }), s({ id: 'b', group: 'G1' }), s({ id: 'c', group: 'G2' })];
    const next = moveStageToIndex(stages, 0, 2, 'G2');
    expect(next.map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(next[2].group).toBe('G2');
  });
});

describe('duplicate / new / sanitize', () => {
  it('复制生成新 id 且不改原对象', () => {
    const src = w();
    const copy = duplicateWorkflow(src, 'copy');
    expect(copy.id).not.toBe(src.id);
    expect(copy.stages[0].id).not.toBe(src.stages[0].id);
    expect(copy.label).toContain('copy');
    expect(src.label).toBe('W');
  });
  it('newWorkflow/newStage 带唯一 id', () => {
    expect(newWorkflow('x').id).not.toBe(newWorkflow('x').id);
    expect(newStage('y').id).not.toBe(newStage('y').id);
  });
  it('sanitizeModel 过滤空白提示语', () => {
    const m = [w({ stages: [s({ prompts: [' ', 'keep', ''] })] })];
    expect(sanitizeModel(m)[0].stages[0].prompts).toEqual(['keep']);
  });
  it('sanitizeModel 保留非 0 priority、丢弃非法', () => {
    const m = [w({ priority: 5 }), w({ id: 'x', priority: NaN as unknown as number })];
    const out = sanitizeModel(m);
    expect(out[0].priority).toBe(5);
    expect('priority' in out[1]).toBe(false);
  });
});
