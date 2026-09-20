// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus, { ElMessageBox } from 'element-plus';
import { mountC } from '../../test-utils';
import NavicatTool from './NavicatTool.vue';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
const P = { id: '1', name: 'A', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'd', hasPassword: true };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount() {
  return mountC(NavicatTool, { global: { plugins: [ElementPlus], stubs: { teleport: true } } });
}

describe('NavicatTool', () => {
  it('加载列表并可选中填充表单', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [P] })));
    const w = mount();
    await flushPromises();
    expect(w.findAll('.nv-row')).toHaveLength(1);
    await w.find('.nv-row').trigger('click');
    await flushPromises();
    expect((w.find('.nv-name-input input').element as HTMLInputElement).value).toBe('A');
  });

  it('执行读语句渲染结果表格与行数', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (String(u) === '/api/navicat/profiles') return okJson({ items: [P] });
      return okJson({ ok: true, result: { columns: ['a'], rows: [[1]], affected: null, truncated: false, durationMs: 2 } });
    }));
    const w = mount();
    await flushPromises();
    await w.find('.nv-row').trigger('click');
    await w.find('.nv-sql').setValue('SELECT 1');
    await w.find('.nv-run').trigger('click');
    await flushPromises();
    expect(w.find('.nv-table').exists()).toBe(true);
    expect(w.find('.nv-table').text()).toContain('1');
  });

  it('写语句先弹确认，确认后执行', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as any);
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (String(u) === '/api/navicat/profiles') return okJson({ items: [P] });
      const b = init?.body ? JSON.parse(String(init.body)) : {};
      if (b.confirm) return okJson({ ok: true, result: { columns: [], rows: [], affected: 1, truncated: false, durationMs: 1 } });
      return okJson({ needConfirm: true, kind: 'write' });
    }));
    const w = mount();
    await flushPromises();
    await w.find('.nv-row').trigger('click');
    await w.find('.nv-sql').setValue('INSERT INTO t VALUES (1)');
    await w.find('.nv-run').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalled();
    expect(w.find('.nv-meta').text()).toContain('1');
  });

  it('新建连接 → 保存发出 POST', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push([String(u), init?.method]);
      if (String(u) === '/api/navicat/profiles' && (!init || !init.method)) return okJson({ items: [] });
      return okJson({ ok: true, item: P });
    }));
    const w = mount();
    await flushPromises();
    await w.find('.nv-new').trigger('click');
    await w.find('.nv-name-input input').setValue('新连接');
    await w.find('.nv-save').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/navicat/profiles' && m === 'POST')).toBe(true);
  });
});
