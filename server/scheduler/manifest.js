import fs from 'node:fs';
import path from 'node:path';

export const MANIFEST_NAME = 'void_manifest.json';
export const MANIFEST_FORMAT = 'void_manifest';
export const MANIFEST_VERSION = 1;
export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-portable', '.venv', 'venv']);

function manifestError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

export function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// 绝对路径 → 相对 baseDir 的正斜杠路径；无法相对化（跨盘符/空）则保留原绝对路径
export function toRel(p, baseDir) {
  if (!p || typeof p !== 'string') return null;
  if (!path.isAbsolute(p)) return p.split(path.sep).join('/');
  const rel = path.relative(baseDir, p);
  if (!rel || path.isAbsolute(rel)) return p;
  return rel.split(path.sep).join('/');
}

// 相对路径 → 相对 baseDir 的绝对路径；已是绝对则原样返回
export function toAbs(p, baseDir) {
  if (!p || typeof p !== 'string') return null;
  return path.isAbsolute(p) ? p : path.resolve(baseDir, p);
}

// 任务所属目录：显式 cwd 优先，否则落到调度器 manifests/<id>
export function manifestDirOf(task, manifestRoot) {
  if (!task) return null;
  return task.cwd ? path.resolve(task.cwd) : path.join(manifestRoot, task.id);
}

function pickRuntime(runtime) {
  if (!runtime) return { nextRunAt: null, lastRun: null };
  const lr = runtime.lastRun || null;
  return {
    nextRunAt: runtime.nextRunAt ?? null,
    lastRun: lr ? {
      startedAt: lr.startedAt ?? null,
      status: lr.status ?? null,
      exitCode: lr.exitCode ?? null,
      durationMs: lr.durationMs ?? null,
    } : null,
  };
}

export function toManifest(task, dir, runtime = null) {
  const m = {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    name: task.name,
    type: task.type,
    enabled: task.enabled !== false,
    once: !!task.once,
    deleteAfter: Number(task.deleteAfter) > 0 ? Number(task.deleteAfter) : null,
    schedule: task.schedule,
  };
  if (task.type === 'shell') m.command = task.command;
  if (task.type === 'ai') {
    m.ai = { ...(task.ai || {}) };
    if (task.filePath) m.filePath = toRel(task.filePath, dir);
  }
  m.runtime = pickRuntime(runtime);
  return m;
}

export function fromManifest(obj, dir) {
  if (!obj || typeof obj !== 'object') throw manifestError('bad-manifest');
  if (obj.format !== MANIFEST_FORMAT) throw manifestError('bad-format');
  if (Number(obj.version) !== MANIFEST_VERSION) throw manifestError('bad-version');
  const task = {
    name: String(obj.name || '').trim(),
    enabled: obj.enabled !== false,
    once: !!obj.once,
    deleteAfter: Number(obj.deleteAfter) > 0 ? Number(obj.deleteAfter) : null,
    type: obj.type,
    schedule: obj.schedule,
    cwd: dir,
  };
  if (obj.type === 'shell') task.command = obj.command;
  if (obj.type === 'ai') {
    task.ai = { ...(obj.ai || {}) };
    if (obj.filePath) task.filePath = toAbs(obj.filePath, dir);
  }
  return task;
}

export function writeManifest(dir, task, runtime = null) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, MANIFEST_NAME);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(toManifest(task, dir, runtime), null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function removeManifest(dir) {
  try { fs.rmSync(path.join(dir, MANIFEST_NAME), { force: true }); } catch { /* ignore */ }
}

export function scanManifests(root, { skipDirs = SKIP_DIRS } = {}) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) walk(path.join(dir, e.name));
      } else if (e.isFile() && e.name === MANIFEST_NAME) {
        found.push(path.join(dir, e.name));
      }
    }
  };
  walk(path.resolve(root));
  return found;
}
