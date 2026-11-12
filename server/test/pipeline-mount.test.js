import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPipelineMount } from '../pipeline/pipeline-mount.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-pipeline-mount-'));
}

function fakeRes() {
  const out = { status: 0, body: '', headers: {} };
  return {
    out,
    writeHead(s) { out.status = s; },
    end(s) { out.body = String(s || ''); },
  };
}

function fakeReq(method, url, body) {
  return {
    method,
    url,
    on(evt, cb) {
      if (body !== undefined && evt === 'data') cb(Buffer.from(body));
      if (evt === 'end') cb();
    },
  };
}

test('pipeline-mount：开关打开时重建基线', async () => {
  const dir = tmpDir();
  const solution = path.join(dir, 'solution');
  fs.mkdirSync(path.join(solution, 'US000001-2021-A'), { recursive: true });
  const mount = createPipelineMount({
    dir: path.join(dir, 'pipeline'),
    docsState: () => ({ solution: { selected: true, path: solution } }),
    scheduler: { engine: { manualRun: async () => ({}) } },
  });
  const res = fakeRes();
  await mount(fakeReq('POST', '/api/pipeline/config', JSON.stringify({ autoDev: true })), res);
  assert.equal(res.out.status, 200);
  assert.match(res.out.body, /"autoDev":true/);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'pipeline', 'us-state.json'), 'utf8'));
  assert.deepEqual(state.baseline, ['US000001-2021-A']);
});

test('pipeline-mount：只改自动合并时不清空自动开发、不重置基线', async () => {
  const dir = tmpDir();
  const pipeline = path.join(dir, 'pipeline');
  fs.mkdirSync(pipeline, { recursive: true });
  fs.writeFileSync(path.join(pipeline, 'config.json'), '{"autoDev":true,"autoMerge":false}');
  fs.writeFileSync(path.join(pipeline, 'us-state.json'), JSON.stringify({
    solutionDir: 'D:/sol', baseline: ['US000001-2021-A'], items: {},
  }));
  const mount = createPipelineMount({
    dir: pipeline,
    docsState: () => ({ solution: { selected: true, path: dir } }),
    scheduler: { engine: { manualRun: async () => ({}) } },
  });
  const res = fakeRes();
  await mount(fakeReq('POST', '/api/pipeline/config', JSON.stringify({ autoMerge: true })), res);
  assert.equal(res.out.status, 200);
  const cfg = JSON.parse(res.out.body);
  assert.equal(cfg.autoDev, true);
  assert.equal(cfg.autoMerge, true);
  const state = JSON.parse(fs.readFileSync(path.join(pipeline, 'us-state.json'), 'utf8'));
  assert.deepEqual(state.baseline, ['US000001-2021-A']);
});

test('pipeline-mount：重试把 failed 置回 pending 并触发 docs', async () => {
  const dir = tmpDir();
  const pipeline = path.join(dir, 'pipeline');
  fs.mkdirSync(pipeline, { recursive: true });
  fs.writeFileSync(path.join(pipeline, 'config.json'), '{"autoDev":true}');
  fs.writeFileSync(path.join(pipeline, 'us-state.json'), JSON.stringify({
    solutionDir: 'D:/sol', baseline: [], items: { 'US000002-2022-B': { status: 'failed' } },
  }));
  let ran = 0;
  const mount = createPipelineMount({
    dir: pipeline,
    docsState: () => ({}),
    scheduler: { engine: { manualRun: async () => { ran++; return {}; } } },
  });
  const res = fakeRes();
  await mount(fakeReq('POST', '/api/pipeline/retry', JSON.stringify({ us: 'US000002-2022-B' })), res);
  assert.equal(ran, 1);
  const state = JSON.parse(fs.readFileSync(path.join(pipeline, 'us-state.json'), 'utf8'));
  assert.equal(state.items['US000002-2022-B'].status, 'pending');
});

