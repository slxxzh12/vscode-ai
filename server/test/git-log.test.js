import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectGitChanges } from '../git-log.js';
import { tmpDir, makeRepo, seedRepo, commit } from './helpers/git-fixture.js';

const RANGE = { since: '2026-09-01', until: '2026-09-10' };

test('collectGitChanges filter 仅代码/排除 docs、test、测试文件', async () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, 'src'));
  fs.mkdirSync(path.join(repo, 'docs'));
  fs.mkdirSync(path.join(repo, 'test'));
  fs.writeFileSync(path.join(repo, 'src', 'app.js'), 'x');
  fs.writeFileSync(path.join(repo, 'src', 'util.py'), 'x');
  fs.writeFileSync(path.join(repo, 'README.md'), 'x');
  fs.writeFileSync(path.join(repo, 'docs', 'guide.md'), 'x');
  fs.writeFileSync(path.join(repo, 'test', 'app.test.js'), 'x');
  commit(repo, 'one', '2026-09-02T10:00:00');

  const all = await collectGitChanges({ repo, ...RANGE });
  assert.equal(all.stats.files, 5);

  const code = await collectGitChanges({ repo, ...RANGE, filter: { codeOnly: true } });
  assert.deepEqual(code.summary.map((s) => s.path).sort(), ['src/app.js', 'src/util.py', 'test/app.test.js']);

  const clean = await collectGitChanges({
    repo, ...RANGE,
    filter: { codeOnly: true, excludeDirs: ['docs', 'test'], excludeTestFiles: true },
  });
  assert.deepEqual(clean.summary.map((s) => s.path).sort(), ['src/app.js', 'src/util.py']);
  assert.equal(clean.stats.commits, 1);
});

test('collectGitChanges 汇总新增/修改/删除/重命名', async () => {
  const repo = seedRepo();
  const r = await collectGitChanges({ repo: repo, ...RANGE });
  assert.equal(r.stats.commits, 4);
  assert.equal(r.stats.files, 4);
  assert.equal(r.stats.added, 1);
  assert.equal(r.stats.modified, 1);
  assert.equal(r.stats.deleted, 1);
  assert.equal(r.stats.renamed, 1);
  const by = Object.fromEntries(r.summary.map((s) => [s.path, s]));
  assert.equal(by['a.txt'].status, 'added');
  assert.equal(by['a.txt'].added, 1);
  assert.equal(by['a.txt'].deleted, 0);
  assert.equal(by['k.txt'].status, 'modified');
  assert.equal(by['k.txt'].touches, 1);
  assert.equal(by['k.txt'].added, 1);
  assert.equal(by['k.txt'].deleted, 1);
  assert.equal(by['b.txt'].status, 'deleted');
  assert.equal(by['b.txt'].touches, 2);
  assert.equal(by['b.txt'].added, 1);
  assert.equal(by['b.txt'].deleted, 1);
  assert.equal(by['m2.txt'].status, 'renamed');
  assert.equal(by['m2.txt'].oldPath, 'm.txt');
  assert.equal(by['m2.txt'].added, 1);
  assert.equal(by['m2.txt'].deleted, 1);
  assert.equal(by['m2.txt'].lastAuthor, 'tester');
  assert.equal(by['m2.txt'].lastEmail, 't@t');
  assert.equal(typeof r.repo.branch, 'string');
});

test('collectGitChanges 只含区间内提交（c0/c5 不出现）', async () => {
  const repo = seedRepo();
  const r = await collectGitChanges({ repo: repo, ...RANGE });
  const subjects = r.commits.map((c) => c.subject);
  assert.deepEqual(subjects, ['c4', 'c3', 'c2', 'c1']);
  const c1 = r.commits.find((c) => c.subject === 'c1');
  assert.deepEqual(c1.files.map((f) => [f.status, f.path]), [
    ['added', 'a.txt'], ['modified', 'k.txt'], ['modified', 'm.txt'],
  ]);
  assert.deepEqual(c1.files.map((f) => [f.added, f.deleted]), [
    [1, 0], [1, 1], [1, 1],
  ]);
});

test('collectGitChanges 空区间返回零与空数组', async () => {
  const repo = seedRepo();
  const r = await collectGitChanges({ repo: repo, since: '2026-01-01', until: '2026-01-02' });
  assert.equal(r.stats.commits, 0);
  assert.deepEqual(r.summary, []);
  assert.deepEqual(r.commits, []);
});

test('collectGitChanges 非仓库 → not-a-repo；路径不存在 → not-found', async () => {
  const empty = tmpDir();
  await assert.rejects(
    () => collectGitChanges({ repo: empty, ...RANGE }),
    (e) => e.code === 'not-a-repo',
  );
  await assert.rejects(
    () => collectGitChanges({ repo: path.join(empty, 'nope'), ...RANGE }),
    (e) => e.code === 'not-found',
  );
});

test('collectGitChanges 坏日期 → bad-date；反序 → bad-range', async () => {
  const repo = makeRepo();
  await assert.rejects(
    () => collectGitChanges({ repo: repo, since: '2026/09/01', until: '2026-09-10' }),
    (e) => e.code === 'bad-date',
  );
  await assert.rejects(
    () => collectGitChanges({ repo: repo, since: '2026-09-10', until: '2026-09-01' }),
    (e) => e.code === 'bad-range',
  );
});

test('collectGitChanges 远程 file:// 地址 → 克隆分析并清理临时目录', async () => {
  const repo = seedRepo();
  const countClones = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('dfgit-clone-')).length;
  const before = countClones();
  const url = `file:///${repo.replace(/\\/g, '/')}`;
  const r = await collectGitChanges({ repo: url, ...RANGE });
  assert.equal(r.repo.cloned, true);
  assert.equal(r.repo.path, url);
  assert.equal(r.stats.commits, 4);
  assert.equal(r.summary.length, 4);
  assert.equal(countClones(), before);
});

test('collectGitChanges 以 - 开头 → bad-repo（防参数注入）', async () => {
  await assert.rejects(
    () => collectGitChanges({ repo: '--upload-pack=evil', ...RANGE }),
    (e) => e.code === 'bad-repo',
  );
});

test('collectGitChanges 单次新增超阈值 → 整条提交被过滤', async () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'big.js'), Array.from({ length: 2001 }, (_, i) => `const x${i} = ${i};`).join('\n'));
  commit(repo, 'big', '2026-09-02T10:00:00');
  fs.writeFileSync(path.join(repo, 'small.js'), 'const a = 1;\n');
  commit(repo, 'small', '2026-09-03T10:00:00');

  const all = await collectGitChanges({ repo, ...RANGE, filter: { codeOnly: true } });
  assert.equal(all.stats.commits, 2);
  assert.equal(all.hugeCommits, 0);
  assert.deepEqual(all.summary.map((s) => s.path).sort(), ['big.js', 'small.js']);

  const filtered = await collectGitChanges({ repo, ...RANGE, filter: { codeOnly: true, hugeCommitLimit: 2000 } });
  assert.equal(filtered.stats.commits, 1);
  assert.equal(filtered.hugeCommits, 1);
  assert.deepEqual(filtered.summary.map((s) => s.path), ['small.js']);
  assert.deepEqual(filtered.commits.map((c) => c.subject), ['small']);

  const custom = await collectGitChanges({ repo, ...RANGE, filter: { codeOnly: true, hugeCommitLimit: 3 } });
  assert.equal(custom.stats.commits, 1);
  assert.equal(custom.hugeCommits, 1);
});
