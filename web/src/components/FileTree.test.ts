// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import FileTree from './FileTree.vue';

const writeText = vi.fn(async () => {});
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
function stubPrompt(v: string | null) { Object.defineProperty(window, 'prompt', { value: vi.fn(() => v), configurable: true, writable: true }); }
function stubAlert() {
  const fn = vi.fn();
  Object.defineProperty(window, 'alert', { value: fn, configurable: true, writable: true });
  return fn;
}

const TREE = { items: [{ name: 'a.ts', type: 'file' }, { name: 'src', type: 'dir' }] };

function stubApi(overrides: Record<string, (init?: RequestInit) => unknown> = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const hit = Object.entries(overrides).find(([k]) => url.startsWith(k));
    const body = hit ? hit[1](init) : (url.startsWith('/api/tree') ? TREE : {});
    return { ok: true, json: async () => body };
  }));
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); writeText.mockClear(); });

describe('FileTree', () => {
  it('无项目显示未选择项目', async () => {
    stubApi();
    const w = mountC(FileTree, { props: { projectId: null } });
    await flushPromises();
    expect(w.find('.empty').text()).toBeTruthy();
  });

  it('有项目渲染根节点；刷新按钮重新拉取', async () => {
    const calls = stubApi();
    const w = mountC(FileTree, { props: { projectId: 'p' } });
    await flushPromises();
    expect(w.find('.nm').text()).toBe('a.ts');
    const before = calls.filter((c) => c.url.startsWith('/api/tree')).length;
    await w.find('.head .ic').trigger('click');
    await flushPromises();
    expect(calls.filter((c) => c.url.startsWith('/api/tree')).length).toBeGreaterThan(before);
  });

  it('新建文件：非法名 alert，合法名创建并 emit open-file', async () => {
    const calls = stubApi();
    const w = mountC(FileTree, { props: { projectId: 'p' } });
    await flushPromises();

    const alertFn = stubAlert();
    stubPrompt('bad/name');
    await w.findAll('.acts .ic')[1].trigger('click');
    expect(alertFn).toHaveBeenCalled();

    stubPrompt('new.ts');
    await w.findAll('.acts .ic')[1].trigger('click');
    await flushPromises();
    expect(calls.some((c) => c.init?.method === 'POST' && c.url.startsWith('/api/file'))).toBe(true);
    expect(w.emitted('open-file')?.[0]).toEqual(['p', 'new.ts', 'new.ts']);
  });

  it('新建文件夹：POST 后展开', async () => {
    const calls = stubApi();
    const w = mountC(FileTree, { props: { projectId: 'p' } });
    await flushPromises();
    stubAlert();
    stubPrompt('assets');
    await w.findAll('.acts .ic')[2].trigger('click');
    await flushPromises();
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(true);
  });

  it('文件右键菜单：复制文件名/路径、复制内容、查看详情', async () => {
    const calls = stubApi({ '/api/file': () => ({ name: 'a.ts', path: 'a.ts', size: 3, content: 'BODY' }) });
    const w = mountC(FileTree, { props: { projectId: 'p' } });
    await flushPromises();
    await w.find('.row').trigger('contextmenu');
    const btns = w.find('.ctx').findAll('button');
    expect(btns).toHaveLength(7);

    await btns[5].trigger('click');   // 复制文件名
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith('a.ts');

    await w.find('.row').trigger('contextmenu');
    await w.find('.ctx').findAll('button')[6].trigger('click');   // 复制路径
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith('a.ts');

    await w.find('.row').trigger('contextmenu');
    await w.find('.ctx').findAll('button')[3].trigger('click');   // 复制内容
    await flushPromises();
    expect(calls.some((c) => c.url.startsWith('/api/file?project=p&path=a.ts'))).toBe(true);
    expect(writeText).toHaveBeenCalledWith('BODY');

    await w.find('.row').trigger('contextmenu');
    await w.find('.ctx').findAll('button')[4].trigger('click');   // 查看详情
    expect(w.emitted('detail-file')?.[0]).toEqual(['p', 'a.ts', 'a.ts']);
  });

  it('目录右键菜单：新建文件/夹与复制目录名', async () => {
    stubApi();
    const w = mountC(FileTree, { props: { projectId: 'p' } });
    await flushPromises();
    const dirRow = w.findAll('.row')[1];
    await dirRow.trigger('contextmenu');
    const btns = w.find('.ctx').findAll('button');
    expect(btns).toHaveLength(5);
    await btns[3].trigger('click');   // 复制目录名
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith('src');
  });

  it('在系统资源管理器中显示：成功静默，失败 alert', async () => {
    stubApi();
    const w = mountC(FileTree, { props: { projectId: 'p' } });
    await flushPromises();
    await w.find('.row').trigger('contextmenu');
    await w.find('.ctx').findAll('button')[0].trigger('click');
    await flushPromises();

    const alertFn = stubAlert();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'no' }) })));
    await w.find('.row').trigger('contextmenu');
    await w.find('.ctx').findAll('button')[0].trigger('click');
    await flushPromises();
    expect(alertFn).toHaveBeenCalled();
  });

  it('projectId 变化时重新拉取', async () => {
    const calls = stubApi();
    const w = mountC(FileTree, { props: { projectId: 'p' } });
    await flushPromises();
    await w.setProps({ projectId: 'q' });
    await flushPromises();
    expect(calls.some((c) => c.url.includes('project=q'))).toBe(true);
  });

  it('点击文件行向上 emit open-file；展开目录后刷新会重载子目录', async () => {
    const calls = stubApi();
    const w = mountC(FileTree, { props: { projectId: 'p' } });
    await flushPromises();
    await w.find('.row').trigger('click');          // a.ts
    expect(w.emitted('open-file')?.[0]).toEqual(['p', 'a.ts', 'a.ts']);

    const dirRow = w.findAll('.row')[1];
    const rowsBefore = w.findAll('.row').length;
    await dirRow.trigger('click');                  // 展开 src
    await flushPromises();
    expect(w.findAll('.row').length).toBeGreaterThan(rowsBefore);
    const before = calls.filter((c) => c.url.startsWith('/api/tree')).length;
    await w.find('.head .ic').trigger('click');     // 刷新 → reloadDir
    await flushPromises();
    expect(calls.filter((c) => c.url.startsWith('/api/tree')).length).toBeGreaterThan(before);
  });

  it('右键菜单新建文件：在父目录下创建并打开', async () => {
    const calls = stubApi();
    const w = mountC(FileTree, { props: { projectId: 'p' } });
    await flushPromises();
    stubAlert();
    stubPrompt('ctx-new.ts');
    await w.find('.row').trigger('contextmenu');
    await w.find('.ctx').findAll('button')[1].trigger('click');   // ctx new_file
    await flushPromises();
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(true);
    expect(w.emitted('open-file')?.[0]).toEqual(['p', 'ctx-new.ts', 'ctx-new.ts']);
  });

  it('创建失败时 alert 提示', async () => {
    stubApi({ '/api/file': () => { throw new Error('denied'); } });
    const w = mountC(FileTree, { props: { projectId: 'p' } });
    await flushPromises();
    const alertFn = stubAlert();
    stubPrompt('bad.ts');
    await w.findAll('.acts .ic')[1].trigger('click');
    await flushPromises();
    expect(alertFn).toHaveBeenCalled();
  });
});
