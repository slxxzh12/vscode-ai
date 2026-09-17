import { describe, it, expect, vi, afterEach } from 'vitest';
import { toCsv, csvCell, zipStamp, downloadZip } from './csv';

describe('csvCell', () => {
  it('普通值原样', () => {
    expect(csvCell('a')).toBe('a');
    expect(csvCell(12)).toBe('12');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
  it('含逗号/引号/换行时加引号并双写引号', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });
  it('公式前缀 = + - @ 前置单引号防注入', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });
  it('普通文本不以公式前缀处理', () => {
    expect(csvCell('a+b')).toBe('a+b');
  });
});

describe('toCsv', () => {
  it('带 BOM、CRLF 与表头', () => {
    expect(toCsv(['a', 'b'], [[1, 2]])).toBe('\uFEFFa,b\r\n1,2\r\n');
  });
  it('空行数组只有表头', () => {
    expect(toCsv(['a'], [])).toBe('\uFEFFa\r\n');
  });
  it('转义生效', () => {
    expect(toCsv(['x'], [['a,b'], ['a"b'], ['a\nb']])).toBe('\uFEFFx\r\n"a,b"\r\n"a""b"\r\n"a\nb"\r\n');
  });
});

describe('zipStamp', () => {
  it('yyyyMMdd-HHmm', () => {
    expect(zipStamp(new Date(2026, 8, 16, 15, 30))).toBe('20260916-1530');
  });
});

describe('downloadZip', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('成功：POST /api/export/zip，触发 <a> 下载并延迟回收 URL', async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, blob: async () => new Blob(['x']) };
    }));
    const anchor = { href: '', download: '', clicked: false, removed: false, click() { this.clicked = true; }, remove() { this.removed = true; } };
    const appended: unknown[] = [];
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: (el: unknown) => appended.push(el) } });
    const revoked: string[] = [];
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: (u: string) => revoked.push(u) });

    await downloadZip('a.zip', [{ name: 'a.csv', content: 'x' }]);
    expect(calls[0].url).toBe('/api/export/zip');
    expect(calls[0].init.method).toBe('POST');
    expect(anchor.download).toBe('a.zip');
    expect(anchor.clicked).toBe(true);
    expect(anchor.removed).toBe(true);
    expect(appended).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoked).toEqual(['blob:x']);
  });

  it('失败：优先取响应体 error，json 解析失败回退 HTTP 状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'bad-zip' }) })));
    await expect(downloadZip('a.zip', [])).rejects.toThrow('bad-zip');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error('x'); } })));
    await expect(downloadZip('a.zip', [])).rejects.toThrow('HTTP 500');
  });
});
