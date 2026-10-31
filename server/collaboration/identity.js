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

function readJson(file) {
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function hasKeys(o) {
  return !!(o && typeof o.publicKey === 'string' && o.publicKey && typeof o.privateKey === 'string' && o.privateKey);
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
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

// 读/建 identity 并持久化到 file。返回对象: { machineId, username, employeeId, host, port, publicKey, privateKey }
// keyFile（可选）：机器级密钥文件，让同机所有端口复用同一 machineId/公私钥。规则：
//   - file 已有密钥 → 以 file 为准（不改变既有身份）；keyFile 缺密钥时由本次身份回填（一次性迁移）；
//   - file 无密钥 → 取 keyFile 的；keyFile 也没有 → 新生成；
//   - 已有 keyFile 永不被覆盖，保证跨端口稳定。
export function loadIdentity({ file, keyFile = null, username = detectUsername(), employeeId = '', host = detectHost(), port = 22222 }) {
  const cur = readJson(file) || {};
  const global = keyFile ? readJson(keyFile) : null;
  if (!cur.machineId) cur.machineId = (global && global.machineId) || crypto.randomUUID();
  if (!hasKeys(cur)) {
    if (hasKeys(global)) { cur.publicKey = global.publicKey; cur.privateKey = global.privateKey; }
    else { const kp = genKeyPair(); cur.publicKey = kp.publicKey; cur.privateKey = kp.privateKey; }
  }
  cur.username = username;
  cur.employeeId = employeeId || cur.employeeId || '';
  cur.host = host;
  cur.port = port;
  writeAtomic(file, cur);
  if (keyFile && !hasKeys(global)) {
    writeAtomic(keyFile, { machineId: cur.machineId, publicKey: cur.publicKey, privateKey: cur.privateKey });
  }
  return { ...cur };
}

export function toPublicProfile(id) {
  return {
    machineId: id.machineId, username: id.username, employeeId: id.employeeId || '',
    host: id.host, port: id.port, publicKey: id.publicKey,
  };
}
