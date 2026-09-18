// @vitest-environment happy-dom
import { test, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import TabRenameDialog from './TabRenameDialog.vue';

const global = { mocks: { $t: (k: string) => k } };

test('确定：emit confirm，name/description 均 trim', async () => {
  const w = mount(TabRenameDialog, {
    props: { name: '  旧名  ', description: '  旧描述  ', placeholder: '默认名' },
    global,
  });
  await w.find('input').setValue('  新名  ');
  await w.find('textarea').setValue('  新描述  ');
  await w.find('.tabdlg-btn.primary').trigger('click');
  expect(w.emitted('confirm')?.[0]?.[0]).toEqual({ name: '新名', description: '新描述' });
});

test('取消：emit cancel，无 confirm', async () => {
  const w = mount(TabRenameDialog, {
    props: { name: '', description: '', placeholder: '默认名' },
    global,
  });
  await w.find('.tabdlg-btn').trigger('click');
  expect(w.emitted('cancel')).toBeTruthy();
  expect(w.emitted('confirm')).toBeFalsy();
});
