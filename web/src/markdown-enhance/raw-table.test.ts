// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { markRawTables } from '@devflow/shared/markdown-client';
import { disposeMarkdown, enhanceMarkdown } from './index';

describe('原始 HTML 表格', () => {
  it('标记 raw 表格，并识别 border="0" 无边框', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<table><tr><td>a</td></tr></table>' +
      '<table border="0"><tr><td>b</td></tr></table>';
    markRawTables(host);
    const [bordered, borderless] = Array.from(host.querySelectorAll('table'));
    expect(bordered.classList.contains('md-raw-table')).toBe(true);
    expect(bordered.classList.contains('md-raw-table--borderless')).toBe(false);
    expect(borderless.classList.contains('md-raw-table--borderless')).toBe(true);
  });

  it('嵌套表格保持原生结构，不转 Element Plus', async () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<table><thead><tr><th>A</th></tr></thead>' +
      '<tbody><tr><td><table><thead><tr><th>B</th></tr></thead>' +
      '<tbody><tr><td>x</td></tr></tbody></table></td></tr></tbody></table>';
    document.body.appendChild(host);

    await enhanceMarkdown(host);

    const outer = host.querySelector('table');
    expect(outer).not.toBeNull();
    expect(outer!.closest('.md-el-table')).toBeNull();
    expect(outer!.classList.contains('md-raw-table')).toBe(true);

    disposeMarkdown(host);
    host.remove();
  });
});
