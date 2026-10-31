// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { extractTable } from './table';

function makeTable(html: string): HTMLTableElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  return wrap.querySelector('table') as HTMLTableElement;
}

describe('extractTable', () => {
  it('提取表头与单元格 HTML', () => {
    const table = makeTable(
      '<table><thead><tr><th>Name</th><th>Age</th></tr></thead>' +
        '<tbody><tr><td><b>Alice</b></td><td>30</td></tr>' +
        '<tr><td>Bob</td><td><code>25</code></td></tr></tbody></table>',
    );
    expect(extractTable(table)).toEqual({
      headers: ['Name', 'Age'],
      rows: [
        ['<b>Alice</b>', '30'],
        ['Bob', '<code>25</code>'],
      ],
    });
  });

  it('合并单元格返回 null', () => {
    const table = makeTable(
      '<table><thead><tr><th colspan="2">Wide</th></tr></thead>' +
        '<tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
    );
    expect(extractTable(table)).toBeNull();
  });

  it('嵌套表格返回 null', () => {
    const table = makeTable(
      '<table><thead><tr><th>A</th></tr></thead>' +
        '<tbody><tr><td><table><tr><td>x</td></tr></table></td></tr></tbody></table>',
    );
    expect(extractTable(table)).toBeNull();
  });

  it('没有 thead 返回 null', () => {
    const table = makeTable('<table><tbody><tr><td>a</td></tr></tbody></table>');
    expect(extractTable(table)).toBeNull();
  });
});
