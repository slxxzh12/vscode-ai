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

