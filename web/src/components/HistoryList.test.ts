// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mountC } from '../test-utils';
import { t } from '../i18n';
import HistoryList from './HistoryList.vue';

type Entry = { projectId: string; path: string; name: string; projName: string; ts: number };
const entry = (over: Partial<Entry> = {}): Entry => ({ projectId: 'p', path: 'a.ts', name: 'a.ts', projName: 'Proj', ts: new Date(2026, 8, 10, 10, 0, 0).getTime(), ...over });

function mount(over: Record<string, unknown> = {}) {
  return mountC(HistoryList, {
    props: { items: [], tab: 'files', messages: [], ...over },
  });
}

describe('HistoryList', () => {
  it('文件页签：空态、分组与日期分隔、点击打开/删除', async () => {
    const w = mount({ items: [] });
    expect(w.find('.empty').text()).toBeTruthy();

    const items = [
      entry({ name: 'b.ts', path: 'b.ts', ts: new Date(2026, 8, 9, 9, 0, 0).getTime() }),
      entry({ name: 'a.ts', path: 'src/a.ts', ts: new Date(2026, 8, 10, 10, 0, 0).getTime() }),
      entry({ projectId: 'p2', path: 'x.md', name: 'x.md', projName: 'Other', ts: new Date(2026, 8, 10, 11, 0, 0).getTime() }),
    ];
    const w2 = mount({ items });
    await w2.vm.$nextTick();
    expect(w2.findAll('.gname').map((x) => x.text())).toEqual(['Other', 'Proj']);
    expect(w2.findAll('.daysep')).toHaveLength(3);   // 09-10 / 09-10 / 09-09
    const rows = w2.findAll('.row');
    expect(rows).toHaveLength(3);
    await rows[0].trigger('click');
    expect(w2.emitted('open')).toHaveLength(1);
    await rows[0].find('.x').trigger('click');
    expect(w2.emitted('remove')?.[0]).toEqual(['p2', 'x.md']);
  });

  it('搜索过滤与无命中提示', async () => {
    const w = mount({ items: [entry({ name: 'zeta.ts' })] });
    await w.find('.searchinput').setValue('nope');
    expect(w.find('.empty').text()).toBeTruthy();
    await w.find('.searchinput').setValue('zeta');
    expect(w.findAll('.row')).toHaveLength(1);
  });

  it('清空按钮在文件页签 emit clear', async () => {
    const w = mount({ items: [entry()] });
    await w.find('.clear').trigger('click');
    expect(w.emitted('clear')).toHaveLength(1);
  });

  it('页签切换 emit update:tab', async () => {
    const w = mount();
    await w.findAll('.tabbtn')[0].trigger('click');
    expect(w.emitted('update:tab')?.[0]).toEqual(['messages']);
    await w.findAll('.tabbtn')[1].trigger('click');
    expect(w.emitted('update:tab')?.[1]).toEqual(['files']);
  });

  it('消息页签：空态、打开/删除/清空', async () => {
    const w = mount({ tab: 'messages' });
    expect(w.find('.empty').text()).toBeTruthy();

    const messages = [{ text: 'hello', ts: new Date(2026, 8, 10, 12, 0, 0).getTime(), tabName: 'tab1' }];
    const w2 = mount({ tab: 'messages', messages });
    await w2.vm.$nextTick();
    expect(w2.findAll('.mrow')).toHaveLength(1);
    expect(w2.find('.mtab').text()).toBe('tab1');
    await w2.find('.mrow').trigger('click');
    expect(w2.emitted('open-message')?.[0]).toEqual(['hello']);
    await w2.find('.mrow .x').trigger('click');
    expect(w2.emitted('remove-message')?.[0]).toEqual([messages[0]]);
    await w2.find('.clear').trigger('click');
    expect(w2.emitted('clear-messages')).toHaveLength(1);
  });

  it('超过一页时显示 more，滚动到底部加载下一页', async () => {
    const items = Array.from({ length: 60 }, (_, i) => entry({ name: `f${i}.ts`, path: `f${i}.ts`, ts: 1000 + i }));
    const w = mount({ items });
    await w.vm.$nextTick();
    expect(w.findAll('.row')).toHaveLength(50);
    expect(w.find('.more').exists()).toBe(true);

    const list = w.find('.list').element as HTMLElement;
    Object.defineProperty(list, 'scrollTop', { value: 100, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(list, 'scrollHeight', { value: 120, configurable: true });
    await w.find('.list').trigger('scroll');
    await w.vm.$nextTick();
    expect(w.findAll('.row')).toHaveLength(60);
    expect(w.find('.foot').exists()).toBe(true);
  });

  it('消息页筛选开关：默认开启、点击 emit update:filter、文件页不渲染', async () => {
    const w = mount({ tab: 'messages' });
    const btn = w.find('.filterbtn');
    expect(btn.exists()).toBe(true);
    expect(btn.classes()).toContain('on');
    expect(btn.text()).toBe(t('hist.filter.on'));
    await btn.trigger('click');
    expect(w.emitted('update:filter')?.[0]).toEqual([false]);

    const off = mount({ tab: 'messages', filter: false });
    expect(off.find('.filterbtn').classes()).not.toContain('on');
    expect(off.find('.filterbtn').text()).toBe(t('hist.filter.off'));

    const files = mount({ tab: 'files' });
    expect(files.find('.filterbtn').exists()).toBe(false);
  });
});
