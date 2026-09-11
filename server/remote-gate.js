// 远程访问门禁的纯判定（便于单测；index.js 消费）
export function isPeerRequest(pathname, method) {
  return pathname === '/api/collab/peer' && method === 'POST';
}

export function matchAccessToken(access, invite, safeEqual) {
  if (!access || !invite || !invite.token) return false;
  return safeEqual(access, invite.token);
}
