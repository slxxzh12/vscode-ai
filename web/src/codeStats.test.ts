import { describe, it, expect, vi, afterEach } from 'vitest';
import { sumCodeTotals, ratioText, fetchCodeStats, type CodeStatsParams } from './codeStats';
import type { GitFilter } from './gitStat';

const FILTER: GitFilter = { codeOnly: true, excludeTestFiles: true };
const PARAMS: CodeStatsParams = { dir: '/p', filter: FILTER };

describe('sumCodeTotals', () => {
  it('逐字段累加', () => {
    expect(sumCodeTotals([
      { files: 2, real: 10, total: 20 },
      { files: 1, real: 5, total: 15 },
    ])).toEqual({ files: 3, real: 15, total: 35 });
  });
  it('空数组全零', () => {
    expect(sumCodeTotals([])).toEqual({ files: 0, real: 0, total: 0 });
  });
});

describe('ratioText', () => {
  it('实代码行 / 总行数 百分比，保留一位小数', () => {
    expect(ratioText(1, 3)).toBe('33.3%');
    expect(ratioText(2, 2)).toBe('100.0%');
  });
  it('总行数为 0 返回 —', () => {
    expect(ratioText(0, 0)).toBe('—');
  });
});

describe('fetchCodeStats', () => {
  afterEach(() => vi.unstubAllGlobals());

  const result = { dir: '/p', files: [], groups: [], totals: { files: 0, real: 0, total: 0 } };

  it('成功返回统计结果', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => result };
    }));
    const r = await fetchCodeStats({ dir: '/p', filter: { codeOnly: true, excludeTestFiles: true } });
    expect(r).toEqual(result);
    expect(calls[0].url).toBe('/api/code/stats');
    expect(calls[0].init.method).toBe('POST');
  });

  it('失败：拼 error 与 message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'bad dir', message: 'nope' }) })));
    await expect(fetchCodeStats(PARAMS)).rejects.toThrow('bad dir：nope');
  });

  it('失败：json 解析失败回退 HTTP 状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error('x'); } })));
    await expect(fetchCodeStats(PARAMS)).rejects.toThrow('HTTP 500');
  });
});
