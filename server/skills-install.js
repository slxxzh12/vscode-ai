// 默认 skills 安装：把项目 <目录>/.void/skills 下的技能装到各 agent 的默认 skills 目录。
// 规则：只补缺失（目标缺少 <group>/<skill> 目录），已存在一律不覆盖；保留分组目录结构。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { opencodeConfigDir } from './llm-config.js';

// 各 agent 的 skills 目录：toolDir 用于判断工具是否装在本机，skillsDir 为实际安装目标
export function skillTargets() {
  return [
    {
      id: 'opencode',
      label: 'opencode',
      toolDir: opencodeConfigDir(),
      dir: path.join(opencodeConfigDir(), 'skills'),
    },
    {
      id: 'claudecode',
      label: 'Claude Code',
      toolDir: path.join(os.homedir(), '.claude'),
      dir: path.join(os.homedir(), '.claude', 'skills'),
    },
  ];
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

export function detectSkillTargets(targets = skillTargets()) {
  return targets
    .map((t) => ({
      id: t.id,
      label: t.label,
      dir: t.dir,
      exists: isDir(t.dir),
      detected: isDir(t.toolDir) || isDir(t.dir),
    }))
    .filter((t) => t.detected);
}

// 递归收集 <root>/<group>/<skill>/SKILL.md；支持任意深度分组，只认含 SKILL.md 的目录
export function listSkills(root) {
  const out = [];
  if (!root || !isDir(root)) return out;
  const walk = (abs, parts) => {
    let entries = [];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      out.push({ id: parts.join('/'), group: parts.slice(0, -1).join('/'), name: parts[parts.length - 1], dir: abs });
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      walk(path.join(abs, e.name), [...parts, e.name]);
    }
  };
  walk(root, []);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// 多个来源目录合并（如会话 cwd 与服务启动目录），同 id 先出现者优先
export function readVoidSkills(dirs = []) {
  const out = [];
  const seen = new Set();
  for (const dir of Array.isArray(dirs) ? dirs : []) {
    if (!dir) continue;
    for (const s of listSkills(dir)) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
  }
  return out;
}

export function missingSkills(targetDir, skills = []) {
  return skills.filter((s) => !isDir(path.join(targetDir, s.id)));
}

// 检测状态记录：<baseDir>/.void/skills-checked.json（本机运行状态，不入库）
export function skillsStateFile(baseDir) {
  return baseDir ? path.join(baseDir, '.void', 'skills-checked.json') : '';
}

export function readSkillsChecked(baseDir) {
  const file = skillsStateFile(baseDir);
  if (!file) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

export function markSkillsChecked(baseDir, info = {}) {
  const file = skillsStateFile(baseDir);
  if (!file) return null;
  const data = { checkedAt: Date.now(), ...info };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return data;
  } catch {
    return null;
  }
}

export function skillsStatus({ sourceDirs = [], targets = null } = {}) {
  const skills = readVoidSkills(sourceDirs);
  const detected = detectSkillTargets(targets || undefined).map((t) => {
    const missing = missingSkills(t.dir, skills).map((s) => s.id);
    return { ...t, total: skills.length, missing };
  });
  return {
    skills: skills.map((s) => s.id),
    targets: detected,
    missing: detected.reduce((n, t) => n + t.missing.length, 0),
  };
}

function copyTree(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: true });
}

export function installSkills({ sourceDirs = [], targetIds = null, targets = null, logger = null } = {}) {
  const skills = readVoidSkills(sourceDirs);
  const want = Array.isArray(targetIds) && targetIds.length ? new Set(targetIds) : null;
  const results = [];
  for (const t of detectSkillTargets(targets || undefined)) {
    if (want && !want.has(t.id)) continue;
    const missing = missingSkills(t.dir, skills);
    const installed = [];
    const skipped = [];
    const errors = [];
    for (const s of missing) {
      const to = path.join(t.dir, s.id);
      if (isDir(to)) { skipped.push(s.id); continue; }
      try {
        fs.mkdirSync(t.dir, { recursive: true });
        copyTree(s.dir, to);
        installed.push(s.id);
      } catch (e) {
        const msg = String((e && e.message) || e);
        errors.push({ id: s.id, error: msg });
        logger?.warn?.('skill install failed', t.id, s.id, msg);
      }
    }
    results.push({ id: t.id, label: t.label, dir: t.dir, total: skills.length, installed, skipped, errors });
  }
  return {
    skills: skills.length,
    installed: results.reduce((n, r) => n + r.installed.length, 0),
    targets: results,
  };
}
