import fs from 'node:fs';
import path from 'node:path';

function pad2(n) { return String(n).padStart(2, '0'); }

// 本机本地时间 → 定长 'YYYY-MM-DD HH:mm:ss'（字典序 = 时间序）
export function formatVersion(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} `
    + `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

// 保证严格大于 prevVersion（同秒则进位 +1s）
export function nextVersion(prevVersion, now = new Date()) {
  let ms = now.getTime();
  let v = formatVersion(new Date(ms));
  while (prevVersion && v <= prevVersion) { ms += 1000; v = formatVersion(new Date(ms)); }
  return v;
}

export function readUpdate(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'update.json'), 'utf8')); }
  catch { return { version: '', updatedAt: 0, files: [] }; }
}

export function writeUpdate(dir, update) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'update.json');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(update, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return update;
}

export function recordPath(syncDir, masterId) {
  const safe = String(masterId || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
  return path.join(syncDir, `${safe}.json`);
}

export function readRecord(syncDir, masterId) {
  try { return JSON.parse(fs.readFileSync(recordPath(syncDir, masterId), 'utf8')); }
  catch { return null; }
}

export function writeRecord(syncDir, masterId, record) {
  fs.mkdirSync(syncDir, { recursive: true });
  const file = recordPath(syncDir, masterId);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return record;
}
