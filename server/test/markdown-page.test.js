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

test('Markdown 样式按内容作用域注入，页面级样式进入 head', () => {
  const md = [
    '# 标题',
    '<style>.a { animation: fade 1s; }</style>',
    '<style data-scope="page">body { background: #000; }</style>',
    '<div class="a">x</div>',
  ].join('\n');
  const html = renderMarkdownDocument(md, 't');
  assert.match(html, /@scope \(\.md-body\)/);
  assert.match(html, /body \{ background: #000; \}/);
  assert.match(html, /<div class="a">x<\/div>/);
});

test('同级目录图片保留相对路径', () => {
  const html = renderMarkdownDocument(
    '# t\n\n![pic](sample-image.svg)\n\n<img src="sample-image.svg" alt="x">',
    't',
  );
  assert.equal((html.match(/<img src="sample-image.svg"/g) || []).length, 2);
});

test('静态页移除脚本并保留内联 SVG', () => {
  const html = renderMarkdownDocument(
    '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg><script>x</script>',
    't',
  );
  assert.match(html, /<svg/);
  assert.match(html, /<circle/);
  assert.doesNotMatch(html, /<script>x<\/script>/);
});
