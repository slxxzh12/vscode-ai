import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { US_RE, listUsDirs } from '../pipeline/us-detect.js';
import {
  createUsStateStore, resetBaseline, selectPending, markInterrupted, emptyUsState,
} from '../pipeline/us-state.js';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-us-state-'));
}

test('us-detect：只识别 US+6位编号+4位年份的一级目录并排序', () => {
  const root = tmpRoot();
  for (const name of ['US000002-2022-B', 'not-us', 'US000001-2021-A', 'US12-2021-X']) {
    fs.mkdirSync(path.join(root, name));
  }
  assert.equal(US_RE.test('US000001-2021-增加用户'), true);
  assert.equal(US_RE.test('US000001-20260315-增加用户'), true);
  assert.equal(US_RE.test('us000001-2021-x'), true);
  assert.equal(US_RE.test('US12-2021-x'), false);
  assert.deepEqual(listUsDirs(root), ['US000001-2021-A', 'US000002-2022-B']);
  assert.deepEqual(listUsDirs(path.join(root, 'missing')), []);
});

test('us-detect：支持一层特性文件夹（F0001-.../US...）', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'US000001-2021-A'));
  fs.mkdirSync(path.join(root, 'F0001-用户管理', 'US000003-2023-C'), { recursive: true });
  fs.mkdirSync(path.join(root, 'F0001-用户管理', 'not-us'), { recursive: true });
  fs.mkdirSync(path.join(root, 'F0002-混合', 'US000002-2022-B'), { recursive: true });
  assert.deepEqual(listUsDirs(root), [
    'F0001-用户管理/US000003-2023-C',
    'F0002-混合/US000002-2022-B',
    'US000001-2021-A',
  ]);
  assert.deepEqual(listUsDirs(path.join(root, 'missing')), []);
});

test('us-state：基线 US 首次记录修订不触发，修订变化后重跑', () => {
  const state = resetBaseline('D:/sol', ['US000001-2021-A']);
  assert.deepEqual(selectPending(state, ['US000001-2021-A'], { 'US000001-2021-A': 'r1' }), []);
  assert.equal(state.revs['US000001-2021-A'], 'r1');
  assert.deepEqual(selectPending(state, ['US000001-2021-A'], { 'US000001-2021-A': 'r2' }), ['US000001-2021-A']);
  assert.equal(state.items['US000001-2021-A'].status, 'pending');
});

test('us-state：已处理 US 文档修订变化才重跑，未变不重跑', () => {
  const state = resetBaseline('D:/sol', []);
  state.items['US000002-2022-B'] = { status: 'success' };
  state.revs['US000002-2022-B'] = 'r1';
  assert.deepEqual(selectPending(state, ['US000002-2022-B'], { 'US000002-2022-B': 'r1' }), []);
  assert.deepEqual(selectPending(state, ['US000002-2022-B'], { 'US000002-2022-B': 'r2' }), ['US000002-2022-B']);
  assert.equal(state.items['US000002-2022-B'].status, 'pending');
  state.items['US000002-2022-B'] = { status: 'failed' };
  state.revs['US000002-2022-B'] = 'r2';
  assert.deepEqual(selectPending(state, ['US000002-2022-B'], { 'US000002-2022-B': 'r2' }), []);
});

test('us-state：基线之外的新 US 进入 pending，已有结果不重复', () => {
  const state = resetBaseline('D:/sol', ['US000001-2021-A']);
  assert.equal(selectPending(state, ['US000001-2021-A']).length, 0);
  assert.deepEqual(selectPending(state, ['US000001-2021-A', 'US000002-2022-B']), ['US000002-2022-B']);
  assert.equal(state.items['US000002-2022-B'].status, 'pending');
  state.items['US000002-2022-B'].status = 'success';
  assert.equal(selectPending(state, ['US000001-2021-A', 'US000002-2022-B']).length, 0);
});

test('us-state：失败的 US 重新置为 pending 后会被选中', () => {
  const state = resetBaseline('D:/sol', []);
  state.items['US000003-2023-C'] = { status: 'failed', attempts: 1 };
  assert.equal(selectPending(state, ['US000003-2023-C']).length, 0);
  state.items['US000003-2023-C'].status = 'pending';
  assert.deepEqual(selectPending(state, ['US000003-2023-C']), ['US000003-2023-C']);
});

test('us-state：running 视为中断失败；写入后读回', () => {
  const file = path.join(tmpRoot(), 'us-state.json');
  const state = emptyUsState('D:/sol');
  state.items['US000004-2024-D'] = { status: 'running', attempts: 1 };
  markInterrupted(state);
  assert.equal(state.items['US000004-2024-D'].status, 'failed');
  assert.equal(state.items['US000004-2024-D'].error, 'interrupted');
  const store = createUsStateStore({ file });
  store.write(state);
  assert.deepEqual(store.read().items['US000004-2024-D'].status, 'failed');
  assert.equal(store.read().solutionDir, 'D:/sol');
});
