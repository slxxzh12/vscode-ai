import fs from 'node:fs';
import path from 'node:path';

// 搜索时跳过的常见目录（按目录名精确匹配）
export const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'dist-portable', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', '.idea', '.vscode',
]);

export const DEFAULT_LIMITS = {
  maxNameHits: 200,
  maxContentHits: 300,
  maxHitsPerFile: 50,
  maxFiles: 20000,
  maxFileBytes: 1024 * 1024,
  maxLineLength: 400,
};

// 读前 64KB，含 NUL 即视为二进制
function isBinaryFile(abs, size) {
  if (size <= 0) return false;
  const probeLen = Math.min(size, 64 * 1024);
  const buf = Buffer.alloc(probeLen);
  const fd = fs.openSync(abs, 'r');
  try {
    fs.readSync(fd, buf, 0, probeLen, 0);
    return buf.includes(0);
  } finally {
    fs.closeSync(fd);
  }
}

// 遍历 root，返回 { nameHits, contentHits, truncated, scanned }；path 一律用 POSIX 风格相对路径
export function searchProject(root, { query = '', caseSensitive = false, limits = {} } = {}) {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const nameHits = [];
  const contentHits = [];
  let scanned = 0;
  let truncated = false;
  if (!query) return { nameHits, contentHits, truncated, scanned };

  const needle = caseSensitive ? query : query.toLowerCase();
  const rootResolved = path.resolve(root);
  const stack = [''];

  while (stack.length) {
    if (scanned >= lim.maxFiles) { truncated = true; break; }
    const relDir = stack.pop();
    const absDir = relDir ? path.join(rootResolved, relDir) : rootResolved;
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { continue; }

    for (const d of entries) {
      const rel = relDir ? `${relDir}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (IGNORE_DIRS.has(d.name)) continue;
        if (d.isSymbolicLink()) continue;   // 跳过符号链接目录，防目录环
        stack.push(rel);
        continue;
      }
      if (!d.isFile()) continue;

      scanned++;
      if (scanned > lim.maxFiles) { truncated = true; break; }

      // —— 文件名命中 ——
      const nameHay = caseSensitive ? d.name : d.name.toLowerCase();
      if (nameHay.includes(needle)) {
        if (nameHits.length < lim.maxNameHits) nameHits.push({ path: rel, name: d.name });
        else truncated = true;
      }

      // —— 内容命中 ——
      if (contentHits.length >= lim.maxContentHits) continue;
      const absFile = path.join(rootResolved, rel);
      let st;
      try { st = fs.statSync(absFile); } catch { continue; }
      if (st.size > lim.maxFileBytes) continue;
      try { if (isBinaryFile(absFile, st.size)) continue; } catch { continue; }
      let text;
      try { text = fs.readFileSync(absFile, 'utf8'); } catch { continue; }

      const lines = text.split(/\r?\n/);
      let perFile = 0;
      for (let i = 0; i < lines.length; i++) {
        const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
        if (!hay.includes(needle)) continue;
        contentHits.push({ path: rel, name: d.name, line: i + 1, text: lines[i].slice(0, lim.maxLineLength) });
        perFile++;
        if (contentHits.length >= lim.maxContentHits) { truncated = true; break; }
        if (perFile >= lim.maxHitsPerFile) { truncated = true; break; }
      }
    }
  }
  return { nameHits, contentHits, truncated, scanned };
}