test('pipeline-mount：识别仓库里的 skills/rules 配置目录', async () => {
  const dir = tmpDir();
  const root = path.join(dir, 'repo');
  for (const rel of ['.opencode/skills', '.opencode/rules', 'docs/knowledge', 'docs/version', 'docs/learn', 'docs/memory']) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
  }
  const mount = createPipelineMount({
    dir: path.join(dir, 'pipeline'),
    docsState: () => ({}),
    scheduler: { engine: { manualRun: async () => ({}) } },
  });
  const res = fakeRes();
  await mount(fakeReq('GET', '/api/pipeline/defaults?root=' + encodeURIComponent(root)), res);
  assert.equal(res.out.status, 200);
  const body = JSON.parse(res.out.body);
  assert.equal(body.paths.skills, path.join(root, '.opencode/skills'));
  assert.equal(body.paths.rules, path.join(root, '.opencode/rules'));
});

test('pipeline-mount：create=1 时创建缺失的默认目录', async () => {
  const dir = tmpDir();
  const root = path.join(dir, 'repo');
  fs.mkdirSync(root, { recursive: true });
  const mount = createPipelineMount({
    dir: path.join(dir, 'pipeline'),
    docsState: () => ({}),
    scheduler: { engine: { manualRun: async () => ({}) } },
  });
  const res = fakeRes();
  await mount(fakeReq('GET', '/api/pipeline/defaults?root=' + encodeURIComponent(root) + '&create=1'), res);
  assert.equal(res.out.status, 200);
  const body = JSON.parse(res.out.body);
  assert.equal(body.created.length, 6);
  assert.ok(fs.statSync(path.join(root, 'docs/knowledge')).isDirectory());
  assert.ok(fs.statSync(path.join(root, 'docs/learn')).isDirectory());
  assert.equal(body.agents?.ok, true);
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /方案编号-日期-方案名称/);
});

test('pipeline-mount：监控开关启动/停止（15 秒扫描）', async () => {
  const dir = tmpDir();
  const solution = path.join(dir, 'solution');
  fs.mkdirSync(path.join(solution, 'US000001-20260315-A'), { recursive: true });
  const mount = createPipelineMount({
    dir: path.join(dir, 'pipeline'),
    docsState: () => ({ solution: { selected: true, path: solution } }),
    scheduler: { engine: { manualRun: async () => ({}) } },
  });
  const res1 = fakeRes();
  await mount(fakeReq('POST', '/api/pipeline/watch', JSON.stringify({ enabled: true })), res1);
  assert.equal(res1.out.status, 200);
  const j1 = JSON.parse(res1.out.body);
  assert.equal(j1.running, true);
  assert.equal(j1.intervalMs, 15000);
  assert.equal(j1.config.watch, true);
  assert.equal(j1.config.autoDev, true);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'pipeline', 'us-state.json'), 'utf8'));
  assert.deepEqual(state.baseline, ['US000001-20260315-A']);

  const res2 = fakeRes();
  await mount(fakeReq('POST', '/api/pipeline/watch', JSON.stringify({ enabled: false })), res2);
  assert.equal(JSON.parse(res2.out.body).running, false);

  const res3 = fakeRes();
  await mount(fakeReq('GET', '/api/pipeline/watch'), res3);
  assert.equal(JSON.parse(res3.out.body).running, false);
});

test('pipeline-mount：日志路径不允许穿越', async () => {  const dir = tmpDir();
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir, { recursive: true });
  const mount = createPipelineMount({
    dir: path.join(dir, 'pipeline'),
    docsState: () => ({}),
    scheduler: { engine: { manualRun: async () => ({}) } },
    runDirFor: () => runDir,
  });
  const res = fakeRes();
  await mount(fakeReq('GET', '/api/pipeline/logs?jobId=j_1&us=US000001-2021-A&file=../../secret.txt'), res);
  assert.equal(res.out.status, 400);
});
