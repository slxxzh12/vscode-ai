import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SAMPLE_SLOTS = ['knowledge', 'solution', 'workflow', 'experience', 'skills', 'rules'];
export const DEFAULT_TEMPLATE_DIR = path.join(__dirname, '..', 'config', 'doc-samples');

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function walkFiles(root, base = root, out = []) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) walkFiles(full, base, out);
    else if (e.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

function inside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function initDocSamples(state, { templateDir = DEFAULT_TEMPLATE_DIR, includeUnselected = false } = {}) {
  const results = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const slot of SAMPLE_SLOTS) {
    const dir = String(state?.[slot]?.path || '').trim();
    if (!dir) continue;
    if (!includeUnselected && !state?.[slot]?.selected) continue;

    const res = { slot, dir, ok: true, created: [], skipped: [], createdDir: false };
    if (!isDir(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        res.createdDir = true;
      } catch (e) {
        res.ok = false;
        res.error = (e && e.code) || 'missing_dir';
        res.message = (e && e.message) || String(e);
        results.push(res);
        failed++;
        continue;
      }
    }

    const srcDir = path.join(templateDir, slot);
    if (!isDir(srcDir)) {
      res.ok = false;
      res.error = 'missing_template';
      results.push(res);
      failed++;
      continue;
    }

    const base = path.resolve(dir);
    for (const rel of walkFiles(srcDir)) {
      const target = path.resolve(base, rel);
      if (!inside(base, target)) {
        res.skipped.push(rel);
        skipped++;
        continue;
      }
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, fs.readFileSync(path.join(srcDir, rel)), { flag: 'wx' });
        res.created.push(rel);
        created++;
      } catch (e) {
        if (e && e.code === 'EEXIST') {
          res.skipped.push(rel);
          skipped++;
        } else {
          res.ok = false;
          res.error = (e && e.code) || 'write_failed';
          res.message = (e && e.message) || String(e);
          failed++;
          break;
        }
      }
    }
    results.push(res);
  }

  return { results, created, skipped, failed };
}
