import type { SearchEvent } from '../tree/treeSource';
import { streamSearch } from './streamSearch';

// 调 GET /api/search：项目内按文件名和/或内容流式搜索（结果以 NDJSON 增量返回）。
export function searchProject(
  projectId: string,
  query: string,
  opts: { caseSensitive: boolean; name: boolean; content: boolean; all: boolean },
  signal?: AbortSignal,
): AsyncGenerator<SearchEvent> {
  const url = `/api/search?project=${encodeURIComponent(projectId)}&q=${encodeURIComponent(query)}&case=${opts.caseSensitive ? 1 : 0}&name=${opts.name ? 1 : 0}&content=${opts.content ? 1 : 0}&all=${opts.all ? 1 : 0}`;
  return streamSearch(url, signal);
}
