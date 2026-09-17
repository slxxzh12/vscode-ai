// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';

const h = vi.hoisted(() => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  return { chart, init: vi.fn(() => chart), use: vi.fn() };
});
vi.mock('echarts/core', () => ({ use: h.use, init: h.init }));
vi.mock('echarts/charts', () => ({ PieChart: {} }));
vi.mock('echarts/components', () => ({ TooltipComponent: {}, LegendComponent: {} }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

import GroupPie from './GroupPie.vue';

afterEach(() => {
  h.chart.setOption.mockClear();
  h.chart.resize.mockClear();
  h.chart.dispose.mockClear();
  h.init.mockClear();
});

describe('GroupPie', () => {
  it('无数据不渲染也不初始化', () => {
    const w = mountC(GroupPie, { props: { slices: [] } });
    expect(w.find('.pie').exists()).toBe(false);
    expect(h.init).not.toHaveBeenCalled();
  });

  it('有数据绘制饼图；resize 触发 chart.resize；卸载 dispose', async () => {
    const w = mountC(GroupPie, { props: { slices: [{ name: '', value: 2 }, { name: 'A', value: 3 }], title: '标题' } });
    await flushPromises();
    expect(w.find('.pie').exists()).toBe(true);
    expect(w.find('.sub').text()).toBe('标题');
    expect(h.init).toHaveBeenCalled();
    expect(h.chart.setOption).toHaveBeenCalled();
    expect(h.chart.resize).toHaveBeenCalled();

    window.dispatchEvent(new Event('resize'));
    expect(h.chart.resize.mock.calls.length).toBeGreaterThan(1);

    w.unmount();
    expect(h.chart.dispose).toHaveBeenCalled();
  });

  it('slices 变化重新绘制', async () => {
    const w = mountC(GroupPie, { props: { slices: [{ name: 'A', value: 1 }] } });
    await flushPromises();
    const first = h.chart.setOption.mock.calls.length;
    await w.setProps({ slices: [{ name: 'B', value: 2 }] });
    await flushPromises();
    expect(h.chart.setOption.mock.calls.length).toBeGreaterThan(first);
    w.unmount();
  });

  it('无 title 不渲染标题', async () => {
    const w = mountC(GroupPie, { props: { slices: [{ name: 'A', value: 1 }] } });
    await flushPromises();
    expect(w.find('.sub').exists()).toBe(false);
    w.unmount();
  });
});
