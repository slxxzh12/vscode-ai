// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../../test-utils';
import NavicatTool from './NavicatTool.vue';
import CodeEditor from '../../components/CodeEditor.vue';
import { useNavicatWorkbench } from './useNavicatWorkbench';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
const P = { id: '1', name: 'A', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'd', hasPassword: false };

afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  const wb = useNavicatWorkbench();
  wb.activeId.value = ''; wb.activeDatabase.value = ''; wb.activeFolder.value = ''; wb.dlg.value = false;
});

function stubFetch(extra: (u: string, init?: RequestInit) => any) {
  return vi.fn(async (u: string, init?: RequestInit) => {
    const s = String(u);
    if (s === '/api/navicat/profiles' && (!init || !init.method)) return okJson({ items: [P] });
    if (s === '/api/navicat/reveal') return okJson({ password: '' });
    return extra(s, init);
  });
}

function mount() { return mountC(NavicatTool, { global: { plugins: [ElementPlus] } }); }

describe('NavicatTool', () => {
  it('选中连接后工具栏显示连接名', async () => {
    vi.stubGlobal('fetch', stubFetch(() => okJson({})));
    const wb = useNavicatWorkbench();
    await wb.load();
    wb.onFolder('c:1');
    const w = mount();
    await flushPromises();
    expect(w.find('.nvactive').text()).toBe('A');
  });

  it('工作台点表生成的 SQL 会出现在编辑器', async () => {
    vi.stubGlobal('fetch', stubFetch(() => okJson({})));
    const wb = useNavicatWorkbench();
    await wb.load();
    wb.activeId.value = ''; wb.sql.value = '';
    wb.onFolder('c:1');
    wb.pickTable('1', 'db1', 'users');
    const w = mount();
    await flushPromises();
    expect(w.findComponent(CodeEditor).props('modelValue')).toBe('SELECT * FROM `users`');
  });

  it('执行查询渲染结果表', async () => {
    vi.stubGlobal('fetch', stubFetch((u) => {
      if (u === '/api/navicat/exec') return okJson({ ok: true, result: { columns: ['a'], rows: [[1]], affected: null, truncated: false, durationMs: 2 } });
      return okJson({});
    }));
    const wb = useNavicatWorkbench();
    await wb.load();
    wb.onFolder('c:1');
    wb.sql.value = 'SELECT 1';
    const w = mount();
    await flushPromises();
    await w.find('.nv-run').trigger('click');
    await flushPromises();
    expect(w.find('.nv-table').exists()).toBe(true);
  });

  it('新建连接对话框：保存走 POST', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', stubFetch((u, init) => { calls.push([u, init?.method]); return okJson({ ok: true, item: { ...P, id: '2', name: 'B' } }); }));
    const wb = useNavicatWorkbench();
    await wb.load();
    const w = mount();
    await flushPromises();
    wb.openNew();
    await flushPromises();
    await w.find('.nv-name-input input').setValue('B');
    await w.find('.nv-save').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/navicat/profiles' && m === 'POST')).toBe(true);
  });

  it('SQLite 连接对话框：浏览按钮写回文件路径', async () => {
    vi.stubGlobal('fetch', stubFetch((u) => (u === '/api/navicat/pick-file' ? okJson({ path: 'C:\\data\\x.db' }) : okJson({}))));
    const wb = useNavicatWorkbench();
    await wb.load();
    wb.openNew();
    wb.form.value = { ...wb.form.value, type: 'sqlite' };
    const w = mount();
    await flushPromises();
    await w.find('.nv-browse').trigger('click');
    await flushPromises();
    expect((w.find('.nv-db-file input').element as HTMLInputElement).value).toBe('C:\\data\\x.db');
  });
});
