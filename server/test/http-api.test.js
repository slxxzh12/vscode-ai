import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Projects } from '../projects.js';
import { createHttpApi } from '../http-api.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfapi-')); }

async function request(server, url) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: url }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function post(server, url, obj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(obj);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

async function start(projects) {
  const server = http.createServer(createHttpApi({ projects }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}

test('/api/projects 返回列表', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/projects');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body).projects, [{ id: 'a', name: 'A', root: dir }]);
});

test('/api/tree 正常返回 items', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'f.txt'), '');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/tree?project=a&path=');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { items: [{ name: 'f.txt', type: 'file' }] });
});

test('/api/tree 越界返回 403', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/tree?project=a&path=..%2F..%2F..');
  assert.equal(r.status, 403);
});

test('/api/tree 未知项目返回 404', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/tree?project=nope&path=');
  assert.equal(r.status, 404);
});

test('非 /api 路由返回 404 json', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/nope');
  assert.equal(r.status, 404);
});

test('/api/file 读取文本', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello world');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/file?project=a&path=a.txt');
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.content, 'hello world');
  assert.equal(body.size, 11);
});

test('/api/file 目录返回 400，越界返回 403', async (t) => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'sub'));
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const d = await request(server, '/api/file?project=a&path=sub');
  assert.equal(d.status, 400);
  const esc = await request(server, '/api/file?project=a&path=..%2Fprojects.json');
  assert.equal(esc.status, 403);
});

test('/api/raw 按扩展名给 Content-Type 并返回字节', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/raw?project=a&path=pic.png');
  assert.equal(r.status, 200);
  assert.ok(r.body.includes('PNG'));
});

test('/api/file POST 自动保存写盘并可读回', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'before');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const w = await post(server, '/api/file?project=a&path=a.txt', { content: 'after edit\nline2' });
  assert.equal(w.status, 200);
  const rb = await request(server, '/api/file?project=a&path=a.txt');
  assert.equal(JSON.parse(rb.body).content, 'after edit\nline2');
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'after edit\nline2');
});

test('/api/file POST 越界 403；缺 content 400', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const esc = await post(server, '/api/file?project=a&path=..%2F..%2FREADME.md', { content: 'x' });
  assert.equal(esc.status, 403);
  const noContent = await post(server, '/api/file?project=a&path=a.txt', {});
  assert.equal(noContent.status, 400);
});

test('/api/file POST create 新建文件（可含嵌套目录）并可读回', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const c = await post(server, '/api/file?project=a&path=new%2Fsub%2Fapp.txt', { create: true, content: 'hello' });
  assert.equal(c.status, 200);
  assert.equal(JSON.parse(c.body).size, 5);
  const rb = await request(server, '/api/file?project=a&path=new%2Fsub%2Fapp.txt');
  assert.equal(JSON.parse(rb.body).content, 'hello');
});

test('/api/file POST create 已存在返回 409', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await post(server, '/api/file?project=a&path=x.txt', { create: true, content: 'y' });
  assert.equal(r.status, 409);
});

test('/api/file POST create dir 新建目录', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const d = await post(server, '/api/file?project=a&path=made%2Ffolder', { create: true, dir: true });
  assert.equal(d.status, 200);
  assert.equal(fs.existsSync(path.join(dir, 'made', 'folder')), true);
});

test('/api/format json 压成一行', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const r = await post(server, '/api/format', { name: 'a.json', content: '{ "a": 1,  "b": [1, 2, 3] }' });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.ok(!j.content.includes('\n'));
  assert.deepEqual(JSON.parse(j.content), { a: 1, b: [1, 2, 3] });
});

test('/api/format js 压缩为单行且语义等价', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const src = 'function add(a, b) {\n  // 注释\n  return a + b;\n}\nconst x = add(1, 2);';
  const r = await post(server, '/api/format', { name: 'a.js', content: src });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.ok(!j.content.includes('\n'));
  assert.ok(j.content.includes('x='));
});

test('/api/format 非法 JSON/不支持类型返回 400', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const bad = await post(server, '/api/format', { name: 'a.json', content: '{ nope' });
  assert.equal(bad.status, 400);
  const unsupported = await post(server, '/api/format', { name: 'a.txt', content: 'x' });
  assert.equal(unsupported.status, 400);
});

test('/api/file/meta 返回文件字段（含绝对路径）', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'm.txt'), 'hello');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/file/meta?project=a&path=m.txt');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.name, 'm.txt');
  assert.equal(j.path, 'm.txt');
  assert.equal(j.size, 5);
  assert.equal(typeof j.mtime, 'number');
  assert.equal(j.isDir, false);
  assert.equal(path.resolve(j.abs), path.join(dir, 'm.txt'));
});

test('/api/file/meta 目录也返回（size 为目录 stat）', async (t) => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'sub'));
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/file/meta?project=a&path=sub');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.name, 'sub');
  assert.equal(j.isDir, true);
  assert.equal(typeof j.size, 'number');
});

test('/api/file/meta 越界 403、不存在 404', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const esc = await request(server, '/api/file/meta?project=a&path=..%2F..%2F..');
  assert.equal(esc.status, 403);
  const miss = await request(server, '/api/file/meta?project=a&path=nope.txt');
  assert.equal(miss.status, 404);
});
