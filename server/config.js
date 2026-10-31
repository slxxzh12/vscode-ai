import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.js';

export function loadJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sampleProjects() {
  return { projects: [] };
}

export function ensureDefaults(projectsFile) {
  if (!fs.existsSync(projectsFile)) {
    fs.mkdirSync(path.dirname(projectsFile), { recursive: true });
    fs.writeFileSync(projectsFile, JSON.stringify(sampleProjects(), null, 2));
  }
}

export function loadProjects(file) {
  const json = loadJson(file) || { projects: [] };
  const arr = Array.isArray(json.projects) ? json.projects : [];
  for (const p of arr) {
    if (!p.id || !p.name || !p.root) throw new Error(t('config.err.project_shape', { json: JSON.stringify(p) }));
  }
  return arr;
}
