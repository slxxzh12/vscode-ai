import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.js';

// config/workflow.xml 的极简解析（仅支持本项目自用结构，无第三方依赖）
function decode(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}
function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return m ? decode(m[1]) : '';
}

// 内置兜底（配置文件缺失/损坏时使用）
export function fallbackWorkflows() {
  return [
    {
      id: 'dev', label: t('workflowxml.dev.title'),
      stages: [
        { id: 'design', label: t('workflowxml.design.label'), prompts: [t('workflowxml.design.prompt')] },
        { id: 'code', label: t('workflowxml.code.label'), prompts: [t('workflowxml.code.prompt')] },
        { id: 'test', label: t('workflowxml.test.label'), prompts: [t('workflowxml.test.prompt')] },
        { id: 'deploy', label: t('workflowxml.deploy.label'), prompts: [t('workflowxml.deploy.prompt')] },
      ],
    },
  ];
}

export function parseWorkflowXml(xml) {
  const workflows = [];
  const wfRe = /<workflow\b([^>]*)>([\s\S]*?)<\/workflow>/g;
  let wm;
  while ((wm = wfRe.exec(xml))) {
    const wf = { id: attr(wm[1], 'id') || `wf-${workflows.length}`, label: attr(wm[1], 'label') || attr(wm[1], 'id'), stages: [] };
    const stRe = /<stage\b([^>]*)>([\s\S]*?)<\/stage>/g;
    let sm;
    while ((sm = stRe.exec(wm[2]))) {
      const st = { id: attr(sm[1], 'id') || `st-${wf.stages.length}`, label: attr(sm[1], 'label') || attr(sm[1], 'id'), group: attr(sm[1], 'group') || '', prompts: [] };
      const prRe = /<prompt>([\s\S]*?)<\/prompt>/g;
      let pm;
      while ((pm = prRe.exec(sm[2]))) { const t = decode(pm[1]); if (t) st.prompts.push(t); }
      wf.stages.push(st);
    }
    if (wf.stages.length) workflows.push(wf);
  }
  return workflows;
}

export function loadWorkflowXml(file) {
  try {
    if (fs.existsSync(file)) {
      const wfs = parseWorkflowXml(fs.readFileSync(file, 'utf8'));
      if (wfs.length) return wfs;
    }
  } catch { /* fallthrough */ }
  return fallbackWorkflows();
}

// 默认配置文件位置：仓库根 config/workflow.xml（server/ 的上一级）
export function defaultWorkflowFile(baseDir) {
  return path.join(baseDir, 'config', 'workflow.xml');
}
