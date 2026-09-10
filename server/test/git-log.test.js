import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { collectGitChanges } from '../git-log.js';
import { tmpDir, makeRepo, seedRepo } from './helpers/git-fixture.js';

const RANGE = { since: '2026-09-01', until: '2026-09-10' };

test('collectGitChanges 汇总新增/修改/删除/重命名', async () => {
  const repo = seedRepo();
  const r = await collectGitChanges({ repoPath: repo, ...RANGE });
  assert.equal(r.stats.commits, 4);
  assert.equal(r.stats.files, 4);
  assert.equal(r.stats.added, 1);
  assert.equal(r.stats.modified, 1);
  assert.equal(r.stats.deleted, 1);
  assert.equal(r.stats.renamed, 1);
  const by = Object.fromEntries(r.summary.map((s) => [s.path, s]));
  assert.equal(by['a.txt'].status, 'added');
  assert.equal(by['k.txt'].status, 'modified');
  assert.equal(by['k.txt'].touches, 1);
  assert.equal(by['b.txt'].status, 'deleted');
  assert.equal(by['b.txt'].touches, 2);
  assert.equal(by['m2.txt'].status, 'renamed');
  assert.equal(by['m2.txt'].oldPath, 'm.txt');
  assert.equal(typeof r.repo.branch, 'string');
});

test('collectGitChanges 只含区间内提交（c0/c5 不出现）', async () => {
  const repo = seedRepo();
  const r = await collectGitChanges({ repoPath: repo, ...RANGE });
  const subjects = r.commits.map((c) => c.subject);
  assert.deepEqual(subjects, ['c4', 'c3', 'c2', 'c1']);
  const c1 = r.commits.find((c) => c.subject === 'c1');
  assert.deepEqual(c1.files.map((f) => [f.status, f.path]), [
    ['added', 'a.txt'], ['modified', 'k.txt'], ['modified', 'm.txt'],
  ]);
});

test('collectGitChanges 空区间返回零与空数组', async () => {
  const repo = seedRepo();
  const r = await collectGitChanges({ repoPath: repo, since: '2026-01-01', until: '2026-01-02' });
  assert.equal(r.stats.commits, 0);
  assert.deepEqual(r.summary, []);
  assert.deepEqual(r.commits, []);
});

test('collectGitChanges 非仓库 → not-a-repo；路径不存在 → not-found', async () => {
  const empty = tmpDir();
  await assert.rejects(
    () => collectGitChanges({ repoPath: empty, ...RANGE }),
    (e) => e.code === 'not-a-repo',
  );
  await assert.rejects(
    () => collectGitChanges({ repoPath: path.join(empty, 'nope'), ...RANGE }),
    (e) => e.code === 'not-found',
  );
});

test('collectGitChanges 坏日期 → bad-date；反序 → bad-range', async () => {
  const repo = makeRepo();
  await assert.rejects(
    () => collectGitChanges({ repoPath: repo, since: '2026/09/01', until: '2026-09-10' }),
    (e) => e.code === 'bad-date',
  );
  await assert.rejects(
    () => collectGitChanges({ repoPath: repo, since: '2026-09-10', until: '2026-09-01' }),
    (e) => e.code === 'bad-range',
  );
});
