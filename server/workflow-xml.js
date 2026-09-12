import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.js';
import { parseWorkflowsXml } from '@devflow/shared/workflow-xml';

export { parseWorkflowsXml as parseWorkflowXml };

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

export function loadWorkflowXml(file) {
  try {
    if (fs.existsSync(file)) {
      const wfs = parseWorkflowsXml(fs.readFileSync(file, 'utf8'));
      if (wfs.length) return wfs;
    }
  } catch { /* fallthrough */ }
  return fallbackWorkflows();
}

// 默认配置文件位置：仓库根 config/devflow.xml（server/ 的上一级）
export function defaultWorkflowFile(baseDir) {
  return path.join(baseDir, 'config', 'devflow.xml');
}
