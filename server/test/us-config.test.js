import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUsConfigStore } from '../pipeline/us-config.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-us-config-'));
  return path.join(dir, 'config.json');
}

test('us-config：文件不存在时默认关闭', () => {
  const store = createUsConfigStore({ file: tmpFile() });
  assert.deepEqual(store.read(), { autoDev: false, autoMerge: false, watch: false, baseBranch: 'master' });
});

test('us-config：写入后读回布尔值', () => {
  const file = tmpFile();
  const store = createUsConfigStore({ file });
  store.write({ autoDev: true, autoMerge: true, watch: true });
  assert.deepEqual(store.read(), { autoDev: true, autoMerge: true, watch: true, baseBranch: 'master' });
  store.write({ autoDev: 'yes', autoMerge: 1 });
  assert.deepEqual(store.read(), { autoDev: false, autoMerge: false, watch: false, baseBranch: 'master' });
});

test('us-config：目标分支默认 master，可自定义且去空白', () => {
  const store = createUsConfigStore({ file: tmpFile() });
  assert.equal(store.read().baseBranch, 'master');
  store.write({ autoDev: true, baseBranch: '  release  ' });
  assert.equal(store.read().baseBranch, 'release');
  store.write({ autoDev: true, baseBranch: '   ' });
  assert.equal(store.read().baseBranch, 'master');
});

test('us-config：watch 依赖 autoDev，自动开发关闭时监控也关闭', () => {
  const store = createUsConfigStore({ file: tmpFile() });
  store.write({ autoDev: false, watch: true });
  assert.equal(store.read().watch, false);
  store.write({ autoDev: true, watch: true });
  assert.equal(store.read().watch, true);
});

test('us-config：损坏文件回退默认值', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{bad', 'utf8');
  const store = createUsConfigStore({ file, logger: { warn() {} } });
  assert.deepEqual(store.read(), { autoDev: false, autoMerge: false, watch: false, baseBranch: 'master' });
});
