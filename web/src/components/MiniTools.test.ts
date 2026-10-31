// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import MiniTools from './MiniTools.vue';
import { pendingTool, clearPendingTool, pendingToolTab, clearPendingToolTab, pendingProxyTab, clearPendingProxyTab } from '../uiIntents';

afterEach(() => { clearPendingTool(); clearPendingToolTab(); clearPendingProxyTab(); });

const IDS = ['notepad', 'postman', 'navicat', 'nginx', 'translate', 'yaml', 'markdown', 'js', 'base64'];

describe('MiniTools', () => {
  it('渲染全部工具磁贴', () => {
    const w = mountC(MiniTools);
    expect(w.findAll('.mticon')).toHaveLength(IDS.length);
  });

  it('任一磁贴点击 → 请求主区工具页签（nginx 进入合并代理页）', async () => {
    for (let i = 0; i < IDS.length; i += 1) {
      clearPendingToolTab();
      clearPendingProxyTab();
      const w = mountC(MiniTools);
      await w.findAll('.mticon')[i].trigger('click');
      if (IDS[i] === 'nginx') {
        expect(pendingProxyTab.value).toBe('nginx');
        expect(pendingToolTab.value).toBeNull();
      } else {
        expect(pendingToolTab.value).toBe(IDS[i]);
        expect(pendingProxyTab.value).toBeNull();
      }
    }
  });

  it('pendingTool 置位时同样请求工具页签', async () => {
    pendingTool.value = 'postman';
    const w = mountC(MiniTools);
    await flushPromises();
    expect(pendingToolTab.value).toBe('postman');
  });
});
