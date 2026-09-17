// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mountC } from '../test-utils';
import SyncUpdateDialog from './SyncUpdateDialog.vue';
import SyncSeedDialog from './SyncSeedDialog.vue';

describe('SyncUpdateDialog', () => {
  const base = { masterLabel: 'Master', version: 'v1' };

  it('open=false 不渲染', () => {
    const w = mountC(SyncUpdateDialog, { props: { ...base, open: false, files: [], result: null } });
    expect(w.find('.mask').exists()).toBe(false);
  });

  it('展示文件与人类可读大小，接受/拒绝/遮罩取消', async () => {
    const w = mountC(SyncUpdateDialog, {
      props: { ...base, open: true, result: null, files: [{ name: 'a.txt', size: 500 }, { name: 'b.bin', size: 2048 }, { name: 'c.bin', size: 2 * 1024 * 1024 }, { name: 'd', size: undefined }] },
    });
    expect(w.text()).toContain('500 B');
    expect(w.text()).toContain('2.0 KB');
    expect(w.text()).toContain('2.0 MB');
    await w.find('.btn.primary').trigger('click');
    expect(w.emitted('accept')).toHaveLength(1);
    await w.find('.btn').trigger('click');
    expect(w.emitted('reject')).toHaveLength(1);
    await w.find('.mask').trigger('click');
    expect(w.emitted('reject')).toHaveLength(2);
  });

  it('有 result 时显示结果，仅剩一个 OK 按钮', async () => {
    const w = mountC(SyncUpdateDialog, { props: { ...base, open: true, files: [], result: '完成' } });
    expect(w.text()).toContain('完成');
    expect(w.findAll('.btn')).toHaveLength(1);
    await w.find('.btn.primary').trigger('click');
    expect(w.emitted('reject')).toHaveLength(1);
  });
});

describe('SyncSeedDialog', () => {
  const files = [{ name: 's1', kind: 'skill', size: 1024 }, { name: 'f1', kind: 'file', size: 10 }];

  it('open=false 不渲染；空列表提示', async () => {
    const w = mountC(SyncSeedDialog, { props: { open: false, files, version: 'v1' } });
    expect(w.find('.mask').exists()).toBe(false);
    await w.setProps({ open: true, files: [] });
    expect(w.find('.empty').exists()).toBe(true);
  });

  it('全选/全不选 + 确认返回所选；skill 行有安装按钮', async () => {
    const w = mountC(SyncSeedDialog, { props: { open: true, files, version: 'v1' } });
    const [all, none] = w.findAll('.row button.ghost');
    await all.trigger('click');
    await w.find('.btn.primary').trigger('click');
    expect(w.emitted('confirm')?.[0]).toEqual([['s1', 'f1']]);

    await none.trigger('click');
    await w.find('.btn.primary').trigger('click');
    expect(w.emitted('confirm')?.[1]).toEqual([[]]);

    const install = w.find('.rowline button.ghost');
    await install.trigger('click');
    expect(w.emitted('install')?.[0]).toEqual(['s1']);
  });

  it('勾选单文件后确认只返回该文件；取消按钮 emit cancel', async () => {
    const w = mountC(SyncSeedDialog, { props: { open: true, files, version: 'v1' } });
    const boxes = w.findAll('input[type="checkbox"]');
    await boxes[1].setValue(true);
    await w.find('.btn.primary').trigger('click');
    expect(w.emitted('confirm')?.[0]).toEqual([['f1']]);
    await w.find('.btn').trigger('click');
    expect(w.emitted('cancel')).toHaveLength(1);
  });
});
