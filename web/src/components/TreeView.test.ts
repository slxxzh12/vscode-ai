// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import TreeView from './TreeView.vue';
import type { TreeSource, TreeSourceNode } from '../tree/treeSource';

function fakeSource(over: Partial<TreeSource> = {}): TreeSource {
  const root: TreeSourceNode[] = [
    { key: 'docs', name: 'docs', kind: 'dir' },
    { key: 'a.txt', name: 'a.txt', kind: 'item' },
  ];
  return {
    async loadChildren(dir) { return dir === '' ? root : dir === 'docs' ? [{ key: 'docs/b.txt', name: 'b.txt', kind: 'item' }] : []; },
    open: vi.fn(),
    createFile: vi.fn(async () => {}),
    createFolder: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    move: vi.fn(async () => {}),
    copyName: vi.fn(),
    copyPath: vi.fn(),
    ...over,
  };
}

describe('TreeView', () => {
  it('加载根节点并渲染行', async () => {
    const w = mountC(TreeView, { props: { source: fakeSource() } });
    await flushPromises();
    const rows = w.findAll('.ftrow');
    expect(rows.map((r) => r.text())).toEqual(expect.arrayContaining([expect.stringContaining('docs'), expect.stringContaining('a.txt')]));
  });

  it('点目录懒加载子节点；点文件调用 source.open', async () => {
    const src = fakeSource();
    const w = mountC(TreeView, { props: { source: src } });
    await flushPromises();
    await w.findAll('.ftrow')[0].find('.ftname').trigger('click');
    await flushPromises();
    expect(w.findAll('.ftrow').length).toBe(3);
    await w.findAll('.ftrow')[2].trigger('click');
    expect(src.open).toHaveBeenCalled();
  });

  it('点文件行/图标区域也能打开（不限于文件名）', async () => {
    const src = fakeSource();
    const w = mountC(TreeView, { props: { source: src } });
    await flushPromises();
    await w.findAll('.ftrow')[1].find('.fticon').trigger('click');
    expect(src.open).toHaveBeenCalledWith(expect.objectContaining({ key: 'a.txt' }));
  });

  it('右键菜单按能力显隐；重命名调用 source.rename', async () => {
    const src = fakeSource({ createFile: undefined, createFolder: undefined });
    const w = mountC(TreeView, { props: { source: src } });
    await flushPromises();
    await w.findAll('.ftrow')[0].trigger('contextmenu');          // docs 目录
    expect(w.find('.ftmenuitem.ftmenu-new').exists()).toBe(false);
    await w.findAll('.ftrow')[1].trigger('contextmenu');          // a.txt 文件
    await w.find('.ftmenuitem.ftmenu-rename').trigger('click');
    await w.find('.ftedit').setValue('renamed.txt');
    await w.find('.ftedit').trigger('keydown.enter');
    await flushPromises();
    expect(src.rename).toHaveBeenCalledWith(expect.objectContaining({ key: 'a.txt' }), 'renamed.txt');
  });

  it('头部刷新按钮重新加载；showRoot 渲染根行', async () => {
    const src = fakeSource();
    const w = mountC(TreeView, { props: { source: src, title: 'X', showRoot: true } });
    await flushPromises();
    expect(w.find('.ftroot').exists()).toBe(true);
    await w.find('.fthead .ftic').trigger('click');
    await flushPromises();
    expect(w.findAll('.ftrow').length).toBe(2);
  });

  it('收到 df-refresh-tree 事件时重新加载根（首次添加目录后自动刷新）', async () => {
    let calls = 0;
    const src = fakeSource({
      loadChildren: vi.fn(async (dir: string): Promise<TreeSourceNode[]> => {
        calls += 1;
        return dir === '' ? [{ key: 'a.txt', name: 'a.txt', kind: 'item' }] : [];
      }),
    });
    const w = mountC(TreeView, { props: { source: src } });
    await flushPromises();
    expect(calls).toBe(1);
    window.dispatchEvent(new CustomEvent('df-refresh-tree'));
    await flushPromises();
    expect(calls).toBe(2);
    w.unmount();
  });

  it('未传 title 时不显示标题文字，但能力按钮仍渲染', async () => {
    const w = mountC(TreeView, { props: { source: fakeSource({ search: vi.fn() }) } });
    await flushPromises();
    expect(w.find('.fthead').exists()).toBe(true);
    expect(w.find('.fttitle').exists()).toBe(false);
    expect(w.find('.ftsearch').exists()).toBe(true);
  });

  it('source.search 存在时显示搜索按钮，缺失时不显示', async () => {
    const withSearch = mountC(TreeView, {
      props: { source: fakeSource({ search: vi.fn() }), title: 'X' },
      global: { plugins: [ElementPlus], stubs: { teleport: true } },
    });
    await flushPromises();
    expect(withSearch.find('.ftsearch').exists()).toBe(true);

    const without = mountC(TreeView, { props: { source: fakeSource(), title: 'X' } });
    await flushPromises();
    expect(without.find('.ftsearch').exists()).toBe(false);
  });
});
