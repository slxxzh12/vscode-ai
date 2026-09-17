import { WebSocketServer } from 'ws';
import { C2S, S2C } from '@devflow/shared';

const REPLAY_RESET = '\x1b[2J\x1b[H';

class Conn {
  constructor(ws) {
    this.ws = ws;
    this.alive = true;
    // ws.data.sessionId 与 conn.sessionId 双向同步（spec §4 / §15.3）
    ws.data = ws.data || { sessionId: null };
  }
  get sessionId() { return this.ws.data.sessionId; }
  set sessionId(v) { this.ws.data.sessionId = v; }
  send(obj) {
    if (!this.alive) return;
    try {
      if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
    } catch { this.alive = false; }
  }
  close() { this.alive = false; try { this.ws.close(); } catch { /* noop */ } }
}

export function createGateway({ httpServer, sessionManager, workflowRunner = null, requireAuthWs = null, log = console }) {
  const wss = new WebSocketServer({ noServer: true });
  const conns = new Set();

  httpServer.on('upgrade', (req, socket, head) => {
    let authed = true;
    if (requireAuthWs) { try { authed = !!requireAuthWs(req); } catch { authed = false; } }
    if (!authed) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    let pathname = '/';
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { /* default '/' */ }
    if (pathname !== '/ws') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    ws.data = { sessionId: null };               // spec §4 / §15.3
    const conn = new Conn(ws);
    conns.add(conn);

    const onData = (session, chunk) => {
      if (session.clients.has(conn)) conn.send({ type: S2C.OUTPUT, sessionId: session.id, data: chunk });
    };
    const onExit = (session) => {
      if (session.clients.has(conn)) conn.send({ type: S2C.SESSION_EXITED, sessionId: session.id, exitCode: session.exitCode });
    };
    sessionManager.on('data', onData);
    sessionManager.on('exit', onExit);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      handleMessage(conn, msg);
    });
    ws.on('close', () => {
      sessionManager.detachAll(conn);
      sessionManager.off('data', onData);
      sessionManager.off('exit', onExit);
      conn.alive = false;
      conns.delete(conn);
    });
    ws.on('error', () => { conn.alive = false; });
  });

  function replay(conn, session) {
    conn.send({ type: S2C.REPLAY, sessionId: session.id, data: REPLAY_RESET + session.ring.content });
  }

  function handleMessage(conn, msg) {
    switch (msg.type) {
      case C2S.LIST:
        conn.send({ type: S2C.SESSION_LIST, sessions: sessionManager.list() });
        break;
      case C2S.CREATE:
        sessionManager.create({
          projectId: msg.projectId || null, cwd: msg.cwd || null,
          cols: msg.cols || 80, rows: msg.rows || 24,
          kind: msg.kind || 'shell', agentId: msg.agentId || null, agentCmd: msg.agentCmd || null,
        }).then((session) => {
          sessionManager.setActive(session.id, conn);
          conn.send({ type: S2C.SESSION_CREATED, session: sessionManager.summary(session) });
          replay(conn, session);
        }).catch((err) => {
          log.error('create failed', err);
          conn.send({ type: S2C.ERROR, code: 'create-failed', message: String(err && err.message || err) });
        });
        break;
      case C2S.START: {
        const session = sessionManager.get(msg.sessionId);
        if (!session) { conn.send({ type: S2C.ERROR, code: 'not-found', message: 'session not found' }); break; }
        if (session.state === 'exited') { conn.send({ type: S2C.ERROR, code: 'exited', message: 'session has exited' }); break; }
        sessionManager.setActive(session.id, conn);
        replay(conn, session);
        break;
      }
      case C2S.INPUT: {
        const sid = msg.sessionId || conn.sessionId;
        if (sid) sessionManager.write(sid, msg.data);
        break;
      }
      case C2S.RESIZE:
        if (conn.sessionId) sessionManager.resize(conn.sessionId, msg.cols, msg.rows);
        break;
      case C2S.STOP:
        sessionManager.detachAll(conn);
        break;
      case C2S.KILL:
        if (sessionManager.kill(msg.sessionId) && conn.sessionId === msg.sessionId) conn.sessionId = null;
        break;
      case C2S.PING:
        conn.send({ type: S2C.PONG });
        break;
      default:
        if (workflowRunner) handleWorkflow(conn, msg);
        break;
    }
  }

  function handleWorkflow(conn, msg) {
    switch (msg.type) {
      case C2S.WF_LIST:
        conn.send({ type: S2C.WF_LIST_RESULT, workflows: workflowRunner.list() });
        break;
      case C2S.WF_RUN: {
        const res = workflowRunner.start(msg.workflowId, msg.sessionId);
        if (!res.ok) { conn.send({ type: S2C.ERROR, code: res.code, message: res.message }); break; }
        workflowRunner.attachConn(res.run.runId, conn);
        conn.send({ type: S2C.WF_STARTED, run: res.run.snapshot() });
        conn.send({ type: S2C.WF_STATUS, run: res.run.snapshot() });
        break;
      }
      case C2S.WF_NEXT: {
        const run = workflowRunner.get(msg.runId);
        if (!run) { conn.send({ type: S2C.ERROR, code: 'not-found', message: 'run not found' }); break; }
        run.advance();
        conn.send({ type: S2C.WF_STATUS, run: run.snapshot() });
        break;
      }
      case C2S.WF_ABORT: {
        const run = workflowRunner.get(msg.runId);
        if (!run) { conn.send({ type: S2C.ERROR, code: 'not-found', message: 'run not found' }); break; }
        run.abort();
        conn.send({ type: S2C.WF_STATUS, run: run.snapshot() });
        break;
      }
    }
  }

  if (workflowRunner) {
    workflowRunner.onStatus((run) => {
      const c = workflowRunner.connOf(run.runId);
      if (c) {
        if (run.status === 'done' || run.status === 'aborted') {
          c.send({ type: S2C.WF_FINISHED, runId: run.runId, status: run.status });
        }
        c.send({ type: S2C.WF_STATUS, run: run.snapshot() });
      }
    });
  }

  return { conns, handleMessage, wss, close: () => wss.close() };
}
