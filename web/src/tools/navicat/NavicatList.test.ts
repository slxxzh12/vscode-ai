// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import ElementPlus from 'element-plus';
import { mountC } from '../../test-utils';
import NavicatList from './NavicatList.vue';

const P = (id: string, name: string, type = 'mysql') => ({ id, name, type, host: 'h', port: '1', user: 'u', database: 'd', hasPassword: true });
function mount(props: any) {
  return mountC(NavicatList, { props, global: { plugins: [ElementPlus] } });
}

describe('NavicatList', () => {
  it('渲染连接并高亮当前项，按名称过滤', async () => {
    const w = mount({ profiles: [P('1', 'Alpha'), P('2', 'Beta')], activeId: '2' });
    expect(w.findAll('.nv-row')).toHaveLength(2);
    expect(w.find('.nv-row.active').text()).toContain('Beta');
    await w.find('.nv-search input').setValue('alp');
    expect(w.findAll('.nv-row')).toHaveLength(1);
    expect(w.text()).toContain('Alpha');
  });

  it('点击项发出 select，新建/重命名/删除发出对应事件', async () => {
    const w = mount({ profiles: [P('1', 'Alpha')], activeId: '' });
    await w.find('.nv-row').trigger('click');
    await w.find('.nv-new').trigger('click');
    await w.find('.nv-rename').trigger('click');
    await w.find('.nv-del').trigger('click');
    expect(w.emitted('select')?.[0]).toEqual(['1']);
    expect(w.emitted('create')).toBeTruthy();
    expect(w.emitted('rename')?.[0]).toEqual(['1']);
    expect(w.emitted('remove')?.[0]).toEqual(['1']);
  });

  it('空列表显示占位文案', () => {
    const w = mount({ profiles: [], activeId: '' });
    expect(w.find('.nv-empty').exists()).toBe(true);
  });
});
