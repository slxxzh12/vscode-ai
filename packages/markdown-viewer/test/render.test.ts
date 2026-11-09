import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/core/render';

describe('renderMarkdown', () => {
  it('renders mermaid blocks', () => {
    const html = renderMarkdown('```mermaid\npie\n  "a": 1\n```');
    expect(html).toContain('class="mermaid"');
  });

  it('rewrites relative images via assetSrc', () => {
    const html = renderMarkdown('![x](img/a.png)', { assetSrc: (rel) => `/raw/${rel}` });
    expect(html).toContain('src="/raw/img/a.png"');
  });
});
