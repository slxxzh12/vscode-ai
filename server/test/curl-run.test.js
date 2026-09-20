import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeCurl, buildCurlArgs, runCurl, splitResponse } from '../curl-run.js';

test('tokenizeCurl：空格分词与引号', () => {
  assert.deepEqual(tokenizeCurl('curl -X GET https://a.com'), ['curl', '-X', 'GET', 'https://a.com']);
  assert.deepEqual(tokenizeCurl('curl -H "Content-Type: application/json"'), ['curl', '-H', 'Content-Type: application/json']);
  assert.deepEqual(tokenizeCurl('curl -d \'{"a":1}\''), ['curl', '-d', '{"a":1}']);
});

test('tokenizeCurl：反斜杠转义与未闭合引号', () => {
  assert.deepEqual(tokenizeCurl('curl a\\ b'), ['curl', 'a b']);
  assert.throws(() => tokenizeCurl('curl "abc'), (e) => e.code === 'unbalanced-quote');
});

test('tokenizeCurl：反斜杠换行续行（Chrome Copy as cURL）', () => {
  const lf = "curl --url 'https://a.com/x' \\\n  -X 'OPTIONS' \\\n  -H 'accept: */*'";
  assert.deepEqual(tokenizeCurl(lf), ['curl', '--url', 'https://a.com/x', '-X', 'OPTIONS', '-H', 'accept: */*']);
  const crlf = "curl -H 'a: 1' \\\r\n  -H 'b: 2'";
  assert.deepEqual(tokenizeCurl(crlf), ['curl', '-H', 'a: 1', '-H', 'b: 2']);
  assert.deepEqual(tokenizeCurl('curl "a\\\nb"'), ['curl', 'ab']);
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

test('splitResponse：拆出状态码 / 响应头 / 响应体', () => {
  const raw = 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nhello';
  assert.deepEqual(splitResponse(raw), { status: 200, headers: 'HTTP/1.1 200 OK\r\nContent-Type: text/plain', body: 'hello' });
});

test('splitResponse：没有响应头时整段算响应体', () => {
  assert.deepEqual(splitResponse('curl 8.0.0'), { status: 0, headers: '', body: 'curl 8.0.0' });
});

test('splitResponse：重定向多段头取最后状态码', () => {
  const raw = 'HTTP/1.1 301 Moved\r\nLocation: /x\r\n\r\nHTTP/1.1 404 Not Found\r\nX: 1\r\n\r\nbody';
  const r = splitResponse(raw);
  assert.equal(r.status, 404);
  assert.equal(r.body, 'body');
  assert.match(r.headers, /301/);
  assert.match(r.headers, /404/);
});

test('runCurl：真跑一次 curl --version', async () => {
  const r = await runCurl('curl --version');
  if (r.error === 'curl-not-found') return;
  assert.equal(r.ok, true);
  assert.match(r.stdout, /curl/i);
});
