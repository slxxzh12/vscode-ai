import fs from 'node:fs';
import path from 'node:path';
import { readZip } from './zip.js';

function writeAtomic(dest, data) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, dest);
}

// 解包 assets 捆绑 zip：skills/<name>/... → skillRoot/<name>/...；command|agent/... → configRoot/<kind>/...
export function installBundleZip({ zip, skillRoot, configRoot }) {
  const entries = readZip(zip);   // 非法 zip 直接抛错
  const counts = { skills: 0, command: 0, agent: 0 };
  for (const e of entries) {
    const seg = e.name.split('/');
    const top = seg[0];
    if (top === 'skills') {
      if (seg.length < 3) continue;
      writeAtomic(path.join(skillRoot, ...seg.slice(1)), e.data);
      counts.skills++;
    } else if (top === 'command' || top === 'agent') {
      if (!configRoot || seg.length < 2) continue;
      writeAtomic(path.join(configRoot, top, ...seg.slice(1)), e.data);
      counts[top]++;
    }
  }
  return { counts, files: counts.skills + counts.command + counts.agent };
}
