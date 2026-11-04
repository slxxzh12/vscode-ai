// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isMarkdownFile, renderMarkdown, renderRemoteMarkdown, printMarkdown, collectAssetRefs } from './markdown';

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

describe('表格宽度指令', () => {
  const src = '<!-- df-table width=60% -->\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';

  it('默认 HTML 模式：写成 data 属性与宽度样式', () => {
    const h = renderMarkdown(src, P);
    expect(h).toContain('data-md-table-width="60%"');
    expect(h).toContain('width:60%');
  });

  it('html:false 模式同样识别，且不把注释渲染成正文', () => {
    const h = renderMarkdown(src, { ...P, html: false });
    expect(h).toContain('data-md-table-width="60%"');
    expect(h).not.toContain('df-table');
  });

  it('支持表头预设蓝色/灰色/暗红色，并自动配文字色', () => {
    const blue = renderMarkdown('<!-- df-table head-bg=blue -->\n\n| A | B |\n| --- | --- |\n| 1 | 2 |', P);
    expect(blue).toContain('data-md-table-head-bg="#1e40af"');
    expect(blue).toContain('data-md-table-head-color="#ffffff"');

    const gray = renderMarkdown('<!-- df-table head-bg=gray -->\n\n| A | B |\n| --- | --- |\n| 1 | 2 |', P);
    expect(gray).toContain('data-md-table-head-bg="#4b5563"');

    const red = renderMarkdown('<!-- df-table head-bg=darkred -->\n\n| A | B |\n| --- | --- |\n| 1 | 2 |', P);
    expect(red).toContain('data-md-table-head-bg="#7f1d1d"');
  });

  it('支持自定义表头背景色与文字色', () => {
    const h = renderMarkdown('<!-- df-table head-bg=#2f6feb head-color=#fff -->\n\n| A | B |\n| --- | --- |\n| 1 | 2 |', P);
    expect(h).toContain('data-md-table-head-bg="#2f6feb"');
    expect(h).toContain('data-md-table-head-color="#fff"');
    expect(h).toContain('--md-table-head-bg:#2f6feb');
  });
});

describe('原始 HTML 表格', () => {
  it('保留嵌套表格、rowspan/colspan 与 border=0', () => {
    const h = renderMarkdown(
      '<table border="0"><thead><tr><th rowspan="2">A</th><th colspan="2">B</th></tr></thead>' +
        '<tbody><tr><td><table><tr><td>x</td></tr></table></td><td colspan="2">y</td></tr></tbody></table>',
      P,
    );
    expect(h).toContain('rowspan="2"');
    expect(h).toContain('colspan="2"');
    expect(h).toContain('border="0"');
    expect((h.match(/<table/g) || []).length).toBe(2);
  });
});

describe('图片尺寸语法', () => {
  it('图片后 {width=300 height=200} 转为属性', () => {
    const h = renderMarkdown('![a](img.png){width=300 height=200}', P);
    expect(h).toContain('width="300"');
    expect(h).toContain('height="200"');
    expect(h).not.toContain('{width=');
  });

  it('支持百分比宽度与 px 后缀', () => {
    const h1 = renderMarkdown('![a](img.png){width=50%}', P);
    expect(h1).toContain('width="50%"');
    const h2 = renderMarkdown('![a](img.png){width=320px}', P);
    expect(h2).toContain('width="320"');
  });
});

describe('renderMarkdown 原始 HTML 模式', () => {
  it('默认开启：原始 HTML 与内联样式渲染，脚本与事件属性移除', () => {
    const md = '<div style="color:red">x</div><script>alert(1)</script><img src="x.png" onerror="alert(1)">';
    const h = renderMarkdown(md, P);
    expect(h).toContain('<div');
    expect(h).toContain('style="color:red"');
    expect(h).not.toContain('<script');
    expect(h).not.toContain('onerror');
  });

  it('html:false 时原始 HTML 转义', () => {
    const h = renderMarkdown('<script>alert(1)</script>', { ...P, html: false });
    expect(h).toContain('&lt;script&gt;');
  });

  it('<style> 转为作用域样式，@import 被移除', () => {
    const h = renderMarkdown('<style>@import "x.css"; .a { animation: fade 1s; }</style><div class="a">x</div>', P);
    expect(h).toContain('@scope');
    expect(h).toContain('animation: fade 1s');
    expect(h).not.toContain('@import');
  });

  it('内联 SVG 保留，脚本移除', () => {
    const h = renderMarkdown('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg><script>x</script>', P);
    expect(h).toContain('<svg');
    expect(h).toContain('<circle');
    expect(h).not.toContain('<script');
  });
});

