import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlmRelayServer, DEFAULT_LLM_RELAY_PORT } from '../llm-relay-server.js';

test('LLM 中转默认独立监听 22223', () => {
  assert.equal(DEFAULT_LLM_RELAY_PORT, 22223);
});

test('独立监听只把请求交给 relay，并报告运行状态', async (t) => {
  const seen = [];
  const mount = {
    relay(req, res, url) {
      seen.push(url.pathname);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    },
  };
  const relay = createLlmRelayServer({
    getMount: () => mount,
    host: '127.0.0.1',
    port: 0,
    logger: { info() {}, warn() {} },
  });
  const st = await relay.start();
  t.after(() => relay.stop());
  assert.equal(st.status, 'running');
  assert.ok(st.actualPort > 0);
  const r = await fetch(`http://127.0.0.1:${st.actualPort}/api/llm/deepseek/v1/chat/completions`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'ok');
  assert.deepEqual(seen, ['/api/llm/deepseek/v1/chat/completions']);
});
