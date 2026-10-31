// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mountC } from '../test-utils';
import ConfirmDialog from './ConfirmDialog.vue';

describe('ConfirmDialog', () => {
  it('open=false 不渲染', () => {
    const w = mountC(ConfirmDialog, { props: { open: false, title: 'T', message: 'M' } });
    expect(w.find('.ep-mask').exists()).toBe(false);
  });

  it('渲染标题与消息；确认按钮 emit confirm；遮罩 emit cancel', async () => {
    const w = mountC(ConfirmDialog, { props: { open: true, title: '标题', message: '内容' } });
    expect(w.text()).toContain('标题');
    expect(w.text()).toContain('内容');
    await w.find('.ep-primary').trigger('click');
    expect(w.emitted('confirm')).toHaveLength(1);
    await w.find('.ep-mask').trigger('click');
    expect(w.emitted('cancel')).toHaveLength(1);
  });

  it('requireText 需输入匹配（忽略大小写/空白）才可确认', async () => {
    const w = mountC(ConfirmDialog, { props: { open: true, title: 'T', message: 'M', requireText: 'DELETE' } });
    const btn = () => w.find('.ep-primary').element as HTMLButtonElement;
    expect(btn().disabled).toBe(true);
    const input = w.find('.ep-input');
    await input.setValue('  delete ');
    expect(btn().disabled).toBe(false);
    await input.trigger('keyup.enter');
    expect(w.emitted('confirm')).toHaveLength(1);
  });

  it('输入不匹配时禁用确认并标记 bad', async () => {
    const w = mountC(ConfirmDialog, { props: { open: true, title: 'T', message: 'M', requireText: 'X' } });
    await w.find('.ep-input').setValue('y');
    expect((w.find('.ep-primary').element as HTMLButtonElement).disabled).toBe(true);
    expect(w.find('.ep-input').classes()).toContain('bad');
  });

  it('重新打开会清空输入', async () => {
    const w = mountC(ConfirmDialog, { props: { open: false, title: 'T', message: 'M', requireText: 'X' } });
    await w.setProps({ open: true });
    await w.find('.ep-input').setValue('x');
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    expect((w.find('.ep-input').element as HTMLInputElement).value).toBe('');
  });

  it('danger 显示 ✕ 图标并加 danger class', () => {
    const w = mountC(ConfirmDialog, { props: { open: true, title: 'T', message: 'M', type: 'danger' } });
    expect(w.find('.ep-ico').text()).toBe('✕');
    expect(w.find('.ep-ico').classes()).toContain('danger');
    expect(w.find('.ep-primary').classes()).toContain('danger');
  });
});
