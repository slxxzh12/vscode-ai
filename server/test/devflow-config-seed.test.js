import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkflowStore } from '../workflow-store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEED = path.join(ROOT, 'config', 'workflows');

function seedWorkflows() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-wfseed-'));
  const store = createWorkflowStore({ dir, seedDir: SEED, logger: { warn() {} } });
  return store.readAll();
}

test('seed 配置：工作流默认顺序 开发 > 测试 > 文档', () => {
  const workflows = seedWorkflows();
  assert.deepEqual(workflows.map((w) => w.label), ['开发工作流', '测试工作流', '文档工作流']);
});

test('seed 配置：开发工作流首阶段为「基础环境检查」（需求组）', () => {
  const dev = seedWorkflows().find((w) => w.label === '开发工作流');
  assert.ok(dev, '缺少开发工作流');
  const first = dev.stages[0];
  assert.equal(first.label, '基础环境检查');
  assert.equal(first.group, '需求');
  assert.equal(first.prompts.length, 1);
  for (const token of ['基础环境检查', 'knowledge', 'memory', 'version', 'AGENTS.md']) {
    assert.ok(first.prompts[0].includes(token), `提示词缺少 ${token}`);
  }
});

test('seed 配置：交付运维组含「打包」「推送 release」，排在「环境部署」之前', () => {
  const dev = seedWorkflows().find((w) => w.label === '开发工作流');
  assert.ok(dev, '缺少开发工作流');
  const ops = dev.stages.filter((s) => s.group === '交付运维');
  assert.deepEqual(ops.map((s) => s.label), ['打包release', '推送对应的release包到gitee', '环境部署', '问题定位']);
  assert.ok(ops[0].prompts[0].includes('根据打包脚本打包release'));
  assert.ok(ops[1].prompts[0].includes('release包到gitee'));
});

test('seed 配置：Push&Merge 代码阶段包含 update/push 提示词', () => {
  const dev = seedWorkflows().find((w) => w.label === '开发工作流');
  assert.ok(dev, '缺少开发工作流');
  const stage = dev.stages.find((s) => s.label === 'Push&Merge 代码');
  assert.ok(stage, '缺少 Push&Merge 代码阶段');
  assert.deepEqual(stage.prompts, ['push代码到当前分支', 'update 当前分支代码', 'update Master分支代码']);
});

test('overwriteAllFromSeed：同名覆盖、补齐包内工作流、保留本地额外工作流', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-wfall-'));
  const store = createWorkflowStore({ dir, seedDir: SEED, logger: { warn() {} } });
  const wf = store.readAll().find((w) => w.label === '开发工作流');
  assert.ok(wf, '缺少开发工作流');
  const stageFile = path.join(dir, wf.id, '200_开发交付', '400_Push&Merge 代码', '100_push代码到当前分支.md');
  fs.writeFileSync(stageFile, '本地改动\n', 'utf8');
  const extra = path.join(dir, '999_本地额外');
  fs.mkdirSync(path.join(extra, '100_组', '100_阶段'), { recursive: true });
  fs.writeFileSync(path.join(extra, '100_组', '100_阶段', '100_技能.md'), 'local\n', 'utf8');
  const r = store.overwriteAllFromSeed();
  assert.ok(r.overwritten >= 1);
  const after = store.readAll();
  const stage = after.find((w) => w.label === '开发工作流').stages.find((s) => s.label === 'Push&Merge 代码');
  assert.deepEqual(stage.prompts, ['push代码到当前分支', 'update 当前分支代码', 'update Master分支代码']);
  assert.ok(after.some((w) => w.label === '本地额外'), '本地额外工作流应保留');
});

test('restoreFromSeed：用默认内容覆盖本地工作流并保留本地文件夹名', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-wfrestore-'));
  const store = createWorkflowStore({ dir, seedDir: SEED, logger: { warn() {} } });
  const wf = store.readAll().find((w) => w.label === '开发工作流');
  assert.ok(wf, '缺少开发工作流');
  const localFile = path.join(dir, wf.id, '200_开发交付', '400_Push&Merge 代码', '100_push代码到当前分支.md');
  fs.writeFileSync(localFile, '本地改动\n', 'utf8');
  const restored = store.restoreFromSeed(wf.id);
  assert.equal(restored.label, '开发工作流');
  const after = store.readAll().find((w) => w.label === '开发工作流');
  const stage = after.stages.find((s) => s.label === 'Push&Merge 代码');
  assert.deepEqual(stage.prompts, ['push代码到当前分支', 'update 当前分支代码', 'update Master分支代码']);
});
