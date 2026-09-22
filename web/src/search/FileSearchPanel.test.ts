// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import FileSearchPanel from './FileSearchPanel.vue';
import type { TreeSource, SearchEvent } from '../tree/treeSource';

function fakeSource(over: Partial<TreeSource> = {}): TreeSource {
  return { async loadChildren() { return []; }, open: vi.fn(), ...over };
}

function streamOf(events: SearchEvent[]): AsyncGenerator<SearchEvent> {
  return (async function* () { for (const ev of events) yield ev; })();
}

const EVENTS: SearchEvent[] = [
  { type: 'name', hits: [{ path: 'target.md', name: 'target.md' }] },
  { type: 'content', path: 'src/a.js', name: 'a.js', lines: [{ line: 2, text: 'const target = 1;' }] },
  { type: 'content', path: 'src/b.js', name: 'b.js', lines: [{ line: 5, text: 'target()' }] },
  { type: 'done', scanned: 9 },
];

function mountPanel(src: TreeSource) {
  return mountC(FileSearchPanel, { props: { source: src } });
}

describe('FileSearchPanel', () => {
  it('默认勾选「文件内容」与「文件名」，回车按两者都搜并流式渲染结果', async () => {
    const src = fakeSource({ search: vi.fn(() => streamOf(EVENTS)), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    expect((w.find('[data-mode="name"]').element as HTMLInputElement).checked).toBe(true);
    expect((w.find('[data-mode="content"]').element as HTMLInputElement).checked).toBe(true);
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    expect(src.search).toHaveBeenCalledWith('target', { caseSensitive: false, name: true, content: true, all: false, split: false }, expect.anything());
    expect(w.findAll('.sname-row').length).toBe(1);
    expect(w.findAll('.scgroup').length).toBe(2);
    expect(w.findAll('.sline').length).toBe(2);
  });

  it('取消勾选「文件名」后重搜只带 content', async () => {
    const src = fakeSource({ search: vi.fn(() => streamOf(EVENTS)), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    await w.find('[data-mode="name"]').setValue(false);
    await flushPromises();
    expect(src.search).toHaveBeenLastCalledWith('target', { caseSensitive: false, name: false, content: true, all: false, split: false }, expect.anything());
  });

  it('勾选「包含忽略目录/二进制」后重搜带 all:true', async () => {
    const src = fakeSource({ search: vi.fn(() => streamOf(EVENTS)), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    await w.find('[data-mode="all"]').setValue(true);
    await flushPromises();
    expect(src.search).toHaveBeenLastCalledWith('target', { caseSensitive: false, name: true, content: true, all: true, split: false }, expect.anything());
  });

  it('默认不勾选「按空格分词」，勾选后重搜带 split:true', async () => {
    const src = fakeSource({ search: vi.fn(() => streamOf(EVENTS)), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    expect((w.find('[data-mode="split"]').element as HTMLInputElement).checked).toBe(false);
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    await w.find('[data-mode="split"]').setValue(true);
    await flushPromises();
    expect(src.search).toHaveBeenLastCalledWith('target', { caseSensitive: false, name: true, content: true, all: false, split: true }, expect.anything());
  });

  it('两种模式都不勾选时不发起搜索并提示', async () => {
    const src = fakeSource({ search: vi.fn(() => streamOf(EVENTS)), openHit: vi.fn() });
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
    const src = fakeSource({ search: vi.fn(() => streamOf(EVENTS)), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('.sinput').setValue('a');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    expect(src.search).not.toHaveBeenCalled();
    expect(w.find('.shint').exists()).toBe(true);
  });

  it('命中过多时提示但不截断（保留全部命中）', async () => {
    const many: SearchEvent[] = [
      { type: 'name', hits: Array.from({ length: 2001 }, (_, i) => ({ path: `f${i}.txt`, name: `f${i}.txt` })) },
      { type: 'done', scanned: 2001 },
    ];
    const src = fakeSource({ search: vi.fn(() => streamOf(many)), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    expect(w.findAll('.sname-row').length).toBe(2001);
    expect(w.find('.strunc').exists()).toBe(true);
  });

  it('点内容命中行调用 openHit 带 line，且不关闭面板', async () => {
    const src = fakeSource({ search: vi.fn(() => streamOf(EVENTS)), openHit: vi.fn() });
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
    const src = fakeSource({ search: vi.fn(() => streamOf(EVENTS)), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('.fsclose').trigger('click');
    expect(w.emitted('close')).toBeTruthy();
  });
});
