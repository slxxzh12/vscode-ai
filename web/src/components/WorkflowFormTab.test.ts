// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mountC } from '../test-utils';
import WorkflowFormTab from './WorkflowFormTab.vue';

describe('WorkflowFormTab', () => {
  it('提示词展示首行缩写标签，title 为完整原文', () => {
    const model = [{ id: 'w', label: 'W', stages: [{ id: 's', label: 'S', prompts: ['first line\nsecond line'] }] }];
    const w = mountC(WorkflowFormTab, { props: { model }, global: { stubs: { CodeEditor: true } } });
    const abbr = w.find('.pabbr');
    expect(abbr.exists()).toBe(true);
    expect(abbr.text()).toBe('first line');
    expect(abbr.attributes('title')).toBe('first line\nsecond line');
  });
});
