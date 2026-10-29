import { describe, it, expect } from 'vitest';
import { parseMermaidChart } from './charts';

describe('parseMermaidChart', () => {
  it('解析 xychart 的标题、坐标轴与混合系列', () => {
    const spec = parseMermaidChart([
      'xychart-beta',
      '    title "Sales Revenue"',
      '    x-axis "Quarter" [Q1, Q2, Q3]',
      '    y-axis "Revenue" 0 --> 100',
      '    bar [10, 30, 20]',
      '    line [15, 25, 35]',
    ].join('\n'));
    expect(spec).toEqual({
      kind: 'xychart',
      title: 'Sales Revenue',
      xTitle: 'Quarter',
      categories: ['Q1', 'Q2', 'Q3'],
      yTitle: 'Revenue',
      yMin: 0,
      yMax: 100,
      series: [
        { type: 'bar', data: [10, 30, 20] },
        { type: 'line', data: [15, 25, 35] },
      ],
    });
  });

  it('解析只有 line、没有轴标题的 xychart', () => {
    const spec = parseMermaidChart([
      'xychart-beta',
      '  x-axis [a, b]',
      '  line [1, 2]',
    ].join('\n'));
    expect(spec).toMatchObject({
      kind: 'xychart',
      title: '',
      xTitle: '',
      categories: ['a', 'b'],
      series: [{ type: 'line', data: [1, 2] }],
    });
  });

  it('类目与数据长度不一致时返回 null', () => {
    const spec = parseMermaidChart([
      'xychart-beta',
      '  x-axis [a, b, c]',
      '  line [1, 2]',
    ].join('\n'));
    expect(spec).toBeNull();
  });

  it('解析 pie 的标题与数据', () => {
    const spec = parseMermaidChart([
      'pie title Pets adopted',
      '    "Dogs" : 386',
      '    "Cats" : 85',
    ].join('\n'));
    expect(spec).toEqual({
      kind: 'pie',
      title: 'Pets adopted',
      data: [
        { name: 'Dogs', value: 386 },
        { name: 'Cats', value: 85 },
      ],
    });
  });

  it('pie 没有数据项时返回 null', () => {
    expect(parseMermaidChart('pie title Empty')).toBeNull();
  });

  it('非目标类型返回 null', () => {
    expect(parseMermaidChart('graph LR\nA-->B')).toBeNull();
    expect(parseMermaidChart('sequenceDiagram\nA->>B: hi')).toBeNull();
    expect(parseMermaidChart('')).toBeNull();
  });
});
