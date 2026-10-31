import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { countReal } from '@devflow/shared/code-count';
import { makeKeepPath } from '@devflow/shared/git-filter';
import { runGitRaw } from './git-log.js';

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const HARD_SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-portable', 'env']);
const CONCURRENCY = 16;
const AUTHOR_TIMEOUT = 30 * 1000;

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

// 顶层目录作为分组键；根目录下的文件归 (root)
export function groupKey(rel) {
  const p = rel.split('/');
  return p.length === 1 ? '(root)' : p[0];
}

// 深度优先列出候选文件（相对路径，`/` 分隔）；跳过点目录、硬跳过目录与符号链接
function listFiles(root) {
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = rel ? path.join(root, rel) : root;
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || HARD_SKIP_DIRS.has(e.name)) continue;
        stack.push(childRel);
      } else if (e.isFile()) {
        out.push(childRel);
      }
    }
  }
  return out;
}

// 单文件统计：超大小上限或含 NUL（二进制）跳过
async function countOne(root, rel) {
  const full = path.join(root, rel);
  let st;
  try { st = await fsp.stat(full); } catch { return null; }
  if (st.size > MAX_FILE_BYTES) return null;
  let buf;
  try { buf = await fsp.readFile(full); } catch { return null; }
  if (buf.includes(0)) return null;
  const { real, total } = countReal(buf.toString('utf8'));
  return { rel, real, total };
}

// 首次提交人映射：一次 git log，取每个文件最早一次「新增」的作者；非仓库/失败返回空
export async function firstAuthors(dir) {
  const empty = new Map();
  try {
    const top = (await runGitRaw(['-C', dir, 'rev-parse', '--show-toplevel'], { timeout: 10000 })).trim();
    if (!top) return empty;
    let prefix = path.relative(path.resolve(top), path.resolve(dir)).replace(/\\/g, '/');
    if (prefix === '.') prefix = '';
    if (prefix.startsWith('..')) return empty;
    const out = await runGitRaw(
      ['-C', dir, '-c', 'core.quotepath=false', 'log', '--reverse', '--diff-filter=A', '--format=%x01%an', '--name-only'],
      { timeout: AUTHOR_TIMEOUT },
    );
    const map = new Map();
    let author = null;
    for (const line of out.split('\n')) {
      if (!line) continue;
      if (line.startsWith('\x01')) { author = line.slice(1); continue; }
      if (author == null) continue;
      let rel = line;
      if (prefix) {
        if (!rel.startsWith(`${prefix}/`)) continue;
        rel = rel.slice(prefix.length + 1);
      }
      if (!map.has(rel)) map.set(rel, author);
    }
    return map;
  } catch { return empty; }
}

export async function collectCodeStats({ dir, filter } = {}) {
  if (typeof dir !== 'string' || !dir.trim()) throw err('bad-dir', 'dir required');
  const root = dir.trim();
  let st;
  try { st = await fsp.stat(root); } catch { throw err('not-found', 'path not found'); }
  if (!st.isDirectory()) throw err('not-found', 'not a directory');

  // 实代码统计始终按代码后缀白名单过滤（不受 filter.codeOnly 影响）
  const keep = makeKeepPath({ ...(filter || {}), codeOnly: true });
  const all = listFiles(root).filter((rel) => keep(rel)).sort();
  const files = [];
  for (let i = 0; i < all.length; i += CONCURRENCY) {
    const chunk = all.slice(i, i + CONCURRENCY);
    const rows = await Promise.all(chunk.map((rel) => countOne(root, rel)));
    for (const r of rows) if (r) files.push(r);
  }

  files.sort((a, b) => b.real - a.real || a.rel.localeCompare(b.rel));
  const truncated = files.length > MAX_FILES;
  const kept = files.slice(0, MAX_FILES);

  const authors = await firstAuthors(root);
  if (authors.size) {
    for (const f of kept) {
      const a = authors.get(f.rel);
      if (a) f.firstAuthor = a;
    }
  }

  const gmap = new Map();
  for (const f of kept) {
    const key = groupKey(f.rel);
    const g = gmap.get(key) || { key, real: 0, total: 0, files: 0 };
    g.real += f.real;
    g.total += f.total;
    g.files += 1;
    gmap.set(key, g);
  }
  const groups = [...gmap.values()].sort((a, b) => b.real - a.real || a.key.localeCompare(b.key));
  const totals = kept.reduce(
    (s, f) => ({ files: s.files + 1, real: s.real + f.real, total: s.total + f.total }),
    { files: 0, real: 0, total: 0 },
  );

  return { dir: root, files: kept, groups, totals, ...(truncated ? { truncated: true } : {}) };
}
