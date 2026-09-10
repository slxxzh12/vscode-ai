import fs from 'node:fs';
import path from 'node:path';

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
export const FALLBACK_WORKFLOWS = [
  {
    id: 'dev', label: '开发工作流',
    stages: [
      { id: 'design', label: '需求设计', prompts: ['请使用 superpower brainstorm 来拆解下面需求：'] },
      { id: 'code', label: '代码实现', prompts: ['请按需求文档实现功能，遵循仓库 AGENTS 约定，改完先跑测试与类型检查。'] },
      { id: 'test', label: '开发自测', prompts: ['请补齐并运行测试与类型检查，报告结果与风险。'] },
      { id: 'deploy', label: '环境部署', prompts: ['请给出构建/打包/发布步骤并执行，说明回滚方案。'] },
    ],
  },
];

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
  return FALLBACK_WORKFLOWS;
}

// 默认配置文件位置：仓库根 config/workflow.xml（server/ 的上一级）
export function defaultWorkflowFile(baseDir) {
  return path.join(baseDir, 'config', 'workflow.xml');
}
