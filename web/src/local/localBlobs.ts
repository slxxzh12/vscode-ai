// 按作用域登记 blob URL，页签关闭/预览重建时统一回收，避免内存泄漏。
const scopes = new Map<string, Set<string>>();

export function trackBlob(scope: string, url: string): string {
  let s = scopes.get(scope);
  if (!s) { s = new Set(); scopes.set(scope, s); }
  s.add(url);
  return url;
}

export function releaseBlob(scope: string, url: string): void {
  const s = scopes.get(scope);
  if (!s || !s.delete(url)) return;
  try { URL.revokeObjectURL(url); } catch { /* ignore */ }
}

export function releaseBlobs(scope: string): void {
  const s = scopes.get(scope);
  if (!s) return;
  for (const u of s) { try { URL.revokeObjectURL(u); } catch { /* ignore */ } }
  s.clear();
  scopes.delete(scope);
}

export function resetBlobs(): void {
  for (const scope of [...scopes.keys()]) releaseBlobs(scope);
}
