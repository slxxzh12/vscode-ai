import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataHome, downloadsDir, relayPluginsDir, instanceName, instanceSeedDir, instanceFpRoot } from '../data-home.js';

function withDataHome(fn) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'df-data-'));
  const prev = process.env.DEVFLOW_DATA_HOME;
  process.env.DEVFLOW_DATA_HOME = data;
  try { fn(data); } finally {
    if (prev === undefined) delete process.env.DEVFLOW_DATA_HOME; else process.env.DEVFLOW_DATA_HOME = prev;
  }
}

function withEnv(key, fn) {
  const prev = process.env[key];
  try { fn(); } finally {
    if (prev === undefined) delete process.env[key]; else process.env[key] = prev;
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

test('downloadsDir/relayPluginsDir 可用显式 root 覆盖（不走 dataHome）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-root-'));
  assert.equal(downloadsDir(22222, root), path.join(root, 'ports', '22222', 'downloads'));
  assert.equal(relayPluginsDir(22222, root), path.join(root, 'ports', '22222', 'downloads', 'relay-plugins'));
});

test('dataHome 无 DEVFLOW_DATA_HOME 时按平台推导到 .../void', () => {
  withEnv('DEVFLOW_DATA_HOME', () => {
    delete process.env.DEVFLOW_DATA_HOME;
    const d = dataHome();
    assert.equal(path.basename(d), 'void');
    assert.ok(path.isAbsolute(d));
  });
});

test('instanceName 忽略空/纯空白/default，其余原样（含 trim）', () => {
  withEnv('DEVFLOW_NODE', () => {
    delete process.env.DEVFLOW_NODE;
    assert.equal(instanceName(), '');
    process.env.DEVFLOW_NODE = '';
    assert.equal(instanceName(), '');
    process.env.DEVFLOW_NODE = '   ';
    assert.equal(instanceName(), '');
    process.env.DEVFLOW_NODE = 'default';
    assert.equal(instanceName(), '');
    process.env.DEVFLOW_NODE = ' nodeA ';
    assert.equal(instanceName(), 'nodeA');
  });
});

test('instanceSeedDir/instanceFpRoot 建目录并返回路径', () => {
  withDataHome((data) => {
    const seed = instanceSeedDir('nodeA');
    assert.equal(seed, path.join(data, 'nodes', 'nodeA'));
    assert.ok(fs.statSync(seed).isDirectory());

    const fp = instanceFpRoot('abcd1234');
    assert.equal(fp, path.join(data, 'nodes', 'abcd1234'));
    assert.ok(fs.statSync(fp).isDirectory());
  });
});
