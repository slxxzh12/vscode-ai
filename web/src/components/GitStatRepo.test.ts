// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import GitStatRepo from './GitStatRepo.vue';
import type { GitChangesResult } from '../gitStat';

function result(over: Partial<GitChangesResult> = {}): GitChangesResult {
  return {
    repo: { path: 'D:/repo', branch: 'main' },
    range: { since: '2026-09-01', until: '2026-09-10' },
    stats: { commits: 1, files: 2, added: 1, modified: 1, deleted: 0, renamed: 0 },
    summary: [
      { path: 'a.ts', status: 'added', touches: 1, lastDate: '2026-09-05T10:20:00', lastAuthor: 'Ann', lastEmail: 'a@x', added: 5, deleted: 0 },
      { path: 'b.ts', status: 'modified', oldPath: 'old.ts', touches: 2, lastDate: 'not-a-date', lastAuthor: 'Bob', lastEmail: 'b@x', added: 1, deleted: 2 },
    ],
    commits: [
      { hash: 'h1', short: 'abc123', author: 'Ann', email: 'a@x', date: '2026-09-05T10:20:00', subject: 'feat x', files: [{ status: 'added', path: 'a.ts', added: 5, deleted: 0 }] },
    ],
    ...over,
  };
}

afterEach(() => vi.unstubAllGlobals());

function mountRepo(over: Partial<GitChangesResult> = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ groups: ['G'], members: { Ann: 'G' } }) })));
  return mountC(GitStatRepo, { props: { result: result(over) } });
}

describe('GitStatRepo', () => {
  it('渲染统计卡片、仓库信息与汇总/提交', async () => {
    const w = mountRepo();
    await flushPromises();
    expect(w.findAll('.card')).toHaveLength(6);
    expect(w.find('.repoline').text()).toContain('D:/repo');
    expect(w.find('.repoline').text()).toContain('main');
    expect(w.findAll('table.tbl')[0].findAll('tbody tr')).toHaveLength(2);
    expect(w.find('.old').text()).toBe('old.ts');
    expect(w.text()).toContain('not-a-date');
  });

  it('状态过滤只保留匹配行；all 恢复', async () => {
    const w = mountRepo();
    await flushPromises();
    const btns = w.findAll('.filters button');
    await btns[1].trigger('click');   // added
    expect(w.findAll('table.tbl')[0].findAll('tbody tr')).toHaveLength(1);
    expect(w.findAll('table.tbl')[0].find('.badge').text()).toBeTruthy();
    await btns[0].trigger('click');   // all
    expect(w.findAll('table.tbl')[0].findAll('tbody tr')).toHaveLength(2);
  });

  it('提交行可展开/折叠文件列表', async () => {
    const w = mountRepo();
    await flushPromises();
    const head = w.find('.chead');
    expect(w.find('.cbody').exists()).toBe(false);
    await head.trigger('click');
    expect(w.find('.cbody').exists()).toBe(true);
    expect(w.find('.cbody').text()).toContain('a.ts');
    await head.trigger('click');
    expect(w.find('.cbody').exists()).toBe(false);
  });

  it('空 summary 显示空态且不渲染过滤条', async () => {
    const w = mountRepo({ summary: [], commits: [] });
    await flushPromises();
    expect(w.find('.empty').exists()).toBe(true);
    expect(w.find('.filters').exists()).toBe(false);
  });

  it('truncated 显示截断提示', async () => {
    const w = mountRepo({ truncated: true });
    await flushPromises();
    expect(w.find('.warn').exists()).toBe(true);
  });
});
