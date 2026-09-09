import crypto from 'node:crypto';

// 规范化 JSON：递归按键排序，保证签名/验签两侧字节一致
export function canonicalize(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(',')}}`;
}

export function makeEnvelope(privateKeyPem, type, from, payload = {}, ts = Date.now()) {
  const body = { type, from, payload, ts };
  const sig = crypto.sign(null, Buffer.from(canonicalize(body), 'utf8'), privateKeyPem);
  return { ...body, sig: sig.toString('base64') };
}

// from: { machineId, username, host, port, publicKey }（含对方公钥以便首次验签）
export function signEnvelope(privateKeyPem, type, from, payload, ts) {
  return makeEnvelope(privateKeyPem, type, from, payload, ts);
}

export function verifyEnvelope(senderPublicKeyPem, env, { now = Date.now(), skewMs = 5 * 60 * 1000 } = {}) {
  if (!env || typeof env !== 'object') return false;
  const { type, from, payload, ts, sig } = env;
  if (typeof type !== 'string' || !from || typeof from.publicKey !== 'string') return false;
  if (typeof ts !== 'number' || Math.abs(now - ts) > skewMs) return false;
  if (typeof sig !== 'string' || typeof payload !== 'object' || payload === null) return false;
  try {
    const body = { type, from, payload, ts };
    return crypto.verify(
      null,
      Buffer.from(canonicalize(body), 'utf8'),
      senderPublicKeyPem,
      Buffer.from(sig, 'base64'),
    );
  } catch { return false; }
}

// 对文件 sha256（hex 字符串字节）用私钥签名 / 公钥验签，用于防仿冒的独立文件凭证
export function signHash(privateKeyPem, sha256Hex) {
  return crypto.sign(null, Buffer.from(sha256Hex, 'utf8'), privateKeyPem).toString('base64');
}
export function verifyHash(publicKeyPem, sha256Hex, sigB64) {
  try {
    return crypto.verify(null, Buffer.from(sha256Hex, 'utf8'), publicKeyPem, Buffer.from(sigB64, 'base64'));
  } catch { return false; }
}
