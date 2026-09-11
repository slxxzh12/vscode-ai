import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDevflowConfig } from '../devflow-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEED = path.join(ROOT, 'config', 'devflow.xml');

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
