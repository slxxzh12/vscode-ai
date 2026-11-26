import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteUrl, mergeUsBranch } from '../pipeline/us-merge.js';

test('us-merge：解析 HTTPS 与 SSH 远端', () => {
  assert.deepEqual(
    parseRemoteUrl('https://gitee.com/wglj/devflow.git'),
    { host: 'gitee.com', owner: 'wglj', repo: 'devflow', provider: 'gitee' },
  );
  assert.deepEqual(
    parseRemoteUrl('git@github.com:owner/repo.git'),
    { host: 'github.com', owner: 'owner', repo: 'repo', provider: 'github' },
  );
  assert.deepEqual(
    parseRemoteUrl('https://gitlab.example.com/group/sub/repo.git'),
    { host: 'gitlab.example.com', owner: 'group', repo: 'sub', provider: 'gitlab' },
  );
  assert.equal(parseRemoteUrl('https://example.com/a/b.git').provider, '');
});

test('us-merge：GitHub 用 gh 创建并合并 PR', async () => {
  const calls = [];
  const run = async (_cwd, bin, args) => {
    calls.push([bin, ...args]);
    if (bin === 'git' && args[0] === 'remote') return { code: 0, stdout: 'https://github.com/owner/repo.git\n', stderr: '' };
    if (bin === 'gh' && args[0] === 'pr' && args[1] === 'list') return { code: 0, stdout: '[]', stderr: '' };
    if (bin === 'gh' && args[0] === 'pr' && args[1] === 'create') return { code: 0, stdout: 'https://github.com/owner/repo/pull/7\n', stderr: '' };
    if (bin === 'gh' && args[0] === 'pr' && args[1] === 'merge') return { code: 0, stdout: '', stderr: '' };
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };
  const r = await mergeUsBranch({
    codeDir: '/repo', branch: 'feature/zhangsan', us: 'US000001-2021-A',
    title: 'feat(US000001): A', body: 'body', base: 'master', run,
  });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'github');
  assert.equal(r.url, 'https://github.com/owner/repo/pull/7');
  assert.ok(calls.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'merge'));
});

test('us-merge：Gitee 用 git 凭据调 API 创建并合并', async () => {
  const requests = [];
  const run = async (_cwd, bin, args) => {
    if (bin === 'git' && args[0] === 'remote') return { code: 0, stdout: 'https://gitee.com/wglj/devflow.git\n', stderr: '' };
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };
  const credential = async () => ({ username: 'wglj', password: 'tok' });
  const fetchFn = async (url, init = {}) => {
    requests.push({ url, method: init.method || 'GET', body: init.body });
    if (String(url).includes('/pulls?') && !init.method) return { ok: true, json: async () => [] };
    if (String(url).endsWith('/pulls') && init.method === 'POST') {
      return { ok: true, json: async () => ({ number: 5, html_url: 'https://gitee.com/wglj/devflow/pulls/5' }) };
    }
    if (String(url).endsWith('/pulls/5/merge') && init.method === 'PUT') {
      return { ok: true, json: async () => ({ merged: true }) };
    }
    return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
  };
  const r = await mergeUsBranch({
    codeDir: '/repo', branch: 'feature/zhangsan', us: 'US000001-2021-A',
    title: 'feat(US000001): A', body: 'body', base: 'master', run, credential, fetchFn,
  });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'gitee');
  assert.equal(r.url, 'https://gitee.com/wglj/devflow/pulls/5');
  assert.ok(requests.some((x) => x.method === 'PUT' && x.url.includes('/pulls/5/merge')));
  assert.equal(JSON.stringify(r).includes('tok'), false);
});

test('us-merge：远端不受支持时返回错误', async () => {
  const run = async (_cwd, bin, args) => {
    if (bin === 'git' && args[0] === 'remote') return { code: 0, stdout: 'https://example.com/a/b.git\n', stderr: '' };
    return { code: 1, stdout: '', stderr: '' };
  };
  const r = await mergeUsBranch({ codeDir: '/repo', branch: 'feature/x', us: 'US000001-2021-A', run, base: 'master' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unsupported-remote');
});

test('us-merge：autoMerge=false 只发起 PR，不调用合并接口', async () => {
  const requests = [];
  const run = async (_cwd, bin, args) => {
    if (bin === 'git' && args[0] === 'remote') return { code: 0, stdout: 'https://gitee.com/wglj/devflow.git\n', stderr: '' };
    return { code: 1, stdout: '', stderr: '' };
  };
  const credential = async () => ({ username: 'wglj', password: 'tok' });
  const fetchFn = async (url, init = {}) => {
    requests.push({ url, method: init.method || 'GET' });
    if (String(url).includes('/pulls?') && !init.method) return { ok: true, json: async () => [] };
    if (String(url).endsWith('/pulls') && init.method === 'POST') {
      return { ok: true, json: async () => ({ number: 9, html_url: 'https://gitee.com/wglj/devflow/pulls/9' }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const r = await mergeUsBranch({
    codeDir: '/repo', branch: 'feature/zhangsan', us: 'US000001-2021-A',
    title: 'feat(US000001): A', body: 'body', base: 'master', run, credential, fetchFn, autoMerge: false,
  });
  assert.equal(r.ok, true);
  assert.equal(r.merged, false);
  assert.equal(r.url, 'https://gitee.com/wglj/devflow/pulls/9');
  assert.ok(!requests.some((x) => x.method === 'PUT'));
});
