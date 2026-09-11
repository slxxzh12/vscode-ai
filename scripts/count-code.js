import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.css', '.scss', '.html', '.htm']);
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

export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code';
  let quote = null;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === 'line') {
      if (c === '\n') { out += c; state = 'code'; } else out += ' ';
      i++;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { out += '  '; i += 2; state = 'code'; }
      else { out += c === '\n' ? c : ' '; i++; }
      continue;
    }
    if (state === 'html') {
      if (c === '-' && c2 === '>') { out += '  '; i += 2; state = 'code'; }
      else { out += c === '\n' ? c : ' '; i++; }
      continue;
    }
    if (quote) {
      out += c;
      if (c === '\\') { out += c2 ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { state = 'line'; out += '  '; i += 2; continue; }
    if (c === '/' && c2 === '*') { state = 'block'; out += '  '; i += 2; continue; }
    if (c === '<' && src.startsWith('<!--', i)) { state = 'html'; out += '    '; i += 4; continue; }
    out += c;
    i++;
  }
  return out;
}

export function countReal(src) {
  const lines = stripComments(src).split(/\r?\n/);
  let total = 0;
  let real = 0;
  for (const line of lines) {
    total++;
    const t = line.trim();
    if (!t) continue;
    if (/^[{}\[\]();,]+$/.test(t)) continue;
    if (!/[A-Za-z]/.test(t)) continue;
    real++;
  }
  return { total, real };
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
