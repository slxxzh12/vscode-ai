// remote_coder 目录的文件层：messages.jsonc 收发、screen.png 覆盖写、git 提交。
// 只做文件与 git，不认识 HTTP；git 可注入以便单测。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const REMOTE_DIR = 'remote_coder';
export const SCREEN_FILE = 'screen.png';
export const MESSAGES_FILE = 'messages.jsonc';
const PNG_PREFIX = 'data:image/png;base64,';
const MAX_TEXT_BYTES = 32 * 1024;

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

export function dirOf(root) {
  return path.join(root, REMOTE_DIR);
}

export function decodePng(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_PREFIX)) {
    throw err('bad-image', 'expected data:image/png;base64 URL');
  }
  const buf = Buffer.from(dataUrl.slice(PNG_PREFIX.length), 'base64');
  if (!buf.length) throw err('bad-image', 'empty image');
  return buf;
}

// JSONC：仅支持整行 `//` 注释（机器写出的就是纯 JSON）
export function parseJsonc(text) {
  return JSON.parse(String(text || '').replace(/^[ \t]*\/\/.*$/gm, ''));
}

export function readMessages(dir) {
  const file = path.join(dir, MESSAGES_FILE);
  if (!fs.existsSync(file)) return [];
  let parsed;
  try {
    parsed = parseJsonc(fs.readFileSync(file, 'utf8'));
  } catch {
    throw err('bad-jsonc', 'messages.jsonc is not valid jsonc');
  }
  if (!Array.isArray(parsed)) throw err('bad-jsonc', 'messages.jsonc must be an array');
  return parsed;
}

export function writeMessages(dir, list) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, MESSAGES_FILE);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

const ID_PREFIX = { screenshot: 'c', deliver: 'd' };
const KINDS = new Set(['screenshot', 'deliver', 'message']);

export function newId(kind, now = Date.now(), rand = Math.random) {
  const prefix = ID_PREFIX[kind] || 'm';
  const suffix = Math.floor(rand() * 0x10000).toString(16).padStart(4, '0');
  return `${prefix}-${now}-${suffix}`;
}

export function makeEntry(input, now = Date.now(), rand = Math.random) {
  const raw = input && input.kind;
  const kind = KINDS.has(raw) ? raw : 'message';
  const text = kind === 'message' ? String((input && input.text) ?? '').trim() : '';
  if (kind === 'message' && !text) throw err('bad-message', 'text is required');
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw err('too-large', 'text too large');
  const entry = { id: newId(kind, now, rand), ts: now, kind, handled: false };
  if (text) entry.text = text;
  return entry;
}

export function appendMessage(dir, entry) {
  const list = readMessages(dir);
  list.push(entry);
  writeMessages(dir, list);
  return entry;
}

export function inbox(dir) {
  return readMessages(dir).filter((m) => m && m.handled !== true);
}

export function markHandled(dir, ids) {
  const set = new Set((Array.isArray(ids) ? ids : []).map(String));
  if (!set.size) return 0;
  const list = readMessages(dir);
  let changed = 0;
  for (const m of list) {
    if (m && set.has(String(m.id)) && m.handled !== true) { m.handled = true; changed += 1; }
  }
  if (changed) writeMessages(dir, list);
  return changed;
}

export function screenRev(dir) {
  try {
    const st = fs.statSync(path.join(dir, SCREEN_FILE));
    return `${st.mtimeMs}-${st.size}`;
  } catch {
    return '';
  }
}

export function saveScreen(dir, dataUrl) {
  const buf = decodePng(dataUrl);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, SCREEN_FILE), buf);
  return { bytes: buf.length, rev: screenRev(dir) };
}

export function isGitRepo(root) {
  return fs.existsSync(path.join(root, '.git'));
}

function defaultGit(repo, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120 * 1000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') { reject(err('git-unavailable', 'git not found in PATH')); return; }
        reject(err('git-failed', String(stderr || error.message).trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function commitScreen(root, { git = defaultGit, isGitRepoFn = isGitRepo } = {}) {
  const rel = `${REMOTE_DIR}/${SCREEN_FILE}`;
  if (!isGitRepoFn(root)) return { uploaded: false, reason: 'not-a-repo' };
  try {
    await git(root, ['add', '--', rel]);
    await git(root, ['commit', '-m', `snapshot(remote): ${SCREEN_FILE}`, '--', rel]);
    await git(root, ['push', 'origin', 'HEAD']);
    return { uploaded: true, reason: '' };
  } catch (e) {
    return { uploaded: false, reason: e && e.code === 'git-unavailable' ? 'git-unavailable' : 'git-failed' };
  }
}

// ---- 软件交付产物：固定目录 <应用目录>/dist-portable/，只读普通文件 ----
export const ARTIFACTS_DIR = 'dist-portable';

export function artifactsDir(root) {
  return path.join(root, ARTIFACTS_DIR);
}

export function listArtifacts(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const items = [];
  for (const name of names) {
    let st;
    try { st = fs.statSync(path.join(dir, name)); } catch { continue; }
    if (!st.isFile()) continue;
    items.push({ name, size: st.size, mtime: st.mtimeMs });
  }
  items.sort((a, b) => b.mtime - a.mtime);
  return items;
}

export function resolveArtifact(dir, name) {
  const raw = String(name ?? '');
  if (!raw || raw !== path.basename(raw) || /[\\/]/.test(raw)) throw err('bad-name', 'invalid artifact name');
  const base = path.resolve(dir);
  const abs = path.resolve(base, raw);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw err('bad-name', 'artifact escapes directory');
  let st;
  try { st = fs.statSync(abs); } catch { throw err('not-found', 'artifact not found'); }
  if (!st.isFile()) throw err('not-found', 'artifact not found');
  return abs;
}
