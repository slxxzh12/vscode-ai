import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runOneUs } from '../pipeline/us-runner.js';

function fixtures() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-us-runner-'));
  const solutionDir = path.join(root, 'solution');
  const codeDir = path.join(root, 'code');
  const us = 'US000001-2021-增加一个用户管理系统';
  const usDir = path.join(solutionDir, us);
  fs.mkdirSync(usDir, { recursive: true });
  fs.mkdirSync(codeDir, { recursive: true });
  fs.writeFileSync(path.join(usDir, '01-需求分析.md'), '# 需求');
  fs.writeFileSync(path.join(usDir, 'pipeline.json'), JSON.stringify({ build: 'npm run build', test: 'npm test' }));
  const logDir = path.join(root, 'logs', 'us', us);
  return { root, solutionDir, codeDir, us, logDir };
}

const template = 'US={{us}} B={{branch}} C={{cwd}}\n{{docs}}';

test('us-runner：成功时提交 feat 并推送', async () => {
  const f = fixtures();
  const calls = [];
  const git = {
    prepareUserBranch: async () => ({ branch: 'feature/zhangsan' }),
    commitAll: async (_cwd, msg) => { calls.push(msg); return { commit: 'a'.repeat(40) }; },
    pushBranch: async () => ({ ok: true }),
  };
  const exec = async ({ command }) => ({ ok: true, exitCode: 0, command });
  const runAi = async ({ logPath }) => { fs.writeFileSync(logPath, 'ai ok'); return { ok: true, exitCode: 0 }; };
  const item = await runOneUs({
    us: f.us, solutionDir: f.solutionDir, codeDir: f.codeDir, user: 'zhangsan',
    logDir: f.logDir, runId: 'j_test', template, git, exec, runAi,
  });
  assert.equal(item.status, 'success');
  assert.equal(item.branch, 'feature/zhangsan');
  assert.equal(item.commit, 'a'.repeat(40));
  assert.deepEqual(item.commands.test.exitCode, 0);
  assert.deepEqual(item.commands.build.exitCode, 0);
  assert.match(calls[0], /^feat\(US000001\):/);
  assert.ok(fs.existsSync(path.join(f.logDir, 'ai.log')));
});

test('us-runner：构建失败提交 wip 并标记 failed', async () => {
  const f = fixtures();
  let message = '';
  const git = {
    prepareUserBranch: async () => ({ branch: 'feature/zhangsan' }),
    commitAll: async (_cwd, msg) => { message = msg; return { commit: 'b'.repeat(40) }; },
    pushBranch: async () => ({ ok: true }),
  };
  const exec = async ({ command }) => ({ ok: !command.includes('build'), exitCode: command.includes('build') ? 1 : 0 });
  const runAi = async () => ({ ok: true, exitCode: 0 });
  const item = await runOneUs({
    us: f.us, solutionDir: f.solutionDir, codeDir: f.codeDir, user: 'zhangsan',
    logDir: f.logDir, runId: 'j_test', template, git, exec, runAi,
  });
  assert.equal(item.status, 'failed');
  assert.match(message, /^wip\(US000001\):.*\[failed\]$/);
  assert.equal(item.error, 'build-failed');
});

test('us-runner：缺少 build 命令直接失败，不调用 AI', async () => {
  const f = fixtures();
  fs.writeFileSync(path.join(f.solutionDir, f.us, 'pipeline.json'), '{"test":"npm test"}');
  let aiCalled = false;
  const item = await runOneUs({
    us: f.us, solutionDir: f.solutionDir, codeDir: f.codeDir, user: 'zhangsan',
    logDir: f.logDir, runId: 'j_test', template,
    git: { prepareUserBranch: async () => ({ branch: 'feature/zhangsan' }) },
    exec: async () => ({ ok: true, exitCode: 0 }),
    runAi: async () => { aiCalled = true; return { ok: true, exitCode: 0 }; },
  });
  assert.equal(item.status, 'failed');
  assert.equal(item.error, 'missing_build');
  assert.equal(aiCalled, false);
});
