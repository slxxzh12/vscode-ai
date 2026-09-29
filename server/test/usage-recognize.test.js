import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVisionMessages, recognizeViaMaster } from '../usage-recognize.js';

test('buildVisionMessages：带系统提示词与图片 dataURL', () => {
  const msgs = buildVisionMessages({ mime: 'image/png', data: Buffer.from('abcd') });
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /sessions/);
  assert.equal(msgs[1].content[1].type, 'image_url');
  assert.match(msgs[1].content[1].image_url.url, /^data:image\/png;base64,/);
});

test('recognizeViaMaster：调 multimodal + report，返回 via=master', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    if (url.endsWith('/api/usage/multimodal')) return { ok: true, status: 200, json: async () => ({ content: '{"sessions":21,"messages":3986}', model: 'glm-4v-plus' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const r = await recognizeViaMaster({
    masterUrl: 'http://h:22222/', token: 'tk', data: Buffer.from('x'), mime: 'image/png',
    identity: { machineId: 'm1', username: 'u1', host: 'h', port: 22222 }, days: 7, fetchFn,
  });
  assert.equal(r.via, 'master');
  assert.equal(r.model, 'glm-4v-plus');
  assert.equal(r.metrics.sessions, 21);
  assert.equal(calls[0].url, 'http://h:22222/api/usage/multimodal');
  assert.equal(calls[0].headers['X-DF-Token'], 'tk');
  assert.equal(calls[0].body.model, 'image');
  assert.equal(calls[1].url, 'http://h:22222/api/usage/report');
  assert.equal(calls[1].body.machineId, 'm1');
  assert.equal(calls[1].body.usage.source, 'image');
  assert.equal(calls[1].body.usage.sessions, 21);
  assert.equal(calls[1].body.usage.days, 7);
});

test('recognizeViaMaster：403 → bad-token；网络异常 → upstream', async () => {
  const bad = async () => ({ ok: false, status: 403, json: async () => ({ error: 'bad-token' }) });
  await assert.rejects(
    () => recognizeViaMaster({ masterUrl: 'http://h', token: 'x', data: Buffer.from('x'), identity: { machineId: 'm' }, fetchFn: bad }),
    (e) => e.code === 'bad-token',
  );
  const boom = async () => { throw new Error('net'); };
  await assert.rejects(
    () => recognizeViaMaster({ masterUrl: 'http://h', token: 'x', data: Buffer.from('x'), identity: { machineId: 'm' }, fetchFn: boom }),
    (e) => e.code === 'upstream',
  );
});
