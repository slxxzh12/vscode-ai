import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataHome, downloadsDir, relayPluginsDir } from '../data-home.js';

function withDataHome(fn) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'df-data-'));
  const prev = process.env.DEVFLOW_DATA_HOME;
  process.env.DEVFLOW_DATA_HOME = data;
  try { fn(data); } finally {
    if (prev === undefined) delete process.env.DEVFLOW_DATA_HOME; else process.env.DEVFLOW_DATA_HOME = prev;
  }
}

test('dataHome 可被 DEVFLOW_DATA_HOME 覆盖', () => {
  withDataHome((data) => { assert.equal(dataHome(), data); });
});

test('downloadsDir/relayPluginsDir 按端口隔离', () => {
  withDataHome((data) => {
    assert.equal(downloadsDir(22222), path.join(data, 'ports', '22222', 'downloads'));
    assert.equal(relayPluginsDir(22222), path.join(data, 'ports', '22222', 'downloads', 'relay-plugins'));
    assert.notEqual(downloadsDir(22222), downloadsDir(33333));
  });
});
