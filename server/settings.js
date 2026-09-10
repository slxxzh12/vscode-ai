import fs from 'node:fs';
import path from 'node:path';
import { LOCALES, DEFAULT_LOCALE } from '@devflow/shared/i18n';

// 可配置的服务设置：config/server.json（端口、语言等）。修改端口需重启后生效。
export function defaultSettingsFile(baseDir) {
  return path.join(baseDir, 'config', 'server.json');
}
export function readSettings(file) {
  try {
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const language = LOCALES.includes(j.language) ? j.language : DEFAULT_LOCALE;
      return { port: Number(j.port) || null, language };
    }
  } catch { /* ignore */ }
  return { port: null, language: DEFAULT_LOCALE };
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
