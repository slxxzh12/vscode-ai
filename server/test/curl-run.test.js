import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeCurl, buildCurlArgs, runCurl } from '../curl-run.js';

test('tokenizeCurl：空格分词与引号', () => {
  assert.deepEqual(tokenizeCurl('curl -X GET https://a.com'), ['curl', '-X', 'GET', 'https://a.com']);
  assert.deepEqual(tokenizeCurl('curl -H "Content-Type: application/json"'), ['curl', '-H', 'Content-Type: application/json']);
  assert.deepEqual(tokenizeCurl('curl -d \'{"a":1}\''), ['curl', '-d', '{"a":1}']);
});

test('tokenizeCurl：反斜杠转义与未闭合引号', () => {
  assert.deepEqual(tokenizeCurl('curl a\\ b'), ['curl', 'a b']);
  assert.throws(() => tokenizeCurl('curl "abc'), (e) => e.code === 'unbalanced-quote');
});

test('buildCurlArgs：支持 curl / curl.exe / 纯选项', () => {
  assert.deepEqual(buildCurlArgs('curl -I https://a.com'), ['-I', 'https://a.com']);
  assert.deepEqual(buildCurlArgs('curl.exe --version'), ['--version']);
  assert.deepEqual(buildCurlArgs('-X POST https://a.com'), ['-X', 'POST', 'https://a.com']);
});

test('buildCurlArgs：拒绝非 curl 与空命令', () => {
  assert.throws(() => buildCurlArgs('wget https://a.com'), (e) => e.code === 'not-curl');
  assert.throws(() => buildCurlArgs('   '), (e) => e.code === 'empty');
});

test('runCurl：真跑一次 curl --version', async () => {
  const r = await runCurl('curl --version');
  if (r.error === 'curl-not-found') return;
  assert.equal(r.ok, true);
  assert.match(r.stdout, /curl/i);
});
