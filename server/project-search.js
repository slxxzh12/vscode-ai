import fsp from 'node:fs/promises';
import path from 'node:path';

// 搜索时跳过的常见目录（按目录名精确匹配）
export const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'dist-portable', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', '.idea', '.vscode',
]);

// split=true 时按空白拆成多个分词；split=false 时整串作为一个分词（不拆分空格）。
// 单个字母/单字（长度 < 2）一律忽略。
export function splitTerms(query, caseSensitive = false, split = true) {
  const src = String(query).trim();
  const parts = split ? src.split(/\s+/) : [src];
  const out = [];
  for (const raw of parts) {
    if (raw.length < 2) continue;
    const t = caseSensitive ? raw : raw.toLowerCase();
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

// 读前 64KB，判断是否含 NUL（二进制）
async function probeBinary(abs, size) {
  const len = Math.min(size, 64 * 1024);
  if (len <= 0) return false;
  const fh = await fsp.open(abs, 'r');
  try {
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0);
    return buf.includes(0);
  } finally {
    await fh.close();
  }
}

// 异步流式遍历 root，边扫边 yield 事件；不设任何上限、不截断。
// 事件：{type:'name',hits}/{type:'content',path,name,lines}/{type:'progress',scanned}/{type:'done',scanned}
// path 一律用 POSIX 风格相对路径；skipIgnores=false 时连忽略目录与二进制也搜。
export async function* streamProject(root, { query = '', caseSensitive = false, searchName = true, searchContent = true, skipIgnores = true, split = true } = {}) {
  const terms = splitTerms(query, caseSensitive, split);
  if (!terms.length || (!searchName && !searchContent)) { yield { type: 'done', scanned: 0 }; return; }

  const rootResolved = path.resolve(root);
  const stack = [''];
  let scanned = 0;
  let sinceProgress = 0;

  while (stack.length) {
    const relDir = stack.pop();
    const absDir = relDir ? path.join(rootResolved, relDir) : rootResolved;
    let entries;
    try { entries = await fsp.readdir(absDir, { withFileTypes: true }); } catch { continue; }

    const nameBatch = [];
    for (const d of entries) {
      const rel = relDir ? `${relDir}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (skipIgnores && IGNORE_DIRS.has(d.name)) continue;
        if (d.isSymbolicLink()) continue;
        stack.push(rel);
        continue;
      }
      if (!d.isFile()) continue;
      scanned++;
      sinceProgress++;

      if (searchName) {
        const nameHay = caseSensitive ? d.name : d.name.toLowerCase();
        for (const t of terms) {
          if (nameHay.includes(t)) { nameBatch.push({ path: rel, name: d.name }); break; }
        }
      }

      if (!searchContent) continue;
      const absFile = path.join(rootResolved, rel);
      let st;
      try { st = await fsp.stat(absFile); } catch { continue; }
      if (skipIgnores) {
        try { if (await probeBinary(absFile, st.size)) continue; } catch { continue; }
      }
      let text;
      try { text = await fsp.readFile(absFile, 'utf8'); } catch { continue; }
      const lines = text.split(/\r?\n/);
      const hitLines = [];
      for (let i = 0; i < lines.length; i++) {
        const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
        for (const t of terms) {
          if (hay.includes(t)) { hitLines.push({ line: i + 1, text: lines[i] }); break; }
        }
      }
      if (hitLines.length) yield { type: 'content', path: rel, name: d.name, lines: hitLines };

      if (sinceProgress >= 200) { sinceProgress = 0; yield { type: 'progress', scanned }; }
    }
    if (nameBatch.length) yield { type: 'name', hits: nameBatch };
  }
  yield { type: 'done', scanned };
}

// 便捷收集器：消费生成器并聚合为 { nameHits, contentHits, scanned }
export async function searchProject(root, opts) {
  const nameHits = [];
  const contentHits = [];
  let scanned = 0;
  for await (const ev of streamProject(root, opts)) {
    if (ev.type === 'name') nameHits.push(...ev.hits);
    else if (ev.type === 'content') for (const l of ev.lines) contentHits.push({ path: ev.path, name: ev.name, line: l.line, text: l.text });
    else if (ev.type === 'done') scanned = ev.scanned;
  }
  return { nameHits, contentHits, scanned };
}
