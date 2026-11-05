// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

const graphCalls: {
  options?: any;
  model?: any;
  fit?: any;
  resize?: number[];
} = {};

vi.mock('@antv/x6', () => ({
  Graph: class {
    constructor(options: any) { graphCalls.options = options; }
    fromJSON(model: any) { graphCalls.model = model; }
    zoomToFit(options: any) { graphCalls.fit = options; }
    resize(width: number, height: number) { graphCalls.resize = [width, height]; }
    dispose() { /* noop */ }
  },
}));

import { renderFlowchartX6 } from '@devflow/shared/markdown-flowchart-x6';

function tallSpec() {
  return {
    kind: 'flowchart',
    direction: 'TD',
    nodes: [
      { id: 'A', label: 'A', x: 100, y: 100, w: 120, h: 44, fill: '#fff', stroke: '#000', color: '#000' },
    ],
    edges: [],
    groups: [],
    width: 300,
    height: 2000,
  };
}

describe('renderFlowchartX6 视口', () => {
  it('高流程图不再压到 760px，文字保持可读', () => {
    const el = document.createElement('div');
    const spec = tallSpec();
    expect(spec.height).toBeGreaterThan(760);

    renderFlowchartX6(el, spec);

    expect(parseFloat(el.style.height)).toBe(1600);
    expect(graphCalls.options.height).toBe(1600);
    expect(graphCalls.fit.maxScale).toBe(1);
    expect(graphCalls.fit.minScale).toBe(0.8);
  });

  it('放在表格单元格里时给图表最小宽度，避免被单元格裁切', () => {
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    const el = document.createElement('div');
    td.appendChild(el);
    tr.appendChild(td);
    tbody.appendChild(tr);
    table.appendChild(tbody);
    document.body.appendChild(table);

    renderFlowchartX6(el, tallSpec());

    expect(el.style.minWidth).toBe('300px');

    table.remove();
  });
});
