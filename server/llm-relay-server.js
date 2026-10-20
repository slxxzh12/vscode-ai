import http from 'node:http';
import { LLM_RELAY_DEFAULT_PORT } from '@devflow/shared';

export const DEFAULT_LLM_RELAY_PORT = LLM_RELAY_DEFAULT_PORT;

// LLM 中转独立监听：只暴露 /api/llm/<provider>/...，管理接口仍留在主服务端口
export function createLlmRelayServer({ mount = null, getMount = null, host = '0.0.0.0', port = DEFAULT_LLM_RELAY_PORT, logger = console } = {}) {
  let server = null;
  let status = 'stopped';
  let error = null;
  let actualPort = port;

  const resolveMount = () => (typeof getMount === 'function' ? getMount() : mount);

  function state() {
    return { status, error, host, port, actualPort };
  }

  function start() {
    if (server) return Promise.resolve(state());
    status = 'starting';
    error = null;
    actualPort = port;

    const srv = http.createServer(async (req, res) => {
      const m = resolveMount();
      if (!m || typeof m.relay !== 'function') {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'relay-unavailable' }));
        return;
      }
      try {
        await m.relay(req, res, new URL(req.url, 'http://localhost'));
      } catch (e) {
        logger?.warn?.('llm relay request failed', (e && e.message) || e);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'internal' }));
        } else {
          try { res.destroy(); } catch { /* ignore */ }
        }
      }
    });
    server = srv;

    return new Promise((resolve) => {
      let settled = false;
      const done = (st) => { if (settled) return; settled = true; resolve(st); };
      srv.once('listening', () => {
        status = 'running';
        actualPort = srv.address()?.port ?? port;
        logger?.info?.(`llm relay listening on http://${host}:${actualPort}`);
        done(state());
      });
      srv.once('error', (e) => {
        status = 'error';
        error = (e && e.code) || String((e && e.message) || e);
        actualPort = port;
        if (server === srv) server = null;
        logger?.warn?.(`llm relay listen failed on ${host}:${port}: ${error}`);
        done(state());
      });
      srv.listen(port, host);
    });
  }

  function stop() {
    const srv = server;
    server = null;
    status = 'stopped';
    if (!srv) return Promise.resolve(state());
    return new Promise((resolve) => srv.close(() => resolve(state())));
  }

  return { start, stop, state };
}
