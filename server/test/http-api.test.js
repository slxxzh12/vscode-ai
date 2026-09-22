import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Projects } from '../projects.js';
import { createHttpApi } from '../http-api.js';
import { readZip } from '../collaboration/zip.js';
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
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, body: buf.toString('utf8'), buf });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

function del(server, url) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method: 'DELETE' }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function patch(server, url, obj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(obj);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, body: buf.toString('utf8'), buf });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

function postRaw(server, url, raw) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end(raw);
  });
}

async function start(projects, deps = {}) {
  const server = http.createServer(createHttpApi({ projects, ...deps }));
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

// 解析 /api/search 的 NDJSON 流，并聚合出与旧结构等价的 { nameHits, contentHits }
function combineSearch(text) {
  const nameHits = [];
  const contentHits = [];
  for (const line of text.trim().split('\n').filter(Boolean)) {
    const e = JSON.parse(line);
    if (e.type === 'name') nameHits.push(...e.hits);
    else if (e.type === 'content') for (const l of e.lines) contentHits.push({ path: e.path, name: e.name, line: l.line, text: l.text });
  }
  return { nameHits, contentHits };
}

test('/api/search 正常返回名字与内容命中', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'target.md'), '# target\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'const target = 1;\n');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'target\n');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/search?project=a&q=target');
  assert.equal(r.status, 200);
  const body = combineSearch(r.body);
  assert.deepEqual(body.nameHits, [{ path: 'target.md', name: 'target.md' }]);
  assert.deepEqual(
    body.contentHits.map((h) => [h.path, h.line]).sort(),
    [['src/a.js', 1], ['target.md', 1]],
  );
});

test('/api/search name=0 只返回内容命中', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'target.md'), '# target\n');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const body = combineSearch((await request(server, '/api/search?project=a&q=target&name=0')).body);
  assert.deepEqual(body.nameHits, []);
  assert.equal(body.contentHits.length, 1);
});

test('/api/search content=0 只返回名字命中', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'target.md'), '# target\n');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const body = combineSearch((await request(server, '/api/search?project=a&q=target&content=0')).body);
  assert.deepEqual(body.nameHits, [{ path: 'target.md', name: 'target.md' }]);
  assert.deepEqual(body.contentHits, []);
});

test('/api/search q 为空返回 400', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  assert.equal((await request(server, '/api/search?project=a&q=')).status, 400);
});

test('/api/search 未知项目返回 404', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  assert.equal((await request(server, '/api/search?project=nope&q=x')).status, 404);
});

test('/api/search/replace 全量替换命中内容', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'target target\n');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await post(server, '/api/search/replace', { project: 'a', q: 'target', replace: 'T' });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { ok: true, files: 1, replacements: 2 });
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'T T\n');
});

test('/api/search/replace q 为空返回 400', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  assert.equal((await post(server, '/api/search/replace', { project: 'a', q: '', replace: 'x' })).status, 400);
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

test('/api/code/stats POST 返回实代码统计', async (t) => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), '// c\nconst a = 1;\n');
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const r = await post(server, '/api/code/stats', { dir, filter: { exts: ['.js'] } });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.deepEqual(j.files, [{ rel: 'src/a.js', real: 1, total: 3 }]);
  assert.deepEqual(j.totals, { files: 1, real: 1, total: 3 });
});

test('/api/code/stats POST 坏 dir 400、不存在 404', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const bad = await post(server, '/api/code/stats', { dir: '' });
  assert.equal(bad.status, 400);
  const nf = await post(server, '/api/code/stats', { dir: path.join(tmpDir(), 'nope') });
  assert.equal(nf.status, 404);
});

test('/api/export/zip 返回可回读的 zip', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const r = await post(server, '/api/export/zip', { zipName: 'a.zip', files: [{ name: 'a.csv', content: '\uFEFFa,b\r\n' }] });
  assert.equal(r.status, 200);
  assert.equal(r.buf.readUInt32LE(0), 0x04034b50);
  const entries = readZip(r.buf);
  assert.equal(entries[0].name, 'a.csv');
  assert.equal(entries[0].data.toString('utf8'), '\uFEFFa,b\r\n');
});

test('/api/export/zip 空 files 400、非法名 400、超量 413', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  assert.equal((await post(server, '/api/export/zip', { files: [] })).status, 400);
  assert.equal((await post(server, '/api/export/zip', { files: [{ name: '../x.csv', content: 'x' }] })).status, 400);
  const many = Array.from({ length: 101 }, (_, i) => ({ name: `f${i}.csv`, content: 'x' }));
  assert.equal((await post(server, '/api/export/zip', { files: many })).status, 413);
});

