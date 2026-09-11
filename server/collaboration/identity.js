import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

function genKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).trim(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).trim(),
  };
}

export function detectHost() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
}

export function detectUsername() {
  return (typeof os.userInfo === 'function' && os.userInfo().username) || process.env.USERNAME || process.env.USER || 'user';
}

export function publicFingerprint(publicKeyPem) {
  return crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16);
}

// 读/建 identity 并持久化到 file。返回对象: { machineId, username, host, port, publicKey, privateKey }
export function loadIdentity({ file, username = detectUsername(), host = detectHost(), port = 22222 }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let cur = {};
  if (fs.existsSync(file)) {
    try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cur = {}; }
  }
  if (!cur.machineId) cur.machineId = crypto.randomUUID();
  if (!cur.publicKey || !cur.privateKey) {
    const kp = genKeyPair();
    cur.publicKey = kp.publicKey;
    cur.privateKey = kp.privateKey;
  }
  cur.username = username;
  cur.host = host;
  cur.port = port;
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cur, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return { ...cur };
}

export function toPublicProfile(id) {
  return {
    machineId: id.machineId, username: id.username,
    host: id.host, port: id.port, publicKey: id.publicKey,
  };
}
