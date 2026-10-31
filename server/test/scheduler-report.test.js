import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SchedulerStore } from '../scheduler/store.js';
import { writeRunContext, ensureReport, legacyReport, stripAnsi, archiveReport } from '../scheduler/report.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-report-')); }
function mkStore() {
  const store = new SchedulerStore({ dir: tmpDir() });
  const { task } = store.createTask({ name: 'scan', type: 'shell', command: 'echo', schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } } });
  return { store, task };
}

test('writeRunContext 生成 run.json 与报告目录', () => {
  const { store, task } = mkStore();
  const run = { id: 'r1', taskId: task.id, trigger: 'manual', startedAt: 100, logFile: store.logFileFor(task.id, 'r1') };
  const ctx = writeRunContext({ store, task, run });
  const json = JSON.parse(fs.readFileSync(ctx.contextPath, 'utf8'));
  assert.equal(json.runId, 'r1');
  assert.equal(json.taskName, 'scan');
  assert.equal(json.reportPath, ctx.reportPath);
  assert.equal(json.outputDir, path.dirname(ctx.reportPath));
  assert.equal(json.logPath, store.logPath(run.logFile));
});

test('ensureReport 保留任务写入的报告', () => {
  const { store, task } = mkStore();
  const run = { id: 'r2', taskId: task.id, trigger: 'manual', startedAt: 100, logFile: store.logFileFor(task.id, 'r2') };
  const ctx = writeRunContext({ store, task, run });
  fs.writeFileSync(ctx.reportPath, '# custom');
  const info = ensureReport({ store, task, run, result: { status: 'success' } });
  assert.equal(fs.readFileSync(store.reportPath(info.reportFile), 'utf8'), '# custom');
});

test('ensureReport 缺失时生成兜底报告并去掉 ANSI', () => {
  const { store, task } = mkStore();
  const run = { id: 'r3', taskId: task.id, trigger: 'schedule', startedAt: 100, logFile: store.logFileFor(task.id, 'r3'), status: 'failed', error: 'boom' };
  fs.mkdirSync(path.dirname(store.logPath(run.logFile)), { recursive: true });
  fs.writeFileSync(store.logPath(run.logFile), '\u001b[31mboom\u001b[0m');
  writeRunContext({ store, task, run });
  const info = ensureReport({ store, task, run, result: { status: 'failed', error: 'boom', exitCode: 1, durationMs: 12 } });
  const text = fs.readFileSync(store.reportPath(info.reportFile), 'utf8');
  assert.match(text, /# scan/);
  assert.match(text, /失败/);
  assert.match(text, /boom/);
  assert.equal(text.includes('\u001b'), false);
});

test('legacyReport 给旧运行记录即时生成报告', () => {
  const { store, task } = mkStore();
  const run = { id: 'r4', taskId: task.id, trigger: 'manual', startedAt: 100, logFile: store.logFileFor(task.id, 'r4'), status: 'success' };
  const text = legacyReport({ store, run, task });
  assert.match(text, /# scan/);
  assert.match(text, /成功/);
});

test('legacyReport 兼容没有 logFile 的旧记录', () => {
  const { store, task } = mkStore();
  const text = legacyReport({ store, run: { id: 'r5', taskId: task.id, status: 'failed', trigger: 'schedule', startedAt: 1 }, task });
  assert.match(text, /# scan/);
  assert.match(text, /失败/);
});

test('stripAnsi 去除颜色码', () => {
  assert.equal(stripAnsi('\u001b[31mred\u001b[0m'), 'red');
});

test('archiveReport：无唯一键留在临时目录，有唯一键复制到独立目录', () => {
  const { store, task } = mkStore();
  const run = { id: 'j1', taskId: task.id, trigger: 'manual', startedAt: 100, logFile: store.logFileFor(task.id, 'j1') };
  const ctx = writeRunContext({ store, task, run });
  fs.writeFileSync(ctx.reportPath, '# temp report');
  const info = ensureReport({ store, task, run, result: { status: 'success' } });

  const plain = archiveReport({ store, task, jobId: 'j1', reportFile: info.reportFile, now: 123 });
  assert.equal(plain.reportId, 'j1');
  assert.equal(plain.reportArchivePath, undefined);

  const { task: keyed } = store.createTask({
    name: 'rag', type: 'shell', command: 'echo', uniqueKey: 'rag-doc-1',
    schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } },
  });
  const run2 = { id: 'j2', taskId: keyed.id, trigger: 'manual', startedAt: 100, logFile: store.logFileFor(keyed.id, 'j2') };
  const ctx2 = writeRunContext({ store, task: keyed, run: run2 });
  fs.writeFileSync(ctx2.reportPath, '# archived report');
  const info2 = ensureReport({ store, task: keyed, run: run2, result: { status: 'success' } });
  const archived = archiveReport({ store, task: keyed, jobId: 'j2', reportFile: info2.reportFile, result: { status: 'success' }, now: 456 });

  assert.equal(archived.reportId, 'rag-doc-1');
  assert.equal(fs.readFileSync(archived.reportArchiveFile, 'utf8'), '# archived report');
  const meta = JSON.parse(fs.readFileSync(path.join(archived.reportArchivePath, 'meta.json'), 'utf8'));
  assert.equal(meta.reportId, 'rag-doc-1');
  assert.equal(meta.jobId, 'j2');
  assert.equal(meta.reportFile, 'report.md');
  assert.equal(meta.createdAt, 456);
});
