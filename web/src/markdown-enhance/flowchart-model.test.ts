import { describe, it, expect } from 'vitest';
import { parseFlowchartModel, serializeFlowchartModel, replaceMermaidBlock } from '@devflow/shared/markdown-flowchart-model';

const SRC = [
  'flowchart TD',
  '  A[开始] --> B{判断}',
  '  B -->|是| C[完成]',
  '  classDef done fill:#2ea043;',
  '  class C done;',
].join('\n');

describe('flowchart model', () => {
  it('解析后保留原始节点形状与 classDef', () => {
    const m = parseFlowchartModel(SRC)!;
    expect(m.nodes.find((n) => n.id === 'A')!.shapeRaw).toBe('[开始]');
    const out = serializeFlowchartModel(m);
    expect(out).toContain('A[开始]');
    expect(out).toContain('B{判断}');
    expect(out).toContain('classDef done fill:#2ea043;');
  });

  it('改标签/加节点后生成合法 Mermaid 与坐标注释', () => {
    const m = parseFlowchartModel(SRC)!;
    m.nodes.find((n) => n.id === 'A')!.label = '启动';
    m.nodes.push({ id: 'D', label: '新增', shapeRaw: '', group: '', x: 10, y: 20, w: 120, h: 44 });
    m.positions.A = { x: 10, y: 20 };
    const out = serializeFlowchartModel(m);
    expect(out).toContain('A[启动]');
    expect(out).toContain('D[新增]');
    expect(out).toContain('%% x6-positions:');
  });

  it('子图节点在 subgraph 块内', () => {
    const m = parseFlowchartModel([
      'flowchart LR',
      '  subgraph P1["阶段"]',
      '    A[A] --> B[B]',
      '  end',
    ].join('\n'))!;
    const out = serializeFlowchartModel(m);
    expect(out).toContain('subgraph P1["阶段"]');
    expect(out).toContain('A[A]');
    expect(out).toContain('  end');
  });

  it('replaceMermaidBlock 只替换目标块', () => {
    const md = '# x\n```mermaid\na\n```\n```mermaid\nb\n```\n';
    const out = replaceMermaidBlock(md, 1, 'flowchart TD\n  X-->Y');
    expect(out).toContain('flowchart TD\n  X-->Y');
    expect(out.indexOf('```mermaid\na')).toBeGreaterThanOrEqual(0);
  });
});
