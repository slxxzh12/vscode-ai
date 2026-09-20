// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import NavicatTree from './NavicatTree.vue';

const MYSQL = { id: '1', name: 'A', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'd', hasPassword: true };
const SQLITE = { id: '2', name: 'S', type: 'sqlite', host: '', port: '', user: '', database: 'C:/a.db', hasPassword: false };
const REDIS = { id: '3', name: 'R', type: 'redis', host: 'h', port: '6379', user: '', database: '0', hasPassword: false };

afterEach(() => { vi.restoreAllMocks(); });

function mount(props: Record<string, unknown> = {}) {
  return mountC(NavicatTree, {
    props: {
      profiles: [],
      activeId: '',
      activeDatabase: '',
      version: 0,
      fetchDatabases: vi.fn(async () => []),
      fetchTables: vi.fn(async () => []),
      ...props,
    },
  });
}

describe('NavicatTree', () => {
  it('展开 mysql 连接加载库并渲染库节点', async () => {
    const fetchDatabases = vi.fn(async () => ['db1', 'db2']);
    const w = mount({ profiles: [MYSQL], fetchDatabases });
    await w.find('.nvconn .nvchev').trigger('click');
    await flushPromises();
    expect(fetchDatabases).toHaveBeenCalledWith('1');
    expect(w.text()).toContain('db1');
    expect(w.find('.nvdbitem').exists()).toBe(true);
  });

  it('展开库加载表，点表发出 pick-table', async () => {
    const fetchTables = vi.fn(async () => ['users']);
    const w = mount({ profiles: [MYSQL], fetchDatabases: vi.fn(async () => ['db1']), fetchTables });
    await w.find('.nvconn .nvchev').trigger('click');
    await flushPromises();
    await w.find('.nvdbitem .nvchev').trigger('click');
    await flushPromises();
    expect(fetchTables).toHaveBeenCalledWith('1', 'db1');
    await w.find('.nvtbname').trigger('click');
    expect(w.emitted('pick-table')?.[0]).toEqual(['db1', 'users']);
  });

  it('点库名发出 select-database', async () => {
    const w = mount({ profiles: [MYSQL], fetchDatabases: vi.fn(async () => ['db1']) });
    await w.find('.nvconn .nvchev').trigger('click');
    await flushPromises();
    await w.find('.nvdname').trigger('click');
    expect(w.emitted('select-database')?.[0]).toEqual(['db1']);
  });

  it('sqlite 展开直接列表（用档案文件路径），点表 database 为空', async () => {
    const fetchTables = vi.fn(async () => ['t1']);
    const w = mount({ profiles: [SQLITE], fetchTables });
    await w.find('.nvconn .nvchev').trigger('click');
    await flushPromises();
    expect(fetchTables).toHaveBeenCalledWith('2', 'C:/a.db');
    await w.find('.nvtbname').trigger('click');
    expect(w.emitted('pick-table')?.[0]).toEqual(['', 't1']);
  });

  it('redis 展开列出数字库，点库发出 select-database', async () => {
    const w = mount({ profiles: [REDIS], fetchDatabases: vi.fn(async () => ['0', '1']) });
    await w.find('.nvconn .nvchev').trigger('click');
    await flushPromises();
    await w.find('.nvdname').trigger('click');
    expect(w.emitted('select-database')?.[0]).toEqual(['0']);
  });

  it('选中连接名发出 select-conn；连接操作按钮发 edit/rename/remove', async () => {
    const w = mount({ profiles: [MYSQL] });
    await w.find('.nvconnname').trigger('click');
    expect(w.emitted('select-conn')?.[0]?.[0]).toMatchObject({ id: '1' });
    await w.find('.nvedit').trigger('click');
    expect(w.emitted('edit')?.[0]?.[0]).toMatchObject({ id: '1' });
    await w.find('.nvrename').trigger('click');
    expect(w.emitted('rename')?.[0]?.[0]).toMatchObject({ id: '1' });
    await w.find('.nvremove').trigger('click');
    expect(w.emitted('remove')?.[0]?.[0]).toMatchObject({ id: '1' });
  });

  it('加载失败显示错误文案', async () => {
    const w = mount({ profiles: [MYSQL], fetchDatabases: vi.fn(async () => { throw new Error('boom'); }) });
    await w.find('.nvconn .nvchev').trigger('click');
    await flushPromises();
    expect(w.find('.nverr').text()).toContain('boom');
  });
});
