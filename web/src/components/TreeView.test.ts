// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
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
    await w.findAll('.ftrow')[2].find('.ftname').trigger('click');
    expect(src.open).toHaveBeenCalled();
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
});
