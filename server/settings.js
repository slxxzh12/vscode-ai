import fs from 'node:fs';
import path from 'node:path';

// 可配置的服务设置：config/server.json（端口等）。修改端口需重启后生效。
export function defaultSettingsFile(baseDir) {
  return path.join(baseDir, 'config', 'server.json');
}
export function readSettings(file) {
  try {
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { port: Number(j.port) || null };
    }
  } catch { /* ignore */ }
  return { port: null };
}
export function writeSettings(file, patch) {
  const cur = readSettings(file);
  const next = { ...cur, ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return next;
}
