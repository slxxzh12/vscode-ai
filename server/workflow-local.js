// 项目级本地工作流：从 <目录>/.void/workflows 读取，并与系统默认工作流合并。
// 规则：本地定义优先排在最前、同名覆盖默认内容，默认工作流仍全部保留；按目录顺序去重（先出现者优先）。
import fs from 'node:fs';
import path from 'node:path';
import { sortWorkflows } from '@devflow/shared/workflow-xml';
import { readWorkflowsDir } from './workflow-store.js';
import { mergeWorkflowList, preferLocalFirst } from './collaboration/workflow-merge.js';

export function localWorkflowDir(baseDir) {
  return baseDir ? path.join(baseDir, '.void', 'workflows') : '';
}

export function readLocalWorkflows(dirs = [], logger = null) {
  const out = [];
  const seen = new Set();
  for (const dir of Array.isArray(dirs) ? dirs : []) {
    if (!dir) continue;
    let st = null;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const w of readWorkflowsDir(dir, logger)) {
      const key = String(w.label || w.id).trim();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(w);
    }
  }
  return out;
}

export function mergeLocalWorkflows(base = [], dirs = [], logger = null) {
  const local = readLocalWorkflows(dirs, logger);
  if (!local.length) return base;
  return preferLocalFirst(sortWorkflows(mergeWorkflowList(base, local)), local);
}

// 提示词增改落点：合并列表同名时保留默认 id，但内容来自本地，所以本地要按 id 或 label 再匹配一次。
// 返回 { source:'local'|'global', workflowId }；都找不到返回 null。
export function resolveWorkflowSource(localList = [], globalList = [], { workflowId, workflowLabel, stageId } = {}) {
  const hasStage = (wf) => !!wf && (wf.stages || []).some((s) => s.id === stageId);
  let localWf = localList.find((w) => w && w.id === workflowId);
  if (!localWf && workflowLabel) {
    const key = String(workflowLabel).trim();
    localWf = localList.find((w) => w && String(w.label || '').trim() === key);
  }
  if (hasStage(localWf)) return { source: 'local', workflowId: localWf.id };
  const globalWf = globalList.find((w) => w && w.id === workflowId);
  if (hasStage(globalWf)) return { source: 'global', workflowId };
  return null;
}
