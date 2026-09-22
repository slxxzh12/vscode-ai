import { describe, it, expect, vi } from 'vitest';
import { navicatTreeSource } from './navicatTreeSource';
import type { NavicatProfile } from './useNavicat';

const MYSQL: NavicatProfile = { id: '1', name: 'Alpha', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'd' };
const SQLITE: NavicatProfile = { id: '2', name: 'Sqlite', type: 'sqlite', host: '', port: '', user: '', database: 'f.db' };

function make(over: Record<string, unknown> = {}) {
  const picked: string[] = [];
  const opened: string[] = [];
  const src = navicatTreeSource({
    profiles: () => [MYSQL, SQLITE],
    profileById: (id) => [MYSQL, SQLITE].find((p) => p.id === id) || null,
    databases: vi.fn(async () => ['db1']),
    tables: vi.fn(async () => ['users', 'orders']),
    openConnection: (id) => opened.push(`c:${id}`),
    openDatabase: (id, db) => opened.push(`d:${id}:${db}`),
    pickTable: (id, db, table) => picked.push(`${id}:${db}:${table}`),
    renameConnection: vi.fn(async () => {}),
    removeConnection: vi.fn(async () => {}),
    ...over,
  });
  return { src, picked, opened };
}

describe('navicatTreeSource', () => {
  it('连接为 dir；mysql 展开为库 dir，库展开为表 item；sqlite 直接表', async () => {
    const { src } = make();
    const roots = await src.loadChildren('');
    expect(roots.map((n) => [n.key, n.kind])).toEqual([['c:1', 'dir'], ['c:2', 'dir']]);
    expect(await src.loadChildren('c:1')).toEqual([{ key: 'd:1\u0000db1', name: 'db1', kind: 'dir' }]);
    expect(await src.loadChildren('d:1\u0000db1')).toEqual([
      { key: 't:1\u0000db1\u0000users', name: 'users', kind: 'item' },
      { key: 't:1\u0000db1\u0000orders', name: 'orders', kind: 'item' },
    ]);
    expect(await src.loadChildren('c:2')).toEqual([
      { key: 't:2\u0000f.db\u0000users', name: 'users', kind: 'item' },
      { key: 't:2\u0000f.db\u0000orders', name: 'orders', kind: 'item' },
    ]);
  });

  it('open 表 → pickTable；search/openHit → 选中连接', async () => {
    const { src, picked, opened } = make();
    src.open({ key: 't:1\u0000db1\u0000users', name: 'users', kind: 'item' });
    expect(picked).toEqual(['1:db1:users']);
    const byName = await src.search!('alp', { caseSensitive: false, name: true, content: false });
    expect(byName.nameHits[0].path).toBe('c:1');
    src.openHit!({ path: 'c:1', name: 'Alpha' });
    expect(opened).toEqual(['c:1']);
  });

  it('rename/remove 只作用于连接', async () => {
    const rename = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    const { src } = make({ renameConnection: rename, removeConnection: remove });
    await src.rename!({ key: 'c:1', name: 'A', kind: 'dir' }, 'A2');
    await src.remove!({ key: 'c:1', name: 'A', kind: 'dir' });
    expect(rename).toHaveBeenCalledWith('1', 'A2');
    expect(remove).toHaveBeenCalledWith('1');
  });
});
