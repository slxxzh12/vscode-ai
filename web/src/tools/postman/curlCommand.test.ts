import { describe, it, expect } from 'vitest';
import { normalizeCurlCommand } from './curlCommand';

describe('normalizeCurlCommand', () => {
  it('普通 URL 自动补全为 curl', () => {
    expect(normalizeCurlCommand('https://a.com/x?y=1')).toBe('curl https://a.com/x?y=1');
    expect(normalizeCurlCommand('http://a.com')).toBe('curl http://a.com');
    expect(normalizeCurlCommand('www.a.com/path')).toBe('curl www.a.com/path');
  });

  it('已带 curl 的命令保持不变（大小写与空白不敏感）', () => {
    expect(normalizeCurlCommand('curl https://a.com')).toBe('curl https://a.com');
    expect(normalizeCurlCommand('  CURL -X POST https://a.com  ')).toBe('CURL -X POST https://a.com');
  });

  it('非 URL 命令不补全', () => {
    expect(normalizeCurlCommand('wget https://a.com')).toBe('wget https://a.com');
    expect(normalizeCurlCommand('-H "A: b" https://a.com')).toBe('-H "A: b" https://a.com');
  });

  it('空输入返回空串', () => {
    expect(normalizeCurlCommand('')).toBe('');
    expect(normalizeCurlCommand('   ')).toBe('');
  });
});
