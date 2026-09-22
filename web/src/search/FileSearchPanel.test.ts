// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import FileSearchPanel from './FileSearchPanel.vue';
import type { TreeSource } from '../tree/treeSource';

function fakeSource(over: Partial<TreeSource> = {}): TreeSource {
  return {
    async loadChildren() { return []; },
    open: vi.fn(),
    ...over,
  };
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

function mountPanel(src: TreeSource) {
  return mountC(FileSearchPanel, { props: { source: src } });
}

describe('FileSearchPanel', () => {
  it('默认勾选「文件内容」与「文件名」，回车按两者都搜', async () => {
    const src = fakeSource({ search: vi.fn(async () => RESULT), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    expect((w.find('[data-mode="name"]').element as HTMLInputElement).checked).toBe(true);
    expect((w.find('[data-mode="content"]').element as HTMLInputElement).checked).toBe(true);
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    expect(src.search).toHaveBeenCalledWith('target', { caseSensitive: false, name: true, content: true });
    expect(w.findAll('.sname-row').length).toBe(1);
    expect(w.findAll('.scgroup').length).toBe(2);
    expect(w.findAll('.sline').length).toBe(2);
  });

  it('取消勾选「文件名」后重搜只带 content', async () => {
    const src = fakeSource({ search: vi.fn(async () => RESULT), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    await w.find('[data-mode="name"]').setValue(false);
    await flushPromises();
    expect(src.search).toHaveBeenLastCalledWith('target', { caseSensitive: false, name: false, content: true });
  });

  it('两种模式都不勾选时不发起搜索并提示', async () => {
    const src = fakeSource({ search: vi.fn(async () => RESULT), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('[data-mode="name"]').setValue(false);
    await w.find('[data-mode="content"]').setValue(false);
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    expect(src.search).not.toHaveBeenCalled();
    expect(w.find('.shint').exists()).toBe(true);
  });

  it('单个字母/单字分词不发起搜索并提示', async () => {
    const src = fakeSource({ search: vi.fn(async () => RESULT), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('.sinput').setValue('a');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    expect(src.search).not.toHaveBeenCalled();
    expect(w.find('.shint').exists()).toBe(true);
  });

  it('点内容命中行调用 openHit 带 line，且不关闭面板', async () => {
    const src = fakeSource({ search: vi.fn(async () => RESULT), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    await w.findAll('.sline')[0].trigger('click');
    expect(src.openHit).toHaveBeenCalledWith({ path: 'src/a.js', name: 'a.js', line: 2 });
    expect(w.emitted('close')).toBeUndefined();
  });

  it('点右上角关闭按钮 emit close', async () => {
    const src = fakeSource({ search: vi.fn(async () => RESULT), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('.fsclose').trigger('click');
    expect(w.emitted('close')).toBeTruthy();
  });
});
