import fs from 'node:fs';
import path from 'node:path';
import { parseWorkflowsXml, sortWorkflows } from '@devflow/shared/workflow-xml';
import { validateWorkflows } from './devflow-config.js';
import { t } from './i18n.js';

const PREFIX_RE = /^(\d+)_/;
const MD_EXT = '.md';

function prefixOf(name) {
  const m = String(name || '').match(PREFIX_RE);
  return m ? Number(m[1]) : 0;
}
function prefixText(name) {
  const m = String(name || '').match(PREFIX_RE);
  return m ? m[1] : '';
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
  const rawPrefix = prefixText(id);
  if (rawPrefix) {
    return uniqueName(`${rawPrefix}_${safeName(label || stripPrefix(id), 'workflow')}`, used);
  }
  return uniqueName(`${nextPrefix([...used])}_${safeName(label || id, 'workflow')}`, used);
}
function stageFolderName(id, label, existing, used) {
  const oldName = String(id || '').split('/').pop() || '';
  const oldPrefix = prefixText(oldName);
  if (oldPrefix) return uniqueName(`${oldPrefix}_${safeName(label || stripPrefix(oldName), 'stage')}`, used);
  return uniqueName(`${nextPrefix([...existing, ...used])}_${safeName(label || 'stage', 'stage')}`, used);
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dest);
    else if (entry.isFile()) fs.copyFileSync(src, dest);
  }
}

// 工作流目录结构：
//   <workflows>/100_工作流/200_小组/300_阶段/400_技能.md
// 文件夹名（含数字前缀）就是 id，显示名称去掉前缀；同一层按数字前缀升序。
// 只读扫描一个工作流目录（工作流/小组/阶段/技能.md），不做 seed / 迁移 / 写盘。
// 用于当前项目目录下的 `.void/workflows/` 等外部只读来源。
export function readWorkflowsDir(dir, logger = null) {
  const out = [];
  for (const wfName of listDirs(dir)) {
    const wfDir = path.join(dir, wfName);
    const stages = [];
    for (const groupName of listDirs(wfDir)) {
      const groupDir = path.join(wfDir, groupName);
      for (const stageName of listDirs(groupDir)) {
        const stageDir = path.join(groupDir, stageName);
        const prompts = [];
        for (const fileName of listMd(stageDir)) {
          try {
            const text = fs.readFileSync(path.join(stageDir, fileName), 'utf8').replace(/\s+$/, '');
            if (text.trim()) prompts.push(text);
          } catch (e) {
            logger?.warn?.(`workflow skill read failed: ${fileName}`, (e && e.message) || e);
          }
        }
        stages.push({
          id: `${groupName}/${stageName}`,
          label: stripPrefix(stageName),
          group: stripPrefix(groupName),
          prompts,
        });
      }
    }
    out.push({ id: wfName, label: stripPrefix(wfName), priority: -prefixOf(wfName), stages });
  }
  return sortWorkflows(out);
}

