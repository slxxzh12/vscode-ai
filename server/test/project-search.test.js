import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchProject, IGNORE_DIRS } from '../project-search.js';

function tmpTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dfsearch-'));
  const w = (rel, content) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  return { root, w };
}

test('文件名与内容命中，内容带行号与行文本', () => {
  const { root, w } = tmpTree();
  w('src/app.js', 'const a = 1;\nconst target = 2;\n');
  w('target.md', '# target\n');
  const r = searchProject(root, { query: 'target' });
  assert.deepEqual(r.nameHits, [{ path: 'target.md', name: 'target.md' }]);
  assert.deepEqual(
    [...r.contentHits].sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: 'src/app.js', name: 'app.js', line: 2, text: 'const target = 2;' },
      { path: 'target.md', name: 'target.md', line: 1, text: '# target' },
    ],
  );
  assert.equal(r.truncated, false);
});

test('区分大小写开关', () => {
  const { root, w } = tmpTree();
  w('a.txt', 'Target\n');
  assert.equal(searchProject(root, { query: 'target' }).contentHits.length, 1);
  assert.equal(searchProject(root, { query: 'target', caseSensitive: true }).contentHits.length, 0);
  assert.equal(searchProject(root, { query: 'Target', caseSensitive: true }).contentHits.length, 1);
});

test('跳过忽略目录、二进制文件与超大文件', () => {
  const { root, w } = tmpTree();
  w('node_modules/a.txt', 'target\n');
  w('.git/b.txt', 'target\n');
  w('dist/c.txt', 'target\n');
  w('dist-portable/d.txt', 'target\n');
  fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0, 116, 97, 114, 103, 101, 116]));
  fs.writeFileSync(path.join(root, 'big.txt'), 'target\n'.repeat(300000));
  w('keep.txt', 'target\n');
  const r = searchProject(root, { query: 'target' });
  assert.deepEqual(r.contentHits.map((h) => h.path), ['keep.txt']);
});

test('总内容命中上限触发 truncated', () => {
  const { root, w } = tmpTree();
  w('a.txt', 'xx\nxx\nyy\n');
  const r = searchProject(root, { query: 'xx', limits: { maxContentHits: 2 } });
  assert.equal(r.contentHits.length, 2);
  assert.equal(r.truncated, true);
});

test('单文件内容命中上限触发 truncated', () => {
  const { root, w } = tmpTree();
  w('a.txt', Array.from({ length: 10 }, () => 'hit').join('\n'));
  const r = searchProject(root, { query: 'hit', limits: { maxHitsPerFile: 3 } });
  assert.equal(r.contentHits.length, 3);
  assert.equal(r.truncated, true);
});

test('空 query 返回空结果且不扫描', () => {
  const { root, w } = tmpTree();
  w('a.txt', 'x');
  assert.deepEqual(searchProject(root, { query: '' }), { nameHits: [], contentHits: [], truncated: false, scanned: 0 });
});

test('单个字母/单字分词被忽略，只用有效分词', () => {
  const { root, w } = tmpTree();
  w('a.txt', 'x\nfoo\n');
  const r = searchProject(root, { query: 'x foo' });
  assert.deepEqual(r.contentHits.map((h) => h.line), [2]);
  assert.deepEqual(r.nameHits, []);
});

test('全是单个字母/单字分词：返回空结果且不扫描', () => {
  const { root, w } = tmpTree();
  w('a.txt', 'x\n');
  assert.deepEqual(
    searchProject(root, { query: 'a b' }),
    { nameHits: [], contentHits: [], truncated: false, scanned: 0 },
  );
});

test('多分词内容：命中分词多的文件排前，少者排后', () => {
  const { root, w } = tmpTree();
  w('aaa.txt', 'foo\n');
  w('zzz.txt', 'foo bar\n');
  const r = searchProject(root, { query: 'foo bar' });
  assert.deepEqual(r.contentHits.map((h) => h.path), ['zzz.txt', 'aaa.txt']);
});

test('多分词文件名：命中分词多的排前', () => {
  const { root, w } = tmpTree();
  w('foo-aaa.txt', 'x\n');
  w('bar-foo.txt', 'x\n');
  const r = searchProject(root, { query: 'foo bar', searchContent: false });
  assert.equal(r.nameHits[0].path, 'bar-foo.txt');
  assert.equal(r.nameHits.length, 2);
});

test('多分词：命中任一分词即算命中（单个也保留）', () => {
  const { root, w } = tmpTree();
  w('only-foo.txt', 'x\n');
  const r = searchProject(root, { query: 'foo bar', searchContent: false });
  assert.deepEqual(r.nameHits.map((h) => h.path), ['only-foo.txt']);
});

test('searchName=false 只搜内容', () => {
  const { root, w } = tmpTree();
  w('target.md', '# target\n');
  const r = searchProject(root, { query: 'target', searchName: false });
  assert.deepEqual(r.nameHits, []);
  assert.equal(r.contentHits.length, 1);
});

test('searchContent=false 只搜文件名', () => {
  const { root, w } = tmpTree();
  w('target.md', '# target\n');
  const r = searchProject(root, { query: 'target', searchContent: false });
  assert.deepEqual(r.nameHits, [{ path: 'target.md', name: 'target.md' }]);
  assert.deepEqual(r.contentHits, []);
});

test('两种模式都关：返回空结果且不扫描', () => {
  const { root, w } = tmpTree();
  w('a.txt', 'target\n');
  assert.deepEqual(
    searchProject(root, { query: 'target', searchName: false, searchContent: false }),
    { nameHits: [], contentHits: [], truncated: false, scanned: 0 },
  );
});

test('IGNORE_DIRS 覆盖常见目录', () => {
  for (const d of ['node_modules', '.git', 'dist', 'dist-portable', 'build', 'out', 'coverage']) {
    assert.ok(IGNORE_DIRS.has(d), d);
  }
});
