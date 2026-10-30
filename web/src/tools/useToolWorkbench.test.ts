import { describe, it, expect, vi, afterEach } from 'vitest';
import { useToolWorkbench } from './useToolWorkbench';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('useToolWorkbench', () => {
  it('同一 tool 返回同一实例（activeId 共享）', () => {
    const a = useToolWorkbench('notepad');
    const b = useToolWorkbench('notepad');
    expect(a).toBe(b);
    a.activeId.value = 'x.txt';
    expect(b.activeId.value).toBe('x.txt');
    a.activeId.value = '';
  });

  it('不同 tool 相互隔离', () => {
    const a = useToolWorkbench('yaml');
    const b = useToolWorkbench('translate');
    expect(a).not.toBe(b);
    a.activeId.value = 'a.yaml';
    expect(b.activeId.value).toBe('');
    a.activeId.value = '';
  });

  it('newFile：在当前目录按日期时间命名创建并打开', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 15, 30, 12)); // 2026-09-29 15:30:12
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/tree')) return { ok: true, json: async () => ({ items: [], folders: [] }) };
      return { ok: true, json: async () => ({ id: 'sub/20260929-153012.txt' }) };
    }));
    const wb = useToolWorkbench('notepad');
    wb.activeFolder.value = 'sub';
    await wb.newFile();
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toBe('/api/files/notepad/file');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ folder: 'sub', name: '20260929-153012.txt' });
    expect(wb.activeId.value).toBe('sub/20260929-153012.txt');
    wb.activeId.value = '';
    wb.activeFolder.value = '';
  });

  it('js：newFile 按 .js 后缀新建并直接打开', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 30, 12, 0, 0)); // 2026-10-30 12:00:00
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/tree')) return { ok: true, json: async () => ({ items: [], folders: [] }) };
      return { ok: true, json: async () => ({ id: '20261030-120000.js' }) };
    }));
    const wb = useToolWorkbench('js');
    await wb.newFile();
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toBe('/api/files/js/file');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ folder: '', name: '20261030-120000.js' });
    expect(wb.activeId.value).toBe('20261030-120000.js');
    wb.activeId.value = '';
  });
});
