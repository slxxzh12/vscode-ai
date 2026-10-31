import type { TreeSource, TreeSourceNode } from '../tree/treeSource';
import { useLocalSources } from './useLocalSources';
import { splitRel } from './localHandles';

// 本地目录树数据源：只提供读能力（创建/重命名/删除/移动缺省即隐藏）。
export function localTreeSource(open: (node: TreeSourceNode) => void): TreeSource {
  const { root } = useLocalSources();

  async function dirOf(dirKey: string): Promise<FileSystemDirectoryHandle | null> {
    const r = root.value;
    if (!r?.handle) return null;
    const segs = splitRel(dirKey);
    if (segs === null) return null;
    let cur = r.handle;
    for (const s of segs) cur = await cur.getDirectoryHandle(s);
    return cur;
  }

  return {
    async loadChildren(dirKey) {
      let dir: FileSystemDirectoryHandle;
      try {
        const d = await dirOf(dirKey);
        if (!d) return [];
        dir = d;
      } catch {
        return [];
      }
      const dirs: TreeSourceNode[] = [];
      const items: TreeSourceNode[] = [];
      const iter = (dir as unknown as { values(): AsyncIterable<{ name: string; kind: string }> }).values();
      for await (const h of iter) {
        const key = dirKey ? `${dirKey}/${h.name}` : h.name;
        if (h.kind === 'directory') dirs.push({ key, name: h.name, kind: 'dir' });
        else items.push({ key, name: h.name, kind: 'item' });
      }
      dirs.sort((a, b) => a.name.localeCompare(b.name));
      items.sort((a, b) => a.name.localeCompare(b.name));
      return [...dirs, ...items];
    },
    open(node) {
      if (node.kind === 'item') open(node);
    },
  };
}
