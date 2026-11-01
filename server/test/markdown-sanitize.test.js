import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMarkdownHtml } from '../markdown-sanitize.js';

test('保留 svg 与内联样式，移除脚本/事件/iframe', () => {
  const html = sanitizeMarkdownHtml(
    '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>' +
    '<div style="animation:fade 1s">x</div>' +
    '<script>x</script><iframe src="x"></iframe><img src="x" onerror="x">',
  );
  assert.match(html, /<svg/);
  assert.match(html, /<circle/);
  assert.match(html, /style="animation:fade 1s"/);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /<iframe/);
  assert.doesNotMatch(html, /onerror/);
});

test('内联样式里的危险片段被移除', () => {
  const html = sanitizeMarkdownHtml('<div style="background:url(javascript:alert(1))">x</div>');
  assert.doesNotMatch(html, /javascript:/);
});
