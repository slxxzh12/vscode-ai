import { describe, expect, it } from 'vitest';
import { resolveMessages, translate } from '../src/core/i18n';

describe('i18n', () => {
  it('falls back to en and interpolates', () => {
    const messages = resolveMessages('en');
    expect(translate(messages, 'markdown.mermaid_error', { msg: 'x' })).toBe('Mermaid render failed: x');
  });

  it('merges overrides', () => {
    const messages = resolveMessages('zh-CN', { 'table.confirm': '好' });
    expect(messages['table.confirm']).toBe('好');
  });
});
