import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createAiSiteRunner } from '../ai-site/runner.js';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return child;
}

function setupPlugin(root) {
  const dir = path.join(root, 'translate');
  fs.mkdirSync(path.join(dir, 'workflow'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'workflow', 'prompt.md'), 'PROMPT');
  fs.writeFileSync(path.join(dir, 'workflow', 'extra.txt'), 'E');
  return dir;
}

test('runnerï¼šå»º run ç›®å½•ã€å†™ input.jsonã€å¤åˆ¶ workflowã€è°ƒç”¨ agent', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-run-'));
  const pluginDir = setupPlugin(root);
  const runsDir = path.join(root, 'runs');
  let captured = null;
  const runner = createAiSiteRunner({
    runsDir,
    resolveBin: () => 'opencode',
    spawnFn: (bin, args, opts) => {
      captured = { bin, args, opts };
      const c = fakeChild();
      setTimeout(() => {
        c.stdout.emit('data', 'hello');
        c.stderr.emit('data', 'warn');
        c.emit('close', 0);
      }, 0);
      return c;
    },
  });
  const run = runner.createRun({
    pluginName: 'translate',
    pluginDir,
    workflowPath: path.join(pluginDir, 'workflow', 'prompt.md'),
    values: { text: 'hi' },
    user: 'alice',
  });
  assert.ok(run.id);
  assert.equal(run.status, 'running');
  const runDir = path.join(runsDir, run.id);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runDir, 'input.json'), 'utf8')), { text: 'hi' });
  assert.equal(fs.readFileSync(path.join(runDir, 'prompt.md'), 'utf8'), 'PROMPT');
  assert.equal(fs.existsSync(path.join(runDir, 'output')), true);
  assert.equal(captured.bin, 'opencode');
  assert.deepEqual(captured.args, ['run', 'PROMPT']);
  assert.equal(captured.opts.cwd, runDir);

  await new Promise((r) => setTimeout(r, 20));
  const done = runner.getRun(run.id);
  assert.equal(done.status, 'success');
  assert.equal(done.exitCode, 0);
  assert.match(fs.readFileSync(path.join(runDir, 'run.log'), 'utf8'), /hello/);
});

test('runnerï¼šä¿ç•™æœ€è¿‘ N ä¸ª run', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-prune-'));
  const pluginDir = setupPlugin(root);
  const runsDir = path.join(root, 'runs');
  const runner = createAiSiteRunner({
    runsDir, keepRuns: 2, resolveBin: () => 'opencode',
    spawnFn: () => { throw new Error('no-spawn'); },
  });
  const ids = [];
  for (let i = 0; i < 4; i += 1) {
    ids.push(runner.createRun({ pluginName: 'translate', pluginDir, workflowPath: path.join(pluginDir, 'workflow', 'prompt.md'), values: {}, user: '' }).id);
    const t = new Date(2020, 0, i + 1);
    fs.utimesSync(path.join(runsDir, ids[i]), t, t);
  }
  const kept = fs.readdirSync(runsDir);
  assert.equal(kept.length, 2);
  assert.equal(kept.includes(ids[0]), false);
});

test('runnerï¼šoutput æ–‡ä»¶åˆ—è¡¨ã€è¯»å–é˜²ç©¿è¶Šã€zip', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-files-'));
  const pluginDir = setupPlugin(root);
  const runsDir = path.join(root, 'runs');
  const runner = createAiSiteRunner({ runsDir, resolveBin: () => 'opencode', spawnFn: () => { throw new Error('no-spawn'); } });
  const run = runner.createRun({ pluginName: 'translate', pluginDir, workflowPath: path.join(pluginDir, 'workflow', 'prompt.md'), values: {}, user: '' });
  const outDir = path.join(runsDir, run.id, 'output');
  fs.writeFileSync(path.join(outDir, 'a.txt'), 'A');
  fs.mkdirSync(path.join(outDir, 'sub'));
  fs.writeFileSync(path.join(outDir, 'sub', 'b.md'), 'B');
  const files = runner.listFiles(run.id).map((f) => f.path).sort();
  assert.deepEqual(files, ['a.txt', 'sub/b.md']);
  assert.equal(runner.readFile(run.id, 'a.txt').data.toString('utf8'), 'A');
  assert.throws(() => runner.readFile(run.id, '../run.json'), (e) => e.code === 'bad-path');
  const zip = runner.zipOutput(run.id);
  assert.equal(zip.subarray(0, 2).toString('utf8'), 'PK');
});

test('runner£ºonStateChange »Øµ÷ start/finish', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-state-'));
  const pluginDir = setupPlugin(root);
  const runsDir = path.join(root, 'runs');
  const events = [];
  const runner = createAiSiteRunner({
    runsDir, resolveBin: () => 'opencode', onStateChange: (e) => events.push(e),
    spawnFn: () => {
      const c = fakeChild();
      setTimeout(() => { c.stdout.emit('data', 'ok'); c.emit('close', 0); }, 0);
      return c;
    },
  });
  runner.createRun({ pluginName: 'translate', pluginTitle: '·­ÒëÖúÊÖ', pluginDir, workflowPath: path.join(pluginDir, 'workflow', 'prompt.md'), values: {}, user: 'u1' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(events[0].phase, 'start');
  assert.equal(events[0].pluginTitle, '·­ÒëÖúÊÖ');
  assert.equal(events.at(-1).phase, 'finish');
  assert.equal(events.at(-1).status, 'success');
  assert.equal(events.at(-1).user, 'u1');
});
