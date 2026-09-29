import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { RingBuffer } from './ring-buffer.js';
import { createPty } from './pty-runner.js';
import { t, getLocale } from './i18n.js';

const shortId = () => 's_' + crypto.randomBytes(4).toString('hex');
const timeLabel = () => new Date().toLocaleTimeString(getLocale(), { hour12: false });

export class SessionManager extends EventEmitter {
  constructor({ ptyFactory = createPty, ringMaxBytes = 256 * 1024, logger = console, projectResolver = null, onCreated = null } = {}) {
    super();
    this.ptyFactory = ptyFactory;   // async ({cwd,cols,rows}) => PseudoPty
    this.ringMaxBytes = ringMaxBytes;
    this.log = logger;
    this.projectResolver = projectResolver; // (projectId) => root|null
    this.onCreated = onCreated;             // (session) => void，用于记录 sessionId → projectId
    this.sessions = new Map();
    this._seq = 0;
  }
  async create({ projectId = null, cwd = null, name = null, cols = 80, rows = 24,
                 id = null, kind = 'shell', agentId = null, agentCmd = null,
                 createdAt = null, replay = null } = {}) {
    const projRoot = projectId && this.projectResolver ? (this.projectResolver(projectId) || null) : null;
    const workdir = cwd || projRoot || process.cwd();
    // 项目目录可能已被删除/移动：此时不能把不存在的目录交给 node-pty（会抛 ERROR_DIRECTORY 267），
    // 给出可识别的错误码，让上层提示用户重新选择/添加项目。
    if (!fs.existsSync(workdir)) {
      const e = new Error(`working directory does not exist: ${workdir}`);
      e.code = 'cwd-missing';
      throw e;
    }
    const pty = await this.ptyFactory({ cwd: workdir, cols, rows });
    const session = {
      id: id || shortId(), name: name || (projectId ? `${projectId} · ${timeLabel()}` : `${t('session.default')} · ${timeLabel()}`),
      projectId, cwd: workdir, pty, alive: true,
      ring: new RingBuffer(this.ringMaxBytes), clients: new Set(),
      cols, rows, state: 'running', exitCode: null,
      createdAt: createdAt || Date.now(), seq: ++this._seq, ptyExited: false,
      kind, agentId, agentCmd, restored: false,
    };
    if (typeof replay === 'string' && replay) session.ring.push(replay);
    pty.onData((chunk) => this._onData(session, chunk));
    pty.onExit((code) => this._onExit(session, code));
    this.sessions.set(session.id, session);
    this.onCreated?.(session);
    return session;
  }
  _onData(session, chunk) {
    session.ring.push(chunk);
    this.emit('data', session, chunk);
  }
  _onExit(session, code) {
    session.ptyExited = true;
    session.alive = false;
    session.state = 'exited';
    session.exitCode = code;
    session.pty = null;
    this.emit('exit', session);
  }
  get(id) { return this.sessions.get(id) || null; }
  list() {
    return [...this.sessions.values()]
      .sort((a, b) => (b.createdAt - a.createdAt) || (b.seq - a.seq))
      .map((s) => this.summary(s));
  }
  summary(s) {
    return { id: s.id, name: s.name, projectId: s.projectId, state: s.state, cwd: s.cwd,
      cols: s.cols, rows: s.rows, exitCode: s.exitCode,
      kind: s.kind || 'shell', agentId: s.agentId || null, restored: !!s.restored,
      resumed: s.resumed === true ? true : undefined };
  }
  live() { return [...this.sessions.values()]; }
  write(id, data) {
    const s = this.get(id);
    if (!s || !s.alive || !s.pty || s.ptyExited) return false;
    try { s.pty.write(String(data)); return true; } catch { return false; }
  }
  resize(id, cols, rows) {
    const s = this.get(id);
    const c = Math.max(2, cols | 0) || 80;
    const r = Math.max(1, rows | 0) || 24;
    if (!s || !s.alive || !s.pty) return false;
    try { s.pty.resize(c, r); } catch { return false; }
    s.cols = c; s.rows = r; return true;
  }
  attach(id, conn) {
    const s = this.get(id);
    if (!s) return null;
    s.clients.add(conn);
    conn.sessionId = id;
    return s;
  }
  setActive(id, conn) {
    for (const s of this.sessions.values()) {
      if (s.clients.has(conn) && s.id !== id) s.clients.delete(conn);
    }
    return this.attach(id, conn);
  }
  detach(id, conn) {
    const s = this.get(id);
    if (s) s.clients.delete(conn);
    if (conn.sessionId === id) conn.sessionId = null;
  }
  detachAll(conn) {
    for (const s of this.sessions.values()) s.clients.delete(conn);
    conn.sessionId = null;
  }
  markRestored(id) {
    const s = this.get(id);
    if (s) s.restored = true;
    return !!s;
  }
  kill(id) {
    const s = this.get(id);
    if (!s) return false;
    s.alive = false;
    s.state = 'exited';
    for (const c of s.clients) c.sessionId = null;
    s.clients.clear();
    this.sessions.delete(id);
    if (s.pty && !s.ptyExited) { try { s.pty.kill(); } catch { /* 第三层兜底 */ } }
    this.emit('removed', id);
    return true;
  }
}
