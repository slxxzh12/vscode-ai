// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mountC } from '../test-utils';
import WelcomeView from './WelcomeView.vue';
import { MINI_TOOLS } from '../tools/catalog';

function mount() { return mountC(WelcomeView); }

describe('WelcomeView', () => {
  it('渲染主按钮与工具卡片', () => {
    const w = mount();
    expect(w.find('.wprimary').exists()).toBe(true);
    expect(w.findAll('.tcard')).toHaveLength(MINI_TOOLS.length);
  });

  it('点主按钮 emit new-agent', async () => {
    const w = mount();
    await w.find('.wprimary').trigger('click');
    expect(w.emitted('new-agent')).toHaveLength(1);
  });

  it('点工具卡片 emit open-tool 带 id', async () => {
    const w = mount();
    const tile = w.findAll('.tcard').find((x) => x.find('.ticon').text() === '🧾');
    expect(tile).toBeTruthy();
    await tile!.trigger('click');
    expect(w.emitted('open-tool')?.[0]).toEqual(['yaml']);
  });
});
