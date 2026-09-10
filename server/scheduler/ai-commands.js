import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function defaultConfigRoot() {
  return process.env.DEVFLOW_OPENCODE_CONFIG || path.join(os.homedir(), '.config', 'opencode');
}
function assertSafeRel(name) {
  if (!name || typeof name !== 'string') throw new Error('bad name');
  if (name.includes('..') || name.startsWith('/') || name.includes('\\')) throw new Error('unsafe name');
}
export function listAiCommands({ configRoot = defaultConfigRoot() } = {}) {
  const dir = path.join(configRoot, 'command');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const full = path.join(dir, e.name);
    let preview = '';
    try { preview = fs.readFileSync(full, 'utf8').replace(/^---[\s\S]*?---/, '').trim().slice(0, 200); } catch { /* ignore */ }
    out.push({ name: e.name, path: full, preview });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
export function readAiCommand(name, { configRoot = defaultConfigRoot() } = {}) {
  assertSafeRel(name);
  return fs.readFileSync(path.join(configRoot, 'command', name), 'utf8');
}
