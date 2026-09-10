import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScheduler } from '../scheduler/index.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-idx-')); }
function fakeRunner() {
  const calls = [];
  return {
    calls,
    run(a) { calls.push(a); return Promise.resolve({ exitCode: 0, timedOut: false, durationMs: 1 }); },
    stop() { return true; }, isRunning() { return false; }, count() { return 0; },
  };
}

test('createScheduler 组装 store/engine/mount 并解析项目 cwd', () => {
  const runner = fakeRunner();
  const sched = createScheduler({ dir: tmpDir(), runner, projectResolver: (id) => (id === 'p1' ? 'C:/proj' : null) });
  const { task } = sched.store.createTask({
    name: 'a', projectId: 'p1', type: 'shell', command: 'echo',
    schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } },
  });
  assert.equal(typeof sched.mount, 'function');
  const r = sched.engine.manualRun(task.id);
  assert.equal(r.run.status, 'running');
  assert.equal(runner.calls[0].spec.cwd, 'C:/proj');
});
