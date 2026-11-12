import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '../pipeline/us-exec.js';

function tmpLog() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-us-exec-')), 'cmd.log');
}

test('us-exec：成功命令写日志并返回 0', async () => {
  const logPath = tmpLog();
  const r = await runCommand({
    cwd: process.cwd(),
    command: 'node -e "console.log(\'hello-ok\')"',
    logPath,
  });
  assert.equal(r.ok, true);
  assert.equal(r.exitCode, 0);
  assert.match(fs.readFileSync(logPath, 'utf8'), /hello-ok/);
});

test('us-exec：失败命令返回非 0', async () => {
  const r = await runCommand({
    cwd: process.cwd(),
    command: 'node -e "process.exit(3)"',
    logPath: tmpLog(),
  });
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 3);
});
