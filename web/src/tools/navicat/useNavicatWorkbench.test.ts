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
});
