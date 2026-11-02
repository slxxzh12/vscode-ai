import { describe, it, expect } from 'vitest';
import { buildFlowGraphModel } from '@devflow/shared/markdown-flowchart-graph';

const spec = {
  kind: 'flowchart',
  direction: 'TD',
  nodes: [{ id: 'A', label: '开始', group: '', x: 100, y: 80, w: 120, h: 44, fill: '#fff', stroke: '#000', color: '#111' }],
  groups: [{ id: 'g1', label: '阶段', x: 20, y: 20, width: 220, height: 140 }],
  edges: [{ source: 'A', target: 'B', label: '是' }],
  width: 300,
  height: 200,
};

describe('buildFlowGraphModel', () => {
  it('节点从中心坐标转左上角，边使用 manhattan 路由', () => {
    const m = buildFlowGraphModel(spec as any, { text: '#fff', axis: '#333' });
    const a = m.nodes.find((n) => n.id === 'A')!;
    expect(a.x).toBe(40);
    expect(a.y).toBe(58);
    const e = m.edges[0];
    expect(e.router.name).toBe('manhattan');
    expect(e.labels[0]).toMatchObject({ attrs: { label: { text: '是' } } });
  });
});
