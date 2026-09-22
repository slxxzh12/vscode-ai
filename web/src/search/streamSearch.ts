import type { SearchEvent } from '../tree/treeSource';

// 逐行读取 NDJSON 响应体，边读边产出搜索事件。
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<SearchEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield JSON.parse(line) as SearchEvent;
    }
  }
  buf += decoder.decode();
  const tail = buf.trim();
  if (tail) yield JSON.parse(tail) as SearchEvent;
}

// fetch 一个流式搜索 URL 并产出事件；非 2xx 抛出 {error} 文案。
export async function* streamSearch(url: string, signal?: AbortSignal): AsyncGenerator<SearchEvent> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* keep status */ }
    throw new Error(msg);
  }
  if (!res.body) return;
  yield* readNdjson(res.body);
}
