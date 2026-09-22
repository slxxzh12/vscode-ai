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

// 按空白拆成多个分词；单个字母/单字（长度 < 2）一律忽略
export function splitTerms(query, caseSensitive = false) {
  const out = [];
  for (const raw of String(query).trim().split(/\s+/)) {
    if (raw.length < 2) continue;
    const t = caseSensitive ? raw : raw.toLowerCase();
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

// 遍历 root，返回 { nameHits, contentHits, truncated, scanned }；path 一律用 POSIX 风格相对路径
// 多分词：命中任一分词即算命中；命中分词数多的文件排前（名字/内容各自排序）。
export function searchProject(root, { query = '', caseSensitive = false, limits = {}, searchName = true, searchContent = true } = {}) {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const nameHits = [];
  const contentHits = [];
  let scanned = 0;
  let truncated = false;
  const terms = splitTerms(query, caseSensitive);
  if (!terms.length || (!searchName && !searchContent)) return { nameHits, contentHits, truncated, scanned };

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
      if (searchName) {
        const nameHay = caseSensitive ? d.name : d.name.toLowerCase();
        let score = 0;
        for (const t of terms) if (nameHay.includes(t)) score++;
        if (score > 0) {
          if (nameHits.length < lim.maxNameHits) nameHits.push({ path: rel, name: d.name, _score: score });
          else truncated = true;
        }
      }

      // —— 内容命中 ——
      if (!searchContent) continue;
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
      const fileTerms = new Set();
      for (let i = 0; i < lines.length; i++) {
        const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
        let lineScore = 0;
        for (const t of terms) if (hay.includes(t)) { lineScore++; fileTerms.add(t); }
        if (!lineScore) continue;
        contentHits.push({ path: rel, name: d.name, line: i + 1, text: lines[i].slice(0, lim.maxLineLength), _score: lineScore });
        perFile++;
        if (contentHits.length >= lim.maxContentHits) { truncated = true; break; }
        if (perFile >= lim.maxHitsPerFile) { truncated = true; break; }
      }
      // 文件级分词命中数：命中更多分词的文件排前
      for (let k = contentHits.length - perFile; k < contentHits.length; k++) contentHits[k]._fileScore = fileTerms.size;
    }
  }

  nameHits.sort((a, b) => b._score - a._score || a.path.localeCompare(b.path));
  contentHits.sort((a, b) => b._fileScore - a._fileScore || a.path.localeCompare(b.path) || a.line - b.line);
  return {
    nameHits: nameHits.map(({ _score, ...h }) => h),
    contentHits: contentHits.map(({ _score, _fileScore, ...h }) => h),
    truncated,
    scanned,
  };
}
