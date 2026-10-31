import fs from 'node:fs';
import path from 'node:path';

// 通用 JSON 小存储：读时归一化、写时先写临时文件再 rename
export function createJsonStore({ file = null, logger = console, normalize, defaults = () => ({}) } = {}) {
  const load = () => {
    if (!file || !fs.existsSync(file)) return defaults();
    try {
      return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      logger?.warn?.('json store load failed', (e && e.message) || e);
      return defaults();
    }
  };
  let data = load();
  const save = () => {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (e) {
      logger?.warn?.('json store save failed', (e && e.message) || e);
    }
  };
  return {
    read: () => data,
    write: (next) => { data = normalize(next); save(); return data; },
  };
}
