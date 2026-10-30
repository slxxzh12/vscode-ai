// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { disposeMarkdown, enhanceMarkdown } from './index';
import { extractTable } from './table';

describe('enhanceMarkdown 表格', () => {
  it('重复增强同一容器不会生成第二个表头', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<table><thead><tr><th>A</th><th>B</th></tr></thead>'
      + '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>';
    document.body.appendChild(host);
    expect(extractTable(host.querySelector('table') as HTMLTableElement)).not.toBeNull();

    await enhanceMarkdown(host);
    expect(host.querySelectorAll('.md-el-table').length).toBe(1);
    expect(host.querySelectorAll('.el-table__header-wrapper').length).toBe(1);

    await enhanceMarkdown(host);
    expect(host.querySelectorAll('.md-el-table').length).toBe(1);
    expect(host.querySelectorAll('.el-table__header-wrapper').length).toBe(1);

    disposeMarkdown(host);
    host.remove();
  });
});
