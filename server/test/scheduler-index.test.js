import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScheduler } from '../scheduler/index.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-idx-')); }

test('createScheduler 暴露 queue/registry/consumer/start/stop', async () => {
  const dir = tmpDir();
  const s = createScheduler({
    dir, manifestRoot: path.join(dir, 'manifests'),
    machineId: 'm1', hostport: 'h:1', role: 'master', version: 'v',
    queueConfigFile: path.join(dir, 'queue.json'),
    dbFile: path.join(dir, 'void.db'),
    startWorkers: false,
  });
  assert.ok(s.queue);
  assert.equal(typeof s.start, 'function');
  await s.start({ startWorkers: false });
  assert.equal(await s.queue.partitionCount(), 16);
  await s.stop();
});
