import { describe, it, expect, vi, afterEach } from 'vitest';
import { projectTreeSource } from './projectTreeSource';
import { copyText } from '../clipboard';
import type { SearchEvent } from './treeSource';

vi.mock('../clipboard', () => ({ copyText: vi.fn(async () => true) }));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function okJson(body: unknown) { return { ok: true, json: async () => body }; }

describe('projectTreeSource', () => {
  it('loadChildren 调 /api/tree 并映射为节点', async () => {
    const fetchMock = vi.fn(async () => okJson({ items: [{ name: 'src', type: 'dir' }, { name: 'a.txt', type: 'file' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn() });
    const nodes = await src.loadChildren('');
    expect(fetchMock).toHaveBeenCalledWith('/api/tree?project=p1&path=');
    expect(nodes).toEqual([
      { key: 'src', name: 'src', kind: 'dir' },
      { key: 'a.txt', name: 'a.txt', kind: 'item' },
    ]);
  });

  it('loadChildren 子目录拼接相对路径', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [{ name: 'b.txt', type: 'file' }] })));
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn() });
    const nodes = await src.loadChildren('src');
    expect(nodes).toEqual([{ key: 'src/b.txt', name: 'b.txt', kind: 'item' }]);
  });

  it('open 触发 onOpenFile(projectId, key, name)', () => {
    const onOpenFile = vi.fn();
    const src = projectTreeSource({ projectId: 'p1', onOpenFile, onDetailFile: vi.fn() });
    src.open({ key: 'src/a.txt', name: 'a.txt', kind: 'item' });
    expect(onOpenFile).toHaveBeenCalledWith('p1', 'src/a.txt', 'a.txt');
  });

  it('detail 触发 onDetailFile', () => {
    const onDetailFile = vi.fn();
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile });
    src.detail!({ key: 'a.txt', name: 'a.txt', kind: 'item' });
    expect(onDetailFile).toHaveBeenCalledWith('p1', 'a.txt', 'a.txt');
  });

  it('copyPath 复制系统绝对路径', async () => {
    const abs = 'D:\\root\\proj\\src\\a.txt';
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ abs, isDir: false })));
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn() });
    await src.copyPath!({ key: 'src/a.txt', name: 'a.txt', kind: 'item' });
    expect(copyText).toHaveBeenCalledWith(abs);
  });

  it('copyPath 解析失败时回退相对路径', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn() });
    await src.copyPath!({ key: 'a.txt', name: 'a.txt', kind: 'item' });
    expect(copyText).toHaveBeenCalledWith('a.txt');
  });
});

describe('projectTreeSource.search', () => {
  it('按 project/q/case/name/content/all 请求 /api/search 并流式返回事件', async () => {
    const events: SearchEvent[] = [
      { type: 'name', hits: [{ path: 'a.txt', name: 'a.txt' }] },
      { type: 'done', scanned: 3 },
    ];
    const text = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, body }));
    vi.stubGlobal('fetch', fetchMock);
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn() });
    const got: SearchEvent[] = [];
    for await (const ev of src.search!('target', { caseSensitive: true, name: true, content: false, all: false })) got.push(ev);
    expect(got).toEqual(events);
    expect(fetchMock).toHaveBeenCalledWith('/api/search?project=p1&q=target&case=1&name=1&content=0&all=0', { signal: undefined });
  });

  it('请求失败抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })));
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn() });
    const gen = src.search!('x', { caseSensitive: false, name: true, content: true, all: false });
    await expect((async () => { for await (const _ of gen) { /* drain */ } })()).rejects.toThrow('boom');
  });
});

describe('projectTreeSource.openHit', () => {
  it('有 onOpenFileAt 时带上 line', () => {
    const onOpenFileAt = vi.fn();
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn(), onOpenFileAt });
    src.openHit!({ path: 'src/a.js', name: 'a.js', line: 7, query: 'foo', caseSensitive: true });
    expect(onOpenFileAt).toHaveBeenCalledWith('p1', 'src/a.js', 'a.js', 7, 'foo', true);
  });

  it('replaceInFiles 调用 /api/search/replace', async () => {
    const calls: { url: string; body: any }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ files: 1, replacements: 2 }) }; }));
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn() });
    const r = await src.replaceInFiles!('foo', { caseSensitive: false, all: false }, 'bar');
    expect(r).toEqual({ files: 1, replacements: 2 });
    expect(calls[0].url).toBe('/api/search/replace');
    expect(calls[0].body).toEqual({ project: 'p1', q: 'foo', case: false, all: false, replace: 'bar' });
  });

  it('无 onOpenFileAt 时回退到 onOpenFile', () => {
    const onOpenFile = vi.fn();
    const src = projectTreeSource({ projectId: 'p1', onOpenFile, onDetailFile: vi.fn() });
    src.openHit!({ path: 'a.txt', name: 'a.txt' });
    expect(onOpenFile).toHaveBeenCalledWith('p1', 'a.txt', 'a.txt');
  });
});
