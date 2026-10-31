import { describe, it, expect, vi, afterEach } from 'vitest';
import { usePostmanWorkbench } from './usePostmanWorkbench';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }

afterEach(() => { vi.unstubAllGlobals(); });

const REC = (id: string, command: string, folder: string) => ({ id, command, folder, result: {}, updatedAt: '2026-09-01T00:00:00.000Z' });

describe('usePostmanWorkbench', () => {
  it('同一实例（模块级单例）', () => {
    expect(usePostmanWorkbench()).toBe(usePostmanWorkbench());
  });

  it('runFolder：批量跑目录内记录并逐条标状态', async () => {
    const records = [REC('foo/a.json', 'curl A', 'foo'), REC('foo/b.json', 'curl B', 'foo')];
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      if (u === '/api/postman/history') return okJson({ items: records, folders: ['foo'] });
      if (u === '/api/curl') {
        const b = JSON.parse(opt.body);
        calls.push(b.command);
        return okJson({ ok: true, code: 0, status: b.command === 'curl A' ? 200 : 500, headers: '', body: '', stdout: '', stderr: '', timedOut: false });
      }
      return okJson({});
    }));
    const wb = usePostmanWorkbench();
    await wb.load();
    await wb.runFolder('foo');
    expect(calls).toEqual(['curl A', 'curl B']);
    expect(wb.runStatus.value['foo/a.json']).toBe('pass');
    expect(wb.runStatus.value['foo/b.json']).toBe('fail');
  });

  it('batchRun：未选目录时跑全部（含子目录）', async () => {
    const records = [REC('a.json', 'curl A', ''), REC('sub/b.json', 'curl B', 'sub')];
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      if (u === '/api/postman/history') return okJson({ items: records, folders: ['sub'] });
      if (u === '/api/curl') { calls.push(JSON.parse(opt.body).command); return okJson({ ok: true, code: 0, status: 200, headers: '', body: '', stdout: '', stderr: '', timedOut: false }); }
      return okJson({});
    }));
    const wb = usePostmanWorkbench();
    await wb.load();
    wb.activeFolder.value = '';
    await wb.batchRun();
    expect(calls.sort()).toEqual(['curl A', 'curl B']);
  });

  it('openRecord 载入命令并选中', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [], folders: [] })));
    const wb = usePostmanWorkbench();
    wb.openRecord(REC('x.json', 'curl X', ''));
    expect(wb.curlCmd.value).toBe('curl X');
    expect(wb.activeId.value).toBe('x.json');
  });
});
