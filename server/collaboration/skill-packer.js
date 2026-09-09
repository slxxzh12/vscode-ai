import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildZip } from './zip.js';

const HIDDEN = new Set(['.git', '.svn', '.hg']);

export function listSkills(root) {
  if (!root || !fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, dir: path.join(root, d.name) }))
    .filter((s) => fs.existsSync(path.join(s.dir, 'SKILL.md')));
}

function walk(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (HIDDEN.has(e.name) || e.name.startsWith('.')) continue;   // 跳过隐藏/.git
    const full = path.join(dir, e.name);
    const name = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(full, name, out);
    else if (e.isFile()) out.push({ name, data: fs.readFileSync(full) });
  }
}

// skillDir 应包含 SKILL.md；返回 { skillName, hash, zip }
export async function packSkill(skillDir) {
  if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) throw new Error('not a skill dir: missing SKILL.md');
  const skillName = path.basename(skillDir);
  const files = [];
  walk(skillDir, '', files);
  const zip = buildZip(files.map((f) => ({ name: `${skillName}/${f.name}`, data: f.data })));
  const hash = crypto.createHash('sha256').update(zip).digest('hex');
  return { skillName, hash, zip };
}
