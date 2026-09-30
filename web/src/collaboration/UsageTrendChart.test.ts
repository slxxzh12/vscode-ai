// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { mountC } from '../test-utils';
import { EMPTY_SNAPSHOT } from './types';

const h = vi.hoisted(() => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  return { chart, init: vi.fn(() => chart), use: vi.fn() };
});
vi.mock('echarts/core', () => ({ use: h.use, init: h.init }));
vi.mock('echarts/charts', () => ({ LineChart: {} }));
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

import UsageTrendChart from './UsageTrendChart.vue';

afterEach(() => { h.chart.setOption.mockClear(); h.init.mockClear(); vi.unstubAllGlobals(); });

describe('UsageTrendChart', () => {
  it('纵轴与 tooltip 用 K/M 格式化', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ daily: {} }) })));
    const collab = { state: ref(EMPTY_SNAPSHOT) } as any;
    const w = mountC(UsageTrendChart, { props: { collab, peers: {} } });
    await flushPromises();
    const opt: any = h.chart.setOption.mock.calls.at(-1)?.[0];
    expect(typeof opt.yAxis.axisLabel.formatter).toBe('function');
    expect(opt.yAxis.axisLabel.formatter(1500)).toBe('1.5K');
    expect(opt.yAxis.axisLabel.formatter(2_000_000)).toBe('2.0M');
    expect(opt.tooltip.valueFormatter(1500)).toBe('1.5K');
    w.unmount();
  });
});
