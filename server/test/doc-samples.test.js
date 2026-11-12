import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDocSamples } from '../doc-samples.js';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-doc-samples-'));
}

function mkdirs(root, names) {
  const out = {};
  for (const name of names) {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    out[name] = dir;
  }
  return out;
}

function stateOf(dirs, selected = Object.keys(dirs)) {
  const state = {};
  for (const [slot, dir] of Object.entries(dirs)) {
    state[slot] = { path: dir, selected: selected.includes(slot) };
  }
  return state;
}

test('初始化样例：向勾选的知识/经验/方案/流程/skills/rules 写入标准样例，未勾选目录不动', () => {
  const root = tmpRoot();
  const dirs = mkdirs(root, ['knowledge', 'experience', 'solution', 'workflow', 'skills', 'rules', 'code']);
  const out = initDocSamples(stateOf(dirs, ['knowledge', 'experience', 'solution', 'workflow', 'skills', 'rules']));
  assert.equal(out.failed, 0);
  assert.ok(out.created > 0);
  assert.ok(fs.existsSync(path.join(dirs.knowledge, 'demo', '01-术语表.md')));
  assert.ok(fs.existsSync(path.join(dirs.experience, 'demo', '01-经验-权限校验.md')));
  assert.ok(fs.existsSync(path.join(dirs.solution, 'US000001-20260315-增加一个用户管理系统', '02-方案设计.md')));
  assert.ok(fs.existsSync(path.join(dirs.workflow, 'demo', '标准开发流程.md')));
  assert.ok(fs.existsSync(path.join(dirs.skills, 'demo', '示例技能-接口联调.md')));
  assert.ok(fs.existsSync(path.join(dirs.rules, 'demo', '示例规则-代码提交规范.md')));
  assert.equal(fs.existsSync(path.join(dirs.code, 'demo')), false);
});

test('初始化样例：已存在的文件不覆盖，计入 skipped', () => {
  const root = tmpRoot();
  const dirs = mkdirs(root, ['knowledge']);
  const target = path.join(dirs.knowledge, 'demo', '01-术语表.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'KEEP', 'utf8');
  const out = initDocSamples(stateOf(dirs));
  assert.equal(out.failed, 0);
  assert.equal(fs.readFileSync(target, 'utf8'), 'KEEP');
  assert.ok(out.skipped >= 1);
});

test('初始化样例：目录不存在时自动创建，其余继续', () => {
  const root = tmpRoot();
  const dirs = mkdirs(root, ['experience']);
  const state = stateOf(dirs);
  const missing = path.join(root, 'missing');
  state.knowledge = { path: missing, selected: true };
  const out = initDocSamples(state);
  const knowledge = out.results.find((r) => r.slot === 'knowledge');
  assert.equal(knowledge.ok, true);
  assert.equal(knowledge.createdDir, true);
  assert.ok(fs.existsSync(missing));
  assert.ok(fs.existsSync(path.join(missing, 'demo', '01-术语表.md')));
  assert.ok(out.created > 0);
  assert.ok(fs.existsSync(path.join(dirs.experience, 'demo', '01-经验-权限校验.md')));
});

test('初始化样例：没有勾选任何样例目录时返回空结果', () => {
  const root = tmpRoot();
  const dirs = mkdirs(root, ['code']);
  const out = initDocSamples(stateOf(dirs));
  assert.deepEqual(out.results, []);
  assert.equal(out.created, 0);
  assert.equal(out.failed, 0);
});
