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
  assert.deepEqual(store.read(), { autoDev: false, autoMerge: false });
});

test('us-config：写入后读回布尔值', () => {
  const file = tmpFile();
  const store = createUsConfigStore({ file });
  store.write({ autoDev: true, autoMerge: true });
  assert.deepEqual(store.read(), { autoDev: true, autoMerge: true });
  store.write({ autoDev: 'yes', autoMerge: 1 });
  assert.deepEqual(store.read(), { autoDev: false, autoMerge: false });
});

test('us-config：损坏文件回退默认值', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{bad', 'utf8');
  const store = createUsConfigStore({ file, logger: { warn() {} } });
  assert.deepEqual(store.read(), { autoDev: false, autoMerge: false });
});
