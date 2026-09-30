export const UPGRADE_API_URL = 'https://gitee.com/api/v5/repos/slxxzh12/vscode-ai/releases/latest';
export const UPGRADE_PAGE_URL = 'https://gitee.com/slxxzh12/vscode-ai/releases';
export const CACHE_MS = 10 * 24 * 60 * 60 * 1000;   // 10 天

const norm = (v) => String(v == null ? '' : v).trim();

// 版本比较：vYYYYMMDD 按数值比；否则回退字符串比较
export function compareVersion(a, b) {
  const x = norm(a).replace(/^v/i, '');
  const y = norm(b).replace(/^v/i, '');
  if (/^\d{8}$/.test(x) && /^\d{8}$/.test(y)) {
    const nx = Number(x); const ny = Number(y);
    return nx < ny ? -1 : nx > ny ? 1 : 0;
  }
  return x < y ? -1 : x > y ? 1 : 0;
}

// 升级检测器：拉远端 latest release 的 tag 与本地版本比对；带缓存、失败静默回退。
export function createUpgradeChecker({
  apiUrl = UPGRADE_API_URL,
  pageUrl = UPGRADE_PAGE_URL,
  currentVersion = '',
  timeoutMs = 5000,
  cacheMs = CACHE_MS,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  let cache = null; // { result, expiresAt }

  async function check(force = false) {
    const t = now();
    if (!force && cache && cache.expiresAt > t) return cache.result;
    const current = norm(currentVersion);
    try {
      const res = await fetchImpl(apiUrl, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'devflow' },
      });
      if (!res.ok) throw new Error(`http-${res.status}`);
      const data = await res.json();
      const latest = norm(data && data.tag_name);
      const hasUpdate = !!latest && !!current && compareVersion(latest, current) > 0;
      const result = { ok: true, current, latest, hasUpdate, url: pageUrl, checkedAt: t };
      cache = { result, expiresAt: t + cacheMs };
      return result;
    } catch (e) {
      if (cache) return { ...cache.result, stale: true };
      return { ok: false, current, latest: '', hasUpdate: false, url: pageUrl, error: String((e && e.message) || e), checkedAt: t };
    }
  }

  return { check, status() { return cache ? cache.result : null; } };
}
