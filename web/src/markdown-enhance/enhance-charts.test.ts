// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { enhanceCharts } from '@devflow/shared/markdown-charts';
import { enhanceMarkdown } from '@devflow/shared/markdown-client';

function fakeEcharts() {
  return {
    init: () => ({
      setOption: () => {},
      resize: () => {},
      dispose: () => {},
    }),
  };
}

describe('enhanceCharts', () => {
  it('把 xychart/pie 的 pre.mermaid 换成 .md-echart，其余 Mermaid 保留', async () => {
    const host = document.createElement('div');
    host.innerHTML = [
      '<pre class="mermaid">pie title X\n  "a" : 1</pre>',
      '<pre class="mermaid">xychart-beta\n  x-axis [a, b]\n  line [1, 2]</pre>',
      '<pre class="mermaid">sequenceDiagram\nA->>B: hi</pre>',
    ].join('\n');

    const items = await enhanceCharts(host, fakeEcharts());

    expect(items).toHaveLength(2);
    expect(host.querySelectorAll('.md-echart')).toHaveLength(2);
    expect(host.querySelectorAll('pre.mermaid')).toHaveLength(1);
    expect(host.querySelector('pre.mermaid')!.textContent).toContain('sequenceDiagram');
  });

  it('没有 ECharts 时不做任何改动', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<pre class="mermaid">pie title X\n  "a" : 1</pre>';
    const items = await enhanceCharts(host, null);
    expect(items).toHaveLength(0);
    expect(host.querySelector('pre.mermaid')).not.toBeNull();
  });
});

describe('enhanceMarkdown（统一入口）', () => {
  it('同一入口同时处理表格回调、ECharts 与 Mermaid', async () => {
    const host = document.createElement('div');
    host.innerHTML = [
      '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
      '<pre class="mermaid">pie title X\n  "a" : 1</pre>',
      '<pre class="mermaid">sequenceDiagram\nA->>B: hi</pre>',
    ].join('\n');
    const mermaid = {
      initialize: () => {},
      render: async () => ({ svg: '<svg data-mm="1"></svg>' }),
    };

    let tableCalls = 0;
    const items = await enhanceMarkdown(host, {
      echarts: fakeEcharts(),
      mermaid,
      enhanceTables: (root) => {
        tableCalls += 1;
        const table = root.querySelector('table')!;
        const marker = document.createElement('div');
        marker.className = 'md-el-table';
        table.replaceWith(marker);
        return [{ host: marker, dispose: () => {} }];
      },
    });

    expect(tableCalls).toBe(1);
    expect(host.querySelector('.md-el-table')).not.toBeNull();
    expect(host.querySelectorAll('.md-echart')).toHaveLength(1);
    expect(host.querySelector('svg[data-mm="1"]')).not.toBeNull();
    expect(items).toHaveLength(2);
  });
});
