// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import FileSearchDialog from './FileSearchDialog.vue';
import type { TreeSource } from '../tree/treeSource';

function fakeSource(over: Partial<TreeSource> = {}): TreeSource {
  return {
    async loadChildren() { return []; },
    open: vi.fn(),
    ...over,
  };
}

function mountDialog(src: TreeSource) {
  return mountC(FileSearchDialog, {
    props: { source: src },
    global: { plugins: [ElementPlus], stubs: { teleport: true } },
  });
}

const RESULT = {
  nameHits: [{ path: 'target.md', name: 'target.md' }],
  contentHits: [
    { path: 'src/a.js', name: 'a.js', line: 2, text: 'const target = 1;' },
    { path: 'src/b.js', name: 'b.js', line: 5, text: 'target()' },
  ],
  truncated: false,
  scanned: 9,
};

describe('FileSearchDialog', () => {
  it('回车触发搜索并分组渲染：文件名命中 + 每个内容文件一组', async () => {
    const src = fakeSource({ search: vi.fn(async () => RESULT), openHit: vi.fn() });
    const w = mountDialog(src);
    await flushPromises();
    expect(w.find('.shint').exists()).toBe(true);
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    expect(src.search).toHaveBeenCalledWith('target', { caseSensitive: false });
    expect(w.findAll('.sname-row').length).toBe(1);
    expect(w.findAll('.scgroup').length).toBe(2);
    expect(w.findAll('.sline').length).toBe(2);
  });

  it('点击内容命中行调用 openHit 并带 line', async () => {
    const src = fakeSource({ search: vi.fn(async () => RESULT), openHit: vi.fn() });
    const w = mountDialog(src);
    await flushPromises();
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    await w.findAll('.sline')[0].trigger('click');
    expect(src.openHit).toHaveBeenCalledWith({ path: 'src/a.js', name: 'a.js', line: 2 });
  });

  it('点击文件名命中调用 openHit（不带 line）', async () => {
    const src = fakeSource({ search: vi.fn(async () => RESULT), openHit: vi.fn() });
    const w = mountDialog(src);
    await flushPromises();
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    await w.find('.sname-row').trigger('click');
    expect(src.openHit).toHaveBeenCalledWith({ path: 'target.md', name: 'target.md' });
  });

  it('无命中显示空态；截断有提示', async () => {
    const empty = { nameHits: [], contentHits: [], truncated: true, scanned: 4 };
    const src = fakeSource({ search: vi.fn(async () => empty), openHit: vi.fn() });
    const w = mountDialog(src);
    await flushPromises();
    await w.find('.sinput').setValue('zzz');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    expect(w.find('.shint').exists()).toBe(true);
    expect(w.find('.strunc').exists()).toBe(true);
  });

  it('搜索失败显示错误', async () => {
    const src = fakeSource({ search: vi.fn(async () => { throw new Error('boom'); }), openHit: vi.fn() });
    const w = mountDialog(src);
    await flushPromises();
    await w.find('.sinput').setValue('x');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    expect(w.find('.serr').text()).toContain('boom');
  });
});
