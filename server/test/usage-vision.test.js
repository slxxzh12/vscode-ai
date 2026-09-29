import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMetrics, pickModel, createUsageVision, callChat, VISION_SYSTEM } from '../usage-vision.js';

function okJson(obj) { return { ok: true, status: 200, json: async () => obj }; }

test('parseMetrics：容忍 markdown 代码块与前后杂文', () => {
  const m = parseMetrics('```json\n{"sessions":21,"messages":3986,"totalCost":4.83}\n```');
  assert.deepEqual(m, { sessions: 21, messages: 3986, days: null, totalCost: 4.83, input: null, output: null, cacheRead: null, cacheWrite: null });
});

test('parseMetrics：非整数指标取整，缺失为 null', () => {
  const m = parseMetrics('before {"sessions":"21.6","input":8200000} after');
  assert.equal(m.sessions, 22);
  assert.equal(m.input, 8200000);
  assert.equal(m.totalCost, null);
});

test('parseMetrics：非 JSON / 全空 抛错', () => {
  assert.throws(() => parseMetrics('not json at all'), (e) => e.code === 'bad-json');
  assert.throws(() => parseMetrics('{"sessions":null,"messages":null}'), (e) => e.code === 'empty-result');
});

test('pickModel：优先视觉模型，否则回退首个', () => {
  assert.equal(pickModel({ id: 'deepseek', models: ['deepseek-v4-pro', 'deepseek-v4-flash-vision-exp'] }).model, 'deepseek-v4-flash-vision-exp');
  assert.equal(pickModel({ id: 'deepseek', models: ['corp/deepseek-v4-pro'] }).model, 'deepseek-v4-pro');
  assert.equal(pickModel({ id: 'x', models: [] }).model, '');
});

test('recognize：调用 chat/completions 并解析指标', async () => {
  let seen = null;
  const fetchFn = async (url, init) => {
    seen = { url, body: JSON.parse(init.body) };
    return okJson({ choices: [{ message: { content: '{"sessions":21,"messages":3986,"days":7}' } }] });
  };
  const vision = createUsageVision({
    resolveProvider: () => ({ id: 'deepseek', baseURL: 'https://gw/v1/', apiKey: 'K', models: ['deepseek-v4-pro'] }),
    fetchFn,
  });
  const r = await vision.recognize({ data: Buffer.from('abcd'), mime: 'image/png' });
  assert.equal(r.model, 'deepseek-v4-pro');
  assert.deepEqual(r.metrics, { sessions: 21, messages: 3986, days: 7, totalCost: null, input: null, output: null, cacheRead: null, cacheWrite: null });
  assert.equal(seen.url, 'https://gw/v1/chat/completions');
  assert.equal(seen.body.model, 'deepseek-v4-pro');
  assert.equal(seen.body.stream, false);
  assert.equal(seen.body.messages[1].content[1].type, 'image_url');
  assert.match(seen.body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.match(seen.body.messages[0].content, /sessions/);
});

test('recognize：错误码映射（无 provider/key、上游失败）', async () => {
  const codeOf = async (vision, data) => {
    try { await vision.recognize({ data }); return 'ok'; } catch (e) { return e.code; }
  };
  assert.equal(await codeOf(createUsageVision({ resolveProvider: () => null, fetchFn: async () => okJson({}) }), Buffer.from('x')), 'no-provider');
  assert.equal(await codeOf(createUsageVision({ resolveProvider: () => ({ baseURL: 'https://x', apiKey: '' }), fetchFn: async () => okJson({}) }), Buffer.from('x')), 'no-key');
  assert.equal(await codeOf(createUsageVision({ resolveProvider: () => ({ baseURL: 'https://x', apiKey: 'k', models: [] }), fetchFn: async () => okJson({}) }), Buffer.from('x')), 'bad-model');
  assert.equal(await codeOf(createUsageVision({ resolveProvider: () => ({ baseURL: 'https://x', apiKey: 'k', models: ['m'] }), fetchFn: async () => ({ ok: false, status: 500, json: async () => ({}) }) }), Buffer.from('x')), 'upstream');
});

test('callChat：哨兵 image 走多模态模型，显式模型名直接用；空 messages 报 bad-messages', async () => {
  const seen = [];
  const fetchFn = async (url, init) => { seen.push(JSON.parse(init.body)); return okJson({ choices: [{ message: { content: 'hi' } }] }); };
  const resolveProvider = () => ({ id: 'deepseek', baseURL: 'https://gw/v1', apiKey: 'K', models: ['deepseek-v4-pro', 'deepseek-v4-flash-vision-exp'] });
  const a = await callChat({ resolveProvider, messages: [{ role: 'user', content: 'x' }], fetchFn });
  assert.equal(a.model, 'deepseek-v4-flash-vision-exp');
  assert.equal(a.content, 'hi');
  const b = await callChat({ resolveProvider, messages: [{ role: 'user', content: 'x' }], model: 'deepseek-v4-pro', fetchFn });
  assert.equal(b.model, 'deepseek-v4-pro');
  assert.equal(seen[0].model, 'deepseek-v4-flash-vision-exp');
  assert.equal(seen[1].model, 'deepseek-v4-pro');
  const codeOf = async () => { try { await callChat({ resolveProvider, messages: [], fetchFn }); return 'ok'; } catch (e) { return e.code; } };
  assert.equal(await codeOf(), 'bad-messages');
});
