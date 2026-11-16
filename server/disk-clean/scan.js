import crypto from 'node:crypto';
import fs from 'node:fs';
import { measureDir, listEntries } from './fs-walk.js';
import { isExcluded } from './validate.js';

function filteredTargets(targets, exclusions) {
  return targets.filter((t) => {
    if (isExcluded(t.path, exclusions)) return false;
    if (t.mode === 'entry' && t.patterns) {
      const keep = t.patterns.filter((p) => !(exclusions.patterns || []).some((x) => x.toLowerCase() === String(p).toLowerCase()));
      return keep.length > 0;
    }
    return true;
  }).map((t) => {
    if (t.mode !== 'entry' || !t.patterns) return t;
    const keep = t.patterns.filter((p) => !(exclusions.patterns || []).some((x) => x.toLowerCase() === String(p).toLowerCase()));
    return { ...t, patterns: keep };
  });
}

export function createDiskCleanScanner({
  listCategories,
  resolveTargets,
  readSettings,
  ttlMs = 10 * 60 * 1000,
  now = () => Date.now(),
}) {
  const tasks = new Map();

  function purge() {
    const t = now();
    for (const [id, task] of tasks) {
      if (t - task.startedAt > ttlMs) tasks.delete(id);
    }
  }

  function start({ customDirs } = {}) {
    purge();
    const settings = readSettings();
    const dirs = Array.isArray(customDirs) ? customDirs : settings.customDirs;
    const cats = listCategories({ customDirs: dirs }).map((c) => ({
      ...c, status: 'pending', bytes: 0, files: 0, truncated: false, error: null,
    }));
    const scanId = crypto.randomUUID();
    const task = { id: scanId, startedAt: now(), customDirs: dirs, exclusions: settings.exclusions, categories: cats };
    tasks.set(scanId, task);
    void run(task);
    return { scanId };
  }

  async function run(task) {
    for (const cat of task.categories) {
      cat.status = 'scanning';
      try {
        const targets = filteredTargets(resolveTargets(cat.id, { customDirs: task.customDirs }), task.exclusions);
        const skip = (full) => isExcluded(full, task.exclusions);
        for (const t of targets) {
          if (t.mode === 'contents') {
            const r = measureDir(t.path, { minAgeDays: t.minAgeDays || 0, skip });
            cat.bytes += r.bytes;
            cat.files += r.files;
            cat.truncated = cat.truncated || r.truncated;
          } else if (t.mode === 'entry') {
            const r = listEntries(t.path, { patterns: t.patterns || [], minAgeDays: t.minAgeDays || 0, skip });
            cat.bytes += r.entries.reduce((s, e) => s + e.size, 0);
            cat.files += r.entries.length;
            cat.truncated = cat.truncated || r.truncated;
          } else if (t.mode === 'file') {
            try {
              const st = fs.statSync(t.path);
              if (st.isFile()) { cat.files += 1; cat.bytes += st.size; }
            } catch { /* ignore */ }
          } else if (t.mode === 'recycle-bin') {
            const r = measureDir(`${t.path}\\$Recycle.Bin`, {});
            cat.bytes += r.bytes;
            cat.files += r.files;
            cat.truncated = cat.truncated || r.truncated;
          }
        }
        cat.status = 'done';
      } catch (e) {
        cat.status = 'error';
        cat.error = String(e?.message || e);
      }
      await new Promise((r) => setImmediate(r));
    }
  }

  function get(scanId) {
    purge();
    return tasks.get(scanId) || null;
  }

  return { start, get };
}
