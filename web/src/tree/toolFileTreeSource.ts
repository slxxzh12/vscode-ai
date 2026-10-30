import { useToolFiles } from '../tools/files/useToolFiles';
import { copyText } from '../clipboard';
import type { TreeSource, TreeSourceNode, SearchEvent } from './treeSource';
import { streamSearch } from '../search/streamSearch';

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
  defaultExt?: string,
): TreeSource {
  const changed = () => hooks.onChanged?.();
  const fmt = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  };
  // 未命名时的默认文件名：当前日期+时间（如 20260920-153012.md）
  function defaultName(): string {
    if (!defaultExt) return '';
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${defaultExt}`;
  }
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
    async createFile(dirKey, name) {
      const id = await files.createFile(dirKey, name);
      // 新建后直接打开，Markdown/JS 等工具无需再点一次
      if (id) hooks.onOpen({ key: id, name: id.slice(id.lastIndexOf('/') + 1), kind: 'item' });
      changed();
    },
    async createFolder(dirKey, name) { await files.createFolder(dirKey, name); changed(); },
    defaultName,
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
    search(query: string, o: { caseSensitive: boolean; name: boolean; content: boolean; all: boolean }, signal?: AbortSignal): AsyncGenerator<SearchEvent> {
      const p = new URLSearchParams({ q: query, case: o.caseSensitive ? '1' : '0', name: o.name ? '1' : '0', content: o.content ? '1' : '0', all: o.all ? '1' : '0' });
      return streamSearch(`/api/files/${files.tool}/search?${p.toString()}`, signal);
    },
    openHit(hit) { hooks.onOpen({ key: hit.path, name: hit.name, kind: 'item' }); },
    ...(hooks.run ? { run: (node: TreeSourceNode) => hooks.run!(node) } : {}),
    ...(hooks.runFolder ? { runFolder: (dirKey: string) => hooks.runFolder!(dirKey) } : {}),
  };
}
