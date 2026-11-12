import fs from 'node:fs';
import path from 'node:path';

export const DOC_SLOTS = ['code', 'knowledge', 'solution', 'workflow', 'experience', 'skills', 'rules'];

export function emptyDocState() {
  return {
    code: { path: '', selected: false },
    knowledge: { path: '', selected: false },
    solution: { path: '', selected: false },
    workflow: { path: '', selected: false },
    experience: { path: '', selected: false },
    skills: { path: '', selected: false },
    rules: { path: '', selected: false },
  };
}

export function normalizeDocState(raw) {
  const out = emptyDocState();
  const src = raw && typeof raw === 'object' ? raw : null;
  if (!src) return out;
  for (const slot of DOC_SLOTS) {
    const v = src[slot];
    if (v && typeof v === 'object') {
      if (typeof v.path === 'string') out[slot].path = v.path;
      if (typeof v.selected === 'boolean') out[slot].selected = v.selected;
    }
  }
  return out;
}

export function selectedDocDirs(state) {
  const out = [];
  for (const slot of DOC_SLOTS) {
    const p = String(state?.[slot]?.path || '').trim();
    if (state?.[slot]?.selected && p && !out.includes(p)) out.push(p);
  }
  return out;
}

export function createDocUpdateStore({ file, logger = console } = {}) {
  function read() {
    try {
      if (!file || !fs.existsSync(file)) return emptyDocState();
      return normalizeDocState(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      logger?.warn?.('doc-update load failed', (e && e.message) || e);
      return emptyDocState();
    }
  }
  function write(input) {
    const state = normalizeDocState(input);
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    }
    return state;
  }
  return { read, write };
}
