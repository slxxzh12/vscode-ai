// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import MiniTools from './MiniTools.vue';
import { pendingTool, clearPendingTool, pendingToolTab, clearPendingToolTab } from '../uiIntents';

afterEach(() => { clearPendingTool(); clearPendingToolTab(); });

const IDS = ['notepad', 'postman', 'navicat', 'translate', 'yaml'];

describe('MiniTools', () => {
  it('渲染 5 个工具磁贴', () => {
    const w = mountC(MiniTools);
    expect(w.findAll('.mticon')).toHaveLength(5);
  });

  it('任一磁贴点击 → 请求主区工具页签', async () => {
    for (let i = 0; i < IDS.length; i += 1) {
      clearPendingToolTab();
      const w = mountC(MiniTools);
      await w.findAll('.mticon')[i].trigger('click');
      expect(pendingToolTab.value).toBe(IDS[i]);
    }
  });

  it('pendingTool 置位时同样请求工具页签', async () => {
    pendingTool.value = 'postman';
    const w = mountC(MiniTools);
    await flushPromises();
    expect(pendingToolTab.value).toBe('postman');
  });
});
