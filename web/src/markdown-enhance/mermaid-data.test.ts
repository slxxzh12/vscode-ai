// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { enhanceDataCharts } from '@devflow/shared/markdown-client';

describe('enhanceDataCharts', () => {
  it('执行脚本，把返回值换成 mermaid 块', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<pre class="mermaid-data" data-processed="false">return "pie title X\\n  \\"a\\" : 1"</pre>';
    await enhanceDataCharts(host, { dataErrorText: (m) => `ERR:${m}` });
    const pre = host.querySelector('pre.mermaid');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('pie title X');
    expect(host.querySelector('pre.mermaid-data')).toBeNull();
  });

  it('fetch 相对路径交给 readAsset', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<pre class="mermaid-data" data-processed="false">const t = await (await fetch("./a.csv")).text(); return "pie title " + t</pre>';
    const calls: string[] = [];
    await enhanceDataCharts(host, {
      readAsset: async (p) => { calls.push(p); return 'X'; },
      dataErrorText: (m) => m,
    });
    expect(calls).toEqual(['./a.csv']);
    expect(host.querySelector('pre.mermaid')!.textContent).toContain('pie title X');
  });

  it('返回空内容 → 错误节点', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<pre class="mermaid-data" data-processed="false">return "   "</pre>';
    await enhanceDataCharts(host, { dataErrorText: (m) => `ERR:${m}` });
    const pre = host.querySelector('pre.mermaid-data-error');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('ERR:');
  });
});
