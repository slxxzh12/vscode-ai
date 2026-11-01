import { describe, it, expect } from 'vitest';
import { splitMarkdownSlides } from './markdownSlides';

describe('splitMarkdownSlides', () => {
  it('只按一级标题切分，二级标题不单独成页', () => {
    const slides = splitMarkdownSlides([
      '# 标题',
      '开头',
      '## 第一章',
      '内容一',
      '### 小节',
      '小节内容',
      '## 第二章',
      '内容二',
    ].join('\n'));
    expect(slides).toHaveLength(1);
    expect(slides[0].title).toBe('标题');
    expect(slides[0].content).toContain('## 第一章');
    expect(slides[0].content).toContain('## 第二章');
  });

  it('多个一级标题按页切分', () => {
    const slides = splitMarkdownSlides(['# 第一页', 'A', '# 第二页', 'B'].join('\n'));
    expect(slides.map((s) => s.title)).toEqual(['第一页', '第二页']);
  });

  it('标题前的内容单独成一页', () => {
    const slides = splitMarkdownSlides(['前言', '', '# 标题', '正文'].join('\n'));
    expect(slides).toHaveLength(2);
    expect(slides[0]).toMatchObject({ title: '', content: '前言' });
    expect(slides[1]).toMatchObject({ title: '标题' });
  });

  it('代码块里的 # 不切分', () => {
    const slides = splitMarkdownSlides([
      '# 标题',
      '```bash',
      '# 这是注释',
      'echo hi',
      '```',
      '正文',
    ].join('\n'));
    expect(slides).toHaveLength(1);
    expect(slides[0].content).toContain('# 这是注释');
  });

  it('没有标题时只有一页；空文档也有空页', () => {
    expect(splitMarkdownSlides('a\n\nb')).toHaveLength(1);
    expect(splitMarkdownSlides('')).toEqual([{ title: '', content: '' }]);
  });
});
