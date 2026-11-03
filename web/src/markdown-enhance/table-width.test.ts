// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { disposeMarkdown, enhanceMarkdown } from './index';

describe('table width directive', () => {
  it('data-md-table-width 会应用到增强后的表格容器', async () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<table data-md-table-width="60%"><thead><tr><th>A</th><th>B</th></tr></thead>' +
      '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>';
    document.body.appendChild(host);

    await enhanceMarkdown(host);
    const table = host.querySelector('.md-el-table') as HTMLElement;
    expect(table).not.toBeNull();
    expect(table.style.getPropertyValue('--md-table-width')).toBe('60%');

    disposeMarkdown(host);
    host.remove();
  });
});
