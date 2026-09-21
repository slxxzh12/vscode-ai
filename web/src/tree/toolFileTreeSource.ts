import { useToolFiles } from '../tools/files/useToolFiles';
import { copyText } from '../clipboard';
import type { TreeSource, TreeSourceNode } from './treeSource';

export interface ToolTreeHooks {
  onOpen(node: TreeSourceNode): void;
  onChanged?(): void;
  statusOf?(id: string): 'pass' | 'fail' | undefined;
  run?(node: TreeSourceNode): void;
  runFolder?(dirKey: string): void;
}

// 工具文件树数据源：把 useToolFiles 的扁平 {folders, items} 按目录过滤成懒加载子节点。
export function toolFileTreeSource(
  files: ReturnType<typeof useToolFiles>,
  hooks: ToolTreeHooks,
): TreeSource {
  const changed = () => hooks.onChanged?.();
  const fmt = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  };
  // '' = 根；只取直接子级
  return {
    async loadChildren(dirKey) {
      await files.load();
      const prefix = dirKey ? `${dirKey}/` : '';
      const dirs = files.folders.value
        .filter((f) => (dirKey ? f.startsWith(prefix) : true))
        .filter((f) => (dirKey ? f.slice(prefix.length) : f).split('/').length === 1)
        .map((f) => ({ key: f, name: f.slice(f.lastIndexOf('/') + 1), kind: 'dir' as const }));
      const leaves = files.items.value
        .filter((i) => (i.folder || '') === dirKey)
        .map((i) => ({
          key: i.id,
          name: i.name,
          kind: 'item' as const,
          time: fmt(i.updatedAt),
          status: hooks.statusOf?.(i.id),
        }));
      return [...dirs, ...leaves];
    },
    open(node) { hooks.onOpen(node); },
    async createFile(dirKey, name) { await files.createFile(dirKey, name); changed(); },
    async createFolder(dirKey, name) { await files.createFolder(dirKey, name); changed(); },
    async rename(node, name) {
      if (node.kind === 'dir') await files.renameFolder(node.key, name);
      else await files.renameItem(node.key, name);
      changed();
    },
    async remove(node) {
      if (node.kind === 'dir') await files.removeFolder(node.key);
      else await files.removeItem(node.key);
      changed();
    },
    async move(node, dirKey) { await files.moveItem(node.key, dirKey); changed(); },
    copyName(node) { void copyText(node.name); },
    copyPath(node) { void copyText(node.key); },
    ...(hooks.run ? { run: (node: TreeSourceNode) => hooks.run!(node) } : {}),
    ...(hooks.runFolder ? { runFolder: (dirKey: string) => hooks.runFolder!(dirKey) } : {}),
  };
}
