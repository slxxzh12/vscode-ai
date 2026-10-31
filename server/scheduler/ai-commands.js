import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function defaultConfigRoot() {
  return process.env.DEVFLOW_OPENCODE_CONFIG || path.join(os.homedir(), '.config', 'opencode');
}
// opencode 配置是 jsonc（允许注释），这里做最小化去注释后再解析
function stripJsonc(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function readOpencodeConfig(configRoot) {
  for (const name of ['opencode.json', 'opencode.jsonc']) {
    try { return { name, text: fs.readFileSync(path.join(configRoot, name), 'utf8') }; } catch { /* next */ }
  }
  return null;
}
// 命令既可来自 command/*.md，也可定义在 opencode.json(c) 的 "command" 块中
function listConfigCommands(configRoot) {
  const cfg = readOpencodeConfig(configRoot);
  if (!cfg) return [];
  let json;
  try { json = JSON.parse(cfg.text); } catch { try { json = JSON.parse(stripJsonc(cfg.text)); } catch { return []; } }
  const cmds = json && json.command;
  if (!cmds || typeof cmds !== 'object') return [];
  return Object.entries(cmds).map(([name, v]) => ({
    name,
    path: path.join(configRoot, cfg.name),
    preview: String((v && v.description) || '').slice(0, 200),
  }));
}
function assertSafeRel(name) {
  if (!name || typeof name !== 'string') throw new Error('bad name');
  if (name.includes('..') || name.startsWith('/') || name.includes('\\')) throw new Error('unsafe name');
}
export function listAiCommands({ configRoot = defaultConfigRoot() } = {}) {
  const out = listConfigCommands(configRoot);
  const seen = new Set(out.map((c) => c.name));
  const dir = path.join(configRoot, 'command');
  if (fs.existsSync(dir)) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith('.md') || seen.has(e.name)) continue;
      const full = path.join(dir, e.name);
      let preview = '';
      try { preview = fs.readFileSync(full, 'utf8').replace(/^---[\s\S]*?---/, '').trim().slice(0, 200); } catch { /* ignore */ }
      out.push({ name: e.name, path: full, preview });
      seen.add(e.name);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
export function readAiCommand(name, { configRoot = defaultConfigRoot() } = {}) {
  assertSafeRel(name);
  return fs.readFileSync(path.join(configRoot, 'command', name), 'utf8');
}
