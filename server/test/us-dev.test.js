import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUsDev } from '../pipeline/us-dev.js';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-us-dev-'));
}

function setup() {
  const root = tmpRoot();
  const solution = path.join(root, 'solution');
  const code = path.join(root, 'code');
  fs.mkdirSync(solution, { recursive: true });
  fs.mkdirSync(code, { recursive: true });
  fs.writeFileSync(path.join(root, 'template.md'), 'US={{us}}');
  return { root, solution, code };
}

test('us-dev：首次运行/目录变化只记基线，不处理已有 US', async () => {
  const f = setup();
  fs.mkdirSync(path.join(f.solution, 'US000001-2021-A'));
  const dir = path.join(f.root, 'pipeline');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ autoDev: true }));
  let ran = 0;
  const dev = createUsDev({
    dir,
    templateFile: path.join(f.root, 'template.md'),
    docsState: () => ({ solution: { selected: true, path: f.solution }, code: { selected: true, path: f.code } }),
    git: { getGitUserName: async () => 'zhangsan' },
    runOne: async () => { ran++; return { us: 'x', status: 'success' }; },
  });
  const r = await dev({ logDir: path.join(f.root, 'run'), runId: 'j1', docResults: [] });
  assert.equal(r.skipped, 'baseline');
  assert.equal(ran, 0);
});

test('us-dev：只处理基线与已处理之外的新 US，并写状态', async () => {
  const f = setup();
  fs.mkdirSync(path.join(f.solution, 'US000001-2021-A'));
  const dir = path.join(f.root, 'pipeline');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ autoDev: true }));
  fs.writeFileSync(path.join(dir, 'us-state.json'), JSON.stringify({
    solutionDir: f.solution, baseline: ['US000001-2021-A'], items: {},
  }));
  fs.mkdirSync(path.join(f.solution, 'US000002-2022-B'));
  const seen = [];
  const dev = createUsDev({
    dir,
    templateFile: path.join(f.root, 'template.md'),
    docsState: () => ({ solution: { selected: true, path: f.solution }, code: { selected: true, path: f.code } }),
    git: { getGitUserName: async () => 'zhangsan' },
    runOne: async ({ us }) => { seen.push(us); return { us, status: 'success', branch: 'feature/zhangsan', commit: 'c' }; },
  });
  const r = await dev({ logDir: path.join(f.root, 'run'), runId: 'j2', docResults: [] });
  assert.deepEqual(seen, ['US000002-2022-B']);
  assert.equal(r.failed, 0);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'us-state.json'), 'utf8'));
  assert.equal(state.items['US000002-2022-B'].status, 'success');
});

test('us-dev：开关关闭直接跳过', async () => {
  const f = setup();
  const dev = createUsDev({
    dir: path.join(f.root, 'pipeline'),
    templateFile: path.join(f.root, 'template.md'),
    docsState: () => ({ solution: { selected: true, path: f.solution }, code: { selected: true, path: f.code } }),
    git: { getGitUserName: async () => 'zhangsan' },
    runOne: async () => { throw new Error('should not run'); },
  });
  const r = await dev({ logDir: path.join(f.root, 'run'), runId: 'j3', docResults: [] });
  assert.equal(r.skipped, 'disabled');
});

test('us-dev：开启自动合并后成功后创建并合并 PR', async () => {
  const f = setup();
  fs.mkdirSync(path.join(f.solution, 'US000001-2021-A'));
  const dir = path.join(f.root, 'pipeline');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ autoDev: true, autoMerge: true }));
  fs.writeFileSync(path.join(dir, 'us-state.json'), JSON.stringify({ solutionDir: f.solution, baseline: ['US000001-2021-A'], items: {} }));
  fs.mkdirSync(path.join(f.solution, 'US000002-2022-B'));
  let merged = 0;
  const dev = createUsDev({
    dir,
    templateFile: path.join(f.root, 'template.md'),
    docsState: () => ({ solution: { selected: true, path: f.solution }, code: { selected: true, path: f.code } }),
    git: { getGitUserName: async () => 'zhangsan', syncBranchToRemote: async () => ({ ok: true }) },
    runOne: async ({ us }) => ({ us, status: 'success', branch: 'feature/zhangsan', commit: 'c' }),
    merge: async ({ us }) => { merged++; return { ok: true, provider: 'gitee', url: 'https://gitee.com/o/r/pulls/1', base: 'master', us }; },
  });
  const r = await dev({ logDir: path.join(f.root, 'run'), runId: 'j4', docResults: [] });
  assert.equal(merged, 1);
  assert.equal(r.failed, 0);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'us-state.json'), 'utf8'));
  assert.equal(state.items['US000002-2022-B'].status, 'success');
  assert.equal(state.items['US000002-2022-B'].prUrl, 'https://gitee.com/o/r/pulls/1');
  assert.equal(state.items['US000002-2022-B'].mergeStatus, 'merged');
});

