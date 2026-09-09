import { describe, it, expect } from 'vitest';
import { parseCurl } from './curl';

describe('parseCurl', () => {
  it('简单 GET', () => {
    const r = parseCurl('curl https://example.com/api?x=1');
    expect(r).not.toBeNull();
    expect(r!.method).toBe('GET');
    expect(r!.url).toBe('https://example.com/api?x=1');
  });

  it('跨行 -H + -d → POST 带请求头与 body', () => {
    const src = [
      'curl -X POST https://api.example.com/login \\',
      "  -H 'Content-Type: application/json' \\",
      "  -H 'Authorization: Bearer abc' \\",
      "  -d '{\"user\":\"sam\"}'",
    ].join('\n');
    const r = parseCurl(src);
    expect(r!.method).toBe('POST');
    expect(r!.url).toBe('https://api.example.com/login');
    expect(r!.headers).toEqual([
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Authorization', value: 'Bearer abc' },
    ]);
    expect(r!.body).toBe('{"user":"sam"}');
  });

  it('-X PUT 短横连写', () => {
    const r = parseCurl('curl -XPUT https://example.com/x -H "X-A: 1"');
    expect(r!.method).toBe('PUT');
    expect(r!.headers[0]).toEqual({ name: 'X-A', value: '1' });
  });

  it('多 -d 用 & 连接', () => {
    const r = parseCurl("curl -X POST https://e.com/f -d 'a=1' -d 'b=2'");
    expect(r!.body).toBe('a=1&b=2');
  });

  it('没有 curl 返回 null', () => {
    expect(parseCurl('npm run build')).toBeNull();
  });
});
