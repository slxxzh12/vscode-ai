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
});
