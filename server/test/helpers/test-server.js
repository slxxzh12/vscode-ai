import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createGateway } from '../../ws-gateway.js';

export async function startTestServer({ sessionManager, workflowRunner = null }) {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const gateway = createGateway({ httpServer: server, sessionManager, workflowRunner });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port, gateway,
    wsUrl: () => `ws://127.0.0.1:${port}/ws`,
    async connect() {
      const ws = new WebSocket(this.wsUrl());
      await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
      const client = {
        ws,
        inbox: [],
        waiters: [],
        wait(pred, ms = 3000) {
          return new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error('wait timeout')), ms);
            this.waiters.push({ pred, res, rej, t });
            this._flush();
          });
        },
        _flush() {
          const done = [];
          for (const w of this.waiters) {
            const hit = this.inbox.find(w.pred);
            if (hit) { clearTimeout(w.t); w.res(hit); done.push(w); }
          }
          this.waiters = this.waiters.filter((w) => !done.includes(w));
          this.inbox = this.inbox.filter((m) => !done.some((w) => w.pred(m)));
        },
        send(type, payload = {}) { ws.send(JSON.stringify({ type, ...payload })); },
        close() { ws.close(); },
      };
      ws.on('message', (raw) => { client.inbox.push(JSON.parse(raw)); client._flush(); });
      return client;
    },
    async stop() {
      for (const c of gateway.conns) try { c.ws.close(); } catch { /* noop */ }
      await new Promise((r) => server.close(r));
    },
  };
}

export { WebSocket };
