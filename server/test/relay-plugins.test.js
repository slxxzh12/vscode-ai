import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPlugins, runRequestPlugins, runResponsePlugins, pluginCacheKeyOverride, seedPlugins } from '../relay-plugins.js';

const noLog = { warn() {} };
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfp-')); }
function write(dir, file, code) { fs.writeFileSync(path.join(dir, file), code); }

test('loadPlugins 按 priority 排序并汇报加载失败', async () => {
  const dir = tmpDir();
  write(dir, 'b.mjs', 'export default { name: "b", priority: 200, onRequest: () => {} };');
  write(dir, 'a.mjs', 'export default { name: "a", priority: 10, onRequest: () => {} };');
  write(dir, 'bad.mjs', 'export default { notAPlugin: true };');
  const { plugins, entries } = await loadPlugins(dir);
  assert.deepEqual(plugins.map((p) => p.name), ['a', 'b']);
  assert.equal(entries.find((e) => e.file === 'bad.mjs').error, 'no-plugin-export');
});

test('目录不存在返回空集', async () => {
  const { plugins, entries } = await loadPlugins(path.join(tmpDir(), 'nope'));
  assert.deepEqual(plugins, []);
  assert.deepEqual(entries, []);
});

test('runRequestPlugins 支持 match 过滤与对象返回改写', async () => {
  const plugins = [
    { name: 'only-post', priority: 1, match: (c) => c.method === 'POST', onRequest: (c) => { c.headers['x-a'] = '1'; } },
    { name: 'rewrite', priority: 2, onRequest: () => ({ path: '/new', providerId: 'p2' }) },
  ];
  const ctx = { method: 'GET', path: '/old', providerId: 'p1', headers: {}, body: Buffer.from('') };
  await runRequestPlugins(plugins, ctx, noLog);
  assert.equal(ctx.headers['x-a'], undefined);
  assert.equal(ctx.path, '/new');
  assert.equal(ctx.providerId, 'p2');
});

test('onRequest 抛错默认抛出，failOpen 跳过', async () => {
  const boom = { name: 'boom', onRequest: () => { throw new Error('x'); } };
  await assert.rejects(runRequestPlugins([boom], { headers: {} }, noLog));
  const ctx = { headers: {}, path: '/x' };
  await runRequestPlugins([{ ...boom, failOpen: true }], ctx, noLog);
  assert.equal(ctx.path, '/x');
});

test('runResponsePlugins 改写响应', async () => {
  const p = { name: 'r', onResponse: () => ({ status: 201, body: Buffer.from('ok') }) };
  const ctx = { status: 200, headers: {}, body: Buffer.from('') };
  await runResponsePlugins([p], ctx, noLog);
  assert.equal(ctx.status, 201);
  assert.equal(ctx.body.toString(), 'ok');
});

test('pluginCacheKeyOverride 返回 null 绕过、对象覆盖', () => {
  assert.equal(pluginCacheKeyOverride([{ name: 'k', onCacheKey: () => null }], {}), null);
  assert.deepEqual(pluginCacheKeyOverride([{ name: 'k', onCacheKey: () => ({ key: 'K', ttlMs: 5 }) }], {}), { key: 'K', ttlMs: 5 });
});

test('seedPlugins 只补缺失、不覆盖', () => {
  const src = tmpDir();
  write(src, 'README.md', 'r');
  write(src, 'example-x.mjs.example', 'e');
  const dst = path.join(tmpDir(), 'plugins');
  const first = seedPlugins(dst, src).sort();
  assert.deepEqual(first, ['README.md', 'example-x.mjs.example']);
  write(dst, 'README.md', 'custom');
  assert.deepEqual(seedPlugins(dst, src), []);
  assert.equal(fs.readFileSync(path.join(dst, 'README.md'), 'utf8'), 'custom');
});
