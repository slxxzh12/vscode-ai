import fs from 'node:fs';
import path from 'node:path';
import { parseWorkflowsXml, sortWorkflows } from '@devflow/shared/workflow-xml';
import { validateWorkflows } from './devflow-config.js';

const PREFIX_RE = /^(\d+)_/;
const MD_EXT = '.md';

function prefixOf(name) {
  const m = String(name || '').match(PREFIX_RE);
  return m ? Number(m[1]) : 0;
}
function stripPrefix(name) {
  return String(name || '').replace(PREFIX_RE, '');
}
function safeName(value, fallback = 'item') {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '_')
    .slice(0, 80);
  return cleaned || fallback;
}
function promptSlug(text) {
  const first = String(text || '').split(/\r?\n/).find((line) => line.trim()) || 'skill';
  return safeName(first.replace(/[#*`>\-[\]()]/g, ' ').replace(/\s+/g, ' ').trim(), 'skill').slice(0, 48);
}
function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => prefixOf(a) - prefixOf(b) || a.localeCompare(b));
  } catch { return []; }
}
function listMd(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(MD_EXT))
      .map((e) => e.name)
      .sort((a, b) => prefixOf(a) - prefixOf(b) || a.localeCompare(b));
  } catch { return []; }
}
function listXml(dir) {
  try { return fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.xml')); } catch { return []; }
}
function nextPrefix(names) {
  const max = names.reduce((m, n) => Math.max(m, prefixOf(n)), 0);
  return String(max + 100);
}
function uniqueName(base, used) {
  let name = base;
  let i = 2;
  while (used.has(name)) { name = `${base}_${i}`; i += 1; }
  used.add(name);
  return name;
}
function folderName(id, label, used) {
  const rawPrefix = String(id || '').match(PREFIX_RE);
  if (rawPrefix) {
    return uniqueName(`${rawPrefix[1]}_${safeName(label || stripPrefix(id), 'workflow')}`, used);
  }
  const names = [...used];
  return uniqueName(`${nextPrefix(names)}_${safeName(label || id, 'workflow')}`, used);
}

// 工作流目录结构：
//   <workflows>/100_工作流/200_小组/300_技能.md
// 文件夹名（含数字前缀）就是 id，显示名称去掉前缀；任一层按数字前缀升序。
export function createWorkflowStore({ dir, configFile = null, seedStore = null, logger = console } = {}) {
  fs.mkdirSync(dir, { recursive: true });

  function readAll() {
    const out = [];
    for (const wfName of listDirs(dir)) {
      const wfDir = path.join(dir, wfName);
      const stages = [];
      for (const groupName of listDirs(wfDir)) {
        const groupDir = path.join(wfDir, groupName);
        const prompts = [];
        for (const fileName of listMd(groupDir)) {
          try {
            const text = fs.readFileSync(path.join(groupDir, fileName), 'utf8').replace(/\s+$/, '');
            if (text.trim()) prompts.push(text);
          } catch (e) {
            logger?.warn?.(`workflow skill read failed: ${fileName}`, (e && e.message) || e);
          }
        }
        stages.push({ id: groupName, label: stripPrefix(groupName), group: '', prompts });
      }
      out.push({
        id: wfName,
        label: stripPrefix(wfName),
        priority: -prefixOf(wfName),
        stages,
      });
    }
    return sortWorkflows(out);
  }

  function writeAll(list) {
    const clean = validateWorkflows(list);
    const existingWf = new Set(listDirs(dir));
    const wantedWf = new Set();
    for (const wf of clean) {
      const wfName = folderName(wf.id, wf.label, wantedWf);
      const wfDir = path.join(dir, wfName);
      fs.mkdirSync(wfDir, { recursive: true });
      const usedGroups = new Set();
      for (const stage of wf.stages || []) {
        const groupName = folderName(stage.id, stage.label, usedGroups);
        const groupDir = path.join(wfDir, groupName);
        fs.mkdirSync(groupDir, { recursive: true });
        const usedFiles = new Set();
        const prompts = (stage.prompts || []).filter((p) => String(p).trim() !== '');
        prompts.forEach((prompt, index) => {
          const base = `${(index + 1) * 100}_${promptSlug(prompt)}${MD_EXT}`;
          const fileName = uniqueName(base, usedFiles);
          fs.writeFileSync(path.join(groupDir, fileName), `${String(prompt).replace(/\s+$/, '')}\n`, 'utf8');
        });
        for (const fileName of listMd(groupDir)) {
          if (!usedFiles.has(fileName)) {
            try { fs.rmSync(path.join(groupDir, fileName), { force: true }); } catch { /* ignore */ }
          }
        }
      }
      for (const oldGroup of listDirs(wfDir)) {
        if (!usedGroups.has(oldGroup)) {
          try { fs.rmSync(path.join(wfDir, oldGroup), { recursive: true, force: true }); } catch { /* ignore */ }
        }
      }
    }
    for (const oldWf of existingWf) {
      if (!wantedWf.has(oldWf)) {
        try { fs.rmSync(path.join(dir, oldWf), { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
    for (const name of listXml(dir)) {
      try { fs.rmSync(path.join(dir, name), { force: true }); } catch { /* ignore */ }
    }
    seedStore?.update?.(clean);
    return readAll();
  }

  function migrateXmlFiles() {
    if (listDirs(dir).length) return false;
    const files = listXml(dir);
    if (!files.length) return false;
    const workflows = [];
    for (const name of files.sort()) {
      try {
        const wfs = parseWorkflowsXml(fs.readFileSync(path.join(dir, name), 'utf8'));
        for (const wf of wfs) workflows.push(wf);
      } catch (e) {
        logger?.warn?.(`workflow file parse failed: ${name}`, (e && e.message) || e);
      }
    }
    if (!workflows.length) return false;
    writeAll(workflows);
    return true;
  }

  // 一次性迁移：目录为空且配置里有 <workflows> 段 -> 拆成文件夹并删掉该段
  function migrateFromConfigXml() {
    if (!configFile || !fs.existsSync(configFile)) return false;
    if (listDirs(dir).length) return false;
    let xml = '';
    try { xml = fs.readFileSync(configFile, 'utf8'); } catch { return false; }
    const wfs = parseWorkflowsXml(xml);
    if (wfs.length) writeAll(wfs);
    const stripped = xml.replace(/[ \t]*<workflows\b[^>]*>[\s\S]*?<\/workflows>\s*/i, '');
    if (stripped !== xml) fs.writeFileSync(configFile, stripped, 'utf8');
    return wfs.length > 0;
  }

  migrateXmlFiles();

  return { readAll, writeAll, migrateFromConfigXml, dir };
}
