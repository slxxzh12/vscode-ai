import { describe, it, expect } from 'vitest';
import { extractStyleBlocks, sanitizeCss, renderStyleBlocks, scopeCss } from '@devflow/shared/markdown-css';

describe('extractStyleBlocks', () => {
  it('提取内容级与页面级样式，代码围栏内不提取', () => {
    const md = [
      '<style>.a { animation: fade .3s; }</style>',
      '<style data-scope="page">body { background: #000; }</style>',
      '',
      '```html',
      '<style>.no { color: red; }</style>',
      '```',
    ].join('\n');
    const r = extractStyleBlocks(md);
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[0].page).toBe(false);
    expect(r.blocks[1].page).toBe(true);
    expect(r.markdown).toContain('<style>.no');
  });
});

describe('sanitizeCss', () => {
  it('移除危险片段；内容级去 @import，页面级保留', () => {
    expect(sanitizeCss('@import "x.css"; .a { width: expression(1); }')).not.toContain('@import');
    expect(sanitizeCss('@import "x.css";', { page: true })).toContain('@import');
    expect(sanitizeCss('.a { background: url(javascript:alert(1)); }')).not.toContain('javascript:');
    expect(sanitizeCss('.a{} </style><script>x</script>')).not.toContain('<script');
  });
});

describe('scopeCss / renderStyleBlocks', () => {
  it('内容级包 @scope，页面级不包', () => {
    expect(scopeCss('.a{}', '[data-md-css="x"]')).toContain('@scope ([data-md-css="x"])');
    const tags = renderStyleBlocks(
      [{ css: '.a{}', page: false }, { css: 'body{}', page: true }],
      '[data-md-css="x"]',
    );
    expect(tags.content).toContain('@scope');
    expect(tags.page).toContain('body{}');
    expect(tags.page).not.toContain('@scope');
  });
});
