import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpApi } from '../http-api.js';

function call(handler, path) {
  return new Promise((resolve) => {
    const req = { url: path, method: 'GET', headers: {} };
    const res = {
      statusCode: 0, body: '',
      writeHead(code) { this.statusCode = code; return this; },
      end(body) { this.body = body || ''; resolve(this); },
    };
    handler(req, res);
  });
}

test('GET /api/sessions 返回账本会话', async () => {
  const sessionLedger = { read: () => ({ sessions: [{ id: 's1', name: 'A', state: 'exited' }] }) };
  const handler = createHttpApi({ projects: { listProjects: () => [] }, sessionLedger });
  const res = await call(handler, '/api/sessions');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).sessions.map((s) => s.id), ['s1']);
});
