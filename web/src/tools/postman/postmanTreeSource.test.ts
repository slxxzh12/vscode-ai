import { describe, it, expect, vi } from 'vitest';
import { postmanTreeSource } from './postmanTreeSource';
import type { PostmanRecord } from './usePostmanHistory';
import type { SearchEvent } from '../../tree/treeSource';

const REC = (id: string, command: string, folder: string, title?: string, updatedAt?: string): PostmanRecord =>
  ({ id, command, folder, title, updatedAt, result: {}, name: id.slice(id.lastIndexOf('/') + 1) });

function make(records: PostmanRecord[], folders: string[], over: Record<string, unknown> = {}) {
  const opened: PostmanRecord[] = [];
  const ran: string[] = [];
  const src = postmanTreeSource({
    history: () => records,
    folders: () => folders,
    statusOf: (id) => (id === 'foo/a.json' ? 'pass' : undefined),
    recordById: (id) => records.find((r) => r.id === id) || null,
    openRecord: (r) => opened.push(r),
    createFolder: vi.fn(async () => ({ ok: true })),
    renameFolder: vi.fn(async () => ({ ok: true })),
    renameRecord: vi.fn(async () => ({ ok: true })),
    removeFolder: vi.fn(async () => ({ ok: true })),
    removeRecord: vi.fn(async () => ({ ok: true })),
    moveRecord: vi.fn(async () => ({ ok: true })),
    runRecord: (r) => ran.push(r.id),
    runFolder: (p) => ran.push(`dir:${p}`),
    ...over,
  });
  return { src, opened, ran };
}

describe('postmanTreeSource', () => {
  it('loadChildren：根=根级文件夹+记录，子目录只取直接子级；带状态点与展示名', async () => {
    const { src } = make(
      [REC('foo/a.json', 'curl A', 'foo'), REC('root.json', 'curl R', '')],
      ['foo', 'foo/bar'],
    );
    expect(await src.loadChildren('')).toEqual([
      { key: 'foo', name: 'foo', kind: 'dir' },
      { key: 'root.json', name: 'curl R', kind: 'item', time: '', status: undefined },
    ]);
    expect(await src.loadChildren('foo')).toEqual([
      { key: 'foo/bar', name: 'bar', kind: 'dir' },
      { key: 'foo/a.json', name: 'curl A', kind: 'item', time: '', status: 'pass' },
    ]);
  });

  it('标题优先作为展示名', async () => {
    const { src } = make([REC('a.json', 'curl A', '', 'My A')], []);
    const rows = await src.loadChildren('');
    expect(rows[0].name).toBe('My A');
  });

  it('open 与右键运行调用对应记录', async () => {
    const { src, opened, ran } = make([REC('foo/a.json', 'curl A', 'foo')], ['foo']);
    src.open({ key: 'foo/a.json', name: 'curl A', kind: 'item' });
    expect(opened.map((r) => r.id)).toEqual(['foo/a.json']);
    src.run!({ key: 'foo/a.json', name: 'curl A', kind: 'item' });
    src.runFolder!('foo');
    expect(ran).toEqual(['foo/a.json', 'dir:foo']);
  });

  it('search：名字命中与内容命中；openHit 打开记录', async () => {
    const recs = [REC('a.json', 'curl https://target.com', '', 'Alpha'), REC('b.json', 'curl other', '', 'Beta')];
    const { src, opened } = make(recs, []);
    const nameEvents: SearchEvent[] = [];
    for await (const ev of src.search!('alpha', { caseSensitive: false, name: true, content: false, all: false })) nameEvents.push(ev);
    expect(nameEvents.flatMap((e) => (e.type === 'name' ? e.hits : []))).toEqual([{ path: 'a.json', name: 'Alpha' }]);
    const contentEvents: SearchEvent[] = [];
    for await (const ev of src.search!('target', { caseSensitive: false, name: false, content: true, all: false })) contentEvents.push(ev);
    expect(contentEvents.flatMap((e) => (e.type === 'content' ? [e.path] : []))).toEqual(['a.json']);
    src.openHit!({ path: 'b.json', name: 'Beta' });
    expect(opened[0].id).toBe('b.json');
  });
});
