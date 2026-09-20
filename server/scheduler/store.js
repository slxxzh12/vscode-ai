import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { manifestDirOf, writeManifest, removeManifest, scanManifests, fromManifest, isDir } from './manifest.js';

const TYPES = new Set(['shell', 'ai', 'script']);
const UNITS = new Set(['second', 'minute', 'hour', 'day']);
const WEEKDAYS = new Set([1, 2, 3, 4, 5, 6, 7]);
const DEFAULT_RUN_LIMIT = 500;

function atomicWriteJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
function readJson(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* ignore */ }
  return fallback;
}
// 记录绝对路径（相对路径按 cwd / 进程 cwd 解析）
function toAbs(p, cwd) {
  if (!p || typeof p !== 'string') return null;
  return path.isAbsolute(p) ? p : path.resolve(cwd || process.cwd(), p);
}

export function validateTask(input) {
  const t = input || {};
  if (!t.name || typeof t.name !== 'string') return { error: 'name required' };
  if (!TYPES.has(t.type)) return { error: 'type must be shell|ai|script' };
  if (t.type === 'shell' && typeof t.command !== 'string') return { error: 'command required' };
  if (t.type === 'ai') {
    const ai = t.ai || {};
    if (ai.source !== 'command' && ai.source !== 'prompt' && ai.source !== 'file') return { error: 'ai.source must be command|prompt|file' };
    if (ai.source === 'command' && !ai.commandName) return { error: 'ai.commandName required' };
    if (ai.source === 'prompt' && typeof ai.prompt !== 'string') return { error: 'ai.prompt required' };
    if (ai.source === 'file' && !t.filePath) return { error: 'ai.filePath required' };
  }
  if (t.type === 'script') {
    const s = t.script || {};
    if (!s.path || typeof s.path !== 'string') return { error: 'script.path required' };
  }
  const sc = t.schedule || {};
  if (sc.mode !== 'interval' && sc.mode !== 'daily') return { error: 'schedule.mode must be interval|daily' };
  if (sc.mode === 'interval') {
    const iv = sc.interval || {};
    if (!(Number(iv.every) > 0)) return { error: 'interval.every must be > 0' };
    if (!UNITS.has(iv.unit)) return { error: 'interval.unit invalid' };
  } else {
    const d = sc.daily || {};
    if (!/^\d{2}:\d{2}$/.test(d.at || '')) return { error: 'daily.at must be HH:MM' };
    const wd = d.weekdays || [];
    if (!Array.isArray(wd) || wd.some((w) => !WEEKDAYS.has(w))) return { error: 'daily.weekdays invalid' };
  }
  return { ok: true };
}

