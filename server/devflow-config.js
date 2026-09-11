import fs from 'node:fs';
import path from 'node:path';
import { normalizeLocale, DEFAULT_LOCALE } from '@devflow/shared/i18n';
import { parseWorkflowXml, fallbackWorkflows } from './workflow-xml.js';

export const DEFAULT_PORT = 22222;
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
function decode(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function validPort(n) {
  const p = Number(n);
  return Number.isInteger(p) && p >= 1 && p <= 65535 ? p : null;
}

export function buildDefaultConfig() {
  return {
    server: { port: DEFAULT_PORT, language: DEFAULT_LOCALE },
    agents: { default: DEFAULT_AGENT, list: DEFAULT_AGENTS.map((a) => ({ ...a })) },
    workflows: fallbackWorkflows(),
  };
}

export function parseDevflowConfig(xml) {
  const defaults = buildDefaultConfig();
  const text = String(xml || '');

  const serverTag = (text.match(/<server\b([^>]*?)\/?>/i) || [])[1] || '';
  const port = validPort(attr(serverTag, 'port')) || defaults.server.port;
  const language = normalizeLocale(decode(attr(serverTag, 'language')) || defaults.server.language);

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
    server: { port, language },
    agents: { default: defAgent, list },
    workflows: workflows.length ? workflows : fallbackWorkflows(),
  };
}

function serializeWorkflow(w) {
  const stages = (w.stages || []).map((s) => {
    const group = s.group ? ` group="${escXml(s.group)}"` : '';
    const prompts = (s.prompts || []).map((p) => `      <prompt>${escXml(p)}</prompt>`).join('\n');
    return `    <stage id="${escXml(s.id)}" label="${escXml(s.label)}"${group}>\n${prompts}\n    </stage>`;
  }).join('\n');
  return `  <workflow id="${escXml(w.id)}" label="${escXml(w.label)}">\n${stages}\n  </workflow>`;
}

export function serializeDevflowConfig(cfg) {
  const agents = cfg.agents.list
    .map((a) => `    <agent id="${escXml(a.id)}" name="${escXml(a.name)}" cmd="${escXml(a.cmd)}" />`)
    .join('\n');
  const wfs = cfg.workflows.map(serializeWorkflow).join('\n\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- DevFlow 统一配置：server（端口/语言）+ agents（默认 Agent 列表）+ workflows（工作流/提示语） -->
<devflow>
  <server port="${cfg.server.port}" language="${escXml(cfg.server.language)}" />

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
  const port = patch.port != null ? (validPort(patch.port) || DEFAULT_PORT) : (validPort(attr(cur, 'port')) || DEFAULT_PORT);
  const language = patch.language != null
    ? normalizeLocale(patch.language)
    : normalizeLocale(decode(attr(cur, 'language')) || DEFAULT_LOCALE);
  const tag = `<server port="${port}" language="${language}" />`;
  if (m) xml = xml.slice(0, m.index) + tag + xml.slice(m.index + m[0].length);
  else xml = xml.replace(/<devflow(\s*)>/i, `<devflow$1>\n  ${tag}`);
  fs.writeFileSync(file, xml, 'utf8');
  return { port, language };
}
