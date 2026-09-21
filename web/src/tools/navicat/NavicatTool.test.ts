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

function stubFetch(extra: (u: string, init?: RequestInit) => any) {
  return vi.fn(async (u: string, init?: RequestInit) => {
    const s = String(u);
    if (s === '/api/navicat/profiles' && (!init || !init.method)) return okJson({ items: [P] });
    if (s.startsWith('/api/navicat/schema/databases')) return okJson({ items: ['db1'] });
    if (s.startsWith('/api/navicat/schema/tables')) return okJson({ items: ['users'] });
    if (s === '/api/navicat/reveal') return okJson({ password: '' });
    return extra(s, init);
  });
}

describe('NavicatTool', () => {
  it('新建连接对话框：保存走 POST', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', stubFetch((u, init) => {
      calls.push([u, init?.method]);
      return okJson({ ok: true, item: { ...P, id: '2', name: 'B' } });
    }));
    const w = mount();
    await flushPromises();
    await w.find('.nvnewbtn').trigger('click');
    await flushPromises();
    expect(w.find('.nv-name-input input').exists()).toBe(true);
    await w.find('.nv-name-input input').setValue('B');
    await w.find('.nv-save').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/navicat/profiles' && m === 'POST')).toBe(true);
  });

  it('编辑连接对话框：保存走 PATCH', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', stubFetch((u, init) => {
      calls.push([u, init?.method]);
      return okJson({ ok: true, item: P });
    }));
    const w = mount();
    await flushPromises();
    await w.find('.nvedit').trigger('click');
    await flushPromises();
    await w.find('.nv-name-input input').setValue('A2');
    await w.find('.nv-save').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/navicat/profiles' && m === 'PATCH')).toBe(true);
  });

  it('选中连接：工具栏显示连接名', async () => {
    vi.stubGlobal('fetch', stubFetch(() => okJson({})));
    const w = mount();
    await flushPromises();
    await w.find('.nvconnname').trigger('click');
    await flushPromises();
    expect(w.find('.nvactive').text()).toBe('A');
  });

  it('展开库并点表：生成 SELECT * 且执行带 database', async () => {
    let execBody: any = null;
    vi.stubGlobal('fetch', stubFetch((u, init) => {
      if (u === '/api/navicat/exec') {
        execBody = init?.body ? JSON.parse(String(init.body)) : {};
        return okJson({ ok: true, result: { columns: ['a'], rows: [[1]], affected: null, truncated: false, durationMs: 2 } });
      }
      return okJson({});
    }));
    const w = mount();
    await flushPromises();
    await w.find('.nvconnname').trigger('click');
    await w.find('.nvconn .nvchev').trigger('click');
    await flushPromises();
    await w.find('.nvdbitem .nvchev').trigger('click');
    await flushPromises();
    await w.find('.nvtbname').trigger('click');
    expect((w.find('.nv-sql').element as HTMLTextAreaElement).value).toBe('SELECT * FROM `users`');
    await w.find('.nv-run').trigger('click');
    await flushPromises();
    expect(execBody.database).toBe('db1');
    expect(w.find('.nv-table').exists()).toBe(true);
  });

  it('写语句先弹确认，确认后执行', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as any);
    vi.stubGlobal('fetch', stubFetch((u, init) => {
      const b = init?.body ? JSON.parse(String(init.body)) : {};
      if (u === '/api/navicat/exec' && b.confirm) return okJson({ ok: true, result: { columns: [], rows: [], affected: 1, truncated: false, durationMs: 1 } });
      if (u === '/api/navicat/exec') return okJson({ needConfirm: true, kind: 'write' });
      return okJson({});
    }));
    const w = mount();
    await flushPromises();
    await w.find('.nvconnname').trigger('click');
    await w.find('.nv-sql').setValue('INSERT INTO t VALUES (1)');
    await w.find('.nv-run').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalled();
    expect(w.find('.nv-meta').text()).toContain('1');
  });

  it('新建连接常规页不含数据库输入', async () => {
    vi.stubGlobal('fetch', stubFetch(() => okJson({})));
    const w = mount();
    await flushPromises();
    await w.find('.nvnewbtn').trigger('click');
    await flushPromises();
    expect(w.find('.nv-name-input input').exists()).toBe(true);
    expect(w.find('.nv-db').exists()).toBe(false);
    expect(w.find('.nv-db-file').exists()).toBe(false);
  });

  it('类型选 sqlite 时显示数据库文件输入，隐藏主机端口', async () => {
    vi.stubGlobal('fetch', stubFetch(() => okJson({})));
    const w = mount();
    await flushPromises();
    await w.find('.nvnewbtn').trigger('click');
    await flushPromises();
    await w.find('.nv-type').setValue('sqlite');
    await flushPromises();
    expect(w.find('.nv-db-file').exists()).toBe(true);
    expect(w.find('.nv-host').exists()).toBe(false);
  });

  it('高级页含 SSL 开关，sqlite 下不渲染高级页', async () => {
    vi.stubGlobal('fetch', stubFetch(() => okJson({})));
    const w = mount();
    await flushPromises();
    await w.find('.nvnewbtn').trigger('click');
    await flushPromises();
    expect(w.find('.nv-ssl').exists()).toBe(true);
    await w.find('.nv-type').setValue('sqlite');
    await flushPromises();
    expect(w.find('.nv-ssl').exists()).toBe(false);
  });

  it('保存 mysql 连接时清空残留 database', async () => {
    let body: any = null;
    vi.stubGlobal('fetch', stubFetch((u, init) => {
      if (u === '/api/navicat/profiles' && init?.method === 'PATCH') {
        body = init?.body ? JSON.parse(String(init.body)) : null;
      }
      return okJson({ ok: true, item: P });
    }));
    const w = mount();
    await flushPromises();
    await w.find('.nvedit').trigger('click');
    await flushPromises();
    await w.find('.nv-save').trigger('click');
    await flushPromises();
    expect(body).toBeTruthy();
    expect(body.database).toBe('');
  });
});