export class SchedulerStore {
  constructor({ dir, logger = console, runLimit = DEFAULT_RUN_LIMIT, manifestRoot = path.join(dir, 'manifests') }) {
    this.dir = dir;
    this.log = logger;
    this.runLimit = runLimit;
    this.manifestRoot = manifestRoot;
    this.runtimeProvider = null;
    this.tasksFile = path.join(dir, 'tasks.json');
    this.runsFile = path.join(dir, 'runs.json');
    this.logsDir = path.join(dir, 'logs');
    const tasks = readJson(this.tasksFile, []);
    const runs = readJson(this.runsFile, []);
    this.tasks = Array.isArray(tasks) ? tasks : [];
    this.runs = Array.isArray(runs) ? runs : [];
  }
  setRuntimeProvider(fn) { this.runtimeProvider = fn; }
  saveTasks() { atomicWriteJson(this.tasksFile, this.tasks); }
  saveRuns() { atomicWriteJson(this.runsFile, this.runs); }
  _key(p) {
    const r = path.resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  }
  _dirOf(task) { return path.resolve(manifestDirOf(task, this.manifestRoot)); }
  _sameDir(a, b) { return this._key(this._dirOf(a)) === this._key(this._dirOf(b)); }
  _dirConflict(task) {
    return this.tasks.some((t) => t.id !== task.id && this._key(this._dirOf(t)) === this._key(this._dirOf(task)));
  }
  _cwdMissing(task) { return !!(task.cwd && !isDir(task.cwd)); }
  _buildTask(input, base = {}) {
    const now = Date.now();
    return {
      id: base.id || 't_' + crypto.randomBytes(4).toString('hex'),
      name: String(input.name).trim(),
      enabled: input.enabled !== false,
      projectId: input.projectId || null,
      cwd: input.cwd || null,
      filePath: toAbs(input.filePath, input.cwd),
      type: input.type,
      command: input.type === 'shell' ? input.command : undefined,
      ai: input.type === 'ai' ? { ...input.ai } : undefined,
      script: input.type === 'script' ? { ...input.script, path: toAbs(input.script.path, input.cwd) } : undefined,
      schedule: { ...input.schedule },
      createdAt: base.createdAt || now,
      updatedAt: now,
    };
  }
  _syncManifest(task) {
    try {
      const runtime = this.runtimeProvider ? this.runtimeProvider(task.id) : null;
      writeManifest(this._dirOf(task), task, runtime);
    } catch (e) { this.log?.error?.('scheduler manifest write failed', e); }
  }
  _removeManifest(task) {
    const dir = this._dirOf(task);
    removeManifest(dir);
    if (!task.cwd) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
  }
  syncManifest(id) { const t = this.getTask(id); if (t) this._syncManifest(t); }
  importManifestDir(root) {
    const summary = { imported: 0, overwritten: 0, failed: [] };
    for (const file of scanManifests(root)) {
      const dir = path.dirname(file);
      let input;
      try {
        input = fromManifest(JSON.parse(fs.readFileSync(file, 'utf8')), dir);
      } catch (e) {
        summary.failed.push({ path: file, error: String(e && e.code || e && e.message || e) });
        continue;
      }
      const existing = this.tasks.find((t) => this._key(this._dirOf(t)) === this._key(dir));
      const r = existing ? this.replaceTask(existing.id, input) : this.createTask(input);
      if (r.error) { summary.failed.push({ path: file, error: r.error }); continue; }
      if (existing) summary.overwritten += 1; else summary.imported += 1;
    }
    return summary;
  }
  listTasks() { return this.tasks.map((t) => ({ ...t })); }
  getTask(id) { const t = this.tasks.find((x) => x.id === id); return t ? { ...t } : null; }
  createTask(input) {
    const v = validateTask(input);
    if (v.error) return { error: v.error };
    const task = this._buildTask(input);
    if (this._cwdMissing(task)) return { error: 'cwd-missing' };
    if (this._dirConflict(task)) return { error: 'dir-taken' };
    this.tasks.push(task);
    this.saveTasks();
    this._syncManifest(task);
    return { task: { ...task } };
  }
  updateTask(id, patch) {
    const i = this.tasks.findIndex((x) => x.id === id);
    if (i < 0) return { error: 'not-found' };
    const prev = this.tasks[i];
    const merged = { ...prev, ...patch, id, createdAt: prev.createdAt, updatedAt: Date.now() };
    merged.filePath = toAbs(merged.filePath, merged.cwd);
    if (merged.type === 'script' && merged.script) merged.script = { ...merged.script, path: toAbs(merged.script.path, merged.cwd) };
    const v = validateTask(merged);
    if (v.error) return { error: v.error };
    if (this._cwdMissing(merged)) return { error: 'cwd-missing' };
    if (this._dirConflict(merged)) return { error: 'dir-taken' };
    const moved = !this._sameDir(prev, merged);
    this.tasks[i] = merged;
    this.saveTasks();
    if (moved) this._removeManifest(prev);
    this._syncManifest(merged);
    return { task: { ...merged } };
  }
  replaceTask(id, input) {
    const i = this.tasks.findIndex((x) => x.id === id);
    if (i < 0) return { error: 'not-found' };
    const v = validateTask(input);
    if (v.error) return { error: v.error };
    const prev = this.tasks[i];
    const task = this._buildTask(input, { id, createdAt: prev.createdAt });
    if (this._cwdMissing(task)) return { error: 'cwd-missing' };
    const moved = !this._sameDir(prev, task);
    this.tasks[i] = task;
    this.saveTasks();
    if (moved) this._removeManifest(prev);
    this._syncManifest(task);
    return { task: { ...task } };
  }
  deleteTask(id) {
    const i = this.tasks.findIndex((x) => x.id === id);
    if (i < 0) return { error: 'not-found' };
    const [task] = this.tasks.splice(i, 1);
    this.saveTasks();
    this._removeManifest(task);
    const removed = this.runs.filter((r) => r.taskId === id);
    this.runs = this.runs.filter((r) => r.taskId !== id);
    this.saveRuns();
    for (const r of removed) { try { fs.rmSync(this.logPath(r.logFile), { force: true }); } catch { /* ignore */ } }
    try { fs.rmSync(path.join(this.logsDir, id), { recursive: true, force: true }); } catch { /* ignore */ }
    return { ok: true };
  }
  logFileFor(taskId, runId) { return path.join(taskId, runId + '.log'); }
  logPath(rel) { return path.join(this.logsDir, rel); }
  addRun(run) {
    this.runs.unshift(run);
    const overflow = this.runs.splice(this.runLimit);
    for (const r of overflow) { try { fs.rmSync(this.logPath(r.logFile), { force: true }); } catch { /* ignore */ } }
    this.saveRuns();
    return run;
  }
  listRuns({ taskId = null, limit = 50 } = {}) {
    const arr = taskId ? this.runs.filter((r) => r.taskId === taskId) : this.runs.slice();
    return arr.slice(0, Math.max(1, Math.min(500, limit | 0 || 50)));
  }
  getRun(id) { return this.runs.find((r) => r.id === id) || null; }
  updateRun(id, patch) {
    const r = this.runs.find((x) => x.id === id);
    if (!r) return null;
    Object.assign(r, patch);
    this.saveRuns();
    return r;
  }
}
