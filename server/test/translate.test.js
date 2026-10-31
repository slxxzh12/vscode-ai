import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {
  createTranslator, createTranslateMount, buildMessages, normalizeModel, SYSTEM_INSTRUCTION, IMAGE_INSTRUCTION,
  parseModelList, createModelLister, createCatalogSource,
  extractImagePaths, resolveImages,
} from '../translate.js';

function mkProvider(over = {}) {
  return { id: 'corp', baseURL: 'https://gw/v1', apiKey: 'SECRET', models: ['gpt-4o', 'gpt-4o-mini'], model: 'corp/gpt-4o', ...over };
}

function okResponse(text, extra = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: text } }], ...extra }),
  };
}

function errResponse(status, body = {}) {
  return { ok: false, status, json: async () => body };
}

function call(translator, opts) {
  return translator.translate(opts);
}

async function codeOf(promise) {
  try { await promise; return null; } catch (e) { return e.code; }
}

test('buildMessages 带 system 指令 + user 原文', () => {
  const msgs = buildMessages('你好');
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[0].content, SYSTEM_INSTRUCTION);
  assert.deepEqual(msgs[1], { role: 'user', content: '你好' });
});

test('normalizeModel 剥 provider 前缀 / 回退默认 / 回退首个', () => {
  assert.equal(normalizeModel('deepseek/deepseek-v4-flash', []), 'deepseek-v4-flash');
  assert.equal(normalizeModel('', ['a', 'b'], 'b'), 'b');
  assert.equal(normalizeModel('', ['a', 'b']), 'a');
  assert.equal(normalizeModel('', []), '');
});

test('translate 成功：URL/鉴权头/body 正确，返回译文', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return okResponse('Translate this.'); };
  const t = createTranslator({ provider: () => mkProvider(), fetchImpl });
  const r = await call(t, { text: '翻译这个' });
  assert.equal(r.text, 'Translate this.');
  assert.equal(r.model, 'gpt-4o');
  assert.equal(calls[0].url, 'https://gw/v1/chat/completions');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer SECRET');
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.model, 'gpt-4o');
  assert.equal(body.stream, false);
  assert.deepEqual(body.messages, buildMessages('翻译这个'));
});

test('translate 去尾斜杠并支持显式 model', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return okResponse('ok'); };
  const t = createTranslator({ provider: () => mkProvider({ baseURL: 'https://gw/v1/' }), fetchImpl });
  const r = await call(t, { text: 'x', model: 'gpt-4o-mini' });
  assert.equal(calls[0].url, 'https://gw/v1/chat/completions');
  assert.equal(r.model, 'gpt-4o-mini');
});

test('校验错误码：空输入 / 超长 / 无 provider / 无 key / 非法模型', async () => {
  const noFetch = () => { throw new Error('should not fetch'); };
  assert.equal(await codeOf(call(createTranslator({ provider: () => mkProvider(), fetchImpl: noFetch }), { text: '  ' })), 'empty-input');
  assert.equal(await codeOf(call(createTranslator({ provider: () => mkProvider(), fetchImpl: noFetch, maxLen: 3 }), { text: 'abcd' })), 'too-long');
  assert.equal(await codeOf(call(createTranslator({ provider: () => null, fetchImpl: noFetch }), { text: 'x' })), 'no-provider');
  assert.equal(await codeOf(call(createTranslator({ provider: () => mkProvider({ apiKey: '' }), fetchImpl: noFetch }), { text: 'x' })), 'no-key');
  assert.equal(await codeOf(call(createTranslator({ provider: () => mkProvider(), fetchImpl: noFetch }), { text: 'x', model: 'nope' })), 'bad-model');
});

