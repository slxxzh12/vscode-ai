import crypto from 'node:crypto';
import { canonicalize } from './sign.js';

const PREFIX = 'dfinv1';
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function toB64url(v) { return Buffer.from(v).toString('base64url'); }
function fromB64url(s) { return Buffer.from(s, 'base64url'); }

// 用邀请方私钥签发自证 token：dfinv1.<b64url(body)>.<b64url(sig)>
export function makeInviteToken(privateKeyPem, body) {
  const payload = {
    groupId: body.groupId,
    groupName: body.groupName,
    inviter: body.inviter,
    epoch: body.epoch ?? 0,
    exp: body.exp,
    jti: body.jti ?? crypto.randomUUID(),
  };
  const sig = crypto.sign(null, Buffer.from(canonicalize(payload), 'utf8'), privateKeyPem);
  return `${PREFIX}.${toB64url(JSON.stringify(payload))}.${toB64url(sig)}`;
}

// 解析并验签；只用 body 内嵌的 inviter.publicKey 自证（与信封一致）
export function parseInviteToken(token) {
  if (typeof token !== 'string') return { ok: false, error: 'bad-token' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, error: 'bad-token' };
  let body;
  try { body = JSON.parse(fromB64url(parts[1]).toString('utf8')); } catch { return { ok: false, error: 'bad-token' }; }
  if (!body || typeof body !== 'object' || !body.inviter || typeof body.inviter.publicKey !== 'string') {
    return { ok: false, error: 'bad-token' };
  }
  let sig;
  try { sig = fromB64url(parts[2]); } catch { return { ok: false, error: 'bad-token' }; }
  try {
    const valid = crypto.verify(null, Buffer.from(canonicalize(body), 'utf8'), body.inviter.publicKey, sig);
    if (!valid) return { ok: false, error: 'bad-token' };
  } catch { return { ok: false, error: 'bad-token' }; }
  return { ok: true, body };
}
