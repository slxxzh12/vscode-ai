import type { SearchResult } from '../tree/treeSource';

// 调 GET /api/search：项目内按文件名和/或内容搜索（name/content 由调用方按需开关）
export async function searchProject(projectId: string, query: string, opts: { caseSensitive: boolean; name: boolean; content: boolean }): Promise<SearchResult> {
  const url = `/api/search?project=${encodeURIComponent(projectId)}&q=${encodeURIComponent(query)}&case=${opts.caseSensitive ? 1 : 0}&name=${opts.name ? 1 : 0}&content=${opts.content ? 1 : 0}`;
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* keep status */ }
    throw new Error(msg);
  }
  return res.json() as Promise<SearchResult>;
}
