import fs from 'node:fs';
import path from 'node:path';

// 邀请令牌落盘：expiresAt === 0 表示长期不过期（供 slave 长期用量上报复用）
export function isInviteActive(invite, now = Date.now()) {
  if (!invite || typeof invite.token !== 'string' || !invite.token) return false;
  const exp = Number(invite.expiresAt);
  return exp === 0 || now < exp;
}

export function loadInvite(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v.token === 'string' && v.token ? v : null;
  } catch { return null; }
}

export function saveInvite(file, invite) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(invite, null, 2), 'utf8');
  return invite;
}

export function clearInvite(file) {
  try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
}
