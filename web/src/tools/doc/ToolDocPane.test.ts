// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountC } from '../../test-utils';

const h = vi.hoisted(() => ({
  newFile: vi.fn(),
  activeId: { value: '' },
}));

vi.mock('../../components/DocViewer.vue', () => ({
  default: { name: 'DocViewer', template: '<div class="dv" />' },
}));
vi.mock('../useToolWorkbench', () => ({
  useToolWorkbench: () => ({
    tool: 'notepad',
    activeId: h.activeId,
    leafName: { value: '' },
    docSource: {},
    newFile: h.newFile,
  }),
}));

import ToolDocPane from './ToolDocPane.vue';

describe('ToolDocPane', () => {
  beforeEach(() => { h.newFile.mockReset(); h.activeId.value = ''; });

  it('空状态双击 → 调用 newFile', async () => {
    const w = mountC(ToolDocPane, { props: { tool: 'notepad' } });
    expect(w.find('.tdp-empty').exists()).toBe(true);
    await w.find('.tdp-empty').trigger('dblclick');
    expect(h.newFile).toHaveBeenCalledTimes(1);
  });

  it('有活动文件时不渲染空状态，改为显示 DocViewer', () => {
    h.activeId.value = 'a.txt';
    const w = mountC(ToolDocPane, { props: { tool: 'notepad' } });
    expect(w.find('.tdp-empty').exists()).toBe(false);
    expect(w.find('.dv').exists()).toBe(true);
  });
});
