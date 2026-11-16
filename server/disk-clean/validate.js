import fs from 'node:fs';
import path from 'node:path';
import { globToRegExp } from './fs-walk.js';

const norm = (p) => path.resolve(String(p || '')).replace(/[\\/]+$/, '').toLowerCase();

export function isUnder(parent, child) {
  const p = norm(parent);
  const c = norm(child);
  return c === p || c.startsWith(p + path.sep.toLowerCase());
}

export function validateCustomDir(raw, { home = '', forbidden = [] } = {}) {
  const input = String(raw || '').trim();
  if (!input || !path.isAbsolute(input)) return { ok: false, error: 'not_absolute' };
  const resolved = path.resolve(input);
  let st;
  try { st = fs.statSync(resolved); } catch { return { ok: false, error: 'not_found' }; }
  if (!st.isDirectory()) return { ok: false, error: 'not_dir' };
  const parsed = path.parse(resolved);
  if (parsed.root.replace(/[\\/]+$/, '') === resolved.replace(/[\\/]+$/, '')) return { ok: false, error: 'drive_root' };
  if (home && norm(resolved) === norm(home)) return { ok: false, error: 'forbidden' };
  for (const f of forbidden) {
    if (!f) continue;
    if (norm(resolved) === norm(f)) return { ok: false, error: 'forbidden' };
  }
  return { ok: true, path: resolved };
}

export function isExcluded(fullPath, exclusions = {}) {
  const dirs = exclusions.dirs || [];
  const patterns = (exclusions.patterns || []).map(globToRegExp);
  if (dirs.some((d) => isUnder(d, fullPath))) return true;
  const base = path.basename(fullPath);
  return patterns.some((r) => r.test(base));
}