test('上游非 2xx → upstream（含状态与消息）；无 choices → empty-result', async () => {
  const bad = createTranslator({ provider: () => mkProvider(), fetchImpl: async () => errResponse(429, { error: { message: 'rate limited' } }) });
  assert.equal(await codeOf(call(bad, { text: 'x' })), 'upstream');
  await assert.rejects(call(bad, { text: 'x' }), /HTTP 429: rate limited/);
  const empty = createTranslator({ provider: () => mkProvider(), fetchImpl: async () => okResponse('') });
  assert.equal(await codeOf(call(empty, { text: 'x' })), 'empty-result');
});

test('超时 → timeout（AbortController 生效）', async () => {
  const fetchImpl = (url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
  const t = createTranslator({ provider: () => mkProvider(), fetchImpl, timeoutMs: 20 });
  assert.equal(await codeOf(call(t, { text: 'x' })), 'timeout');
});

test('网络异常 → upstream', async () => {
  const t = createTranslator({ provider: () => mkProvider(), fetchImpl: async () => { throw new Error('boom'); } });
  assert.equal(await codeOf(call(t, { text: 'x' })), 'upstream');
});

// ---- 模型清单（与 opencode 选择一致）----

test('parseModelList 只留指定 provider 且去重/剔除空行', () => {
  const out = 'deepseek/deepseek-flash\ndeepseek/deepseek-v4-flash\n\nopencode/big-pickle\ndeepseek/deepseek-v4-flash\n';
  assert.deepEqual(parseModelList(out, 'deepseek'), ['deepseek/deepseek-flash', 'deepseek/deepseek-v4-flash']);
  assert.deepEqual(parseModelList(out), ['deepseek/deepseek-flash', 'deepseek/deepseek-v4-flash', 'opencode/big-pickle']);
  assert.deepEqual(parseModelList('garbage\nno-slash\n', 'deepseek'), []);
});

function fakeChild(output, code = 0) {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.kill = () => { /* noop */ };
  queueMicrotask(() => { if (output) c.stdout.emit('data', Buffer.from(output)); c.emit('close', code); });
  return c;
}

test('createModelLister 跑 opencode models <provider> 并缓存结果', async () => {
  const calls = [];
  const lister = createModelLister({
    spawnFn: (bin, args) => { calls.push([bin, ...args]); return fakeChild('deepseek/deepseek-flash\ndeepseek/deepseek-v4-flash\n'); },
    ttlMs: 10000,
  });
  assert.deepEqual(await lister('deepseek'), ['deepseek/deepseek-flash', 'deepseek/deepseek-v4-flash']);
  await lister('deepseek');
  assert.equal(calls.length, 1, '第二次命中缓存不再拉起 CLI');
  assert.deepEqual(calls[0], ['opencode', 'models', 'deepseek']);
  assert.deepEqual(await lister(''), [], '无 provider 直接空');
});

test('createModelLister 失败/非零退出一律返回空数组', async () => {
  const boom = createModelLister({ spawnFn: () => { throw new Error('ENOENT'); } });
  assert.deepEqual(await boom('deepseek'), []);
  const bad = createModelLister({ spawnFn: () => fakeChild('deepseek/x\n', 1) });
  assert.deepEqual(await bad('deepseek'), []);
});

const CATALOG_DEPS = {
  loadProviders: () => ({ defaultProvider: 'deepseek', model: 'deepseek/deepseek-v4-flash' }),
  resolveProvider: () => ({ id: 'deepseek', baseURL: 'https://api.deepseek.com/v1', apiKey: 'K', models: ['deepseek-v4-pro', 'deepseek-v4-flash'] }),
};

test('createCatalogSource 优先用 opencode models，默认模型与 opencode 一致', async () => {
  const { build } = createCatalogSource({
    ...CATALOG_DEPS,
    listModels: async () => ['deepseek/deepseek-flash', 'deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro'],
  });
  const c = await build();
  assert.equal(c.provider, 'deepseek');
  assert.deepEqual(c.models, ['deepseek/deepseek-flash', 'deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro']);
  assert.equal(c.model, 'deepseek/deepseek-v4-flash');
  assert.equal(c.hasKey, true);
});

test('createCatalogSource 清单拿不到时回退 opencode.json 的 models', async () => {
  const { build } = createCatalogSource({ ...CATALOG_DEPS, listModels: async () => [] });
  const c = await build();
  assert.deepEqual(c.models, ['deepseek/deepseek-v4-pro', 'deepseek/deepseek-v4-flash']);
  assert.equal(c.model, 'deepseek/deepseek-v4-flash');
});

test('createCatalogSource 无默认 provider → 空目录且不泄露 key', async () => {
  const { build } = createCatalogSource({ loadProviders: () => ({ defaultProvider: null, model: '' }), resolveProvider: () => null, listModels: async () => [] });
  assert.deepEqual(await build(), { provider: null, models: [], model: '', hasKey: false, resolved: null });
});

test('translate 接受 provider/model 形式，并传裸模型名给上游', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push(opts); return okResponse('ok'); };
  const t = createTranslator({ provider: async () => mkProvider({ models: ['corp/gpt-4o', 'corp/gpt-4o-mini'] }), fetchImpl });
  const r = await call(t, { text: 'x', model: 'corp/gpt-4o-mini' });
  assert.equal(r.model, 'gpt-4o-mini');
  assert.equal(JSON.parse(calls[0].body).model, 'gpt-4o-mini');
});

