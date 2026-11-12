import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateGitDirs } from '../git-update.js';

test('updateGitDirs：去空去重，依次 rev-parse + pull --ff-only', async () => {
  const calls = [];
  const r = await updateGitDirs([' D:\\a ', '', 'D:\\a'], {
    exists: () => true,
    runGit: async (args) => { calls.push(args); return 'Already up to date.\n'; },
  });
  assert.equal(r.results.length, 1);
  assert.deepEqual(r.results[0], { dir: 'D:\\a', ok: true, code: 'ok', message: 'Already up to date.' });
  assert.deepEqual(calls[0], ['-C', 'D:\\a', 'rev-parse', '--is-inside-work-tree']);
  assert.deepEqual(calls[1], ['-C', 'D:\\a', 'pull', '--ff-only']);
});

test('updateGitDirs：目录不存在返回 not-found 且不调用 git', async () => {
  const calls = [];
  const r = await updateGitDirs(['D:\\missing'], {
    exists: () => false,
    runGit: async (args) => { calls.push(args); return ''; },
  });
  assert.equal(calls.length, 0);
  assert.deepEqual(r.results, [{ dir: 'D:\\missing', ok: false, code: 'not-found', message: 'directory not found' }]);
});

test('updateGitDirs：非 git 目录返回 not-a-repo，且继续处理其它目录', async () => {
  const r = await updateGitDirs(['D:\\plain', 'D:\\repo'], {
    exists: () => true,
    runGit: async (args) => {
      if (args[1] === 'D:\\plain') { const e = new Error('not a git repository'); e.code = 'git-failed'; throw e; }
      return 'up to date';
    },
  });
  assert.equal(r.results[0].ok, false);
  assert.equal(r.results[0].code, 'not-a-repo');
  assert.equal(r.results[1].ok, true);
});

test('updateGitDirs：pull 失败返回 git-failed 与该目录错误信息', async () => {
  const r = await updateGitDirs(['D:\\repo'], {
    exists: () => true,
    runGit: async (args) => {
      if (args.includes('rev-parse')) return 'true';
      const e = new Error('fatal: Not possible to fast-forward'); e.code = 'git-failed';
      throw e;
    },
  });
  assert.equal(r.results[0].ok, false);
  assert.equal(r.results[0].code, 'git-failed');
  assert.match(r.results[0].message, /fast-forward/);
});
