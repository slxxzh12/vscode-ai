import fs from 'node:fs';

// 方案文件夹：US + 6 位编号 - 日期 - 名称；日期兼容 YYYYMMDD 与旧的 YYYY。
export const US_RE = /^US\d{6}-(?:\d{8}|\d{4})-/i;

export function listUsDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && US_RE.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch {
    return [];
  }
}
