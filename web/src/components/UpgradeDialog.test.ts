// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mountC } from '../test-utils';
import UpgradeDialog from './UpgradeDialog.vue';

describe('UpgradeDialog', () => {
  it('三按钮分别 emit go / close / skip', async () => {
    const w = mountC(UpgradeDialog, { props: { open: true, current: 'v1', latest: 'v2' } });
    expect(w.text()).toContain('v2');
    await w.find('.upg-go').trigger('click');
    await w.find('.upg-close').trigger('click');
    await w.find('.upg-skip').trigger('click');
    expect(w.emitted('go')).toHaveLength(1);
    expect(w.emitted('close')).toHaveLength(1);
    expect(w.emitted('skip')).toHaveLength(1);
  });

  it('open=false 不渲染', () => {
    const w = mountC(UpgradeDialog, { props: { open: false, current: 'v1', latest: 'v2' } });
    expect(w.find('.ep-box').exists()).toBe(false);
  });
});
