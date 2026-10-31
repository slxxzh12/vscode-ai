import fs from 'node:fs';
import path from 'node:path';
import { readZip } from './zip.js';

// 校验 zip：能解、首段统一为 skillName、必含 <skillName>/SKILL.md
export function validateSkillZip(zip, skillName) {
  try {
    const entries = readZip(zip);
    if (!entries.length) return false;
    for (const e of entries) {
      const seg = e.name.split('/');
      if (seg[0] !== skillName || seg.length < 2) return false;
    }
    return entries.some((e) => e.name === `${skillName}/SKILL.md`);
  } catch { return false; }
}

// 安装：目标已存在则备份 <name>.bak-<ts>，再原子覆盖
export function installZip({ zip, skillName, destRoot }) {
  if (!validateSkillZip(zip, skillName)) throw new Error('invalid skill zip');
  const entries = readZip(zip);
  const dest = path.join(destRoot, skillName);
  if (fs.existsSync(dest)) {
    fs.mkdirSync(destRoot, { recursive: true });
    const bak = `${dest}.bak-${Date.now()}`;
    fs.renameSync(dest, bak);
  }
  for (const e of entries) {
    const rel = e.name.split('/').slice(1).join('/');
    const target = path.join(dest, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.data);
  }
  return { skillName, dest, count: entries.length };
}
