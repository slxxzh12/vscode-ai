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

test('流程图页面注入 X6 资源与加载器', () => {
  const html = renderMarkdownDocument('```mermaid\nflowchart TD\n  A-->B\n```', 't');
  assert.match(html, /__devflow_flowx6__\.js/);
  assert.match(html, /__devflow_flowedit__\.js/);
  assert.match(html, /df-edit-flowchart/);
});

test('同级目录图片保留相对路径', () => {
  const html = renderMarkdownDocument(
    '# t\n\n![pic](sample-image.svg)\n\n<img src="sample-image.svg" alt="x">',
    't',
  );
  assert.equal((html.match(/<img src="sample-image.svg"/g) || []).length, 2);
});

test('Markdown 页面带 PPT 导出接线与两个按需脚本名', () => {
  const html = renderMarkdownDocument('# 标题\n\n正文', 't');
  assert.match(html, /exportPptx/);
  assert.match(html, /__devflow_html_to_image__\.js/);
  assert.match(html, /__devflow_pptxgen__\.js/);
  assert.match(html, /onExport/);
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