test('/api/code/groups GET 默认空、POST 保存后读回', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const empty = await request(server, '/api/code/groups');
  assert.equal(empty.status, 200);
  assert.deepEqual(JSON.parse(empty.body), { groups: [], members: {} });

  const r = await post(server, '/api/code/groups', { groups: ['A组', 'A组', ''], members: { 张三: 'A组', 李四: 'B组' } });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { groups: ['A组'], members: { 张三: 'A组' } });

  const again = await request(server, '/api/code/groups');
  assert.deepEqual(JSON.parse(again.body), { groups: ['A组'], members: { 张三: 'A组' } });
});

test('/api/code/prefs GET 默认空、POST 只存已知键且读回', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const empty = await request(server, '/api/code/prefs');
  assert.equal(empty.status, 200);
  assert.deepEqual(JSON.parse(empty.body), {});

  const r = await post(server, '/api/code/prefs', { exts: '.js, .xml', excludeTestFiles: false, nope: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { exts: '.js, .xml', excludeTestFiles: false });

  const again = await request(server, '/api/code/prefs');
  assert.deepEqual(JSON.parse(again.body), { exts: '.js, .xml', excludeTestFiles: false });
});

test('/api/composer/prefs GET 默认空、POST 只存 autoSend 且读回', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const empty = await request(server, '/api/composer/prefs');
  assert.equal(empty.status, 200);
  assert.deepEqual(JSON.parse(empty.body), {});

  const r = await post(server, '/api/composer/prefs', { autoSend: false, nope: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { autoSend: false });

  const again = await request(server, '/api/composer/prefs');
  assert.deepEqual(JSON.parse(again.body), { autoSend: false });

  const bad = await post(server, '/api/composer/prefs', { autoSend: 'yes' });
  assert.equal(bad.status, 200);
  assert.deepEqual(JSON.parse(bad.body), {});
});

test('/api/projects/pick 走注入的目录选择器（成功/取消/错误）', async (t) => {
  const dir = tmpDir();
  const pickFolderFn = async () => ({ path: dir });
  const server = await start(new Projects({ projects: [] }), { pickFolderFn });
  t.after(() => server.close());
  const ok = await post(server, '/api/projects/pick', {});
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).path, dir);

  const cancelled = await start(new Projects({ projects: [] }), { pickFolderFn: async () => ({ cancelled: true }) });
  t.after(() => cancelled.close());
  assert.deepEqual(JSON.parse((await post(cancelled, '/api/projects/pick', {})).body), { cancelled: true });

  const errored = await start(new Projects({ projects: [] }), { pickFolderFn: async () => ({ error: 'unsupported' }) });
  t.after(() => errored.close());
  assert.deepEqual(JSON.parse((await post(errored, '/api/projects/pick', {})).body), { error: 'unsupported', message: null });
});

test('POST /api/projects 新增目录：校验 body/路径/目录/重名，重名 slug 递增生 id', async (t) => {
  const dir = tmpDir();
  const a = path.join(dir, 'a', 'My Proj');
  const b = path.join(dir, 'b', 'My Proj');
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
  let saves = 0;
  const projects = new Projects({ projects: [] });
  const server = await start(projects, { saveProjects: () => { saves++; } });
  t.after(() => server.close());

  assert.equal((await postRaw(server, '/api/projects', '{ nope')).status, 400);
  assert.equal((await post(server, '/api/projects', { path: '   ' })).status, 400);
  assert.equal((await post(server, '/api/projects', { path: path.join(dir, 'ghost') })).status, 404);
  assert.equal((await post(server, '/api/projects', { path: path.join(dir, 'file.txt') })).status, 400);

  const first = await post(server, '/api/projects', { path: a });
  assert.equal(first.status, 200);
  const f = JSON.parse(first.body).project;
  assert.equal(f.id, 'my-proj');
  assert.equal(f.name, 'My Proj');
  assert.equal(saves, 1);

  assert.equal((await post(server, '/api/projects', { path: a })).status, 409);

  const second = await post(server, '/api/projects', { path: b });
  assert.equal(second.status, 200);
  assert.equal(JSON.parse(second.body).project.id, 'my-proj-2');

  const named = await post(server, '/api/projects', { path: path.join(dir, 'a'), name: 'Custom' });
  assert.equal(named.status, 200);
  assert.equal(JSON.parse(named.body).project.name, 'Custom');
});

test('/api/run-script 注入执行器：ok / 不支持扩展名 / 平台不支持', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.bat'), 'echo hi');
  fs.writeFileSync(path.join(dir, 'a.sh'), 'echo hi');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  const calls = [];
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }), {
    runScriptFn: (abs, ext) => { calls.push([abs, ext]); return true; },
  });
  t.after(() => server.close());
  const ok = await post(server, '/api/run-script?project=a&path=a.bat', {});
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).ok, true);
  assert.equal(calls[0][1], 'bat');
  assert.equal((await post(server, '/api/run-script?project=a&path=a.txt', {})).status, 400);

  const noPlatform = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }), { runScriptFn: () => false });
  t.after(() => noPlatform.close());
  assert.equal((await post(noPlatform, '/api/run-script?project=a&path=a.sh', {})).status, 501);
});

