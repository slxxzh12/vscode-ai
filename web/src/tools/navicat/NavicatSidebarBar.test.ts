// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import NavicatSidebarBar from './NavicatSidebarBar.vue';
import { useNavicatWorkbench } from './useNavicatWorkbench';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }

afterEach(() => {
  vi.unstubAllGlobals();
  const wb = useNavicatWorkbench();
  wb.dlg.value = false;
  wb.exportDlg.value = false;
});

describe('NavicatSidebarBar', () => {
  it('点击新建连接 → 置位弹窗状态', async () => {
    const w = mountC(NavicatSidebarBar);
    await w.find('.nvsb-new').trigger('click');
    expect(useNavicatWorkbench().dlg.value).toBe(true);
  });

  it('点击批量导入 → 触发隐藏文件输入', async () => {
    const w = mountC(NavicatSidebarBar);
    const input = w.find('.nvsb-file').element as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    await w.find('.nvsb-import').trigger('click');
    expect(click).toHaveBeenCalled();
  });

  it('点击导出 → 打开导出弹窗', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (String(u) === '/api/navicat/profiles' ? okJson({ items: [] }) : okJson({}))));
    const w = mountC(NavicatSidebarBar);
    await w.find('.nvsb-export').trigger('click');
    await flushPromises();
    expect(useNavicatWorkbench().exportDlg.value).toBe(true);
  });
});
