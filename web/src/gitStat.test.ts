import { describe, it, expect, vi, afterEach } from 'vitest';
import { statusLabel, statusClass, defaultRange, sumStats, aggregateByAuthor, fetchGitChanges, type GitCommit } from './gitStat';
import { parseHugeCommitLimit, DEFAULT_HUGE_COMMIT_ADDED_LIMIT } from '@devflow/shared/git-filter';

describe('statusLabel', () => {
  it('返回中文标签', () => {
    expect(statusLabel('added')).toBe('新增');
    expect(statusLabel('modified')).toBe('修改');
    expect(statusLabel('deleted')).toBe('删除');
    expect(statusLabel('renamed')).toBe('重命名');
  });
});

describe('statusClass', () => {
  it('统一加 st- 前缀', () => {
    expect(statusClass('added')).toBe('st-added');
    expect(statusClass('renamed')).toBe('st-renamed');
  });
});

describe('defaultRange', () => {
  it('默认从本月 1 号起', () => {
    const r = defaultRange(new Date(2026, 8, 10)); // 2026-09-10
    expect(r.until).toBe('2026-09-10');
    expect(r.since).toBe('2026-09-01');
  });
});

describe('sumStats', () => {
  it('逐字段累加多个仓库统计', () => {
    const a = { commits: 2, files: 3, added: 1, modified: 1, deleted: 1, renamed: 0 };
    const b = { commits: 5, files: 7, added: 4, modified: 2, deleted: 0, renamed: 1 };
    expect(sumStats([a, b])).toEqual({ commits: 7, files: 10, added: 5, modified: 3, deleted: 1, renamed: 1 });
  });
  it('空数组返回全零', () => {
    expect(sumStats([])).toEqual({ commits: 0, files: 0, added: 0, modified: 0, deleted: 0, renamed: 0 });
  });
});

describe('aggregateByAuthor', () => {
  const commit = (author: string, email: string, files: GitCommit['files']): GitCommit =>
    ({ hash: author + files.length, short: 'x', author, email, date: '', subject: '', files });
  it('按修改人叠加提交数/状态数/增删行/去重文件', () => {
    const rows = aggregateByAuthor([
      commit('Ann', 'a@x', [{ status: 'added', path: 'a.js', added: 10, deleted: 0 }, { status: 'modified', path: 'b.js', added: 2, deleted: 3 }]),
      commit('Ann', 'a@x', [{ status: 'deleted', path: 'c.js', added: 0, deleted: 5 }, { status: 'modified', path: 'b.js', added: 1, deleted: 1 }]),
      commit('Bob', 'b@x', [{ status: 'added', path: 'd.py', added: 7, deleted: 0 }]),
    ]);
    const ann = rows.find((r) => r.author === 'Ann')!;
    expect(ann.commits).toBe(2);
    expect(ann.files).toBe(3);
    expect(ann.added).toBe(1);
    expect(ann.modified).toBe(2);
    expect(ann.deleted).toBe(1);
    expect(ann.linesAdded).toBe(13);
    expect(ann.linesDeleted).toBe(9);
    expect(rows[0].author).toBe('Ann');
  });
  it('空提交返回空数组', () => {
    expect(aggregateByAuthor([])).toEqual([]);
  });
  it('renamed 计入 renamed；缺省增删行按 0', () => {
    const rows = aggregateByAuthor([
      commit('Ren', 'r@x', [{ status: 'renamed', path: 'x.js', oldPath: 'y.js' }]),
    ]);
    expect(rows[0].renamed).toBe(1);
    expect(rows[0].linesAdded).toBe(0);
    expect(rows[0].linesDeleted).toBe(0);
    expect(rows[0].files).toBe(1);
  });
});

describe('fetchGitChanges', () => {
  afterEach(() => vi.unstubAllGlobals());
  const params = { repo: '/r', since: '2026-09-01', until: '2026-09-10' };

  it('成功返回变更结果', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ stats: { commits: 1 } }) };
    }));
    const r = await fetchGitChanges(params);
    expect(r.stats.commits).toBe(1);
    expect(calls[0].url).toBe('/api/git/changes');
    expect(calls[0].init.method).toBe('POST');
  });

  it('失败：拼 error 与 message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'bad repo', message: 'boom' }) })));
    await expect(fetchGitChanges(params)).rejects.toThrow('bad repo：boom');
  });

  it('失败：json 解析失败回退 HTTP 状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error('x'); } })));
    await expect(fetchGitChanges(params)).rejects.toThrow('HTTP 500');
  });
});

describe('parseHugeCommitLimit', () => {
  it('正整数/数字串原样返回', () => {
    expect(parseHugeCommitLimit(2000)).toBe(2000);
    expect(parseHugeCommitLimit('3000')).toBe(3000);
  });
  it('0/负数/非法/空 → 0（不过滤）', () => {
    expect(parseHugeCommitLimit(0)).toBe(0);
    expect(parseHugeCommitLimit(-5)).toBe(0);
    expect(parseHugeCommitLimit('abc')).toBe(0);
    expect(parseHugeCommitLimit('')).toBe(0);
    expect(parseHugeCommitLimit(null)).toBe(0);
    expect(parseHugeCommitLimit(undefined)).toBe(0);
  });
  it('默认值为 2000', () => {
    expect(DEFAULT_HUGE_COMMIT_ADDED_LIMIT).toBe(2000);
  });
});
