import fs from 'node:fs';
import path from 'node:path';

// 当前选中目录（项目 id）持久化：供启动时只恢复该目录最近 8 个会话。
export function createCurrentProjectStore({ file } = {}) {
  function read() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      return String(raw?.projectId || '').trim();
    } catch { return ''; }
  }

  function write(projectId) {
    const id = String(projectId || '').trim();
    if (!file) return id;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ projectId: id }, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return id;
  }

  return { read, write };
}
