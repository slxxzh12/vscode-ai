// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ElMessageBox } from 'element-plus';
import { useNavicatWorkbench } from './useNavicatWorkbench';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
const P = { id: '1', name: 'A', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'd', hasPassword: false };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('useNavicatWorkbench', () => {
  it('单例', () => { expect(useNavicatWorkbench()).toBe(useNavicatWorkbench()); });

  it('onFolder 选中连接/库，pickTable 追加 SELECT', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/api/navicat/profiles' ? okJson({ items: [P] }) : okJson({}))));
    const wb = useNavicatWorkbench();
    await wb.load();
    wb.onFolder('c:1');
    expect(wb.activeId.value).toBe('1');
    wb.sql.value = 'SELECT 1';
    wb.pickTable('1', 'db1', 'users');
    expect(wb.sql.value).toBe('SELECT 1\nSELECT * FROM `users`');
  });

  it('onFolder 选库设置 activeDatabase 并高亮', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/api/navicat/profiles' ? okJson({ items: [P] }) : okJson({}))));
    const wb = useNavicatWorkbench();
    await wb.load();
    wb.onFolder('d:1\u0000db1');
    expect(wb.activeId.value).toBe('1');
    expect(wb.activeDatabase.value).toBe('db1');
    expect(wb.activeFolder.value).toBe('d:1\u0000db1');
  });

  it('delete 当前连接清空活动项', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as any);
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/api/navicat/profiles' ? okJson({ items: [P] }) : okJson({ ok: true }))));
    const wb = useNavicatWorkbench();
    await wb.load();
    wb.onFolder('c:1');
    await wb.onRemove(P as any);
    expect(wb.activeId.value).toBe('');
  });

  it('browseFile：选中写回 form.database', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (String(u) === '/api/navicat/pick-file' ? okJson({ path: 'C:\\a\\x.db' }) : okJson({ items: [P] }))));
    const wb = useNavicatWorkbench();
    wb.openNew();
    wb.form.value = { ...wb.form.value, type: 'sqlite' };
    await wb.browseFile();
    expect(wb.form.value.database).toBe('C:\\a\\x.db');
  });

  it('browseFile：unsupported 置 dlgMsg', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (String(u) === '/api/navicat/pick-file' ? okJson({ error: 'unsupported' }) : okJson({ items: [P] }))));
    const wb = useNavicatWorkbench();
    wb.dlgMsg.value = '';
    await wb.browseFile();
    expect(wb.dlgMsg.value).not.toBe('');
  });

  it('openSqliteFile：没有则新建 sqlite 连接并选中', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (String(u) === '/api/navicat/profiles' && init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)));
        return okJson({ item: { id: '9', name: 'a.db', type: 'sqlite', database: 'C:\\d\\a.db' } });
      }
      if (String(u) === '/api/navicat/profiles') return okJson({ items: [] });
      return okJson({});
    }));
    const wb = useNavicatWorkbench();
    await wb.openSqliteFile('C:\\d\\a.db', 'a.db');
    expect(bodies[0]).toMatchObject({ type: 'sqlite', database: 'C:\\d\\a.db', name: 'a.db' });
    expect(wb.activeId.value).toBe('9');
  });

  it('openSqliteFile：同路径复用不新增', async () => {
    const posts: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (String(u) === '/api/navicat/profiles' && init?.method === 'POST') { posts.push(1); return okJson({ item: { id: '9' } }); }
      if (String(u) === '/api/navicat/profiles') return okJson({ items: [{ id: '9', name: 'a.db', type: 'sqlite', database: 'C:\\d\\a.db' }] });
      return okJson({});
    }));
    const wb = useNavicatWorkbench();
    await wb.openSqliteFile('C:\\d\\a.db', 'a.db');
    expect(posts).toHaveLength(0);
    expect(wb.activeId.value).toBe('9');
  });

  it('importCsv：跳过重复，创建后逐个测试，失败记入 failedIds', async () => {
    const csv = 'B,mysql://u@h2/db2\nDup,mysql://u@h/d\nbad line\nC,redis://h3:6379/0';
    const posts: any[] = [];
    const tests: string[] = [];
    let seq = 2;
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      const s = String(u);
      if (s === '/api/navicat/profiles' && (!init || !init.method)) return okJson({ items: [P] });
      if (s === '/api/navicat/profiles' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        posts.push(body);
        return okJson({ item: { ...body, id: String(seq++) } });
      }
      if (s === '/api/navicat/test') {
        const body = JSON.parse(String(init?.body || '{}'));
        tests.push(body.id);
        if (body.id === '3') return { ok: false, status: 502, json: async () => ({ message: 'boom' }) };
        return okJson({ ok: true });
      }
      return okJson({ items: [P] });
    }));
    const wb = useNavicatWorkbench();
    wb.failedIds.value.clear();
    await wb.importCsv({ text: async () => csv } as any);
    expect(posts.map((p) => p.name)).toEqual(['B', 'C']);
    expect(tests).toEqual(['2', '3']);
    expect(wb.failedIds.value.has('3')).toBe(true);
    expect(wb.importing.value).toBe(false);
    expect(wb.msg.value).toContain('C: boom');
  });

  it('openExport：默认全选连接、N=30、SQL/CSV 都勾选', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (String(u) === '/api/navicat/profiles' ? okJson({ items: [P] }) : okJson({}))));
    const wb = useNavicatWorkbench();
    await wb.openExport();
    expect(wb.exportIds.value).toEqual(['1']);
    expect(wb.exportN.value).toBe(30);
    expect(wb.exportSql.value).toBe(true);
    expect(wb.exportCsv.value).toBe(true);
    expect(wb.exportDlg.value).toBe(true);
  });

  it('doExportData：启动异步导出、轮询进度并下载', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      const s = String(u);
      if (s === '/api/navicat/profiles') return okJson({ items: [P] });
      if (s === '/api/navicat/export') {
        bodies.push(JSON.parse(String(init?.body)));
        return okJson({ ok: true, jobId: 'j1' });
      }
      if (s === '/api/navicat/export/jobs/j1') {
        return okJson({ status: 'done', progress: { dbIndex: 1, dbTotal: 1, tablesDone: 2 }, errors: [], errorsCount: 0, error: '' });
      }
      if (s === '/api/navicat/export/jobs/j1/download') return { ok: true, status: 200, blob: async () => new Blob(['zip']) };
      return okJson({});
    }));
    if (!URL.createObjectURL) (URL as any).createObjectURL = () => 'blob:x';
    if (!URL.revokeObjectURL) (URL as any).revokeObjectURL = () => {};
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const wb = useNavicatWorkbench();
    wb.exportDlg.value = true;
    wb.exportIds.value = ['1'];
    wb.exportN.value = 5;
    wb.exportSql.value = false;
    wb.exportCsv.value = true;
    wb.exportDbs.value = { '1': 'db1' };
    wb.exportOutDir.value = 'out';
    await wb.doExportData();
    expect(bodies).toEqual([{ ids: ['1'], n: 5, formats: ['csv'], databases: { '1': 'db1' }, sample: true, outDir: 'out', async: true }]);
    expect(create).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(wb.exportDlg.value).toBe(false);
  });
});
