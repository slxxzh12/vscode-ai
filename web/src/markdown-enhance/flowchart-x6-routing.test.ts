// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { enhanceMarkdown } from '@devflow/shared/markdown-client';

const CODE = [
  'flowchart TD',
  '  A[开始] --> B{判断}',
  '  B -->|是| C[完成]',
  '  style A fill:#f00,stroke:#0f0',
].join('\n');

describe('flowchart X6 路由', () => {
  it('含 style 行的流程图走 X6，而不是回退 Mermaid', async () => {
    const host = document.createElement('div');
    host.innerHTML = `<pre class="mermaid">${CODE}</pre>`;
    const calls: any[] = [];
    let mermaidCalls = 0;

    const items = await enhanceMarkdown(host, {
      loadFlowX6: async () => ({
        renderFlowchartX6: (el: HTMLElement, spec: any) => {
          calls.push(spec);
          const node = document.createElement('div');
          node.className = 'x6-host';
          el.appendChild(node);
          return { dispose() {} };
        },
      }),
      mermaid: {
        initialize: () => {},
        render: async () => { mermaidCalls += 1; return { svg: '<svg></svg>' }; },
      },
    });

    expect(mermaidCalls).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('flowchart');
    expect(host.querySelector('pre.mermaid')).toBeNull();
    expect(host.querySelector('.x6-host')).not.toBeNull();
    expect(items).toHaveLength(1);
  });
});
