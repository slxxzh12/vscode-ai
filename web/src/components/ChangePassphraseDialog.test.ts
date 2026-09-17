// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mountC } from '../test-utils';
import ChangePassphraseDialog from './ChangePassphraseDialog.vue';

describe('ChangePassphraseDialog', () => {
  it('open=false 不渲染', () => {
    const w = mountC(ChangePassphraseDialog, { props: { open: false } });
    expect(w.find('.mask').exists()).toBe(false);
  });

  it('缺字段提示必填；两次不一致提示不匹配', async () => {
    const w = mountC(ChangePassphraseDialog, { props: { open: false } });
    await w.setProps({ open: true });
    await w.find('.btn.primary').trigger('click');
    expect(w.find('.err').exists()).toBe(true);

    const inputs = w.findAll('input');
    await inputs[0].setValue('old');
    await inputs[1].setValue('new');
    await inputs[2].setValue('other');
    await w.find('.btn.primary').trigger('click');
    expect(w.emitted('confirm')).toBeUndefined();
    expect(w.find('.err').exists()).toBe(true);
  });

  it('一致时 emit confirm；取消按钮 emit cancel', async () => {
    const w = mountC(ChangePassphraseDialog, { props: { open: false } });
    await w.setProps({ open: true });
    const inputs = w.findAll('input');
    await inputs[0].setValue('old');
    await inputs[1].setValue('new');
    await inputs[2].setValue('new');
    await w.find('.btn.primary').trigger('click');
    expect(w.emitted('confirm')?.[0]).toEqual([{ oldPass: 'old', newPass: 'new' }]);

    await w.find('.btn').trigger('click');
    expect(w.emitted('cancel')).toHaveLength(1);
  });

  it('回车提交', async () => {
    const w = mountC(ChangePassphraseDialog, { props: { open: true } });
    const inputs = w.findAll('input');
    await inputs[0].setValue('a');
    await inputs[1].setValue('b');
    await inputs[2].setValue('b');
    await inputs[2].trigger('keyup.enter');
    expect(w.emitted('confirm')).toHaveLength(1);
  });

  it('重新打开清空输入与错误', async () => {
    const w = mountC(ChangePassphraseDialog, { props: { open: false } });
    await w.setProps({ open: true });
    await w.find('.btn.primary').trigger('click');
    expect(w.find('.err').exists()).toBe(true);
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    expect(w.find('.err').exists()).toBe(false);
    expect((w.findAll('input')[0].element as HTMLInputElement).value).toBe('');
  });
});
