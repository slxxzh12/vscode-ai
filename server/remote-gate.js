// è¿œç¨‹è®¿é—®é—¨ç¦çš„çº¯åˆ¤å®šï¼ˆä¾¿äºå•æµ‹ï¼›index.js æ¶ˆè´¹ï¼‰
export function isPeerRequest(pathname, method) {
  if (method !== 'POST') return false;
  return pathname === '/api/collab/peer' || pathname === '/api/usage/report';
}

export function matchAccessToken(access, invite, safeEqual) {
  if (!access || !invite || !invite.token) return false;
  return safeEqual(access, invite.token);
}

export const DEFAULT_INVITE_DAYS = 1;
export const WARN_INVITE_DAYS = 7;
export const MAX_INVITE_DAYS = 100;

// è§£æé‚€è¯·æœ‰æ•ˆæœŸï¼šä»¥ã€Œå¤©ã€ä¸ºå‡†ï¼ˆ1..100ï¼Œé»˜è®¤ 1ï¼‰ï¼›å…¼å®¹æ—§çš„ hours å­—æ®µ
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

// days=0 è¡¨ç¤ºã€Œé•¿æœŸä¸è¿‡æœŸã€ï¼ˆç”¨ä½œç”¨é‡ä¸ŠæŠ¥çš„é•¿æœŸä»¤ç‰Œï¼‰ï¼›å…¶å®ƒå€¼æ²¿ç”¨ resolveInviteDays
export function resolveInviteDaysAllowForever(input = {}) {
  if (Number(input.days) === 0) return 0;
  return resolveInviteDays(input);
}

export const LOOPBACK_HOST = '127.0.0.1';
export const PUBLIC_HOST = '0.0.0.0';

// ¼àÌıµØÖ·¹æÔò£ºÖ»ÓĞ master Ä£Ê½£¨ÑûÇëÁËÓĞĞ§/ÒÑ¿ªÆô·ÃÎÊ£©²Å¶Ô¾ÖÓòÍø¼àÌı£¬·ñÔòÖ»°ó»Ø»·
// DEVFLOW_HOST ÏÔÊ½ÉèÖÃÊ±ÓÅÏÈ£¨ÌÓÉúÍ¨µÀ£©
export function resolveBindHost({ masterOn = false, envHost = '' } = {}) {
  const env = String(envHost || '').trim();
  if (env) return env;
  return masterOn ? PUBLIC_HOST : LOOPBACK_HOST;
}

// ÇĞ»» master ¿ª¹ØºóĞèÒªÖØÆô·şÎñ²ÅÄÜ»»°ó¶¨µØÖ·
export function hostRestartNeeded({ current = '', masterOn = false, envHost = '' } = {}) {
  return resolveBindHost({ masterOn, envHost }) !== String(current || '');
}
