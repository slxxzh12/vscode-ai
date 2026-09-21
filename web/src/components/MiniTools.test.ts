// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import MiniTools from './MiniTools.vue';
import PostmanTool from '../tools/postman/PostmanTool.vue';
import { pendingTool, clearPendingTool, pendingToolTab, clearPendingToolTab } from '../uiIntents';

afterEach(() => { vi.unstubAllGlobals(); clearPendingTool(); clearPendingToolTab(); });

function okJson(body: unknown) { return { ok: true, json: async () => body }; }

describe('MiniTools', () => {
  it('渲染 5 个工具磁贴', () => {
    const w = mountC(MiniTools, { global: { plugins: [ElementPlus], stubs: { teleport: true } } });
    expect(w.findAll('.mticon')).toHaveLength(5);
  });

  it('记事本 / YAML / 翻译磁贴改为请求主区工具页签（不开弹窗）', async () => {
    const w = mountC(MiniTools, { global: { plugins: [ElementPlus], stubs: { teleport: true } } });
    await w.findAll('.mticon')[0].trigger('click');   // 记事本
    expect(pendingToolTab.value).toBe('notepad');
    clearPendingToolTab();
    await w.findAll('.mticon')[4].trigger('click');   // YAML
    expect(pendingToolTab.value).toBe('yaml');
    clearPendingToolTab();
    await w.findAll('.mticon')[3].trigger('click');   // 翻译
    expect(pendingToolTab.value).toBe('translate');
    expect(w.find('.ttbody').exists()).toBe(false);
  });

  it('Postman 磁贴仍开全屏弹窗并可关闭', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [], folders: [] })));
    const w = mountC(MiniTools, { global: { plugins: [ElementPlus], stubs: { teleport: true } } });
    await w.findAll('.mticon')[1].trigger('click');
    await flushPromises();
    expect(w.findComponent(PostmanTool).exists()).toBe(true);
    expect(w.find('.el-dialog').classes()).toContain('is-fullscreen');
    await w.find('.el-dialog__headerbtn').trigger('click');
    await flushPromises();
    expect((w.find('.el-overlay').element as HTMLElement).style.display).toBe('none');
  });

  it('Navicat 磁贴仍开弹窗', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [] })));
    // teleport stub 会让 ElSelect 递归更新（happy-dom 下的已知问题），此用例只验证面板挂载，直接 stub 掉 ElSelect。
    const w = mountC(MiniTools, { global: { plugins: [ElementPlus], stubs: { teleport: true, ElSelect: true } } });
    await w.findAll('.mticon')[2].trigger('click');
    await flushPromises();
    expect(w.find('.nvbody').exists()).toBe(true);
  });

  it('pendingTool 置为 Postman 时自动打开弹窗', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [], folders: [] })));
    pendingTool.value = 'postman';
    const w = mountC(MiniTools, { global: { plugins: [ElementPlus], stubs: { teleport: true } } });
    await flushPromises();
    expect(w.findComponent(PostmanTool).exists()).toBe(true);
  });

  it('pendingTool 置为记事本时改为请求工具页签', async () => {
    pendingTool.value = 'notepad';
    const w = mountC(MiniTools, { global: { plugins: [ElementPlus], stubs: { teleport: true } } });
    await flushPromises();
    expect(pendingToolTab.value).toBe('notepad');
    expect(w.find('.ttbody').exists()).toBe(false);
  });

  it('工具操作按钮 Teleport 到弹窗标题行右侧', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [], folders: [] })));
    // 不 stub teleport：验证按钮真的被挂到 #mtdlg-actions 里
    const w = mountC(MiniTools, { global: { plugins: [ElementPlus] } });
    await w.findAll('.mticon')[1].trigger('click');   // Postman
    await flushPromises();
    const actions = document.querySelector('#mtdlg-actions');
    expect(actions?.querySelector('.pmactsbar')).toBeTruthy();
    expect(document.querySelector('.pmmain .pmactsbar')).toBeNull();
    w.unmount();
  });
});
