import crypto from 'node:crypto';

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function fromB64url(s) { return Buffer.from(s, 'base64url'); }
function jwtErr(code, message) { const e = new Error(message || code); e.code = code; return e; }

export function signJwt(payload, secret, { now = Date.now() } = {}) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: payload.iat ?? Math.floor(now / 1000) };
  const h = b64url(JSON.stringify(header));
  const b = b64url(JSON.stringify(body));
  const sig = b64url(crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest());
  return `${h}.${b}.${sig}`;
}

export function verifyJwt(token, secret, { now = Date.now() } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw jwtErr('bad-token');
  const [h, b, s] = parts;
  const expect = b64url(crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest());
  const a = Buffer.from(s);
  const e = Buffer.from(expect);
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) throw jwtErr('bad-signature');
  let payload;
  try { payload = JSON.parse(fromB64url(b).toString('utf8')); } catch { throw jwtErr('bad-payload'); }
  if (typeof payload.exp === 'number' && Math.floor(now / 1000) >= payload.exp) throw jwtErr('expired');
  return payload;
}