test('/api/explorer/reveal 注入定位器：存在→200，不存在→404，平台不支持→501', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }), { revealInOsFn: () => true });
  t.after(() => server.close());
  assert.equal((await post(server, '/api/explorer/reveal?project=a&path=a.txt', {})).status, 200);
  assert.equal((await post(server, '/api/explorer/reveal?project=a&path=ghost.txt', {})).status, 404);

  const noPlatform = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }), { revealInOsFn: () => false });
  t.after(() => noPlatform.close());
  assert.equal((await post(noPlatform, '/api/explorer/reveal?project=a&path=a.txt', {})).status, 501);
});

test('/api/file/pick 返回文本元数据；二进制标 binary；超 1MB 文本 413；取消/错误', async (t) => {
  const dir = tmpDir();
  const text = path.join(dir, 'note.txt');
  const bin = path.join(dir, 'a.bin');
  const big = path.join(dir, 'big.txt');
  fs.writeFileSync(text, 'hello');
  fs.writeFileSync(bin, Buffer.from([0x41, 0x00, 0x42]));
  fs.writeFileSync(big, Buffer.alloc(1024 * 1024 + 10, 0x61));

  async function pick(result) {
    const s = await start(new Projects({ projects: [] }), { pickAnyFileFn: async () => result });
    t.after(() => s.close());
    return post(s, '/api/file/pick', {});
  }

  const r = await pick({ path: text });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.name, 'note.txt');
  assert.equal(j.content, 'hello');
  assert.equal(j.binary, false);

  const b = await pick({ path: bin });
  assert.equal(JSON.parse(b.body).binary, true);
  assert.equal('content' in JSON.parse(b.body), false);

  assert.equal((await pick({ path: big })).status, 413);
  assert.deepEqual(JSON.parse((await pick({ cancelled: true })).body), { cancelled: true });
  assert.deepEqual(JSON.parse((await pick({ error: 'unsupported', message: 'x' })).body), { error: 'unsupported', message: 'x' });
});

test('/api/file/pick-path 只回路径：成功/取消/错误', async (t) => {
  const dir = tmpDir();
  const f = path.join(dir, 'a.txt');
  const server = await start(new Projects({ projects: [] }), { pickAnyFileFn: async () => ({ path: f }) });
  t.after(() => server.close());
  assert.deepEqual(JSON.parse((await post(server, '/api/file/pick-path', {})).body), { path: f });

  const cancelled = await start(new Projects({ projects: [] }), { pickAnyFileFn: async () => ({ cancelled: true }) });
  t.after(() => cancelled.close());
  assert.deepEqual(JSON.parse((await post(cancelled, '/api/file/pick-path', {})).body), { cancelled: true });

  const errored = await start(new Projects({ projects: [] }), { pickAnyFileFn: async () => ({ error: 'unsupported' }) });
  t.after(() => errored.close());
  assert.deepEqual(JSON.parse((await post(errored, '/api/file/pick-path', {})).body), { error: 'unsupported', message: null });
});

test('GET /api/session-projects 默认空对象', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const r = await request(server, '/api/session-projects');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), {});
});

test('GET /api/window-state 默认空对象；POST 归一化后落盘', async (t) => {
  const { createWindowState } = await import('../window-state.js');
  const windowState = createWindowState({ file: path.join(tmpDir(), 'window-state.json') });
  const server = await start(new Projects({ projects: [] }), { windowState });
  t.after(() => server.close());

  const empty = await request(server, '/api/window-state');
  assert.equal(empty.status, 200);
  assert.deepEqual(JSON.parse(empty.body), {});

  const saved = await post(server, '/api/window-state', {
    rail: 'history', historyTab: 'messages', msgFilter: false,
    tabs: [{ projectId: 'p1', path: 'a.ts', label: 'a.ts' }, { projectId: 'p1' }, 'nope'],
    activeTab: 'f:p1|a.ts', junk: true,
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(JSON.parse(saved.body), {
    rail: 'history', historyTab: 'messages', msgFilter: false,
    tabs: [{ projectId: 'p1', path: 'a.ts', label: 'a.ts' }], activeTab: 'f:p1|a.ts',
  });

  const back = await request(server, '/api/window-state');
  assert.deepEqual(JSON.parse(back.body), JSON.parse(saved.body));
});

test('POST /api/window-state 非法字段被剔除（rail=mobile 不持久化）', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const r = await post(server, '/api/window-state', { rail: 'mobile', msgFilter: 'x', tabs: 'nope' });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), {});
});

