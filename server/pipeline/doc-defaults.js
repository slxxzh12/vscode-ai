import fs from 'node:fs';
import path from 'node:path';

const CANDIDATES = {
  knowledge: ['docs/knowledge'],
  solution: ['docs/version'],
  workflow: ['docs/learn', 'docs/workflows', '.void/workflows', 'workflow'],
  experience: ['docs/memory'],
  skills: ['.opencode/skills', '.opencode/skill', '.claude/skills', '.void/skills', 'skills'],
  rules: ['.opencode/rules', '.opencode/rule', '.claude/rules', '.void/rules', 'docs/rules'],
};

const FALLBACK = {
  knowledge: 'docs/knowledge',
  solution: 'docs/version',
  workflow: 'docs/learn',
  experience: 'docs/memory',
  skills: 'skills',
  rules: 'docs/rules',
};

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

export function detectDocDefaults(root) {
  const base = path.resolve(String(root || ''));
  if (!isDir(base)) return { error: 'bad-root' };
  const paths = { code: base };
  const detected = {};
  for (const [slot, candidates] of Object.entries(CANDIDATES)) {
    const hit = candidates.find((rel) => isDir(path.join(base, rel))) || '';
    const rel = hit || FALLBACK[slot];
    paths[slot] = path.join(base, rel);
    detected[slot] = hit;
  }
  return { root: base, paths, detected };
}
