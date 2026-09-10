import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataHome, ensureDataHome, seedFromLegacy } from './data-home.js';
import { t } from './i18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sampleProjects() {
  return { projects: [{ id: 'local', name: t('config.default_project'), root: process.cwd() }] };
}
function sampleWorkflows() {
  return [{
    id: 'deploy', name: t('config.default_workflow_name'), steps: [
      { id: 'build', advance: 'auto', cmd: 'npm run build' },
      { id: 'restart', advance: 'manual', cmd: 'echo ready', hint: t('config.default_step_hint') },
    ],
  }];
}

export function ensureDefaults(projectsFile, workflowsFile) {
  if (!fs.existsSync(projectsFile)) {
    fs.mkdirSync(path.dirname(projectsFile), { recursive: true });
    fs.writeFileSync(projectsFile, JSON.stringify(sampleProjects(), null, 2));
  }
  if (!fs.existsSync(workflowsFile)) {
    fs.writeFileSync(workflowsFile, JSON.stringify(sampleWorkflows(), null, 2));
  }
}

export function resolveFiles() {
  const dataRoot = ensureDataHome();
  const legacyP = path.join(__dirname, 'projects.json');
  const legacyW = path.join(__dirname, 'workflows.json');
  // 默认配置放入用户数据目录；存在仓库旧配置则首次迁移
  const projectsFile = process.env.DEVFLOW_PROJECTS || path.join(dataRoot, 'projects.json');
  const workflowsFile = process.env.DEVFLOW_WORKFLOWS || path.join(dataRoot, 'workflows.json');
  if (!process.env.DEVFLOW_PROJECTS) seedFromLegacy(projectsFile, legacyP);
  if (!process.env.DEVFLOW_WORKFLOWS) seedFromLegacy(workflowsFile, legacyW);
  ensureDefaults(projectsFile, workflowsFile);
  return { projectsFile, workflowsFile, dataHome: dataRoot };
}

export function loadProjects(file) {
  const json = loadJson(file) || { projects: [] };
  const arr = Array.isArray(json.projects) ? json.projects : [];
  for (const p of arr) {
    if (!p.id || !p.name || !p.root) throw new Error(t('config.err.project_shape', { json: JSON.stringify(p) }));
  }
  return arr;
}

export function loadWorkflows(file) {
  const arr = loadJson(file) || [];
  if (!Array.isArray(arr)) throw new Error(t('config.err.workflows_array'));
  for (const w of arr) {
    if (!w.id || !w.name || !Array.isArray(w.steps)) throw new Error(t('config.err.workflow_shape', { json: JSON.stringify(w) }));
    for (const s of w.steps) {
      if (!s.id || typeof s.cmd !== 'string') throw new Error(t('config.err.step_shape', { json: JSON.stringify(s) }));
      if (s.advance !== 'auto' && s.advance !== 'manual') throw new Error(t('config.err.advance', { json: JSON.stringify(s) }));
    }
  }
  return arr;
}
