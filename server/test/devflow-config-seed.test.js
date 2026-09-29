import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDevflowConfig } from '../devflow-config.js';
import { sortWorkflows } from '@devflow/shared/workflow-xml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEED = path.join(ROOT, 'config', 'devflow.xml');

test('seed 配置：工作流默认顺序 开发(500) > 测试(400) > 文档(300)', () => {
  const cfg = parseDevflowConfig(fs.readFileSync(SEED, 'utf8'));
  const byId = new Map(cfg.workflows.map((w) => [w.id, w]));
  assert.equal(byId.get('dev').priority, 500);
  assert.equal(byId.get('test').priority, 400);
  assert.equal(byId.get('doc').priority, 300);
  assert.deepEqual(sortWorkflows(cfg.workflows).map((w) => w.id), ['dev', 'test', 'doc']);
});

test('seed 配置：开发工作流首阶段为「基础环境检查」（env-check/需求）', () => {
  const cfg = parseDevflowConfig(fs.readFileSync(SEED, 'utf8'));
  const dev = cfg.workflows.find((w) => w.id === 'dev');
  assert.ok(dev, '缺少 dev 工作流');
  const first = dev.stages[0];
  assert.equal(first.id, 'env-check');
  assert.equal(first.label, '基础环境检查');
  assert.equal(first.group, '需求');
  assert.equal(first.prompts.length, 1);
  for (const token of ['基础环境检查', 'knowledge', 'memory', 'version', 'AGENTS.md']) {
    assert.ok(first.prompts[0].includes(token), `提示词缺少 ${token}`);
  }
});

test('seed 配置：交付运维组含「打包」阶段（package），排在「环境部署」之前', () => {
  const cfg = parseDevflowConfig(fs.readFileSync(SEED, 'utf8'));
  const dev = cfg.workflows.find((w) => w.id === 'dev');
  assert.ok(dev, '缺少 dev 工作流');
  const ops = dev.stages.filter((s) => s.group === '交付运维');
  assert.deepEqual(ops.map((s) => s.id), ['package', 'deploy', 'troubleshoot']);
  assert.equal(ops[0].label, '打包release');
  assert.equal(ops[0].prompts.length, 1);
  assert.ok(ops[0].prompts[0].includes('根据打包脚本打包release'));
});

test('seed 配置：Push&Merge 代码阶段提示词合并为一条', () => {
  const cfg = parseDevflowConfig(fs.readFileSync(SEED, 'utf8'));
  const dev = cfg.workflows.find((w) => w.id === 'dev');
  assert.ok(dev, '缺少 dev 工作流');
  const stage = dev.stages.find((s) => s.id === 'push-merge');
  assert.ok(stage, '缺少 push-merge 阶段');
  assert.equal(stage.prompts.length, 1);
  assert.ok(stage.prompts[0].includes('push'));
});
