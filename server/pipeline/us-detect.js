import fs from 'node:fs';

export const US_RE = /^US\d{6}-\d{4}-/i;

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
