import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseWorkflowsXml, serializeWorkflow, sortWorkflows } from '@devflow/shared/workflow-xml';
import { validateWorkflows } from './devflow-config.js';

const EXT = '.xml';

// id → 安全文件名（仅 [A-Za-z0-9._-]；为空/纯点用 id 的 sha256 前缀兜底）
export function safeWorkflowFile(id) {
  const raw = String(id == null ? '' : id);
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
  const base = cleaned && cleaned !== '_' ? cleaned : crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
  return `${base}${EXT}`;
}

// 每端口一个目录，单文件存一个 workflow；读时按 priority 排序。
export function createWorkflowStore({ dir, configFile = null, seedStore = null, logger = console } = {}) {
  fs.mkdirSync(dir, { recursive: true });

  function filePathFor(id) {
    const resolved = path.resolve(path.join(dir, safeWorkflowFile(id)));
    if (resolved !== path.resolve(dir) && !resolved.startsWith(path.resolve(dir) + path.sep)) throw new Error('bad workflow path');
    return resolved;
  }
  function listFiles() {
    try { return fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(EXT)); }
    catch (e) { logger?.warn?.('workflow dir read failed', (e && e.message) || e); return []; }
  }
  function readAll() {
    const byId = new Map();
    for (const name of listFiles().sort()) {
      let wfs = [];
      try { wfs = parseWorkflowsXml(fs.readFileSync(path.join(dir, name), 'utf8')); }
      catch (e) { logger?.warn?.(`workflow file parse failed: ${name}`, (e && e.message) || e); continue; }
      const wf = wfs[0];
      if (!wf || !wf.id) { logger?.warn?.(`workflow file has no workflow: ${name}`); continue; }
      if (byId.has(wf.id)) logger?.warn?.(`duplicate workflow id "${wf.id}": ${name} overrides earlier file`);
      byId.set(wf.id, wf);
    }
    return sortWorkflows([...byId.values()]);
  }
  function writeAll(list) {
    const clean = validateWorkflows(list);
    const wanted = new Map();
    for (const wf of clean) wanted.set(safeWorkflowFile(wf.id), wf);
    for (const [, wf] of wanted) {
      const p = filePathFor(wf.id);
      const tmp = `${p}.tmp`;
      fs.writeFileSync(tmp, serializeWorkflow(wf) + '\n', 'utf8');
      fs.renameSync(tmp, p);
    }
    for (const name of listFiles()) {
      if (!wanted.has(name)) { try { fs.unlinkSync(path.join(dir, name)); } catch { /* ignore */ } }
    }
    seedStore?.update?.(clean);
    return sortWorkflows(clean);
  }
  // 一次性迁移：目录为空且配置里有 <workflows> → 拆成单文件并删掉该段
  function migrateFromConfigXml() {
    if (!configFile || !fs.existsSync(configFile)) return false;
    if (listFiles().length) return false;
    let xml = '';
    try { xml = fs.readFileSync(configFile, 'utf8'); } catch { return false; }
    const wfs = parseWorkflowsXml(xml);
    if (wfs.length) writeAll(wfs);
    const stripped = xml.replace(/[ \t]*<workflows\b[^>]*>[\s\S]*?<\/workflows>\s*/i, '');
    if (stripped !== xml) fs.writeFileSync(configFile, stripped, 'utf8');
    return wfs.length > 0;
  }
  return { readAll, writeAll, migrateFromConfigXml, filePathFor, dir };
}
