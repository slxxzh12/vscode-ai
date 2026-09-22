import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { streamProject, searchProject, IGNORE_DIRS } from '../project-search.js';

function tmpTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dfsearch-'));
  const w = (rel, content) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  return { root, w };
}

async function collect(root, opts) {
  const nameHits = [];
  const contentHits = [];
  const types = [];
  let scanned = 0;
  for await (const ev of streamProject(root, opts)) {
    types.push(ev.type);
    if (ev.type === 'name') nameHits.push(...ev.hits);
    else if (ev.type === 'content') for (const l of ev.lines) contentHits.push({ path: ev.path, name: ev.name, line: l.line, text: l.text });
    else if (ev.type === 'done') scanned = ev.scanned;
  }
  return { nameHits, contentHits, scanned, types };
}

test('文件名与内容命中，内容带行号与整行文本', async () => {
  const { root, w } = tmpTree();
  w('src/app.js', 'const a = 1;\nconst target = 2;\n');
  w('target.md', '# target\n');
  const r = await collect(root, { query: 'target' });
  assert.deepEqual(r.nameHits, [{ path: 'target.md', name: 'target.md' }]);
  assert.deepEqual(
    [...r.contentHits].sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: 'src/app.js', name: 'app.js', line: 2, text: 'const target = 2;' },
      { path: 'target.md', name: 'target.md', line: 1, text: '# target' },
    ],
  );
  assert.equal(r.types.at(-1), 'done');
});

test('超大文件与超长行都不截断', async () => {
  const { root, w } = tmpTree();
  const line = 'x'.repeat(2 * 1024 * 1024) + 'target';
  w('big.txt', line + '\n');
  const r = await collect(root, { query: 'target' });
  assert.equal(r.contentHits.length, 1);
  assert.equal(r.contentHits[0].text, line);
});

test('默认跳过忽略目录与二进制；skipIgnores=false 时一并搜出', async () => {
  const { root, w } = tmpTree();
  w('node_modules/a.txt', 'target\n');
  w('.git/b.txt', 'target\n');
  fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0, 116, 97, 114, 103, 101, 116]));
  w('keep.txt', 'target\n');
  const def = await collect(root, { query: 'target' });
  assert.deepEqual(def.contentHits.map((h) => h.path), ['keep.txt']);
  const all = await collect(root, { query: 'target', skipIgnores: false });
  assert.deepEqual(
    all.contentHits.map((h) => h.path).sort(),
    ['.git/b.txt', 'bin.dat', 'keep.txt', 'node_modules/a.txt'],
  );
});

test('区分大小写开关', async () => {
  const { root, w } = tmpTree();
  w('a.txt', 'Target\n');
  assert.equal((await collect(root, { query: 'target' })).contentHits.length, 1);
  assert.equal((await collect(root, { query: 'target', caseSensitive: true })).contentHits.length, 0);
  assert.equal((await collect(root, { query: 'Target', caseSensitive: true })).contentHits.length, 1);
});

test('空 query 只发 done 事件且不扫描', async () => {
  const { root, w } = tmpTree();
  w('a.txt', 'x');
  const r = await collect(root, { query: '' });
  assert.deepEqual(r.types, ['done']);
  assert.equal(r.scanned, 0);
});

test('单个字母/单字分词被忽略', async () => {
  const { root, w } = tmpTree();
  w('a.txt', 'x\nfoo\n');
  const r = await collect(root, { query: 'x foo' });
  assert.deepEqual(r.contentHits.map((h) => h.line), [2]);
  assert.deepEqual(r.nameHits, []);
});

test('split=false 时整串（含空格）作为一个关键词，不做空格分词', async () => {
  const { root, w } = tmpTree();
  w('a.txt', 'foo bar\nfoo\nbar\n');
  const joined = await collect(root, { query: 'foo bar', split: false });
  assert.deepEqual(joined.contentHits.map((h) => h.line), [1]);
  assert.deepEqual(joined.nameHits, []);
  const tokenized = await collect(root, { query: 'foo bar' });
  assert.deepEqual(tokenized.contentHits.map((h) => h.line), [1, 2, 3]);
});

test('split=false 且整串不足 2 字符时忽略', async () => {
  const { root, w } = tmpTree();
  w('a.txt', 'x y\n');
  const r = await collect(root, { query: 'x', split: false });
  assert.deepEqual(r.types, ['done']);
  assert.equal(r.scanned, 0);
});

test('searchName=false 只搜内容，searchContent=false 只搜文件名', async () => {
  const { root, w } = tmpTree();
  w('target.md', '# target\n');
  const onlyContent = await collect(root, { query: 'target', searchName: false });
  assert.deepEqual(onlyContent.nameHits, []);
  assert.equal(onlyContent.contentHits.length, 1);
  const onlyName = await collect(root, { query: 'target', searchContent: false });
  assert.deepEqual(onlyName.nameHits, [{ path: 'target.md', name: 'target.md' }]);
  assert.deepEqual(onlyName.contentHits, []);
});

test('两种模式都关：只发 done', async () => {
  const { root, w } = tmpTree();
  w('a.txt', 'target\n');
  const r = await collect(root, { query: 'target', searchName: false, searchContent: false });
  assert.deepEqual(r.types, ['done']);
});

test('收集器 searchProject 聚合事件', async () => {
  const { root, w } = tmpTree();
  w('target.md', '# target\n');
  const r = await searchProject(root, { query: 'target' });
  assert.equal(r.nameHits.length, 1);
  assert.equal(r.contentHits.length, 1);
  assert.ok(r.scanned >= 1);
});

test('IGNORE_DIRS 覆盖常见目录', () => {
  for (const d of ['node_modules', '.git', 'dist', 'dist-portable', 'build', 'out', 'coverage']) {
    assert.ok(IGNORE_DIRS.has(d), d);
  }
});