test('POST /api/curl 执行后按 curl 去重落盘到 postman 目录', async (t) => {
  const { createPostmanHistory } = await import('../postman-history.js');
  const dir = tmpDir();
  const postmanHistory = createPostmanHistory({ dir });
  const result = { ok: true, code: 0, error: '', timedOut: false, stdout: 'ok', stderr: '' };
  const server = await start(new Projects({ projects: [] }), { runCurlFn: async () => result, postmanHistory });
  t.after(() => server.close());

  const r1 = await post(server, '/api/curl', { command: 'curl https://a.com' });
  assert.equal(r1.status, 200);
  assert.deepEqual(JSON.parse(r1.body), result);
  await post(server, '/api/curl', { command: 'curl https://a.com' });
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 1, '同一 curl 只留一条记录');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8')).command, 'curl https://a.com');

  const got = await request(server, '/api/postman/history');
  assert.equal(got.status, 200);
  const items = JSON.parse(got.body).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].command, 'curl https://a.com');
  assert.equal(items[0].id, files[0]);

  const removed = await del(server, `/api/postman/history?id=${encodeURIComponent(items[0].id)}`);
  assert.equal(removed.status, 200);
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length, 0);
  assert.equal((await del(server, '/api/postman/history?id=../evil.json')).status, 404);
});

test('GET /api/postman/history 未注入 store 时返回空列表', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const r = await request(server, '/api/postman/history');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { items: [], folders: [] });
});

test('POST/DELETE /api/postman/folder 与 /api/postman/move', async (t) => {
  const { createPostmanHistory } = await import('../postman-history.js');
  const dir = tmpDir();
  const postmanHistory = createPostmanHistory({ dir });
  const result = { ok: true, code: 0, error: '', timedOut: false, stdout: 'ok', stderr: '' };
  const server = await start(new Projects({ projects: [] }), { runCurlFn: async () => result, postmanHistory });
  t.after(() => server.close());

  const made = await post(server, '/api/postman/folder', { path: 'foo' });
  assert.equal(made.status, 200);
  assert.deepEqual(JSON.parse(made.body), { ok: true, folder: 'foo' });
  assert.equal(fs.existsSync(path.join(dir, 'foo')), true);

  await post(server, '/api/curl', { command: 'curl https://a.com', folder: 'foo' });
  const items = JSON.parse((await request(server, '/api/postman/history')).body).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].id, `foo/${items[0].name}`);

  const moved = await post(server, '/api/postman/move', { id: items[0].id, folder: '' });
  assert.equal(moved.status, 200);
  const after = JSON.parse((await request(server, '/api/postman/history')).body).items;
  assert.equal(after[0].folder, '');

  const bad = await post(server, '/api/postman/folder', { path: '../evil' });
  assert.equal(bad.status, 400);

  const removed = await del(server, '/api/postman/folder?path=foo');
  assert.equal(removed.status, 200);
  assert.equal((await del(server, '/api/postman/folder?path=foo')).status, 404);
});

test('PATCH /api/postman/folder 重命名；PATCH /api/postman/history 改标题', async (t) => {
  const { createPostmanHistory } = await import('../postman-history.js');
  const dir = tmpDir();
  const postmanHistory = createPostmanHistory({ dir });
  const result = { ok: true, code: 0, error: '', timedOut: false, stdout: 'ok', stderr: '' };
  const server = await start(new Projects({ projects: [] }), { runCurlFn: async () => result, postmanHistory });
  t.after(() => server.close());

  await post(server, '/api/postman/folder', { path: 'foo' });
  const renamed = await patch(server, '/api/postman/folder', { path: 'foo', name: 'bar' });
  assert.equal(renamed.status, 200);
  assert.deepEqual(JSON.parse(renamed.body), { ok: true, path: 'bar' });
  assert.equal(fs.existsSync(path.join(dir, 'bar')), true);

  await post(server, '/api/curl', { command: 'curl https://a.com', folder: 'bar' });
  const items = JSON.parse((await request(server, '/api/postman/history')).body).items;
  const rec = await patch(server, '/api/postman/history', { id: items[0].id, title: 'My A' });
  assert.equal(rec.status, 200);
  const after = JSON.parse((await request(server, '/api/postman/history')).body).items;
  assert.equal(after[0].title, 'My A');

  await post(server, '/api/postman/folder', { path: 'other' });
  const conflict = await patch(server, '/api/postman/folder', { path: 'bar', name: 'other' });
  assert.equal(conflict.status, 400);
  assert.equal(JSON.parse(conflict.body).error, 'exists');
  assert.equal((await patch(server, '/api/postman/history', { id: '../evil.json', title: 'x' })).status, 404);
});
