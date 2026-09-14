import { LOCALES, DEFAULT_LOCALE } from '@devflow/shared/i18n';

export const NOTICE_BASE_URL = 'https://gitee.com/slxxzh12/vscode-ai-mobile/raw/master/notice';

export function noticeUrl(lang) {
  const l = LOCALES.includes(lang) ? lang : DEFAULT_LOCALE;
  return `${NOTICE_BASE_URL}/${l}/main.md`;
}

export function noticeLang(lang) {
  return LOCALES.includes(lang) ? lang : DEFAULT_LOCALE;
}

export function createNotice({
  baseUrl = NOTICE_BASE_URL,
  timeoutMs = 5000,
  cacheMs = 10 * 60 * 1000,
  fetchImpl = fetch,
} = {}) {
  const cache = new Map(); // lang -> { content, fetchedAt, expiresAt }

  async function get(lang) {
    const l = noticeLang(lang);
    const url = `${baseUrl}/${l}/main.md`;
    const now = Date.now();
    const cached = cache.get(l);
    if (cached && cached.expiresAt > now) {
      return { ok: true, content: cached.content, fetchedAt: cached.fetchedAt, cached: true, lang: l };
    }
    try {
      const res = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'devflow' },
      });
      if (!res.ok) throw new Error(`http-${res.status}`);
      const content = await res.text();
      cache.set(l, { content, fetchedAt: now, expiresAt: now + cacheMs });
      return { ok: true, content, fetchedAt: now, cached: false, lang: l };
    } catch (e) {
      if (cached) {
        return { ok: true, content: cached.content, fetchedAt: cached.fetchedAt, cached: true, stale: true, lang: l };
      }
      return { ok: false, error: String((e && e.message) || e), lang: l };
    }
  }

  return {
    get,
    clear() {
      cache.clear();
    },
  };
}
