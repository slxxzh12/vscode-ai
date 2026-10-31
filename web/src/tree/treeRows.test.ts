import { describe, it, expect } from 'vitest';
import { flattenVisible, type TreeRowNode } from './treeRows';

function n(key: string, kind: 'dir' | 'item', children: TreeRowNode[] = []): TreeRowNode {
  return { key, name: key, kind, children, loaded: true, loading: false };
}

describe('flattenVisible', () => {
  it('展开的目录递归输出子节点，折叠的目录只输出自身', () => {
    const tree = [n('a', 'dir', [n('a/1', 'item'), n('a/b', 'dir', [n('a/b/1', 'item')])]), n('z', 'item')];

    const collapsedRows = flattenVisible(tree, new Set(['a']));
    expect(collapsedRows.map((r) => r.node.key)).toEqual(['a', 'z']);
    expect(collapsedRows.find((r) => r.node.key === 'a')!.expanded).toBe(false);

    const rows = flattenVisible(tree, new Set());
    expect(rows.map((r) => r.node.key)).toEqual(['a', 'a/1', 'a/b', 'a/b/1', 'z']);
    expect(rows.find((r) => r.node.key === 'a/b/1')!.depth).toBe(2);
    expect(rows.find((r) => r.node.key === 'a')!.expanded).toBe(true);
  });

  it('未折叠（不在折叠集合）时子节点也输出', () => {
    const rows = flattenVisible([n('a', 'dir', [n('a/1', 'item')])], new Set());
    expect(rows.map((r) => r.node.key)).toEqual(['a', 'a/1']);
  });

  it('文件节点即使有 children 也不展开', () => {
    const rows = flattenVisible([{ ...n('f', 'item'), children: [n('f/x', 'item')] }], new Set());
    expect(rows.map((r) => r.node.key)).toEqual(['f']);
  });
});
