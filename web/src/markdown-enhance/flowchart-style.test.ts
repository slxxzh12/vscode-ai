import { describe, it, expect } from 'vitest';
import { parseMermaidChart } from './charts';

function nodeOf(spec: any, id: string) {
  return spec.nodes.find((n: any) => n.id === id);
}

describe('flowchart node colors', () => {
  it('style 指令给同一子图内的不同节点上不同颜色', () => {
    const spec = parseMermaidChart([
      'flowchart LR',
      '  subgraph P["Phase"]',
      '    A[Start] --> B[Doing] --> C[Done]',
      '  end',
      '  style A fill:#2ea043,stroke:#1a7f37,color:#fff',
      '  style B fill:#f5a524,stroke:#b45309,color:#111',
    ].join('\n')) as any;

    expect(nodeOf(spec, 'A').fill).toBe('#2ea043');
    expect(nodeOf(spec, 'B').fill).toBe('#f5a524');
    expect(nodeOf(spec, 'A').color).toBe('#fff');
    expect(nodeOf(spec, 'B').color).toBe('#111');
    expect(nodeOf(spec, 'C').fill).not.toBe(nodeOf(spec, 'A').fill);
  });

  it('style 指令覆盖 classDef', () => {
    const spec = parseMermaidChart([
      'flowchart LR',
      '  A[Start] --> B[End]',
      '  classDef done fill:#2ea043,stroke:#1a7f37',
      '  class A done',
      '  style A fill:#f5a524,stroke:#b45309',
    ].join('\n')) as any;

    expect(nodeOf(spec, 'A').fill).toBe('#f5a524');
    expect(nodeOf(spec, 'A').stroke).toBe('#b45309');
  });
});
