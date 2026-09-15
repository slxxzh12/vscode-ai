import fs from 'node:fs';
import path from 'node:path';
import { normalizeLocale, DEFAULT_LOCALE } from '@devflow/shared/i18n';
import { parseWorkflowXml, fallbackWorkflows } from './workflow-xml.js';
import { serializeWorkflow, decode } from '@devflow/shared/workflow-xml';
import { downloadsDir } from './data-home.js';
import { updateSeed } from './workflow-seed.js';

export const DEFAULT_AGENT = 'opencode';
export const DEFAULT_AGENTS = [
  { id: 'opencode', name: 'OpenCode', cmd: 'opencode' },
  { id: 'claudecode', name: 'ClaudeCode', cmd: 'claudecode' },
  { id: 'nga', name: 'nga', cmd: 'nga.cmd' },
];

export function defaultConfigFile(baseDir) {
  return path.join(baseDir, 'config', 'devflow.xml');
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1].trim() : '';
}
function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildDefaultConfig() {
  return {
    server: { language: DEFAULT_LOCALE, host: '127.0.0.1' },
    agents: { default: DEFAULT_AGENT, list: DEFAULT_AGENTS.map((a) => ({ ...a })) },
    workflows: fallbackWorkflows(),
  };
}

export function parseDevflowConfig(xml) {
  const defaults = buildDefaultConfig();
  const text = String(xml || '');

  const serverTag = (text.match(/<server\b([^>]*?)\/?>/i) || [])[1] || '';
  const language = normalizeLocale(decode(attr(serverTag, 'language')) || defaults.server.language);
  const host = decode(attr(serverTag, 'host')) || defaults.server.host;

  let list = defaults.agents.list;
  let defAgent = defaults.agents.default;
  const agentsTag = text.match(/<agents\b([^>]*)>([\s\S]*?)<\/agents>/i);
  if (agentsTag) {
    const found = [];
    const re = /<agent\b([^>]*?)\/?>/gi;
    let m;
    while ((m = re.exec(agentsTag[2]))) {
      const id = decode(attr(m[1], 'id'));
      const cmd = decode(attr(m[1], 'cmd'));
      if (id && cmd) found.push({ id, name: decode(attr(m[1], 'name')) || id, cmd });
    }
    if (found.length) list = found;
    const d = decode(attr(agentsTag[1], 'default'));
    defAgent = (d && list.some((a) => a.id === d)) ? d : list[0].id;
  }

  const workflows = parseWorkflowXml(text);
  return {
    server: { language, host },
    agents: { default: defAgent, list },
    workflows: workflows.length ? workflows : fallbackWorkflows(),
  };
}

export function serializeDevflowConfig(cfg) {
  const agents = cfg.agents.list
    .map((a) => `    <agent id="${escXml(a.id)}" name="${escXml(a.name)}" cmd="${escXml(a.cmd)}" />`)
    .join('\n');
  const wfs = cfg.workflows.map(serializeWorkflow).join('\n\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- DevFlow 统一配置：server（端口/语言）+ agents（默认 Agent 列表）+ workflows（工作流/提示语） -->
<devflow>
  <server language="${escXml(cfg.server.language)}" host="${escXml(cfg.server.host || '127.0.0.1')}" />

  <agents default="${escXml(cfg.agents.default)}">
${agents}
  </agents>

  <workflows>
${wfs}
  </workflows>
</devflow>
`;
}

export function ensureConfigFile(file) {
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeDevflowConfig(buildDefaultConfig()), 'utf8');
  return true;
}

// 解析运行时活动配置：优先 <dataHome>/ports/<端口>/downloads/devflow.xml；不存在则从仓库模板 seed（不覆盖已存在的）
export function resolveActiveConfigFile(baseDir, port) {
  const dir = downloadsDir(port);
  const active = path.join(dir, 'devflow.xml');
  if (fs.existsSync(active)) return active;
  fs.mkdirSync(dir, { recursive: true });        // 失败向上抛出 → 启动失败
  const template = defaultConfigFile(baseDir);
  if (fs.existsSync(template)) fs.copyFileSync(template, active);
  else fs.writeFileSync(active, serializeDevflowConfig(buildDefaultConfig()), 'utf8');
  return active;
}

export function loadDevflowConfig(file) {
  try {
    if (fs.existsSync(file)) return parseDevflowConfig(fs.readFileSync(file, 'utf8'));
  } catch { /* fallthrough */ }
  return buildDefaultConfig();
}

export function updateServerAttrs(file, patch = {}) {
  ensureConfigFile(file);
  let xml = fs.readFileSync(file, 'utf8');
  const m = xml.match(/<server\b([^>]*?)\s*\/?>/i);
  const cur = m ? m[1] : '';
  const language = patch.language != null
    ? normalizeLocale(patch.language)
    : normalizeLocale(decode(attr(cur, 'language')) || DEFAULT_LOCALE);
  const host = patch.host != null
    ? (String(patch.host).trim() || '127.0.0.1')
    : (decode(attr(cur, 'host')) || '127.0.0.1');
  const tag = `<server language="${language}" host="${escXml(host)}" />`;
  if (m) xml = xml.slice(0, m.index) + tag + xml.slice(m.index + m[0].length);
  else xml = xml.replace(/<devflow(\s*)>/i, `<devflow$1>\n  ${tag}`);
  fs.writeFileSync(file, xml, 'utf8');
  return { language, host };
}

// 校验一份工作流定义（workflow → stages → prompts）
export function validateWorkflows(workflows) {
  if (!Array.isArray(workflows)) throw new Error('workflows must be an array');
  return workflows.map((w, wi) => {
    const id = String(w && w.id || `wf-${wi}`).trim();
    const label = String(w && (w.label || w.id) || id).trim();
    const stages = Array.isArray(w && w.stages) ? w.stages : [];
    return {
      id: id || `wf-${wi}`,
      label: label || id || `wf-${wi}`,
      stages: stages.map((s, si) => {
        const sid = String(s && s.id || `st-${si}`).trim();
        return {
          id: sid || `st-${si}`,
          label: String(s && (s.label || s.id) || sid || `st-${si}`).trim(),
          group: String(s && s.group || '').trim(),
          prompts: (Array.isArray(s && s.prompts) ? s.prompts : []).map((p) => String(p)).filter((p) => p.trim() !== ''),
        };
      }),
    };
  });
}

// 用新的 workflows 覆盖 config 的 <workflows> 段（保留 server/agents）
export function updateWorkflows(file, workflows) {
  const list = validateWorkflows(workflows);
  const cur = loadDevflowConfig(file);
  fs.writeFileSync(file, serializeDevflowConfig({ server: cur.server, agents: cur.agents, workflows: list }), 'utf8');
  updateSeed(file, list);
  return list;
}
