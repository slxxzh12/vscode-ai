// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import PostmanTree from './PostmanTree.vue';

function actions(overrides: Record<string, unknown> = {}) {
  return {
    createFolder: vi.fn(async () => ({ ok: true })),
    renameFolder: vi.fn(async () => ({ ok: true })),
    renameRecord: vi.fn(async () => ({ ok: true })),
    removeFolder: vi.fn(async () => ({ ok: true })),
    removeRecord: vi.fn(async () => ({ ok: true })),
    moveRecord: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

function mount(props: Record<string, unknown> = {}) {
  return mountC(PostmanTree, {
    props: { folders: [], records: [], activeFolder: '', activeId: '', actions: actions(), ...props },
  });
}

const REC = (id: string, command: string, folder = '', extra: Record<string, unknown> = {}) =>
  ({ id, command, folder, result: {}, updatedAt: '2026-09-01T00:00:00.000Z', ...extra });

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('PostmanTree', () => {
  it('默认全展开：文件夹及其记录都可见', () => {
    const w = mount({ folders: ['foo'], records: [REC('foo/a.json', 'curl A', 'foo')] });
    expect(w.text()).toContain('foo');
    expect(w.text()).toContain('curl A');
  });

  it('点箭头折叠后记录隐藏，并写入 localStorage', async () => {
    const w = mount({ folders: ['foo'], records: [REC('foo/a.json', 'curl A', 'foo')] });
    await w.find('.pmchev:not(.invisible)').trigger('click');
    expect(w.text()).not.toContain('curl A');
    expect(JSON.parse(localStorage.getItem('devflow-postman-collapsed') || '[]')).toEqual(['foo']);
  });

  it('localStorage 里的折叠状态在挂载时生效', () => {
    localStorage.setItem('devflow-postman-collapsed', JSON.stringify(['foo']));
    const w = mount({ folders: ['foo'], records: [REC('foo/a.json', 'curl A', 'foo')] });
    expect(w.text()).not.toContain('curl A');
  });

  it('双击文件夹名切换展开/折叠', async () => {
    const w = mount({ folders: ['foo'], records: [REC('foo/a.json', 'curl A', 'foo')] });
    await w.find('.pmrow.folder .pmname').trigger('dblclick');
    expect(w.text()).not.toContain('curl A');
  });

  it('同一文件夹内先子文件夹后记录', () => {
    const w = mount({ folders: ['foo', 'foo/sub'], records: [REC('foo/a.json', 'curl A', 'foo')] });
    const texts = w.findAll('.pmrow .pmname').map((n) => n.text());
    expect(texts.indexOf('foo')).toBeLessThan(texts.indexOf('sub'));
    expect(texts.indexOf('sub')).toBeLessThan(texts.indexOf('curl A'));
  });

  it('单击文件夹/记录发出 select 事件', async () => {
    const w = mount({ folders: ['foo'], records: [REC('a.json', 'curl A', '')] });
    await w.find('.pmrow.folder .pmname').trigger('click');
    expect(w.emitted('select-folder')?.[0]).toEqual(['foo']);
    await w.find('.pmrow.record .pmname').trigger('click');
    expect(w.emitted('select-record')?.[0]?.[0]).toMatchObject({ id: 'a.json' });
  });

  it('悬停 ＋ 新建子文件夹：Enter 调 actions.createFolder(parent, name)', async () => {
    const a = actions();
    const w = mount({ actions: a, folders: ['foo'] });
    await w.find('.pmrow.folder .pmnew').trigger('click');
    const input = w.find('.pmedit');
    expect(input.exists()).toBe(true);
    await input.setValue('bar');
    await input.trigger('keydown.enter');
    await nextTick();
    expect(a.createFolder).toHaveBeenCalledWith('foo', 'bar');
    expect(w.find('.pmedit').exists()).toBe(false);
  });

  it('新建文件夹空名称点击其他位置退出编辑且不创建', async () => {
    const a = actions();
    const w = mount({ actions: a, folders: ['foo'] });
    await w.find('.pmrow.folder .pmnew').trigger('click');
    expect(w.find('.pmedit').exists()).toBe(true);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(w.find('.pmedit').exists()).toBe(false);
    expect(a.createFolder).not.toHaveBeenCalled();
  });

  it('新建文件夹输入名称后点击其他位置会保存', async () => {
    const a = actions();
    const w = mount({ actions: a });
    await w.find('.pmroot .pmnew').trigger('click');
    await w.find('.pmedit').setValue('bar');
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    expect(a.createFolder).toHaveBeenCalledWith('', 'bar');
    expect(w.find('.pmedit').exists()).toBe(false);
  });

  it('执行按钮：记录发出 run-record，文件夹发出 run-folder', async () => {
    const w = mount({ folders: ['foo'], records: [REC('foo/a.json', 'curl A', 'foo')] });
    await w.find('.pmrow.record .pmexec').trigger('click');
    expect(w.emitted('run-record')?.[0]?.[0]).toMatchObject({ id: 'foo/a.json' });
    await w.find('.pmrow.folder .pmexec').trigger('click');
    expect(w.emitted('run-folder')?.[0]).toEqual(['foo']);
  });

  it('statuses 渲染通过/未通过圆圈', () => {
    const w = mount({
      folders: ['foo'],
      records: [REC('foo/a.json', 'curl A', 'foo'), REC('foo/b.json', 'curl B', 'foo')],
      statuses: { 'foo/a.json': 'pass', 'foo/b.json': 'fail' },
    });
    expect(w.findAll('.pmstatus.pass').length).toBe(1);
    expect(w.findAll('.pmstatus.fail').length).toBe(1);
  });

  it('记录重命名：Enter 调 actions.renameRecord', async () => {
    const a = actions();
    const w = mount({ actions: a, records: [REC('a.json', 'curl A', '')] });
    await w.find('.pmrow.record .pmrename').trigger('click');
    await w.find('.pmedit').setValue('My A');
    await w.find('.pmedit').trigger('keydown.enter');
    await nextTick();
    expect(a.renameRecord).toHaveBeenCalledWith('a.json', 'My A');
  });

  it('文件夹重命名冲突保持编辑态并显示提示', async () => {
    const a = actions({ renameFolder: vi.fn(async () => ({ ok: false, error: 'exists' })) });
    const w = mount({ actions: a, folders: ['foo'] });
    await w.find('.pmrow.folder .pmrename').trigger('click');
    await w.find('.pmedit').setValue('bar');
    await w.find('.pmedit').trigger('keydown.enter');
    await nextTick();
    expect(w.find('.pmedit').exists()).toBe(true);
    expect(w.find('.pmerr').exists()).toBe(true);
  });

  it('右键文件夹出现菜单，菜单可删除', async () => {
    const a = actions();
    const w = mount({ actions: a, folders: ['foo'] });
    await w.find('.pmrow.folder').trigger('contextmenu');
    expect(w.find('.pmmenu').exists()).toBe(true);
    await w.find('.pmmenu-del').trigger('click');
    await nextTick();
    expect(a.removeFolder).toHaveBeenCalledWith('foo');
  });

  it('记录显示标题优先于 command，无标题回退 command', () => {
    const w = mount({ records: [REC('a.json', 'curl A', '', { title: 'My A' }), REC('b.json', 'curl B', '')] });
    expect(w.text()).toContain('My A');
    expect(w.text()).not.toContain('curl A');
    expect(w.text()).toContain('curl B');
  });
});