test('us-dev：合并失败标记 US 失败但继续', async () => {
  const f = setup();
  fs.mkdirSync(path.join(f.solution, 'US000001-2021-A'));
  const dir = path.join(f.root, 'pipeline');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ autoDev: true, autoMerge: true }));
  fs.writeFileSync(path.join(dir, 'us-state.json'), JSON.stringify({ solutionDir: f.solution, baseline: ['US000001-2021-A'], items: {} }));
  fs.mkdirSync(path.join(f.solution, 'US000002-2022-B'));
  const dev = createUsDev({
    dir,
    templateFile: path.join(f.root, 'template.md'),
    docsState: () => ({ solution: { selected: true, path: f.solution }, code: { selected: true, path: f.code } }),
    git: { getGitUserName: async () => 'zhangsan' },
    runOne: async ({ us }) => ({ us, status: 'success', branch: 'feature/zhangsan', commit: 'c' }),
    merge: async () => ({ ok: false, provider: 'gitee', error: 'gitee-merge-failed' }),
  });
  const r = await dev({ logDir: path.join(f.root, 'run'), runId: 'j5', docResults: [] });
  assert.equal(r.failed, 1);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'us-state.json'), 'utf8'));
  assert.equal(state.items['US000002-2022-B'].status, 'failed');
  assert.equal(state.items['US000002-2022-B'].error, 'gitee-merge-failed');
});

test('us-dev：分支用文档提交人（工号优先）', async () => {
  const f = setup();
  fs.mkdirSync(path.join(f.solution, 'US000001-2021-A'));
  const dir = path.join(f.root, 'pipeline');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ autoDev: true }));
  fs.writeFileSync(path.join(dir, 'us-state.json'), JSON.stringify({
    solutionDir: f.solution, baseline: ['US000001-2021-A'], revs: {}, items: {},
  }));
  fs.mkdirSync(path.join(f.solution, 'US000002-2022-B'));
  const seen = [];
  const dev = createUsDev({
    dir,
    templateFile: path.join(f.root, 'template.md'),
    docsState: () => ({ solution: { selected: true, path: f.solution }, code: { selected: true, path: f.code } }),
    git: { getGitUserName: async () => 'localuser' },
    docRevOf: async () => 'rev1',
    docAuthorOf: async () => ({ name: 'zhangsan', email: 'z@corp.com' }),
    runOne: async ({ us, user }) => { seen.push({ us, user }); return { us, status: 'success', branch: `feature/${user}`, commit: 'c' }; },
  });
  const r = await dev({ logDir: path.join(f.root, 'run'), runId: 'j6', docResults: [], resolveBranchUser: () => 'E123' });
  assert.deepEqual(seen, [{ us: 'US000002-2022-B', user: 'E123' }]);
  assert.equal(r.failed, 0);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'us-state.json'), 'utf8'));
  assert.equal(state.revs['US000002-2022-B'], 'rev1');
  assert.equal(state.items['US000002-2022-B'].docAuthor, 'zhangsan');
});

test('us-dev：无工号映射时分支用作者名', async () => {
  const f = setup();
  fs.mkdirSync(path.join(f.solution, 'US000001-2021-A'));
  const dir = path.join(f.root, 'pipeline');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ autoDev: true }));
  fs.writeFileSync(path.join(dir, 'us-state.json'), JSON.stringify({
    solutionDir: f.solution, baseline: ['US000001-2021-A'], revs: {}, items: {},
  }));
  fs.mkdirSync(path.join(f.solution, 'US000002-2022-B'));
  const seen = [];
  const dev = createUsDev({
    dir,
    templateFile: path.join(f.root, 'template.md'),
    docsState: () => ({ solution: { selected: true, path: f.solution }, code: { selected: true, path: f.code } }),
    git: { getGitUserName: async () => 'localuser' },
    docRevOf: async () => 'rev1',
    docAuthorOf: async () => ({ name: 'zhangsan', email: 'z@corp.com' }),
    runOne: async ({ us, user }) => { seen.push({ us, user }); return { us, status: 'success', branch: `feature/${user}`, commit: 'c' }; },
  });
  const r = await dev({ logDir: path.join(f.root, 'run'), runId: 'j7', docResults: [], resolveBranchUser: () => '' });
  assert.deepEqual(seen, [{ us: 'US000002-2022-B', user: 'zhangsan' }]);
  assert.equal(r.failed, 0);
});

test('us-dev：以监控提交为基准，按变更先后顺序执行', async () => {
  const f = setup();
  const dir = path.join(f.root, 'pipeline');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ autoDev: true }));
  fs.writeFileSync(path.join(dir, 'us-state.json'), JSON.stringify({
    solutionDir: f.solution, baseline: [], revs: {}, items: {},
  }));
  const order = [];
  const writes = [];
  const dev = createUsDev({
    dir,
    templateFile: path.join(f.root, 'template.md'),
    docsState: () => ({ solution: { selected: true, path: f.solution }, code: { selected: true, path: f.code } }),
    git: { getGitUserName: async () => 'localuser' },
    docHeadOf: async () => 'head1',
    readMonitor: () => ({ lastCommit: 'base1' }),
    changedUsSince: async () => ['F0001-用户管理/US000003-2023-C', 'US000002-2022-B'],
    writeMonitor: async (_d, s) => { writes.push(s); },
    docAuthorOf: async () => ({ name: 'zhangsan', email: 'z@x' }),
    runOne: async ({ us }) => { order.push(us); return { us, status: 'success', branch: 'feature/zhangsan', commit: 'c' }; },
  });
  const r = await dev({ logDir: path.join(f.root, 'run'), runId: 'j8', docResults: [] });
  assert.deepEqual(order, ['F0001-用户管理/US000003-2023-C', 'US000002-2022-B']);
  assert.equal(r.failed, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].commit, 'head1');
});

