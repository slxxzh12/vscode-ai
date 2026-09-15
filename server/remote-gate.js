// 远程访问门禁的纯判定（便于单测；index.js 消费）
export function isPeerRequest(pathname, method) {
  if (method !== 'POST') return false;
  return pathname === '/api/collab/peer' || pathname === '/api/collab/stats';
}

export function matchAccessToken(access, invite, safeEqual) {
  if (!access || !invite || !invite.token) return false;
  return safeEqual(access, invite.token);
}

export const DEFAULT_INVITE_DAYS = 1;
export const WARN_INVITE_DAYS = 7;
export const MAX_INVITE_DAYS = 100;

// 解析邀请有效期：以「天」为准（1..100，默认 1）；兼容旧的 hours 字段
export function resolveInviteDays(input = {}) {
  let days = Number(input.days);
  if (!Number.isFinite(days) || days <= 0) {
    const hours = Number(input.hours);
    days = Number.isFinite(hours) && hours > 0 ? hours / 24 : DEFAULT_INVITE_DAYS;
  }
  days = Math.round(days);
  if (!Number.isFinite(days) || days < 1) days = DEFAULT_INVITE_DAYS;
  if (days > MAX_INVITE_DAYS) days = MAX_INVITE_DAYS;
  return days;
}
