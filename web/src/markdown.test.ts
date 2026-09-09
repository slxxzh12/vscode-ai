import { describe, it, expect } from 'vitest';
import { isMarkdownFile, renderMarkdown } from './markdown';

const P = { projectId: 'p', fileDir: '' };

describe('isMarkdownFile', () => {
  it('识别 md/markdown（忽略大小写），排除其它/无扩展', () => {
    expect(isMarkdownFile('README.md')).toBe(true);
    expect(isMarkdownFile('A.MD')).toBe(true);
    expect(isMarkdownFile('CHANGELOG.markdown')).toBe(true);
    expect(isMarkdownFile('a.txt')).toBe(false);
    expect(isMarkdownFile('.md')).toBe(false);
    expect(isMarkdownFile('notes')).toBe(false);
  });
});

describe('renderMarkdown', () => {
  it('mermaid 代码块 → pre.mermaid 且内容转义', () => {
    const h = renderMarkdown('```mermaid\ngraph LR\nA-->B\n```', P);
    expect(h).toContain('class="mermaid"');
    expect(h).toContain('data-processed="false"');
  });

  it('js 代码块 → hljs 高亮', () => {
    const h = renderMarkdown('```js\nconst a = 1\n```', P);
    expect(h).toContain('hljs');
    expect(h).toContain('language-js');
  });

  it('未知语言与无语言代码块 → 纯文本转义输出', () => {
    const h = renderMarkdown('```unknownlang\n<b>x</b>\n```', P);
    expect(h).not.toContain('<b>x</b>');
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt;');
    const h2 = renderMarkdown('```\n<b>y</b>\n```', P);
    expect(h2).toContain('&lt;b&gt;y&lt;/b&gt;');
  });

  it('html:false → 原始 HTML/脚本被转义', () => {
    const h = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>', P);
    expect(h).not.toContain('<script>');
    expect(h).not.toContain('<img src=x');
    expect(h).toContain('&lt;script&gt;');
    expect(h).toContain('&lt;img');
  });

  it('相对图片基于 fileDir 归一化为 /api/raw，同目录/上跳/含空格中文', () => {
    const a = renderMarkdown('![logo](../assets/logo.png)', { projectId: 'p', fileDir: 'docs' });
    expect(a).toContain('/api/raw?project=p&amp;path=assets%2Flogo.png');
    expect(a).toContain('alt="logo"');
    expect(a).not.toContain('../assets');
    const b = renderMarkdown('![x](imgs/a.png)', { projectId: 'p', fileDir: 'docs/sub' });
    expect(b).toContain('path=docs%2Fsub%2Fimgs%2Fa.png');
    const c = renderMarkdown('![pic](<./my pic.png>)', { projectId: 'p', fileDir: 'docs/文档 区' });
    expect(c).toContain(`path=${encodeURIComponent('docs/文档 区/my pic.png')}`);
  });

  it('外部 http(s)/data/# 引用不改写', () => {
    const h = renderMarkdown('[外](https://ex.com/a.png) ![d](data:image/png;base64,AA) [锚](#sec)', P);
    expect(h).toContain('href="https://ex.com/a.png"');
    expect(h).toContain('src="data:image/png;base64,AA"');
    expect(h).toContain('href="#sec"');
    expect(h).not.toContain('/api/raw');
  });

  it('相对链接 → /api/raw 并新窗口', () => {
    const h = renderMarkdown('[doc](./other.md)', { projectId: 'p', fileDir: 'docs' });
    expect(h).toContain('href="/api/raw?project=p&amp;path=docs%2Fother.md"');
    expect(h).toContain('target="_blank"');
  });
});
