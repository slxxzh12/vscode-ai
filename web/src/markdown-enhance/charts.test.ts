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

  it('解析多条带名称的折线与柱状系列', () => {
    const spec = parseMermaidChart([
      'xychart-beta',
      '  x-axis [Q1, Q2]',
      '  line "华东" [1, 2]',
      '  line "华南" [3, 4]',
      '  bar "线上" [5, 6]',
    ].join('\n'));
    expect(spec).toMatchObject({
      kind: 'xychart',
      series: [
        { type: 'line', name: '华东', data: [1, 2] },
        { type: 'line', name: '华南', data: [3, 4] },
        { type: 'bar', name: '线上', data: [5, 6] },
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

  it('解析 gantt 的任务、依赖与状态', () => {
    const spec = parseMermaidChart([
      'gantt',
      '  title 阶段进度',
      '  dateFormat YYYY-MM-DD',
      '  section 开发',
      '  需求 :done, a1, 2026-10-01, 3d',
      '  开发 :active, a2, after a1, 5d',
      '  发布 :milestone, m1, 2026-10-20, 0d',
    ].join('\n'));
    expect(spec).toMatchObject({
      kind: 'gantt',
      title: '阶段进度',
      tasks: [
        { name: '需求', section: '开发', tag: 'done' },
        { name: '开发', section: '开发', tag: 'active' },
        { name: '发布', section: '开发', tag: 'milestone' },
      ],
    });
    const tasks = (spec as any).tasks;
    expect(tasks[1].start).toBe(tasks[0].end);
    expect(tasks[1].end - tasks[1].start).toBe(5 * 86400000);
    expect(tasks[2].start).toBe(tasks[2].end);
  });

  it('解析 timeline 的 period / section / 续行事件', () => {
    const spec = parseMermaidChart([
      'timeline',
      '  title 发布进度',
      '  section 开发',
      '  2026-10-01 : 需求评审 : 方案设计',
      '  2026-10-10 : 编码',
      '       : 联调',
    ].join('\n'));
    expect(spec).toMatchObject({
      kind: 'timeline',
      title: '发布进度',
      periods: [
        { period: '2026-10-01', section: '开发', events: ['需求评审', '方案设计'] },
        { period: '2026-10-10', section: '开发', events: ['编码', '联调'] },
      ],
    });
  });

  it('解析线性阶段流程图的节点、连线和状态样式', () => {
    const spec = parseMermaidChart([
      'flowchart LR',
      '  S1["✅ 需求"] --> S2["✅ 设计"] --> S3["🔄 开发"] --> S4["⏳ 发布"]',
      '  classDef done fill:#2ea043,stroke:#1a7f37,color:#fff;',
      '  classDef doing fill:#f5a524,stroke:#b45309,color:#111;',
      '  class S1,S2 done;',
      '  class S3 doing;',
    ].join('\n'));
    expect(spec).toMatchObject({
      kind: 'flowchart',
      direction: 'LR',
      edges: [
        { source: 'S1', target: 'S2', label: '' },
        { source: 'S2', target: 'S3', label: '' },
        { source: 'S3', target: 'S4', label: '' },
      ],
    });
    const nodes = (spec as any).nodes;
    expect(nodes.map((n: any) => n.label)).toEqual(['✅ 需求', '✅ 设计', '🔄 开发', '⏳ 发布']);
    expect(nodes[0].fill).toBe('#2ea043');
    expect(nodes[2].fill).toBe('#f5a524');
  });

  it('解析子图流程：子图横向并排，子图内节点横向排列', () => {
    const spec = parseMermaidChart([
      'flowchart LR',
      '  subgraph P1["第一段"]',
      '    direction LR',
      '    A[开始] --> B[校验] --> C[处理]',
      '  end',
      '  subgraph P2["第二段"]',
      '    direction LR',
      '    D[写入] --> E[通知] --> F[结束]',
      '  end',
      '  C --> D',
    ].join('\n')) as any;
    expect(spec).toMatchObject({ kind: 'flowchart' });
    expect(spec.groups.map((g: any) => g.label)).toEqual(['第一段', '第二段']);
    expect(spec.groups[0].x).toBeLessThan(spec.groups[1].x);
    const node = (id: string) => spec.nodes.find((n: any) => n.id === id);
    expect(node('A').x).toBeLessThan(node('B').x);
    expect(node('A').y).toBeCloseTo(node('B').y, 3);
    expect(node('D').x).toBeLessThan(node('E').x);
    expect(node('D').y).toBeCloseTo(node('E').y, 3);
    expect(spec.edges).toContainEqual({ source: 'C', target: 'D', label: '' });
  });

  it('解析 %% x6-positions 并覆盖节点/子图坐标', () => {
    const spec = parseMermaidChart([
      'flowchart TD',
      '  A[开始] --> B[结束]',
      '%% x6-positions: {"A":{"x":10,"y":20},"g1":{"x":0,"y":0,"w":200,"h":120}}',
    ].join('\n')) as any;
    const a = spec.nodes.find((n: any) => n.id === 'A');
    expect(a.x).toBe(10 + a.w / 2);
    expect(a.y).toBe(20 + a.h / 2);
  });

  it('gantt chevron 按持续时间生成箭头时间轴段', () => {
    const spec = parseMermaidChart([
      'gantt chevron',
      '  title 阶段耗时',
      '  需求 :done, a1, 2026-10-01, 2d',
      '  开发 :active, a2, after a1, 8d',
      '  发布 :milestone, m1, after a2, 0d',
    ].join('\n'));
    expect(spec).toMatchObject({ kind: 'chevron', title: '阶段耗时' });
    const segments = (spec as any).segments;
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ label: '需求', weight: 2 });
    expect(segments[1]).toMatchObject({ label: '开发', weight: 8 });
    expect(segments[2]).toMatchObject({ label: '发布', weight: 2.5 });
  });

  it('timeline chevron 生成等宽箭头时间轴段', () => {
    const spec = parseMermaidChart([
      'timeline chevron',
      '  2026 Q1 : 立项',
      '  2026 Q2 : 公测',
    ].join('\n'));
    expect(spec).toMatchObject({
      kind: 'chevron',
      segments: [
        { label: '2026 Q1', weight: 1 },
        { label: '2026 Q2', weight: 1 },
      ],
    });
  });

  it('非线性流程图与不支持的 Mermaid 返回 null', () => {
    expect(parseMermaidChart('graph LR\nA-->B\nA-->C')).toBeNull();
    expect(parseMermaidChart('graph LR\nsubgraph X\nA-->B\nend')).toBeNull();
    expect(parseMermaidChart('sequenceDiagram\nA->>B: hi')).toBeNull();
    expect(parseMermaidChart('')).toBeNull();
  });
});
