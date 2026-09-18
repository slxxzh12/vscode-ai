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

// 同步种子（update.json）与各 master 同步记录（sync/<id>.json）已迁到 SQLite，见 server/sync-store.js。
