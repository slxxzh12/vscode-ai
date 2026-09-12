import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function seedFileFor(configFile) {
  return path.join(path.dirname(configFile), 'workflows.seed.json');
}

export function hashWorkflow(w) {
  const norm = {
    id: w.id,
    label: w.label,
    stages: (w.stages || []).map((s) => ({ id: s.id, label: s.label, group: s.group || '', prompts: s.prompts || [] })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}

export function readSeed(configFile) {
  try { return JSON.parse(fs.readFileSync(seedFileFor(configFile), 'utf8')); }
  catch { return { version: 0, updatedAt: 0, workflows: [] }; }
}

export function updateSeed(configFile, workflows, { now = Date.now() } = {}) {
  const prev = readSeed(configFile);
  const prevById = new Map((prev.workflows || []).map((w) => [w.id, w]));
  const catalog = (workflows || []).map((w) => {
    const hash = hashWorkflow(w);
    const old = prevById.get(w.id);
    return { id: w.id, label: w.label, hash, updatedAt: old && old.hash === hash ? (old.updatedAt || 0) : now };
  });
  const sig = (list) => JSON.stringify(list.map((w) => [w.id, w.hash]));
  const changed = sig(catalog) !== sig(prev.workflows || []);
  const seed = {
    version: (prev.version || 0) + (changed ? 1 : 0),
    updatedAt: changed ? now : (prev.updatedAt || 0),
    workflows: catalog,
  };
  try {
    fs.mkdirSync(path.dirname(seedFileFor(configFile)), { recursive: true });
    const tmp = seedFileFor(configFile) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(seed, null, 2), 'utf8');
    fs.renameSync(tmp, seedFileFor(configFile));
  } catch { /* best-effort：写种子失败不阻断 */ }
  return seed;
}
