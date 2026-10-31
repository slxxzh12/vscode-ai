// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountC } from '../../test-utils';
import NavicatSidebarBar from './NavicatSidebarBar.vue';
import { useNavicatWorkbench } from './useNavicatWorkbench';

afterEach(() => { vi.unstubAllGlobals(); useNavicatWorkbench().dlg.value = false; });

describe('NavicatSidebarBar', () => {
  it('点击新建连接 → 置位弹窗状态', async () => {
    const w = mountC(NavicatSidebarBar);
    await w.find('.nvsb-new').trigger('click');
    expect(useNavicatWorkbench().dlg.value).toBe(true);
  });
});
