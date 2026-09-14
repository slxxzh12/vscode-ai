export const NOTICE_URL = 'https://gitee.com/slxxzh12/vscode-ai/raw/master/notice/readme.md';

export function createNotice({
  url = NOTICE_URL,
  timeoutMs = 5000,
  cacheMs = 10 * 60 * 1000,
  fetchImpl = fetch,
} = {}) {
  let cache = null; // { content, fetchedAt, expiresAt }

  return {
    async get() {
      const now = Date.now();
      if (cache && cache.expiresAt > now) {
        return { ok: true, content: cache.content, fetchedAt: cache.fetchedAt, cached: true };
      }
      try {
        const res = await fetchImpl(url, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'User-Agent': 'devflow' },
        });
        if (!res.ok) throw new Error(`http-${res.status}`);
        const content = await res.text();
        cache = { content, fetchedAt: now, expiresAt: now + cacheMs };
        return { ok: true, content, fetchedAt: now, cached: false };
      } catch (e) {
        if (cache) {
          return { ok: true, content: cache.content, fetchedAt: cache.fetchedAt, cached: true, stale: true };
        }
        return { ok: false, error: String((e && e.message) || e) };
      }
    },
    clear() {
      cache = null;
    },
  };
}
