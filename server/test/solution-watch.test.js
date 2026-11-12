import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSolutionWatch } from '../pipeline/solution-watch.js';

function setup({ watch = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-solution-watch-'));
  const solution = path.join(root, 'docs', 'version');
  fs.mkdirSync(path.join(solution, 'US000001-20260315-A'), { recursive: true });
  let state = { solutionDir: '', baseline: [], items: {} };
  const cfg = { autoDev: true, autoMerge: false, watch };
  let triggers = 0;
  let active = false;
  const configStore = { read: () => ({ ...cfg }) };
  const stateStore = {
    read: () => JSON.parse(JSON.stringify(state)),
    write: (next) => { state = JSON.parse(JSON.stringify(next)); return state; },
  };
  const scheduler = {
    queue: { listJobs: async () => (active ? [{}] : []) },
    engine: { manualRun: async () => { triggers++; active = true; return {}; } },
  };
  const watcher = createSolutionWatch({
    configStore, stateStore, scheduler,
    docsState: () => ({ solution: { selected: true, path: solution } }),
    logger: { info() {}, warn() {} },
    intervalMs: 15,
  });
  return {
    root, solution, watcher,
    state: () => state,
    triggers: () => triggers,
    idle: () => { active = false; },
    add: (name) => fs.mkdirSync(path.join(solution, name), { recursive: true }),
  };
}

test('solution-watch: first scan records baseline and does not trigger', async () => {
  const f = setup();
  const s = await f.watcher.scan();
  assert.equal(f.triggers(), 0);
  assert.equal(s.pending, 0);
  assert.deepEqual(f.state().baseline, ['US000001-20260315-A']);
});

test('solution-watch: new solution triggers auto coding once while job is active', async () => {
  const f = setup();
  await f.watcher.scan();
  f.add('US000002-20260316-B');
  const s1 = await f.watcher.scan();
  assert.equal(s1.pending, 1);
  assert.equal(f.triggers(), 1);
  const s2 = await f.watcher.scan();
  assert.equal(s2.pending, 1);
  assert.equal(f.triggers(), 1);
  f.idle();
  f.state().items['US000002-20260316-B'] = { status: 'success' };
  await f.watcher.scan();
  assert.equal(f.triggers(), 1);
});

test('solution-watch: disabled config never triggers', async () => {
  const f = setup({ watch: false });
  await f.watcher.scan();
  f.add('US000002-20260316-B');
  await f.watcher.scan();
  assert.equal(f.triggers(), 0);
});

test('solution-watch: start/stop updates running status', () => {
  const f = setup();
  const a = f.watcher.start();
  assert.equal(a.running, true);
  const b = f.watcher.stop();
  assert.equal(b.running, false);
});
