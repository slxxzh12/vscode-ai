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

export function createSessionLedger({ file = null, logsDir = null, logger = console } = {}) {
  const store = createJsonStore({ file, logger, normalize: normalizeLedger, defaults: () => ({ sessions: [] }) });
  const buffers = new Map();
  const dirty = new Set();
  const logFile = (id) => (logsDir ? path.join(logsDir, `${id}.log`) : null);

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
  return { read: store.read, upsert, remove, close, appendLog, flushLog, flushAll, readLog };
}
