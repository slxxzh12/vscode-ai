import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { opencodeConfigDir } from '../llm-config.js';

// Pi 的 agent 目录：默认 ~/.pi/agent（PI_CODING_AGENT_DIR 可覆盖）
function piAgentDir() {
  const custom = String(process.env.PI_CODING_AGENT_DIR || '').trim();
  return custom ? path.resolve(custom) : path.join(os.homedir(), '.pi', 'agent');
}

// agent 的 skills 目录：内置映射（opencode/claudecode/pi）+ skillsDir 配置覆盖；无法确定返回 null（不可选）
export function agentSkillsDir(agent) {
  const id = String(agent?.id || '').toLowerCase();
  const cmd = path.basename(String(agent?.cmd || '')).toLowerCase().replace(/\.(cmd|exe|bat|ps1)$/, '');
  if (id === 'opencode' || cmd === 'opencode') {
    return process.env.DEVFLOW_COLLAB_SKILLS || path.join(opencodeConfigDir(), 'skills');
  }
  if (id === 'claudecode' || cmd === 'claudecode') {
    return path.join(os.homedir(), '.claude', 'skills');
  }
  if (id === 'pi' || cmd === 'pi' || String(agent?.resume || '').toLowerCase() === 'pi') {
    return path.join(piAgentDir(), 'skills');
  }
  const custom = agent?.skillsDir && String(agent.skillsDir).trim();
  return custom ? path.resolve(custom) : null;
}

// 供 UI 展示的 agent 选项（含目录是否存在、是否可选）
export function listAgentOptions({ agents = [], selected = null } = {}) {
  return agents.map((a) => {
    const skillsDir = agentSkillsDir(a);
    return {
      id: a.id,
      name: a.name || a.id,
      cmd: a.cmd || '',
      skillsDir,
      exists: !!(skillsDir && fs.existsSync(skillsDir)),
      selectable: !!skillsDir,
      selected: a.id === selected,
    };
  });
}

// 由选择解析实际 skills 根：custom → 手填；agent → 映射；否则兜底默认根
export function resolveSkillRoot({ selected, customRoot, agents = [], defaultSkillsRoot = null } = {}) {
  if (selected === 'custom') {
    const r = customRoot && String(customRoot).trim();
    return r ? path.resolve(r) : defaultSkillsRoot;
  }
  const agent = agents.find((a) => a.id === selected);
  const dir = agent ? agentSkillsDir(agent) : null;
  return dir || defaultSkillsRoot;
}
