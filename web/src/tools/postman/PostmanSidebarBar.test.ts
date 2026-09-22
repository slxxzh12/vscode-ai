// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import PostmanSidebarBar from './PostmanSidebarBar.vue';
import { usePostmanWorkbench } from './usePostmanWorkbench';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
afterEach(() => { vi.unstubAllGlobals(); usePostmanWorkbench().runStatus.value = {}; });

describe('PostmanSidebarBar', () => {
  it('点击批量执行 → 跑当前目录记录', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      if (u === '/api/postman/history') return okJson({ items: [{ id: 'a.json', command: 'curl A', folder: '', result: {} }], folders: [] });
      if (u === '/api/curl') { calls.push(JSON.parse(opt.body).command); return okJson({ ok: true, code: 0, status: 200, headers: '', body: '', stdout: '', stderr: '', timedOut: false }); }
      return okJson({});
    }));
    const wb = usePostmanWorkbench();
    await wb.load();
    wb.activeFolder.value = '';
    const w = mountC(PostmanSidebarBar);
    await flushPromises();
    await w.find('.pmsb-run').trigger('click');
    await flushPromises();
    expect(calls).toEqual(['curl A']);
  });
});
