import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Projects } from '../projects.js';
import { createHttpApi } from '../http-api.js';
import { seedRepo } from './helpers/git-fixture.js';

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

test('/api/file 含 NUL 的二进制文件返回 binary:true 且无 content', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.exe'), Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]));
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/file?project=a&path=a.exe');
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.binary, true);
  assert.equal('content' in body, false);
});

test('/api/file 普通 UTF-8 文本返回 binary:false + content', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello world');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/file?project=a&path=a.txt');
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.binary, false);
  assert.equal(body.content, 'hello world');
});

test('/api/file 超 1MB 且首 64KB 含 NUL 返回 binary 而非 413', async (t) => {
  const dir = tmpDir();
  const head = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]), Buffer.alloc(1024, 0x61)]);
  const big = Buffer.concat([head, Buffer.alloc(1024 * 1024 + 512, 0x62)]);   // > 1MB
  fs.writeFileSync(path.join(dir, 'big.bin'), big);
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/file?project=a&path=big.bin');
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).binary, true);
});

test('/api/file 超 1MB 纯文本（前 64KB 无 NUL）仍返回 413', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'big.txt'), Buffer.alloc(1024 * 1024 + 64, 0x61));   // 'a' 无 NUL
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/file?project=a&path=big.txt');
  assert.equal(r.status, 413);
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

test('/api/file/hash 返回 md5+sha256（大文件跨块一致）', async (t) => {
  const dir = tmpDir();
  const buf = Buffer.alloc(300 * 1024);        // 跨 64KB 块边界
  for (let i = 0; i < buf.length; i++) buf[i] = i % 251;
  fs.writeFileSync(path.join(dir, 'big.bin'), buf);
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/file/hash?project=a&path=big.bin');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.md5, crypto.createHash('md5').update(buf).digest('hex'));
  assert.equal(j.sha256, crypto.createHash('sha256').update(buf).digest('hex'));
});

test('/api/file/hash 目录返回 400；不存在 404；越界 403', async (t) => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'sub'));
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const d = await request(server, '/api/file/hash?project=a&path=sub');
  assert.equal(d.status, 400);
  const miss = await request(server, '/api/file/hash?project=a&path=nope.bin');
  assert.equal(miss.status, 404);
  const esc = await request(server, '/api/file/hash?project=a&path=..%2F..%2F..');
  assert.equal(esc.status, 403);
});

test('/api/git/changes POST 返回统计与汇总', async (t) => {
  const repo = seedRepo();
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const r = await post(server, '/api/git/changes', { repo: repo, since: '2026-09-01', until: '2026-09-10' });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.stats.commits, 4);
  assert.equal(j.summary.length, 4);
  assert.equal(j.commits[0].files.length, 1);
});

test('/api/git/changes POST 非仓库 400、坏日期 400、路径不存在 404', async (t) => {
  const empty = tmpDir();
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const nr = await post(server, '/api/git/changes', { repo: empty, since: '2026-09-01', until: '2026-09-10' });
  assert.equal(nr.status, 400);
  const bd = await post(server, '/api/git/changes', { repo: empty, since: 'x', until: '2026-09-10' });
  assert.equal(bd.status, 400);
  const nf = await post(server, '/api/git/changes', { repo: path.join(empty, 'nope'), since: '2026-09-01', until: '2026-09-10' });
  assert.equal(nf.status, 404);
});

test('/api/open-file 项目内文件返回 projectId/rel', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.md'), '# hi');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await post(server, '/api/open-file', { path: path.join(dir, 'a.md') });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.ok, true);
  assert.equal(j.project.id, 'a');
  assert.equal(j.rel, 'a.md');
});

test('/api/open-file 项目外建临时项目', async (t) => {
  const dir = tmpDir();
  const other = tmpDir();
  fs.writeFileSync(path.join(other, 'b.yaml'), 'x: 1');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await post(server, '/api/open-file', { path: path.join(other, 'b.yaml') });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.project.temp, true);
  assert.equal(j.rel, 'b.yaml');
});

test('/api/open-file 不存在返回 404', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await post(server, '/api/open-file', { path: path.join(dir, 'ghost.md') });
  assert.equal(r.status, 404);
});
