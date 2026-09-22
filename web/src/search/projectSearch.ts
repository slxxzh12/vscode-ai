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

// 调 POST /api/search/replace：把项目中内容命中的整串关键词全量替换为 replacement。
export async function replaceProject(
  projectId: string,
  query: string,
  opts: { caseSensitive: boolean; all: boolean },
  replacement: string,
): Promise<{ files: number; replacements: number }> {
  const res = await fetch('/api/search/replace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: projectId, q: query, case: opts.caseSensitive, all: opts.all, replace: replacement }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* keep status */ }
    throw new Error(msg);
  }
  return res.json() as Promise<{ files: number; replacements: number }>;
}
