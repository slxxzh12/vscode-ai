// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { groupMermaidSides } from '../markdown';

describe('groupMermaidSides', () => {
  it('相邻的 mermaid-side 合并到一个 mermaid-row，普通 mermaid 不受影响', () => {
    const host = document.createElement('div');
    host.innerHTML = [
      '<pre class="mermaid mermaid-side">a</pre>',
      '<pre class="mermaid mermaid-side">b</pre>',
      '<pre class="mermaid">c</pre>',
    ].join('\n');

    groupMermaidSides(host);

    const row = host.querySelector('.mermaid-row');
    expect(row).not.toBeNull();
    expect(row!.querySelectorAll('pre.mermaid-side').length).toBe(2);
    expect(Array.from(host.children).filter((el) => el.matches('pre.mermaid')).length).toBe(1);
  });
});
