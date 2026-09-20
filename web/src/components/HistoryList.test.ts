// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import { t } from '../i18n';
import HistoryList from './HistoryList.vue';

type Entry = { projectId: string; path: string; name: string; projName: string; ts: number };
const entry = (over: Partial<Entry> = {}): Entry => ({ projectId: 'p', path: 'a.ts', name: 'a.ts', projName: 'Proj', ts: new Date(2026, 8, 10, 10, 0, 0).getTime(), ...over });

function mount(over: Record<string, unknown> = {}) {
  return mountC(HistoryList, {
    props: { items: [], tab: 'files', messages: [], ...over },
    global: { plugins: [ElementPlus] },
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

  it('页签切换 emit update:tab（消息 / 最近文件 / 目录 三个页签）', async () => {
    const w = mount();
    const items = w.findAll('.el-tabs__item');
    expect(items).toHaveLength(3);
    await items[0].trigger('click');
    expect(w.emitted('update:tab')?.[0]).toEqual(['messages']);
    await items[1].trigger('click');
    expect(w.emitted('update:tab')?.[1]).toEqual(['files']);
    await items[2].trigger('click');
    expect(w.emitted('update:tab')?.[2]).toEqual(['tree']);
  });

  it('目录页签渲染文件树（无项目时显示空态，不请求）', async () => {
    const w = mount({ tab: 'tree', projectId: null });
    await w.vm.$nextTick();
    expect(w.find('.ft').exists()).toBe(true);
    expect(w.find('.filterbtn').exists()).toBe(false);
    expect(w.find('.searchinput').exists()).toBe(false);
  });

  it('消息页签：空态、打开/删除（无清空按钮）', async () => {
    const w = mount({ tab: 'messages' });
    expect(w.find('.empty').text()).toBeTruthy();

    const messages = [{ text: 'hello', ts: new Date(2026, 8, 10, 12, 0, 0).getTime(), tabName: 'tab1' }];
    const w2 = mount({ tab: 'messages', messages });
    await w2.vm.$nextTick();
    expect(w2.findAll('.mrow')).toHaveLength(1);
    expect(w2.find('.mtab').text()).toBe('tab1');
    expect(w2.find('.clear').exists()).toBe(false);
    await w2.find('.mrow').trigger('click');
    expect(w2.emitted('open-message')?.[0]).toEqual(['hello']);
    await w2.find('.mrow .x').trigger('click');
    expect(w2.emitted('remove-message')?.[0]).toEqual([messages[0]]);
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

  it('消息页筛选：仅当前会话 / 全部会话 两个互斥按钮；文件页不渲染', async () => {
    const w = mount({ tab: 'messages' });
    const btns = w.findAll('.filterbtn');
    expect(btns).toHaveLength(2);
    expect(btns[0].text()).toBe(t('hist.filter.on'));
    expect(btns[1].text()).toBe(t('hist.filter.off'));
    expect(btns[0].classes()).toContain('on');
    expect(btns[1].classes()).not.toContain('on');
    await btns[1].trigger('click');
    expect(w.emitted('update:filter')?.[0]).toEqual([false]);
    await btns[0].trigger('click');
    expect(w.emitted('update:filter')?.[1]).toEqual([true]);

    const off = mount({ tab: 'messages', filter: false });
    const offBtns = off.findAll('.filterbtn');
    expect(offBtns[0].classes()).not.toContain('on');
    expect(offBtns[1].classes()).toContain('on');

    const files = mount({ tab: 'files' });
    expect(files.find('.filterbtn').exists()).toBe(false);
  });

  it('全部会话：渲染会话树，点行展开，打开按钮 emit open-session', async () => {
    const messages = [
      { text: 'm1', ts: 100, sessionId: 's1', tabName: 'A' },
      { text: 'm2', ts: 200, sessionId: 's2', tabName: 'B' },
    ];
    const w = mount({ tab: 'messages', filter: false, allStyle: 'tree', messages, liveSessionIds: ['s2'] });
    await w.vm.$nextTick();
    const nodes = w.findAll('.tnode');
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.find('.tname').text())).toEqual(['B', 'A']);
    expect(w.findAll('.mrow')).toHaveLength(0);              // 默认折叠
    await nodes[1].trigger('click');                          // 展开 A
    expect(w.findAll('.mrow')).toHaveLength(1);
    await nodes[1].find('.topen').trigger('click');
    expect(w.emitted('open-session')?.[0]).toEqual(['s1', 'A']);
    await nodes[1].find('.tedit').trigger('click');
    expect(w.emitted('edit-session')?.[0]).toEqual(['s1', 'A']);
  });

  it('全部会话：账本/运行中的空会话也展示且可打开', async () => {
    const w = mount({ tab: 'messages', filter: false, allStyle: 'tree', messages: [], sessions: [{ id: 's9', name: '空会话' }] });
    await w.vm.$nextTick();
    expect(w.findAll('.tnode')).toHaveLength(1);
    expect(w.find('.tname').text()).toBe('空会话');
    expect(w.find('.tcount').exists()).toBe(false);
    await w.find('.topen').trigger('click');
    expect(w.emitted('open-session')?.[0]).toEqual(['s9', '空会话']);
  });

  it('全部会话：无 sessionId 的组禁用打开', async () => {
    const w = mount({ tab: 'messages', filter: false, allStyle: 'tree', messages: [{ text: 'x', ts: 1, tabName: 'only' }] });
    await w.vm.$nextTick();
    expect(w.findAll('.tnode')).toHaveLength(1);
    expect(w.find('.topen').exists()).toBe(false);
    expect(w.find('.tedit').exists()).toBe(false);
  });

  it('全部会话：自定义页签名覆盖节点标签（含账本空会话）', async () => {
    const messages = [{ text: 'm1', ts: 100, sessionId: 's1', tabName: '旧名' }];
    const w = mount({
      tab: 'messages', filter: false, allStyle: 'tree', messages,
      sessions: [{ id: 's1', name: '服务端旧名' }, { id: 's2', name: '服务端B' }],
      sessionNames: { s1: '自定义A', s2: '自定义B' },
    });
    await w.vm.$nextTick();
    const names = w.findAll('.tname').map((n) => n.text());
    expect(names).toEqual(['自定义A', '自定义B']);
  });

  it('仅当前会话：仍是平铺消息', async () => {
    const w = mount({ tab: 'messages', filter: true, messages: [{ text: 'x', ts: 1, tabName: 't' }] });
    await w.vm.$nextTick();
    expect(w.findAll('.tnode')).toHaveLength(0);
    expect(w.findAll('.mrow')).toHaveLength(1);
  });

  it('全部会话：默认平铺，不渲染会话树', async () => {
    const messages = [
      { text: 'm1', ts: 100, sessionId: 's1', tabName: 'A' },
      { text: 'm2', ts: 200, sessionId: 's2', tabName: 'B' },
    ];
    const w = mount({ tab: 'messages', filter: false, messages });
    await w.vm.$nextTick();
    expect(w.findAll('.tnode')).toHaveLength(0);
    expect(w.findAll('.mrow')).toHaveLength(2);
    expect(w.findAll('.mtab').map((x) => x.text())).toEqual(['A', 'B']);
  });

  it('全部会话：显式 allStyle=tree 时渲染会话树', async () => {
    const messages = [{ text: 'm1', ts: 100, sessionId: 's1', tabName: 'A' }];
    const w = mount({ tab: 'messages', filter: false, allStyle: 'tree', messages });
    await w.vm.$nextTick();
    expect(w.findAll('.tnode')).toHaveLength(1);
    expect(w.findAll('.mrow')).toHaveLength(0);
  });

  it('全部会话：不同 session 的页签名带不同背景色类', async () => {
    const messages = [
      { text: 'm1', ts: 100, sessionId: 's1', tabName: 'A' },
      { text: 'm2', ts: 200, sessionId: 's2', tabName: 'B' },
    ];
    const flat = mount({ tab: 'messages', filter: false, messages });
    await flat.vm.$nextTick();
    const cls = flat.findAll('.mtab').map((x) => x.classes().find((c) => c.startsWith('sc-')));
    expect(cls[0]).toBeTruthy();
    expect(cls[1]).toBeTruthy();
    expect(cls[0]).not.toBe(cls[1]);   // 不同会话 → 不同色

    const tree = mount({ tab: 'messages', filter: false, allStyle: 'tree', messages });
    await tree.vm.$nextTick();
    const nodeCls = tree.findAll('.tname').map((x) => x.classes().find((c) => c.startsWith('sc-')));
    expect(nodeCls[0]).toBeTruthy();
    expect(nodeCls[0]).not.toBe(nodeCls[1]);
  });

  it('样式子切换仅在全部会话出现，点击 emit update:all-style', async () => {
    const cur = mount({ tab: 'messages', filter: true });
    expect(cur.find('.stylebtn').exists()).toBe(false);

    const off = mount({ tab: 'messages', filter: false });
    const btns = off.findAll('.stylebtn');
    expect(btns).toHaveLength(2);
    expect(btns[0].text()).toBe(t('hist.style.flat'));
    expect(btns[1].text()).toBe(t('hist.style.tree'));
    expect(btns[0].classes()).toContain('on');
    expect(btns[1].classes()).not.toContain('on');
    await btns[1].trigger('click');
    expect(off.emitted('update:all-style')?.[0]).toEqual(['tree']);
    await btns[0].trigger('click');
    expect(off.emitted('update:all-style')?.[1]).toEqual(['flat']);

    const files = mount({ tab: 'files' });
    expect(files.find('.stylebtn').exists()).toBe(false);
  });
});
