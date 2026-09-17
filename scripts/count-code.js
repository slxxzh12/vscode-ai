import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments, countReal } from '../shared/code-count.js';

// 纯函数实现已下沉到 shared/code-count.js（server 与 CLI 共用、随包分发）；
// 这里继续转出以兼容既有引用（含 server/test/count-code.test.js）。
export { stripComments, countReal };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.css', '.scss', '.html', '.htm', '.sql', '.xml']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-portable', 'env']);

export function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

function groupKey(rel) {
  const p = rel.split('/');
  if (p[0] === 'server' && p[1] === 'test') return 'server/test';
  return p.length === 1 ? '(root)' : p[0];
}

function main() {
  const files = walk(ROOT).sort((a, b) => a.localeCompare(b));
  const rows = files.map((full) => {
    const { total, real } = countReal(fs.readFileSync(full, 'utf8'));
    return { rel: path.relative(ROOT, full).replace(/\\/g, '/'), total, real };
  });

  rows.sort((a, b) => b.real - a.real || a.rel.localeCompare(b.rel));

  console.log('REAL  TOTAL  FILE');
  for (const r of rows) console.log(`${String(r.real).padStart(5)} ${String(r.total).padStart(6)}  ${r.rel}`);

  const groups = {};
  for (const r of rows) (groups[groupKey(r.rel)] ??= []).push(r);

  console.log('\nGROUP            REAL   TOTAL  FILES');
  let allReal = 0;
  let allTotal = 0;
  for (const key of Object.keys(groups).sort()) {
    const g = groups[key];
    const real = g.reduce((s, r) => s + r.real, 0);
    const total = g.reduce((s, r) => s + r.total, 0);
    allReal += real;
    allTotal += total;
    console.log(`${key.padEnd(15)} ${String(real).padStart(6)} ${String(total).padStart(6)}  ${g.length}`);
  }
  console.log(`${'ALL'.padEnd(15)} ${String(allReal).padStart(6)} ${String(allTotal).padStart(6)}  ${rows.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