// ---- 图片识别 ----

test('extractImagePaths：引号包裹（含空格）与裸绝对路径，非图片忽略', () => {
  assert.deepEqual(extractImagePaths('看 "C:\\a b\\x.png" 和 C:/tmp/y.JPG 以及 z.txt'), ['C:\\a b\\x.png', 'C:/tmp/y.JPG']);
  assert.deepEqual(extractImagePaths('没有图'), []);
  assert.deepEqual(extractImagePaths('`D:/shot/一.png`'), ['D:/shot/一.png']);
});

test('buildMessages 带图 → IMAGE_INSTRUCTION + 文本与 image_url 分块', () => {
  const msgs = buildMessages('看图', ['data:image/png;base64,AAA']);
  assert.equal(msgs[0].content, IMAGE_INSTRUCTION);
  assert.deepEqual(msgs[1].content, [
    { type: 'text', text: '看图' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
  ]);
});

test('resolveImages：缺失图片跳过、超量/过大报错', () => {
  const read = (abs) => {
    if (abs.endsWith('missing.png')) { const e = new Error('x'); e.code = 'image-missing'; throw e; }
    return `data:image/png;base64,${path.basename(abs)}`;
  };
  assert.deepEqual(resolveImages('"C:/a/x.png" "C:/a/missing.png"', { readImage: read }), ['data:image/png;base64,x.png']);
  const many = Array.from({ length: 5 }, (_, i) => `"C:/a/${i}.png"`).join(' ');
  assert.throws(() => resolveImages(many, { readImage: read }), (e) => e.code === 'too-many-images');
  const tooBig = () => { const e = new Error('big'); e.code = 'image-too-large'; throw e; };
  assert.throws(() => resolveImages('"C:/a/x.png"', { readImage: tooBig }), (e) => e.code === 'image-too-large');
});

test('resolveImages：allowedRoots 之外的图片被跳过（远程访问限制）', () => {
  const read = () => 'data:image/png;base64,AAA';
  const root = path.join(os.tmpdir(), 'df-root-allowed');
  const inside = `"${path.join(root, 'a.png')}"`;
  const outside = `"${path.join(os.tmpdir(), 'df-other', 'b.png')}"`;
  assert.deepEqual(resolveImages(inside, { readImage: read, allowedRoots: [root] }), ['data:image/png;base64,AAA']);
  assert.deepEqual(resolveImages(outside, { readImage: read, allowedRoots: [root] }), []);
  assert.deepEqual(resolveImages(outside, { readImage: read, allowedRoots: null }), ['data:image/png;base64,AAA']);
});

test('translate 带图片路径：请求体为视觉消息', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push(opts); return okResponse('ok'); };
  const t = createTranslator({ provider: async () => mkProvider(), fetchImpl, readImage: () => 'data:image/png;base64,AAA' });
  await call(t, { text: '看这张图 "C:/a/x.png"' });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.messages[0].content, IMAGE_INSTRUCTION);
  assert.equal(body.messages[1].content[1].image_url.url, 'data:image/png;base64,AAA');
});

