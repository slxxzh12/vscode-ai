import fs from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({ exclusions: { dirs: [], patterns: [] }, customDirs: [] });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

export function createDiskCleanStore({ dir }) {
  const exclusionsFile = path.join(dir, 'exclusions.json');
  const customFile = path.join(dir, 'custom.json');
  const historyFile = path.join(dir, 'history.jsonl');

  function readSettings() {
    const base = EMPTY();
    const ex = readJson(exclusionsFile, base.exclusions);
    const custom = readJson(customFile, []);
    return {
      exclusions: {
        dirs: Array.isArray(ex.dirs) ? ex.dirs.filter((x) => typeof x === 'string') : [],
        patterns: Array.isArray(ex.patterns) ? ex.patterns.filter((x) => typeof x === 'string') : [],
      },
      customDirs: Array.isArray(custom) ? custom.filter((x) => typeof x === 'string') : [],
    };
  }

  function writeSettings(next) {
    const saved = {
      exclusions: {
        dirs: Array.isArray(next?.exclusions?.dirs) ? next.exclusions.dirs : [],
        patterns: Array.isArray(next?.exclusions?.patterns) ? next.exclusions.patterns : [],
      },
      customDirs: Array.isArray(next?.customDirs) ? next.customDirs : [],
    };
    writeJson(exclusionsFile, saved.exclusions);
    writeJson(customFile, saved.customDirs);
    return saved;
  }

  function appendHistory(entry) {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(historyFile, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  function readHistory(limit = 100) {
    let text = '';
    try { text = fs.readFileSync(historyFile, 'utf8'); } catch { return []; }
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }

  return { readSettings, writeSettings, appendHistory, readHistory };
}
