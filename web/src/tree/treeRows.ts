// 把树（含展开状态）压平成可见行；纯函数便于单测。
export interface TreeRowNode {
  key: string;
  name: string;
  kind: 'dir' | 'item';
  icon?: string;
  time?: string;
  status?: 'pass' | 'fail';
  children: TreeRowNode[];
  loaded: boolean;
  loading: boolean;
}

export interface TreeRow {
  node: TreeRowNode;
  depth: number;
  expanded: boolean;
}

export function flattenVisible(nodes: TreeRowNode[], collapsed: Set<string>): TreeRow[] {
  const out: TreeRow[] = [];
  const walk = (list: TreeRowNode[], depth: number) => {
    for (const node of list) {
      const expanded = node.kind === 'dir' && !collapsed.has(node.key);
      out.push({ node, depth, expanded });
      if (expanded && node.children.length) walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return out;
}