describe('renderMarkdown', () => {
  it('mermaid 代码块 → pre.mermaid 且内容转义', () => {
    const h = renderMarkdown('```mermaid\ngraph LR\nA-->B\n```', P);
    expect(h).toContain('class="mermaid"');
    expect(h).toContain('data-processed="false"');
  });

  it('mermaid-data 代码块 → pre.mermaid-data 且内容转义', () => {
    const h = renderMarkdown('```mermaid-data\nreturn `<b>x</b>`\n```', P);
    expect(h).toContain('class="mermaid-data"');
    expect(h).toContain('data-processed="false"');
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(h).not.toContain('<b>x</b>');
  });

  it('mermaid row → 输出并排标记', () => {
    const h = renderMarkdown('```mermaid row\ngraph LR\nA-->B\n```', P);
    expect(h).toContain('class="mermaid mermaid-side"');
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
    const h = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>', { ...P, html: false });
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
    expect(h).toContain('data-md-link="docs/other.md"');
  });

  it('非法百分号转义不崩（safeDecode 回退原串）', () => {
    const h = renderMarkdown('![x](bad%zz.png)', { projectId: 'p', fileDir: 'docs' });
    expect(h).toContain('/api/raw?project=p');
  });

  it('assetMap 命中相对图片/链接时替换为给定 URL', () => {
    const map = new Map([['assets/logo.png', 'blob:abc'], ['docs/other.md', 'blob:def']]);
    const h = renderMarkdown('![logo](../assets/logo.png)\n\n[doc](./other.md)', { projectId: '', fileDir: 'docs', assetMap: map });
    expect(h).toContain('src="blob:abc"');
    expect(h).toContain('href="blob:def"');
    expect(h).not.toContain('/api/raw');
  });

  it('无 projectId 且未命中 assetMap 时保持原始相对路径', () => {
    const h = renderMarkdown('![x](imgs/a.png)', { projectId: '', fileDir: 'docs' });
    expect(h).toContain('src="imgs/a.png"');
    expect(h).not.toContain('/api/raw');
  });
});

describe('collectAssetRefs', () => {
  it('抽取相对 image/link、去重、过滤外链/锚点/绝对 URL', () => {
    const refs = collectAssetRefs(
      '![a](./x.png)\n![b](./x.png)\n[c](../y.md)\n[d](https://e.com/z.png)\n[e](#sec)',
      'docs',
    );
    expect(refs.map((r) => r.rel).sort()).toEqual(['docs/x.png', 'y.md']);
  });

  it('保留 query/hash 后缀', () => {
    const refs = collectAssetRefs('![a](./x.png?v=1#f)', 'docs');
    expect(refs).toEqual([{ rel: 'docs/x.png', suffix: '?v=1#f' }]);
  });
});

describe('renderRemoteMarkdown', () => {
  it('外链加 target/rel，不改写相对资源', () => {
    const h = renderRemoteMarkdown('[x](https://ex.com/a)');
    expect(h).toContain('href="https://ex.com/a"');
    expect(h).toContain('target="_blank"');
    expect(h).toContain('rel="noopener"');
  });
});

describe('printMarkdown', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  function fakeWin(images: unknown[]) {
    const doc = {
      opened: false, written: '', closed: false, images,
      open() { this.opened = true; },
      write(s: string) { this.written += s; },
      close() { this.closed = true; },
    };
    return { document: doc, focused: 0, printed: 0, focus() { this.focused += 1; }, print() { this.printed += 1; } };
  }

  it('window.open 返回 null 时静默返回', () => {
    vi.stubGlobal('window', { open: () => null });
    expect(() => printMarkdown('<p>x</p>', 'T')).not.toThrow();
  });

  it('无图片：写入文档并延迟一拍打印（标题转义）', () => {
    vi.useFakeTimers();
    const win = fakeWin([]);
    vi.stubGlobal('window', { open: () => win });
    printMarkdown('<p>x</p>', '标题<1>');
    expect(win.document.opened).toBe(true);
    expect(win.document.written).toContain('标题&lt;1&gt;');
    expect(win.document.written).toContain('<article class="md-body">');
    expect(win.document.written).toContain('@page { size: A4; margin: 24mm 20mm; }');
    expect(win.document.written).toContain('white-space: pre-wrap');
    expect(win.document.written).toContain('width: 100%; max-width: 100%; table-layout: fixed');
    expect(win.document.written).toContain('.md-body .md-el-table');
    expect(win.document.closed).toBe(true);
    expect(win.printed).toBe(0);
    vi.advanceTimersByTime(300);
    expect(win.printed).toBe(1);
  });

  it('打印前把 Element Plus 表格还原成原生表，避免固定宽度丢数据', () => {
    const win = fakeWin([]);
    vi.stubGlobal('window', { open: () => win });
    const html =
      '<div class="md-el-table"><div class="el-table">' +
      '<table class="el-table__header"><thead><tr><th><div class="cell">Name</div></th></tr></thead></table>' +
      '<table class="el-table__body"><tbody><tr><td><div class="cell"><b>Alice</b></div></td></tr></tbody></table>' +
      '</div></div>';
    printMarkdown(html, 'T');
    expect(win.document.written).toContain('<table class="md-table">');
    expect(win.document.written).toContain('<th>Name</th>');
    expect(win.document.written).toContain('<td><b>Alice</b></td>');
    expect(win.document.written).not.toContain('<div class="md-el-table">');
  });

  it('图片已完成：延迟一拍打印', () => {
    vi.useFakeTimers();
    const win = fakeWin([{ complete: true }]);
    vi.stubGlobal('window', { open: () => win });
    printMarkdown('<p>x</p>', 'T');
    expect(win.printed).toBe(0);
    vi.advanceTimersByTime(300);
    expect(win.printed).toBe(1);
  });

  it('图片未完成：等 load 后打印；超时兜底不重复打印', () => {
    vi.useFakeTimers();
    const handlers: Record<string, () => void> = {};
    const img = { complete: false, addEventListener: (t: string, cb: () => void) => { handlers[t] = cb; } };
    const win = fakeWin([img]);
    vi.stubGlobal('window', { open: () => win });
    printMarkdown('<p>x</p>', 'T');
    expect(win.printed).toBe(0);
    handlers.load();
    vi.advanceTimersByTime(300);
    expect(win.printed).toBe(1);
    vi.advanceTimersByTime(8000);
    expect(win.printed).toBe(1);
  });
});
