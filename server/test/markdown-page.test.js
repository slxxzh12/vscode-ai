import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdownDocument } from '../markdown-page.js';

test('mermaid-data 页面注入 mermaid/echarts/client 脚本', () => {
  const html = renderMarkdownDocument('```mermaid-data\nreturn "pie title X\\n  \\"a\\" : 1"\n```', 't');
  assert.match(html, /class="mermaid-data"/);
  assert.match(html, /__devflow_mermaid__\.js/);
  assert.match(html, /__devflow_echarts__\.js/);
  assert.match(html, /__devflow_markdown__\.js/);
});
