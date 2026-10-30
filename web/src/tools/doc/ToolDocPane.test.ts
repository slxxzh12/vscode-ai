// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
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

  it('markdown / js 打开且无活动文件时自动新建并打开', async () => {
    mountC(ToolDocPane, { props: { tool: 'markdown' } });
    await flushPromises();
    expect(h.newFile).toHaveBeenCalledTimes(1);
    h.newFile.mockReset();
    mountC(ToolDocPane, { props: { tool: 'js' } });
    await flushPromises();
    expect(h.newFile).toHaveBeenCalledTimes(1);
  });

  it('notepad 打开时不会自动新建', async () => {
    mountC(ToolDocPane, { props: { tool: 'notepad' } });
    await flushPromises();
    expect(h.newFile).not.toHaveBeenCalled();
  });
});
