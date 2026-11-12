import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSecretScan, groupFindingsByFile, type SecretFinding } from './secretScan';

const EMPTY = { dir: '/p', scanned: 0, findings: [], byRule: [], totals: { files: 0, findings: 0, scanned: 0 } };

describe('groupFindingsByFile', () => {
  it('按文件分组并按行号排序', () => {
    const findings: SecretFinding[] = [
      { rel: 'b.js', line: 3, rule: 'jwt', severity: 'medium', match: 'x' },
      { rel: 'a.js', line: 9, rule: 'jwt', severity: 'medium', match: 'y' },
      { rel: 'a.js', line: 2, rule: 'jwt', severity: 'medium', match: 'z' },
    ];
    const groups = groupFindingsByFile(findings);
    expect(groups.map((g) => g.rel)).toEqual(['a.js', 'b.js']);
    expect(groups[0].findings.map((f) => f.line)).toEqual([2, 9]);
  });
  it('空数组返回空', () => {
    expect(groupFindingsByFile([])).toEqual([]);
  });
});

describe('fetchSecretScan', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('成功返回扫描结果', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => EMPTY };
    }));
    const r = await fetchSecretScan({ dir: '/p', excludeDirs: ['docs'] });
    expect(r).toEqual(EMPTY);
    expect(calls[0].url).toBe('/api/code/secret-scan');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ dir: '/p', excludeDirs: ['docs'] });
  });

  it('失败：拼 error 与 message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'bad dir', message: 'nope' }) })));
    await expect(fetchSecretScan({ dir: '/p' })).rejects.toThrow('bad dir：nope');
  });

  it('失败：json 解析失败回退 HTTP 状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error('x'); } })));
    await expect(fetchSecretScan({ dir: '/p' })).rejects.toThrow('HTTP 500');
  });
});
