import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectCodeStats } from '../code-count.js';
import { makeRepo, commit } from './helpers/git-fixture.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfcode-')); }
function w(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('collectCodeStats 按 countReal 口径统计并列文件', async () => {
  const dir = tmp();
  w(dir, 'src/a.js', ['// c', '', '{', 'const a = 1;', '中文', 'foo();'].join('\n'));
  w(dir, 'src/b.js', 'const b = 2;\n');
  const r = await collectCodeStats({ dir });
  assert.equal(r.totals.files, 2);
  const by = Object.fromEntries(r.files.map((f) => [f.rel, f]));
  assert.deepEqual(by['src/a.js'], { rel: 'src/a.js', real: 2, total: 6 });
  assert.deepEqual(by['src/b.js'], { rel: 'src/b.js', real: 1, total: 2 });
  assert.deepEqual(r.groups, [{ key: 'src', real: 3, total: 8, files: 2 }]);
  assert.deepEqual(r.totals, { files: 2, real: 3, total: 8 });
});

test('collectCodeStats filter：exts / excludeDirs / excludeTestFiles', async () => {
  const dir = tmp();
  w(dir, 'src/a.js', 'const a = 1;\n');
  w(dir, 'src/b.py', 'x = 1\n');
  w(dir, 'docs/g.js', 'const g = 1;\n');
  w(dir, 'src/a.test.js', 'const t = 1;\n');
  const r = await collectCodeStats({ dir, filter: { exts: ['.js'], excludeDirs: ['docs'], excludeTestFiles: true } });
  assert.deepEqual(r.files.map((f) => f.rel), ['src/a.js']);
});

test('collectCodeStats 硬跳过 node_modules 与点目录', async () => {
  const dir = tmp();
  w(dir, 'node_modules/x/i.js', 'const i = 1;\n');
  w(dir, '.git/hooks/h.js', 'const h = 1;\n');
  w(dir, 'ok.js', 'const o = 1;\n');
  const r = await collectCodeStats({ dir });
  assert.deepEqual(r.files.map((f) => f.rel), ['ok.js']);
});

test('collectCodeStats 清单/锁文件即使后缀包含 .json 也排除', async () => {
  const dir = tmp();
  w(dir, 'package.json', '{"name":"x"}\n');
  w(dir, 'package-lock.json', '{"lockfileVersion":3}\n');
  w(dir, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
  w(dir, 'yarn.lock', 'x\n');
  w(dir, 'node_modules/p/package.json', '{"name":"p"}\n');
  w(dir, 'src/a.js', 'const a = 1;\n');
  w(dir, 'src/b.json', '{"b":1}\n');
  const r = await collectCodeStats({ dir, filter: { exts: ['.js', '.json', '.yaml', '.lock'] } });
  assert.deepEqual(r.files.map((f) => f.rel), ['src/a.js', 'src/b.json']);
});

test('collectCodeStats 跳过二进制与超 2MiB 文件', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'bin.js'), Buffer.from([0x63, 0x00, 0x6f]));
  fs.writeFileSync(path.join(dir, 'big.js'), Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
  w(dir, 'ok.js', 'const o = 1;\n');
  const r = await collectCodeStats({ dir });
  assert.deepEqual(r.files.map((f) => f.rel), ['ok.js']);
});

test('collectCodeStats 根目录文件归 (root) 分组', async () => {
  const dir = tmp();
  w(dir, 'root.js', 'const r = 1;\n');
  const r = await collectCodeStats({ dir });
  assert.equal(r.groups[0].key, '(root)');
});

test('collectCodeStats 非目录/不存在 → not-found；空 dir → bad-dir', async () => {
  const dir = tmp();
  await assert.rejects(() => collectCodeStats({ dir: path.join(dir, 'nope') }), (e) => e.code === 'not-found');
  await assert.rejects(() => collectCodeStats({ dir: '' }), (e) => e.code === 'bad-dir');
  await assert.rejects(() => collectCodeStats({}), (e) => e.code === 'bad-dir');
});

test('collectCodeStats 超过 MAX_FILES 截断', async () => {
  const dir = tmp();
  for (let i = 0; i < 5001; i++) w(dir, `f${i}.js`, `const v${i} = ${i};\n`);
  const r = await collectCodeStats({ dir });
  assert.equal(r.totals.files, 5000);
  assert.equal(r.truncated, true);
});

test('collectCodeStats 贴首次提交人（含子目录扫描）', async () => {
  const repo = makeRepo();
  w(repo, 'src/a.js', 'const a = 1;\n');
  commit(repo, 'first', '2026-09-01T10:00:00');
  w(repo, 'src/b.js', 'const b = 1;\n');
  commit(repo, 'second', '2026-09-02T10:00:00');

  const r = await collectCodeStats({ dir: repo, filter: { exts: ['.js'] } });
  const by = Object.fromEntries(r.files.map((f) => [f.rel, f]));
  assert.equal(by['src/a.js'].firstAuthor, 'tester');
  assert.equal(by['src/b.js'].firstAuthor, 'tester');

  const sub = await collectCodeStats({ dir: path.join(repo, 'src'), filter: { exts: ['.js'] } });
  assert.deepEqual(sub.files.map((f) => [f.rel, f.firstAuthor]), [['a.js', 'tester'], ['b.js', 'tester']]);
});

test('collectCodeStats 非 git 目录不贴首次提交人', async () => {
  const dir = tmp();
  w(dir, 'a.js', 'const a = 1;\n');
  const r = await collectCodeStats({ dir, filter: { exts: ['.js'] } });
  assert.equal(r.files[0].firstAuthor, undefined);
});
