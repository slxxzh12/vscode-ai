import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  sanitizeBranchUser, branchFor, getGitUserName, prepareUserBranch, commitAll, pushBranch, detectRemoteDefault,
} from '../pipeline/us-git.js';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-us-git-'));
  const bare = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  execFileSync('git', ['init', '--bare', bare]);
  execFileSync('git', ['init', work]);
  git(work, ['config', 'user.email', 'dev@example.com']);
  git(work, ['config', 'user.name', 'zhangsan']);
  fs.writeFileSync(path.join(work, 'README.md'), 'init\n');
  git(work, ['add', '-A']);
  git(work, ['commit', '-m', 'init']);
  git(work, ['branch', '-M', 'master']);
  git(work, ['remote', 'add', 'origin', bare]);
  git(work, ['push', '-u', 'origin', 'master']);
  return { root, bare, work };
}

test('us-git：分支名清洗', () => {
  assert.equal(sanitizeBranchUser('  zhang san  '), 'zhang-san');
  assert.equal(sanitizeBranchUser('a~b^c:d*e[f'), 'a-b-c-d-e-f');
  assert.equal(branchFor('zhang san'), 'feature/zhang-san');
  assert.equal(branchFor('   '), '');
});

test('us-git：读取 user.name 并创建 feature 分支', async () => {
  const { work } = tempRepo();
  assert.equal(await getGitUserName(work), 'zhangsan');
  assert.equal(await detectRemoteDefault(work), 'master');
  const r = await prepareUserBranch(work, 'zhangsan');
  assert.equal(r.branch, 'feature/zhangsan');
  assert.equal(git(work, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/zhangsan');
});

test('us-git：脏工作区拒绝', async () => {
  const { work } = tempRepo();
  fs.writeFileSync(path.join(work, 'dirty.txt'), 'x');
  const r = await prepareUserBranch(work, 'zhangsan');
  assert.equal(r.error, 'dirty-worktree');
});

test('us-git：提交并推送分支', async () => {
  const { work, bare } = tempRepo();
  await prepareUserBranch(work, 'zhangsan');
  fs.writeFileSync(path.join(work, 'a.txt'), 'a');
  const c = await commitAll(work, 'feat(US000001): demo');
  assert.equal(c.commit.length, 40);
  const p = await pushBranch(work, 'feature/zhangsan');
  assert.equal(p.ok, true);
  const branches = execFileSync('git', ['branch'], { cwd: bare, encoding: 'utf8' });
  assert.match(branches, /feature\/zhangsan/);
});
