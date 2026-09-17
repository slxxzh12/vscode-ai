// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import TreeNode from './TreeNode.vue';

type Node = { name: string; type: 'file' | 'dir'; path: string; expanded: boolean; loading: boolean; children: Node[] };
const node = (over: Partial<Node> = {}): Node => ({ name: 'a.txt', type: 'file', path: 'a.txt', expanded: false, loading: false, children: [], ...over });

afterEach(() => vi.unstubAllGlobals());

describe('TreeNode', () => {
  it('文件节点按扩展名给图标', () => {
    const cases: Array<[string, string]> = [
      ['a.ts', '🧩'], ['a.html', '🌐'], ['a.yml', '📐'], ['a.http', '⇀'],
      ['a.exe', '⬛'], ['a.png', '🖼️'], ['a.zip', '🗜️'], ['a.docx', '📝'], ['a.unknown', '📄'], ['noext', '📄'],
    ];
    for (const [name, icon] of cases) {
      const w = mountC(TreeNode, { props: { projectId: 'p', node: node({ name, path: name }) } });
      expect(w.find('.ic').text()).toBe(icon);
    }
  });

  it('点击文件 emit open-file', async () => {
    const w = mountC(TreeNode, { props: { projectId: 'p', node: node({ name: 'x.ts', path: 'x.ts' }) } });
    await w.find('.row').trigger('click');
    expect(w.emitted('open-file')?.[0]).toEqual(['x.ts', 'x.ts']);
  });

  it('目录首次展开拉取子节点；再次点击折叠', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [{ name: 'a.ts', type: 'file' }, { name: 'sub', type: 'dir' }] }) })));
    const n = node({ name: 'src', type: 'dir', path: 'src' });
    const w = mountC(TreeNode, { props: { projectId: 'p', node: n } });
    await w.find('.row').trigger('click');
    expect(w.emitted('dir-open')?.[0]).toEqual(['src']);
    await flushPromises();
    expect(n.children.map((c) => c.name)).toEqual(['a.ts', 'sub']);
    expect(n.loading).toBe(false);
    expect(w.text()).toContain('a.ts');

    await w.find('.row').trigger('click');
    expect(n.expanded).toBe(false);
  });

  it('已展开再展开不重复拉取', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { calls += 1; return { ok: true, json: async () => ({ items: [{ name: 'a.ts', type: 'file' }] }) }; }));
    const n = node({ name: 'src', type: 'dir', path: 'src', expanded: true, children: [node({ name: 'a.ts', path: 'src/a.ts' })] });
    const w = mountC(TreeNode, { props: { projectId: 'p', node: n } });
    await w.find('.row').trigger('click');   // 折叠
    await w.find('.row').trigger('click');   // 展开（已有 children）
    await flushPromises();
    expect(calls).toBe(0);
    expect(n.expanded).toBe(true);
  });

  it('无 projectId 时展开不拉取', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { calls += 1; return { ok: true, json: async () => ({ items: [] }) }; }));
    const n = node({ name: 'src', type: 'dir', path: 'src' });
    const w = mountC(TreeNode, { props: { projectId: null, node: n } });
    await w.find('.row').trigger('click');
    await flushPromises();
    expect(calls).toBe(0);
  });

  it('activePath 命中文件时整行高亮；右键 emit ctx', async () => {
    const n = node({ name: 'x.ts', path: 'x.ts' });
    const w = mountC(TreeNode, { props: { projectId: 'p', node: n, activePath: 'x.ts' } });
    expect(w.find('.row').classes()).toContain('sel');
    await w.find('.row').trigger('contextmenu');
    const ev = w.emitted('ctx')?.[0] as unknown[];
    expect(ev[1]).toBe('x.ts');
    expect(ev[2]).toBe('x.ts');
    expect(ev[3]).toBe('file');
  });

  it('目录节点显示 ▸/▾', async () => {
    const collapsed = mountC(TreeNode, { props: { projectId: 'p', node: node({ name: 'd', type: 'dir', path: 'd' }) } });
    expect(collapsed.find('.tw').text()).toBe('▸');
    const expanded = mountC(TreeNode, { props: { projectId: 'p', node: node({ name: 'd', type: 'dir', path: 'd', expanded: true }) } });
    expect(expanded.find('.tw').text()).toBe('▾');
  });
});
