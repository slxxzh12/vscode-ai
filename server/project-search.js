import fsp from 'node:fs/promises';
import path from 'node:path';

// 搜索时跳过的常见目录（按目录名精确匹配）
export const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'dist-portable', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', '.idea', '.vscode',
]);

// 整串作为一个关键词（不做空格分词）；单个字母/单字（长度 < 2）忽略。
export function searchTerms(query, caseSensitive = false) {
  const src = String(query).trim();
  if (src.length < 2) return [];
  return [caseSensitive ? src : src.toLowerCase()];
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
export async function* streamProject(root, { query = '', caseSensitive = false, searchName = true, searchContent = true, skipIgnores = true } = {}) {
  const terms = searchTerms(query, caseSensitive);
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

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 在单个关键词上做全量替换，返回替换后的文本与替换次数。
function replaceTerm(text, term, replacement, caseSensitive) {
  if (!term) return { text, count: 0 };
  if (caseSensitive) {
    let count = 0;
    let i = 0;
    while ((i = text.indexOf(term, i)) >= 0) { count++; i += term.length; }
    return count ? { text: text.split(term).join(replacement), count } : { text, count: 0 };
  }
  const re = new RegExp(escapeRegExp(term), 'gi');
  let count = 0;
  const out = text.replace(re, () => { count++; return replacement; });
  return count ? { text: out, count } : { text, count: 0 };
}

// 全量替换：对内容命中的每个文件，把整串关键词替换为 replacement，写回磁盘。
// 只处理内容命中（文件名命中不改动）。返回 { files: 改动的文件数, replacements: 替换处数 }。
export async function replaceProject(root, { query = '', caseSensitive = false, skipIgnores = true } = {}, replacement = '') {
  const terms = searchTerms(query, caseSensitive);
  if (!terms.length) return { files: 0, replacements: 0 };
  const rootResolved = path.resolve(root);
  const paths = [];
  const seen = new Set();
  for await (const ev of streamProject(rootResolved, { query, caseSensitive, searchName: false, searchContent: true, skipIgnores })) {
    if (ev.type === 'content' && !seen.has(ev.path)) { seen.add(ev.path); paths.push(ev.path); }
  }
  let files = 0;
  let replacements = 0;
  for (const rel of paths) {
    const abs = path.join(rootResolved, rel);
    let text;
    try { text = await fsp.readFile(abs, 'utf8'); } catch { continue; }
    let next = text;
    let count = 0;
    for (const term of terms) {
      const r = replaceTerm(next, term, replacement, caseSensitive);
      next = r.text;
      count += r.count;
    }
    if (!count) continue;
    try { await fsp.writeFile(abs, next, 'utf8'); } catch { continue; }
    files++;
    replacements += count;
  }
  return { files, replacements };
}
