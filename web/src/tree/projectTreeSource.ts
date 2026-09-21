import { useProjects } from '../useProjects';
import { copyText } from '../clipboard';
import { searchProject } from '../search/projectSearch';
import type { TreeSource, SearchResult, SearchHit } from './treeSource';

// 项目文件树数据源：包装 useProjects，供统一 TreeView 使用。
export function projectTreeSource(opts: {
  projectId: string;
  onOpenFile: (projectId: string, path: string, name: string) => void;
  onDetailFile: (projectId: string, path: string, name: string) => void;
  onOpenFileAt?: (projectId: string, path: string, name: string, line?: number) => void;
}): TreeSource {
  const api = useProjects();
  const pid = opts.projectId;
  const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

  return {
    async loadChildren(dirKey) {
      if (!pid) return [];
      const items = await api.tree(pid, dirKey);
      return items.map((i) => ({ key: join(dirKey, i.name), name: i.name, kind: i.type === 'dir' ? 'dir' : 'item' }));
    },
    open(node) {
      opts.onOpenFile(pid, node.key, node.name);
    },
    createFile(dirKey, name) {
      const rel = join(dirKey, name);
      return api.createFile(pid, rel).then(() => { opts.onOpenFile(pid, rel, name); });
    },
    createFolder(dirKey, name) {
      return api.createDir(pid, join(dirKey, name)).then(() => undefined);
    },
    reveal(node) {
      return api.reveal(pid, node.key).then(() => undefined);
    },
    detail(node) {
      opts.onDetailFile(pid, node.key, node.name);
    },
    copyName(node) { void copyText(node.name); },
    copyPath(node) { void copyText(node.key); },
    async copyContent(node) {
      const f = await api.text(pid, node.key);
      await copyText(f.content);
    },
    async search(query: string, o: { caseSensitive: boolean }): Promise<SearchResult> {
      if (!pid) return { nameHits: [], contentHits: [], truncated: false, scanned: 0 };
      return searchProject(pid, query, o);
    },
    openHit(hit: SearchHit) {
      if (opts.onOpenFileAt) opts.onOpenFileAt(pid, hit.path, hit.name, hit.line);
      else opts.onOpenFile(pid, hit.path, hit.name);
    },
  };
}
