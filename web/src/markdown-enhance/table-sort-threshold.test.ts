// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { enhanceSimpleTables } from '@devflow/shared/markdown-client';
import { disposeMarkdown, enhanceMarkdown } from './index';

function tableHtml(rowCount: number) {
  const rows = Array.from({ length: rowCount }, (_, i) => `<tr><td>v${i}</td></tr>`).join('');
  return `<table class="md-table"><thead><tr><th>Col</th></tr></thead><tbody>${rows}</tbody></table>`;
}

describe('Markdown 表格排序阈值', () => {
  it('静态页：20 行以内不添加排序', () => {
    const host = document.createElement('div');
    host.innerHTML = tableHtml(20);
    enhanceSimpleTables(host);
    expect(host.querySelectorAll('th.df-sortable')).toHaveLength(0);
  });

  it('静态页：超过 20 行才添加排序', () => {
    const host = document.createElement('div');
    host.innerHTML = tableHtml(21);
    enhanceSimpleTables(host);
    expect(host.querySelectorAll('th.df-sortable')).toHaveLength(1);
  });

  it('Web 预览：20 行以内不渲染排序图标', async () => {
    const host = document.createElement('div');
    host.innerHTML = tableHtml(20);
    document.body.appendChild(host);
    await enhanceMarkdown(host);
    expect(host.querySelectorAll('.caret-wrapper')).toHaveLength(0);
    disposeMarkdown(host);
    host.remove();
  });

  it('Web 预览：超过 20 行渲染排序图标', async () => {
    const host = document.createElement('div');
    host.innerHTML = tableHtml(21);
    document.body.appendChild(host);
    await enhanceMarkdown(host);
    expect(host.querySelectorAll('.caret-wrapper').length).toBeGreaterThan(0);
    disposeMarkdown(host);
    host.remove();
  });
});
