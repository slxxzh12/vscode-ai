import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectDocDefaults } from '../pipeline/doc-defaults.js';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-doc-defaults-'));
}

test('doc-defaults：优先识别 .opencode / .claude 下的 skills、rules', () => {
  const root = tmpRoot();
  for (const rel of ['docs/knowledge', 'docs/version', 'docs/learn', 'docs/memory', '.opencode/skills', '.opencode/rules']) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
  }
  const r = detectDocDefaults(root);
  assert.equal(r.paths.knowledge, path.join(root, 'docs/knowledge'));
  assert.equal(r.paths.skills, path.join(root, '.opencode/skills'));
  assert.equal(r.paths.rules, path.join(root, '.opencode/rules'));
  assert.equal(r.detected.skills, '.opencode/skills');
});

test('doc-defaults：识别 .void 配置目录与 Claude 目录', () => {
  const root = tmpRoot();
  for (const rel of ['.void/skills', '.claude/rules', 'docs/knowledge']) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
  }
  const r = detectDocDefaults(root);
  assert.equal(r.paths.skills, path.join(root, '.void/skills'));
  assert.equal(r.paths.rules, path.join(root, '.claude/rules'));
});

test('doc-defaults：没识别到配置目录时回退到默认结构', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'docs/knowledge'), { recursive: true });
  const r = detectDocDefaults(root);
  assert.equal(r.paths.skills, path.join(root, 'skills'));
  assert.equal(r.paths.rules, path.join(root, 'docs/rules'));
  assert.equal(r.detected.skills, '');
});

test('doc-defaults：create 时创建缺失的默认目录', () => {
  const root = tmpRoot();
  const r = detectDocDefaults(root, { create: true });
  assert.equal(r.failed.length, 0);
  for (const rel of ['docs/knowledge', 'docs/version', 'docs/learn', 'docs/memory', 'skills', 'docs/rules']) {
    assert.ok(fs.statSync(path.join(root, rel)).isDirectory());
  }
  assert.equal(r.created.length, 6);
});

test('doc-defaults：create 不重复创建已存在的目录', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'docs/knowledge'), { recursive: true });
  fs.mkdirSync(path.join(root, '.opencode/skills'), { recursive: true });
  const r = detectDocDefaults(root, { create: true });
  assert.ok(!r.created.includes(path.join(root, 'docs/knowledge')));
  assert.ok(!r.created.includes(path.join(root, '.opencode/skills')));
  assert.ok(fs.existsSync(path.join(root, '.opencode/skills')));
  assert.ok(!fs.existsSync(path.join(root, 'skills')));
});

test('doc-defaults：根目录不存在返回错误', () => {
  assert.equal(detectDocDefaults(path.join(tmpRoot(), 'missing')).error, 'bad-root');
});
