import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadsDir, relayPluginsDir } from '../data-home.js';

test('downloadsDir 指向 dataHome/downloads', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'df-data-'));
  const prev = process.env.DEVFLOW_DATA_HOME;
  process.env.DEVFLOW_DATA_HOME = data;
  try {
    assert.equal(downloadsDir(), path.join(data, 'downloads'));
    assert.equal(relayPluginsDir(), path.join(data, 'downloads', 'relay-plugins'));
  } finally {
    if (prev === undefined) delete process.env.DEVFLOW_DATA_HOME; else process.env.DEVFLOW_DATA_HOME = prev;
  }
});
