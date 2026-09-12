import { describe, it, expect } from 'vitest';
import { parseCurl, parseCurlCommands, buildCurl, replaceCurlCommand } from './curl';

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

describe('parseCurlCommands', () => {
  it('解析多条命令并给出源码区间', () => {
    const text = [
      "curl -X GET 'https://a.test/x'",
      "curl -X POST 'https://b.test/y' \\",
      "  -H 'Content-Type: application/json' \\",
      "  -d '{\"a\":1}'",
    ].join('\n');
    const entries = parseCurlCommands(text);
    expect(entries).toHaveLength(2);
    expect(entries[0].request.url).toBe('https://a.test/x');
    expect(entries[1].request.method).toBe('POST');
    expect(entries[1].request.headers[0]).toEqual({ name: 'Content-Type', value: 'application/json' });
    expect(entries[1].request.body).toBe('{"a":1}');
    expect(text.slice(entries[0].start, entries[0].end)).toBe("curl -X GET 'https://a.test/x'");
  });

  it('无 curl 返回空数组', () => {
    expect(parseCurlCommands('echo hi')).toEqual([]);
  });
});

describe('buildCurl / replaceCurlCommand', () => {
  it('序列化后再次解析得到等价请求', () => {
    const req = {
      method: 'POST',
      url: 'https://a.test/x?q=1',
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      body: '{"a":1}',
      raw: '',
    };
    const cmd = buildCurl(req);
    expect(cmd).toContain('curl -X POST');
    expect(cmd).toContain('-H');
    const back = parseCurlCommands(cmd)[0].request;
    expect(back.method).toBe('POST');
    expect(back.url).toBe('https://a.test/x?q=1');
    expect(back.headers).toEqual(req.headers);
    expect(back.body).toBe('{"a":1}');
  });

  it('替换区间只改目标命令', () => {
    const text = "curl -X GET 'https://a.test/x'\ncurl -X GET 'https://b.test/y'";
    const entries = parseCurlCommands(text);
    const next = replaceCurlCommand(text, entries[0], { ...entries[0].request, method: 'DELETE' });
    expect(next).toContain("-X DELETE 'https://a.test/x'");
    expect(next).toContain("curl -X GET 'https://b.test/y'");
  });
});
