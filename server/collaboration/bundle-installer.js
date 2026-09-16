import fs from 'node:fs';
import path from 'node:path';
import { readZip } from './zip.js';
import { parseWorkflowsXml } from '@devflow/shared/workflow-xml';

function writeAtomic(dest, data) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, dest);
}

// 解包 assets 捆绑 zip：skills/<name>/... → skillRoot；command|agent/... → configRoot；
// workflow/<id>.json → installWorkflows([...]) 合并
export function installBundleZip({ zip, skillRoot, configRoot, installWorkflows = null }) {
  const entries = readZip(zip);
  const counts = { skills: 0, command: 0, agent: 0, workflow: 0 };
  const workflows = [];
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
    } else if (top === 'workflow') {
      // 新格式：workflow/workflows.xml（勾选的工作流打成一份 XML）；兼容旧的 workflow/<id>.json
      if (seg.length >= 2 && seg[1].endsWith('.xml')) {
        try {
          const list = parseWorkflowsXml(e.data.toString('utf8'));
          for (const w of list) { workflows.push(w); counts.workflow++; }
        } catch { /* skip bad xml */ }
        continue;
      }
      if (seg.length < 2 || !seg[1].endsWith('.json')) continue;
      try { workflows.push(JSON.parse(e.data.toString('utf8'))); counts.workflow++; } catch { /* skip bad json */ }
    }
  }
  if (workflows.length && typeof installWorkflows === 'function') installWorkflows(workflows);
  return { counts, files: counts.skills + counts.command + counts.agent + counts.workflow };
}