test('translate 显式选图（images 参数）且文本可为空', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push(opts); return okResponse('ok'); };
  const t = createTranslator({ provider: async () => mkProvider(), fetchImpl, readImage: () => 'data:image/png;base64,AAA' });
  const r = await call(t, { text: '', images: ['C:/a/x.png'] });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.messages[0].content, IMAGE_INSTRUCTION);
  assert.equal(body.messages[1].content[0].text, 'See the attached image.');
  assert.equal(body.messages[1].content[1].image_url.url, 'data:image/png;base64,AAA');
  assert.equal(r.text, 'ok');
});

// ---- mount ----

function fakeReq(method, body) {
  const chunks = body == null ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    on(ev, cb) {
      if (ev === 'data') for (const c of chunks) cb(c);
      if (ev === 'end') cb();
      return this;
    },
    destroy() { /* noop */ },
  };
}

function fakeRes() {
  return {
    statusCode: 0,
    body: '',
    writeHead(code) { this.statusCode = code; },
    end(s) { this.body = s || ''; },
  };
}

const URL_CFG = { pathname: '/api/translate/config' };
const URL_RUN = { pathname: '/api/translate' };

test('mount GET /config 用 catalog 且不泄露 key', async () => {
  const mount = createTranslateMount({ translator: { translate: async () => ({ text: 'x' }) }, catalog: () => ({ provider: 'corp', models: ['gpt-4o'], model: 'gpt-4o', hasKey: true }) });
  const res = fakeRes();
  await mount(fakeReq('GET'), res, URL_CFG);
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.deepEqual(j, { provider: 'corp', models: ['gpt-4o'], model: 'gpt-4o', hasKey: true });
  assert.equal(res.body.includes('SECRET'), false);
});

test('mount POST 成功返回译文；错误码映射到状态码', async () => {
  const mk = (err) => createTranslateMount({
    translator: { translate: async () => { if (err) { const e = new Error(err); e.code = err; throw e; } return { text: 'Hello', model: 'gpt-4o' }; } },
    catalog: () => ({}),
  });
  const ok = fakeRes();
  await mk(null)(fakeReq('POST', { text: 'x' }), ok, URL_RUN);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(JSON.parse(ok.body), { text: 'Hello', model: 'gpt-4o' });

  for (const [code, status] of [['empty-input', 400], ['too-long', 400], ['bad-model', 400], ['timeout', 504], ['upstream', 502], ['weird', 500]]) {
    const res = fakeRes();
    await mk(code)(fakeReq('POST', { text: 'x' }), res, URL_RUN);
    assert.equal(res.statusCode, status, `${code} → ${status}`);
    assert.equal(JSON.parse(res.body).error, code);
  }
});

test('mount 坏 body / 未知路径', async () => {
  const mount = createTranslateMount({ translator: { translate: async () => ({ text: 'x' }) }, catalog: () => ({}) });
  const bad = fakeRes();
  const req = fakeReq('POST', null);
  req.on = (ev, cb) => { if (ev === 'data') cb(Buffer.from('{oops')); if (ev === 'end') cb(); return req; };
  await mount(req, bad, URL_RUN);
  assert.equal(bad.statusCode, 400);
  assert.equal(JSON.parse(bad.body).error, 'bad-body');

  const nf = fakeRes();
  await mount(fakeReq('GET'), nf, { pathname: '/api/translate/other' });
  assert.equal(nf.statusCode, 404);
});
