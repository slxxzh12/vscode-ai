import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

export function validateTask(input) {
  const t = input || {};
  if (!t.name || typeof t.name !== 'string') return { error: 'name required' };
  if (!TYPES.has(t.type)) return { error: 'type must be shell|ai|script' };
  if (t.type === 'shell' && typeof t.command !== 'string') return { error: 'command required' };
  if (t.type === 'ai') {
    const ai = t.ai || {};
    if (ai.source !== 'command' && ai.source !== 'prompt') return { error: 'ai.source must be command|prompt' };
    if (ai.source === 'command' && !ai.commandName) return { error: 'ai.commandName required' };
    if (ai.source === 'prompt' && typeof ai.prompt !== 'string') return { error: 'ai.prompt required' };
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
  constructor({ dir, logger = console, runLimit = DEFAULT_RUN_LIMIT }) {
    this.dir = dir;
    this.log = logger;
    this.runLimit = runLimit;
    this.tasksFile = path.join(dir, 'tasks.json');
    this.runsFile = path.join(dir, 'runs.json');
    this.logsDir = path.join(dir, 'logs');
    const tasks = readJson(this.tasksFile, []);
    const runs = readJson(this.runsFile, []);
    this.tasks = Array.isArray(tasks) ? tasks : [];
    this.runs = Array.isArray(runs) ? runs : [];
  }
  saveTasks() { atomicWriteJson(this.tasksFile, this.tasks); }
  saveRuns() { atomicWriteJson(this.runsFile, this.runs); }
  listTasks() { return this.tasks.map((t) => ({ ...t })); }
  getTask(id) { const t = this.tasks.find((x) => x.id === id); return t ? { ...t } : null; }
  createTask(input) {
    const v = validateTask(input);
    if (v.error) return { error: v.error };
    const now = Date.now();
    const task = {
      id: 't_' + crypto.randomBytes(4).toString('hex'),
      name: String(input.name).trim(),
      enabled: input.enabled !== false,
      projectId: input.projectId || null,
      cwd: input.cwd || null,
      type: input.type,
      command: input.type === 'shell' ? input.command : undefined,
      ai: input.type === 'ai' ? { ...input.ai } : undefined,
      script: input.type === 'script' ? { ...input.script } : undefined,
      schedule: { ...input.schedule },
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.push(task);
    this.saveTasks();
    return { task: { ...task } };
  }
  updateTask(id, patch) {
    const i = this.tasks.findIndex((x) => x.id === id);
    if (i < 0) return { error: 'not-found' };
    const merged = { ...this.tasks[i], ...patch, id, createdAt: this.tasks[i].createdAt, updatedAt: Date.now() };
    const v = validateTask(merged);
    if (v.error) return { error: v.error };
    this.tasks[i] = merged;
    this.saveTasks();
    return { task: { ...merged } };
  }
  deleteTask(id) {
    const i = this.tasks.findIndex((x) => x.id === id);
    if (i < 0) return { error: 'not-found' };
    this.tasks.splice(i, 1);
    this.saveTasks();
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
