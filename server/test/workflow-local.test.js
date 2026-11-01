import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkflowStore } from '../workflow-store.js';
import { localWorkflowDir, readLocalWorkflows, mergeLocalWorkflows } from '../workflow-local.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-wflocal-')); }

function makeWorkflow(dir, id, label, prompts = ['p']) {
  const store = createWorkflowStore({ dir });
  store.writeAll([{ id, label, stages: [{ id: 's', label: 'S', group: 'G', prompts }] }]);
}

test('localWorkflowDir 拼接 <目录>/.void/workflows', () => {
  assert.equal(localWorkflowDir(path.join('a', 'b')), path.join('a', 'b', '.void', 'workflows'));
  assert.equal(localWorkflowDir(''), '');
});

test('readLocalWorkflows 按目录顺序读取并按 label 去重', () => {
  const a = path.join(tmp(), '.void', 'workflows');
  const b = path.join(tmp(), '.void', 'workflows');
  makeWorkflow(a, '100_A', 'A', ['from-a']);
  makeWorkflow(b, '200_B', 'B', ['from-b']);
  const merged = tmp();
  makeWorkflow(merged, '300_C', 'A', ['from-c']);
  const out = readLocalWorkflows([a, b, merged, path.join(tmp(), 'missing')]);
  assert.deepEqual(out.map((w) => w.label), ['A', 'B']);
  assert.deepEqual(out.find((w) => w.label === 'A').stages[0].prompts, ['from-a'], '先出现的目录优先');
});

test('mergeLocalWorkflows 本地排最前，同名覆盖，默认仍保留', () => {
  const baseDir = tmp();
  createWorkflowStore({ dir: baseDir }).writeAll([
    { id: '100_Dev', label: '开发工作流', stages: [{ id: 's', label: 'S', group: 'G', prompts: ['base-dev'] }] },
    { id: '200_Doc', label: '文档工作流', stages: [{ id: 's', label: 'S', group: 'G', prompts: ['base-doc'] }] },
  ]);
  const base = createWorkflowStore({ dir: baseDir }).readAll();

  const local = path.join(tmp(), '.void', 'workflows');
  createWorkflowStore({ dir: local }).writeAll([
    { id: '100_Dev', label: '开发工作流', stages: [{ id: 's', label: 'S', group: 'G', prompts: ['local-dev'] }] },
    { id: '300_Common', label: '常用工作流', stages: [{ id: 's', label: 'S', group: 'G', prompts: ['local-common'] }] },
  ]);

  const out = mergeLocalWorkflows(base, [local]);
  assert.deepEqual(out.map((w) => w.label), ['开发工作流', '常用工作流', '文档工作流']);
  assert.deepEqual(out.find((w) => w.label === '开发工作流').stages[0].prompts, ['local-dev']);
  assert.equal(out.find((w) => w.label === '开发工作流').id, base.find((w) => w.label === '开发工作流').id, '同名保留默认 id');
});

test('没有本地工作流时原样返回默认列表', () => {
  const base = [{ id: 'x', label: 'X', stages: [] }];
  assert.equal(mergeLocalWorkflows(base, [path.join(tmp(), 'none')]), base);
});