export function createWorkflowStore({ dir, configFile = null, seedDir = null, seedStore = null, logger = console, seed = true } = {}) {
  fs.mkdirSync(dir, { recursive: true });

  function groupHints() {
    const hints = new Map();
    const files = [configFile, path.join(process.cwd(), 'config', 'devflow.xml')];
    for (const file of files) {
      if (!file || !fs.existsSync(file)) continue;
      try {
        for (const wf of parseWorkflowsXml(fs.readFileSync(file, 'utf8'))) {
          for (const st of wf.stages || []) {
            if (st.label && st.group) hints.set(st.label, st.group);
          }
        }
      } catch { /* ignore */ }
    }
    if (seedDir) {
      for (const wfName of listDirs(seedDir)) {
        const wfDir = path.join(seedDir, wfName);
        for (const groupName of listDirs(wfDir)) {
          for (const stageName of listDirs(path.join(wfDir, groupName))) {
            hints.set(stripPrefix(stageName), stripPrefix(groupName));
          }
        }
      }
    }
    return hints;
  }

  // 从包内 config/workflows 补齐默认工作流：同名工作流只解压一次（不覆盖、不重复），
  // 数据目录里没有的新工作流才复制进来。
  function seedFromDir() {
    if (!seedDir || !fs.existsSync(seedDir)) return false;
    const existing = new Set(listDirs(dir).map(stripPrefix));
    let copied = false;
    for (const name of listDirs(seedDir)) {
      const label = stripPrefix(name);
      if (existing.has(label)) continue;
      const to = path.join(dir, name);
      if (fs.existsSync(to)) continue;
      try {
        copyTree(path.join(seedDir, name), to);
        existing.add(label);
        copied = true;
      } catch (e) {
        logger?.warn?.('workflow seed copy failed', name, (e && e.message) || e);
      }
    }
    return copied;
  }

  // 用包内默认目录覆盖指定的本地工作流（按去掉数字前缀后的名称匹配）。
  // 只覆盖该工作流，保留本地文件夹名/排序；其他工作流不受影响。
  function restoreFromSeed(workflowId) {
    if (!seedDir || !fs.existsSync(seedDir)) throw new Error('no-seed');
    const localName = listDirs(dir).find((name) => name === workflowId || stripPrefix(name) === stripPrefix(workflowId));
    if (!localName) throw new Error('not-found');
    const label = stripPrefix(localName);
    const seedName = listDirs(seedDir).find((name) => stripPrefix(name) === label);
    if (!seedName) throw new Error('no-default');
    const from = path.join(seedDir, seedName);
    const to = path.join(dir, localName);
    fs.rmSync(to, { recursive: true, force: true });
    copyTree(from, to);
    seedStore?.update?.(readAll());
    return { workflowId: localName, label };
  }

  // 用包内默认目录强制覆盖全部同名本地工作流，并补齐包内新增工作流；
  // 不在包内的本地额外工作流保留，避免误删用户自建内容。
  function overwriteAllFromSeed() {
    if (!seedDir || !fs.existsSync(seedDir)) throw new Error('no-seed');
    const localNames = listDirs(dir);
    const seedNames = listDirs(seedDir);
    let overwritten = 0;
    let added = 0;
    for (const seedName of seedNames) {
      const label = stripPrefix(seedName);
      const localName = localNames.find((name) => stripPrefix(name) === label);
      if (localName) {
        const to = path.join(dir, localName);
        fs.rmSync(to, { recursive: true, force: true });
        copyTree(path.join(seedDir, seedName), to);
        overwritten += 1;
      } else {
        const to = path.join(dir, seedName);
        if (!fs.existsSync(to)) {
          copyTree(path.join(seedDir, seedName), to);
          added += 1;
        }
      }
    }
    seedStore?.update?.(readAll());
    return { overwritten, added };
  }

  // 旧的三层目录（工作流/阶段/技能）迁移为四层（工作流/小组/阶段/技能）。
  function migrateOldLayout() {
    const hints = groupHints();
    for (const wfName of listDirs(dir)) {
      const wfDir = path.join(dir, wfName);
      const children = listDirs(wfDir);
      const oldStages = children.filter((name) => listMd(path.join(wfDir, name)).length > 0);
      if (!oldStages.length) continue;
      const used = new Set(children.filter((name) => !oldStages.includes(name)));
      for (const oldName of oldStages) {
        const groupLabel = hints.get(stripPrefix(oldName)) || t('workflow.default_group');
        let groupName = [...used].find((name) => stripPrefix(name) === groupLabel);
        if (!groupName) {
          groupName = `${nextPrefix([...used])}_${safeName(groupLabel, 'group')}`;
          used.add(groupName);
        }
        const groupDir = path.join(wfDir, groupName);
        fs.mkdirSync(groupDir, { recursive: true });
        const from = path.join(wfDir, oldName);
        const to = path.join(groupDir, oldName);
        try {
          if (!fs.existsSync(to)) fs.renameSync(from, to);
          else fs.rmSync(from, { recursive: true, force: true });
        } catch (e) {
          logger?.warn?.(`workflow migrate failed: ${oldName}`, (e && e.message) || e);
        }
      }
    }
  }

  function readAll() {
    return readWorkflowsDir(dir, logger);
  }

  function writeAll(list) {
    const clean = validateWorkflows(list);
    const existingWf = new Set(listDirs(dir));
    const wantedWf = new Set();
    for (const wf of clean) {
      const wfName = folderName(wf.id, wf.label, wantedWf);
      const wfDir = path.join(dir, wfName);
      fs.mkdirSync(wfDir, { recursive: true });
      const existingGroups = listDirs(wfDir);
      const usedGroups = new Set();
      const groupNameByLabel = new Map();
      for (const stage of wf.stages || []) {
        const groupLabel = String(stage.group || '').trim() || t('workflow.default_group');
        if (groupNameByLabel.has(groupLabel)) continue;
        let groupName = existingGroups.find((name) => stripPrefix(name) === groupLabel && !usedGroups.has(name));
        if (!groupName) groupName = `${nextPrefix([...usedGroups])}_${safeName(groupLabel, 'group')}`;
        usedGroups.add(groupName);
        groupNameByLabel.set(groupLabel, groupName);
      }
      const usedStages = new Map();
      for (const stage of wf.stages || []) {
        const groupLabel = String(stage.group || '').trim() || t('workflow.default_group');
        const groupName = groupNameByLabel.get(groupLabel);
        const groupDir = path.join(wfDir, groupName);
        fs.mkdirSync(groupDir, { recursive: true });
        if (!usedStages.has(groupName)) usedStages.set(groupName, new Set());
        const existingStages = listDirs(groupDir);
        const stageName = stageFolderName(stage.id, stage.label, existingStages, usedStages.get(groupName));
        const stageDir = path.join(groupDir, stageName);
        fs.mkdirSync(stageDir, { recursive: true });
        const usedFiles = new Set();
        const prompts = (stage.prompts || []).filter((p) => String(p).trim() !== '');
        prompts.forEach((prompt, index) => {
          const base = `${(index + 1) * 100}_${promptSlug(prompt)}${MD_EXT}`;
          const fileName = uniqueName(base, usedFiles);
          fs.writeFileSync(path.join(stageDir, fileName), `${String(prompt).replace(/\s+$/, '')}\n`, 'utf8');
        });
        for (const fileName of listMd(stageDir)) {
          if (!usedFiles.has(fileName)) {
            try { fs.rmSync(path.join(stageDir, fileName), { force: true }); } catch { /* ignore */ }
          }
        }
      }
      for (const groupName of listDirs(wfDir)) {
        const groupDir = path.join(wfDir, groupName);
        if (!usedGroups.has(groupName)) {
          try { fs.rmSync(groupDir, { recursive: true, force: true }); } catch { /* ignore */ }
          continue;
        }
        const used = usedStages.get(groupName) || new Set();
        for (const stageName of listDirs(groupDir)) {
          if (!used.has(stageName)) {
            try { fs.rmSync(path.join(groupDir, stageName), { recursive: true, force: true }); } catch { /* ignore */ }
          }
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

  function absPath(rel) {
    const root = path.resolve(dir);
    const abs = path.resolve(root, String(rel || ''));
    if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('bad-path');
    return abs;
  }

  function tree(workflowId = '') {
    const all = listDirs(dir);
    const names = workflowId ? all.filter((n) => n === workflowId) : all;
    return names.map((wfName) => ({
      name: wfName,
      type: 'dir',
      path: wfName,
      abs: absPath(wfName),
      children: listDirs(path.join(dir, wfName)).map((groupName) => ({
        name: groupName,
        type: 'dir',
        path: `${wfName}/${groupName}`,
        abs: absPath(`${wfName}/${groupName}`),
        children: listDirs(path.join(dir, wfName, groupName)).map((stageName) => ({
          name: stageName,
          type: 'dir',
          path: `${wfName}/${groupName}/${stageName}`,
          abs: absPath(`${wfName}/${groupName}/${stageName}`),
          children: listMd(path.join(dir, wfName, groupName, stageName)).map((fileName) => ({
            name: fileName,
            type: 'file',
            path: `${wfName}/${groupName}/${stageName}/${fileName}`,
            abs: absPath(`${wfName}/${groupName}/${stageName}/${fileName}`),
          })),
        })),
      })),
    }));
  }

  function readFile(rel) {
    const abs = absPath(rel);
    if (!abs.toLowerCase().endsWith(MD_EXT)) throw new Error('bad-file');
    return fs.readFileSync(abs, 'utf8');
  }

  function deleteFile(rel) {
    const abs = absPath(rel);
    if (!abs.toLowerCase().endsWith(MD_EXT)) throw new Error('bad-file');
    fs.rmSync(abs);
    seedStore?.update?.(readAll());
    return { path: rel };
  }

  function moveFile(fromRel, toRel) {
    const from = absPath(fromRel);
    const to = absPath(toRel);
    if (!from.toLowerCase().endsWith(MD_EXT) || !to.toLowerCase().endsWith(MD_EXT)) throw new Error('bad-file');
    let st = null;
    try { st = fs.statSync(from); } catch { throw new Error('not-found'); }
    if (!st.isFile()) throw new Error('not-found');
    const parent = path.dirname(to);
    let pst = null;
    try { pst = fs.statSync(parent); } catch { throw new Error('bad-target'); }
    if (!pst.isDirectory()) throw new Error('bad-target');
    if (fs.existsSync(to)) throw new Error('exists');
    fs.renameSync(from, to);
    seedStore?.update?.(readAll());
    return { from: fromRel, to: toRel };
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

  if (seed) seedFromDir();
  migrateXmlFiles();
  migrateOldLayout();

  return { readAll, writeAll, tree, readFile, deleteFile, moveFile, absPath, restoreFromSeed, overwriteAllFromSeed, migrateFromConfigXml, dir };
}
