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
  return mountC(NavicatTool, { global: { plugins: [ElementPlus] } });
}

function pick(w: any, value: string) {
  const c = w.findComponent('.nv-conn');
  c.vm.$emit('update:modelValue', value);
  c.vm.$emit('change', value);
}

describe('NavicatTool', () => {
  it('下拉可选连接：填充表单并 reveal 已保存密码', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      calls.push(String(u));
      if (String(u) === '/api/navicat/profiles') return okJson({ items: [P] });
      if (String(u) === '/api/navicat/reveal') return okJson({ password: 'pw' });
      return okJson({});
    }));
    const w = mount();
    await flushPromises();
    pick(w, '1');
    await flushPromises();
    expect((w.find('.nv-name-input input').element as HTMLInputElement).value).toBe('A');
    expect(calls).toContain('/api/navicat/reveal');
    expect((w.find('.nv-pw input').element as HTMLInputElement).value).toBe('pw');
  });

  it('执行读语句渲染结果表格', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (String(u) === '/api/navicat/profiles') return okJson({ items: [P] });
      if (String(u) === '/api/navicat/reveal') return okJson({ password: '' });
      return okJson({ ok: true, result: { columns: ['a'], rows: [[1]], affected: null, truncated: false, durationMs: 2 } });
    }));
    const w = mount();
    await flushPromises();
    pick(w, '1');
    await flushPromises();
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
      if (String(u) === '/api/navicat/reveal') return okJson({ password: '' });
      const b = init?.body ? JSON.parse(String(init.body)) : {};
      if (b.confirm) return okJson({ ok: true, result: { columns: [], rows: [], affected: 1, truncated: false, durationMs: 1 } });
      return okJson({ needConfirm: true, kind: 'write' });
    }));
    const w = mount();
    await flushPromises();
    pick(w, '1');
    await flushPromises();
    await w.find('.nv-sql').setValue('INSERT INTO t VALUES (1)');
    await w.find('.nv-run').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalled();
    expect(w.find('.nv-meta').text()).toContain('1');
  });

  it('新建态选模板填充字段，保存走 POST', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push([String(u), init?.method]);
      if (String(u) === '/api/navicat/profiles' && (!init || !init.method)) return okJson({ items: [P] });
      if (String(u) === '/api/navicat/reveal') return okJson({ password: 'pw' });
      return okJson({ ok: true, item: { ...P, id: '2', name: 'B' } });
    }));
    const w = mount();
    await flushPromises();
    pick(w, '__new__');
    await flushPromises();
    pick(w, '1');
    await flushPromises();
    expect((w.find('.nv-host input').element as HTMLInputElement).value).toBe('h');
    expect((w.find('.nv-pw input').element as HTMLInputElement).value).toBe('pw');
    await w.find('.nv-name-input input').setValue('B');
    await w.find('.nv-save').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/navicat/profiles' && m === 'POST')).toBe(true);
  });

  it('编辑态保存走 PATCH', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push([String(u), init?.method]);
      if (String(u) === '/api/navicat/profiles' && (!init || !init.method)) return okJson({ items: [P] });
      if (String(u) === '/api/navicat/reveal') return okJson({ password: '' });
      return okJson({ ok: true, item: P });
    }));
    const w = mount();
    await flushPromises();
    pick(w, '1');
    await flushPromises();
    await w.find('.nv-name-input input').setValue('A2');
    await w.find('.nv-save').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/navicat/profiles' && m === 'PATCH')).toBe(true);
  });

  it('重命名/删除按钮仅编辑已保存连接时出现', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (String(u) === '/api/navicat/profiles') return okJson({ items: [P] });
      if (String(u) === '/api/navicat/reveal') return okJson({ password: '' });
      return okJson({});
    }));
    const w = mount();
    await flushPromises();
    expect(w.find('.nv-rename').exists()).toBe(false);
    pick(w, '1');
    await flushPromises();
    expect(w.find('.nv-rename').exists()).toBe(true);
    expect(w.find('.nv-del').exists()).toBe(true);
    pick(w, '__new__');
    await flushPromises();
    expect(w.find('.nv-rename').exists()).toBe(false);
  });
});
