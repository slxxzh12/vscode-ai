import fs from 'node:fs';
import path from 'node:path';

export const MAX_FILES = 200_000;
export const MAX_MS = 30_000;

export function globToRegExp(pattern) {
  let out = '^';
  for (const ch of String(pattern || '')) {
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  out += '$';
  return new RegExp(out, 'i');
}

function ageCutoff(minAgeDays, now) {
  return minAgeDays > 0 ? now - minAgeDays * 86400000 : 0;
}

export function measureDir(dir, { minAgeDays = 0, recursive = true, maxFiles = MAX_FILES, maxMs = MAX_MS, skip = null } = {}) {
  const started = Date.now();
  const cutoff = ageCutoff(minAgeDays, started);
  let files = 0;
  let bytes = 0;
  let truncated = false;

  function walk(current) {
    if (truncated) return;
    let list;
    try { list = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (files >= maxFiles || Date.now() - started > maxMs) { truncated = true; return; }
      const full = path.join(current, e.name);
      if (skip && skip(full)) continue;
      let st;
      try { st = fs.lstatSync(full); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (recursive) walk(full);
      } else if (st.isFile()) {
        if (cutoff && st.mtimeMs > cutoff) continue;
        files += 1;
        bytes += st.size;
      }
    }
  }

  walk(dir);
  return { bytes, files, truncated };
}

export function listEntries(dir, { patterns = [], minAgeDays = 0, maxFiles = MAX_FILES, skip = null } = {}) {
  const cutoff = ageCutoff(minAgeDays, Date.now());
  const regs = patterns.map(globToRegExp);
  const entries = [];
  let truncated = false;
  let list;
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { entries, truncated }; }
  for (const e of list) {
    if (entries.length >= maxFiles) { truncated = true; break; }
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (skip && skip(full)) continue;
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (regs.length && !regs.some((r) => r.test(e.name))) continue;
    if (cutoff && st.mtimeMs > cutoff) continue;
    entries.push({ path: full, size: st.isFile() ? st.size : 0, isDir: st.isDirectory() });
  }
  return { entries, truncated };
}
