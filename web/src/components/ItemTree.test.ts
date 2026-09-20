// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import ItemTree from './ItemTree.vue';
import type { FileTreeActions } from '../fileTree';

function makeActions(): FileTreeActions {
  return {
    createFolder: vi.fn(async () => ({ ok: true })),
    renameFolder: vi.fn(async () => ({ ok: true })),
    removeFolder: vi.fn(async () => ({ ok: true })),
    renameItem: vi.fn(async () => ({ ok: true })),
    removeItem: vi.fn(async () => ({ ok: true })),
    moveItem: vi.fn(async () => ({ ok: true })),
  };
}
beforeEach(() => localStorage.clear());

describe('ItemTree', () => {
  it('渲染文件夹与文件，选中事件', async () => {
    const actions = makeActions();
    const w = mountC(ItemTree, { props: { folders: ['d'], items: [{ id: 'd/a.txt', folder: 'd', name: 'a.txt' }], activeFolder: '', activeId: '', actions, storageKey: 'k' } });
    const names = w.findAll('.ftname').map((n) => n.text());
    expect(names).toContain('d');
    expect(names).toContain('a.txt');
    await w.findAll('.ftrow.item .ftname')[0].trigger('click');
    expect(w.emitted('select-item')?.[0]?.[0]).toMatchObject({ id: 'd/a.txt' });
  });

  it('showRun=false 不渲染 ▶', () => {
    const w = mountC(ItemTree, { props: { folders: [], items: [{ id: 'a.txt', folder: '', name: 'a.txt' }], activeFolder: '', activeId: '', actions: makeActions(), storageKey: 'k' } });
    expect(w.find('.ftexec').exists()).toBe(false);
  });

  it('新建文件夹走 createFolder', async () => {
    const actions = makeActions();
    const w = mountC(ItemTree, { props: { folders: [], items: [], activeFolder: '', activeId: '', actions, storageKey: 'k' } });
    await w.find('.ftroot .ftnew').trigger('click');
    await w.find('.ftedit').setValue('newdir');
    await w.find('.ftedit').trigger('keydown.enter');
    await flushPromises();
    expect(actions.createFolder).toHaveBeenCalledWith('', 'newdir');
  });
});
