import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, commit } from './helpers/git-fixture.js';
import { docRevOf, docAuthorOf } from '../pipeline/us-doc-git.js';

test('us-doc-git：取 US 目录最近提交 hash 与作者', async () => {
  const repo = makeRepo();
  const us = 'US000002-2022-B';
  fs.mkdirSync(path.join(repo, us), { recursive: true });
  fs.writeFileSync(path.join(repo, us, 'a.md'), 'x');
  commit(repo, 'add us');
  const rev = await docRevOf(repo, us);
  assert.match(rev, /^[0-9a-f]{40}$/);
  const author = await docAuthorOf(repo, us);
  assert.equal(author.name, 'tester');
  assert.equal(author.email, 't@t');
  assert.equal(await docRevOf(repo, 'US999999-2022-X'), '');
  assert.deepEqual(await docAuthorOf(repo, 'US999999-2022-X'), { name: '', email: '' });
});

test('us-doc-git：支持特性文件夹下的相对路径', async () => {
  const repo = makeRepo();
  const us = 'F0001-用户管理/US000003-2023-C';
  fs.mkdirSync(path.join(repo, 'F0001-用户管理', 'US000003-2023-C'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'F0001-用户管理', 'US000003-2023-C', 'a.md'), 'x');
  commit(repo, 'add nested us');
  assert.match(await docRevOf(repo, us), /^[0-9a-f]{40}$/);
  assert.equal((await docAuthorOf(repo, us)).name, 'tester');
});
