import fs from 'node:fs';
import path from 'node:path';
import { createJsonStore } from './json-store.js';

// 会话账本 + 终端回滚落盘。一个端口一份：sessions.json + session-logs/<id>.log。
// 存储上限（保留 kind/agentId/agentCmd/agentSessionId 供按原 agent 恢复）；UI 另按 30 个展示，
// 见 web/src/sessionTree.ts 的 MAX_SESSION_NODES。
export const MAX_SESSIONS = 500;
export const MAX_LOG_BYTES = 512 * 1024;
export const KINDS = ['agent', 'shell', 'workflow'];   // workflow 仅用于识别并跳过恢复

const str = (v) => (typeof v === 'string' ? v : '');

export function normalizeLedger(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const list = Array.isArray(src.sessions) ? src.sessions : [];
  const out = [];
  for (const it of list) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
    const id = str(it.id);
    const cwd = str(it.cwd);
    if (!id || !cwd) continue;
    out.push({
      id,
      name: str(it.name) || id,
      projectId: str(it.projectId) || null,
      cwd,
      kind: KINDS.includes(it.kind) ? it.kind : 'shell',
      agentId: str(it.agentId) || null,
      agentCmd: str(it.agentCmd) || null,
      agentSessionId: str(it.agentSessionId) || null,
      cols: Number.isInteger(it.cols) && it.cols > 0 ? it.cols : 80,
      rows: Number.isInteger(it.rows) && it.rows > 0 ? it.rows : 24,
      createdAt: Number.isFinite(it.createdAt) ? it.createdAt : 0,
      updatedAt: Number.isFinite(it.updatedAt) ? it.updatedAt : 0,
      state: it.state === 'exited' ? 'exited' : 'running',
    });
  }
  out.sort((a, b) => (b.updatedAt - a.updatedAt) || (b.createdAt - a.createdAt));
  return { sessions: out.slice(0, MAX_SESSIONS) };
}

// 会话账本按项目分片存储：读时合并各项目目录 + _global 的 sessions.json，写时按 projectId 拆分写回，并清理已空分片。
function createShardedSessionsStore({ dirs = () => [], dirFor = (projectId) => '', logger = console } = {}) {
  const writeJson = (f, obj) => {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, f);
  };
  const loadAll = () => {
    const sessions = [];
    for (const dir of new Set(dirs())) {
      const f = path.join(dir, 'sessions.json');
      if (!fs.existsSync(f)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (Array.isArray(parsed && parsed.sessions)) sessions.push(...parsed.sessions);
      } catch (e) { logger?.warn?.('sessions load failed', f, (e && e.message) || e); }
    }
    return normalizeLedger({ sessions });
  };
  let data = loadAll();
  const save = () => {
    const buckets = new Map();
    for (const s of data.sessions) {
      const key = s.projectId || '';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(s);
    }
    const written = new Set();
    for (const [projectId, list] of buckets) {
      const dir = dirFor(projectId);
      written.add(path.resolve(dir));
      try { writeJson(path.join(dir, 'sessions.json'), { sessions: list }); }
      catch (e) { logger?.warn?.('sessions save failed', projectId, (e && e.message) || e); }
    }
    for (const dir of new Set(dirs())) {
      if (written.has(path.resolve(dir))) continue;
      const f = path.join(dir, 'sessions.json');
      if (fs.existsSync(f)) { try { fs.rmSync(f, { force: true }); } catch { /* ignore */ } }
    }
  };
  return {
    read: () => data,
    write: (next) => { data = normalizeLedger(next); save(); return data; },
    // 项目增删后重新扫描磁盘：让移出的项目不再参与读写，重新加入的项目能恢复历史
    reload: () => { data = loadAll(); return data; },
  };
}

export function createSessionLedger({ file = null, logsDir = null, logDirFor = null, sessionsDirs = null, sessionsDirFor = null, logger = console } = {}) {
  // 提供 sessionsDirs + sessionsDirFor 时：会话账本按项目分片存（读合并、写拆分），否则退回单文件
  const store = (sessionsDirs && sessionsDirFor)
    ? createShardedSessionsStore({ dirs: sessionsDirs, dirFor: sessionsDirFor, logger })
    : createJsonStore({ file, logger, normalize: normalizeLedger, defaults: () => ({ sessions: [] }) });
  const buffers = new Map();
  const dirty = new Set();
  const logFile = (id) => {
    if (!logsDir && !logDirFor) return null;
    if (!logDirFor) return path.join(logsDir, `${id}.log`);
    const session = store.read().sessions.find((s) => s.id === id);
    return path.join(logDirFor(session?.projectId || ''), `${id}.log`);
  };

  function appendLog(id, chunk) {
    if (!id || typeof chunk !== 'string' || !chunk) return;
    let buf = (buffers.get(id) || '') + chunk;
    if (buf.length > MAX_LOG_BYTES) buf = buf.slice(buf.length - MAX_LOG_BYTES);
    buffers.set(id, buf);
    dirty.add(id);
  }
  function flushLog(id) {
    const f = logFile(id);
    if (!f || !dirty.has(id)) return;
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const tmp = `${f}.tmp`;
      fs.writeFileSync(tmp, buffers.get(id) || '', 'utf8');
      fs.renameSync(tmp, f);
      dirty.delete(id);
    } catch (e) { logger?.warn?.('session log flush failed', (e && e.message) || e); }
  }
  function flushAll() { for (const id of [...dirty]) flushLog(id); }
  function readLog(id) {
    if (buffers.has(id)) return buffers.get(id);
    const f = logFile(id);
    if (!f) return null;
    try { return fs.readFileSync(f, 'utf8'); } catch { return null; }
  }
  function upsert(entry) {
    if (!entry || !entry.id) return store.read();
    const cur = store.read();
    const existing = cur.sessions.find((s) => s.id === entry.id) || {};
    const rest = cur.sessions.filter((s) => s.id !== entry.id);
    return store.write({ sessions: [{ ...existing, ...entry }, ...rest] });
  }
  // 关闭会话（kill）：把回滚落盘后丢内存缓冲，但保留记录与日志文件（供历史恢复）。
  function close(id) {
    flushLog(id);
    buffers.delete(id);
    dirty.delete(id);
  }
  function remove(id) {
    const cur = store.read();
    store.write({ sessions: cur.sessions.filter((s) => s.id !== id) });
    buffers.delete(id);
    dirty.delete(id);
    const f = logFile(id);
    if (f) { try { fs.rmSync(f, { force: true }); } catch { /* ignore */ } }
  }
  // 一次性把老 <logsDir>/<id>.log 迁到按项目分目录的位置；幂等（无日志/无 logDirFor 时不动作）
  function migrateLogs() {
    if (!logsDir || !logDirFor || !fs.existsSync(logsDir)) return;
    let moved = 0;
    for (const f of fs.readdirSync(logsDir)) {
      if (!f.endsWith('.log')) continue;
      const id = f.slice(0, -4);
      const session = store.read().sessions.find((s) => s.id === id);
      const target = path.join(logDirFor(session?.projectId || ''), f);
      if (path.resolve(target) === path.resolve(path.join(logsDir, f))) continue;
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(path.join(logsDir, f), target);
        moved += 1;
      } catch (e) { logger?.warn?.('session log migrate failed', f, (e && e.message) || e); }
    }
    if (moved) logger?.info?.(`session logs migrated to per-project dirs: ${moved}`);
  }
  return { read: store.read, reload: () => (store.reload ? store.reload() : store.read()), upsert, remove, close, appendLog, flushLog, flushAll, readLog, migrateLogs };
}
