import fs from 'node:fs';
import path from 'node:path';
import { t } from '../i18n.js';

const ANSI_RE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function stripAnsi(s) {
  return String(s ?? '').replace(ANSI_RE, '');
}

export function readLogTail(file, maxLines = 100) {
  if (!file) return '';
  try {
    const text = stripAnsi(fs.readFileSync(file, 'utf8')).trim();
    if (!text) return '';
    return text.split(/\r?\n/).slice(-maxLines).join('\n');
  } catch {
    return '';
  }
}

function logFileOf(store, run) {
  return run.logFile ? store.logPath(run.logFile) : '';
}

export function runPaths(store, task, runId) {
  const runDir = store.runDirFor(task.id, runId);
  return {
    runDir,
    reportDir: runDir,
    defaultReportPath: path.join(runDir, 'report.md'),
  };
}

export function writeRunContext({ store, task, run, callback = null }) {
  const p = runPaths(store, task, run.id);
  const contextFile = store.contextFileFor(task.id, run.id);
  const contextPath = store.reportPath(contextFile);
  fs.mkdirSync(p.runDir, { recursive: true });
  fs.mkdirSync(p.reportDir, { recursive: true });
  const context = {
    runId: run.id,
    taskId: task.id,
    taskName: task.name,
    trigger: run.trigger,
    startedAt: run.startedAt,
    reportPath: p.defaultReportPath,
    reportDir: p.reportDir,
    promptPath: path.join(p.runDir, 'prompt.md'),
    logPath: logFileOf(store, run),
    outputDir: p.runDir,
    ...(callback ? { callback } : {}),
  };
  fs.writeFileSync(contextPath, JSON.stringify(context, null, 2), 'utf8');
  return {
    contextPath,
    reportPath: p.defaultReportPath,
    reportFile: store.reportFileFor(task.id, run.id),
    reportDir: p.reportDir,
    promptPath: context.promptPath,
    outputDir: p.runDir,
  };
}

export function fallbackMarkdown({ task, run, result = {}, logText = '' }) {
  const status = result.status || run.status || 'failed';
  const label = t(`sched.status.${status}`);
  const started = new Date(run.startedAt || Date.now()).toLocaleString();
  const duration = result.durationMs ?? run.durationMs;
  const exitCode = result.exitCode ?? run.exitCode;
  const error = result.error || run.error || '';
  const lines = [
    `# ${task.name} · ${label}`,
    '',
    `- ${t('sched.report.run')}: ${run.id}`,
    `- ${t('sched.report.trigger')}: ${t(`sched.trigger.${run.trigger || 'schedule'}`)}`,
    `- ${t('sched.report.started')}: ${started}`,
    `- ${t('sched.report.duration')}: ${duration == null ? '—' : `${duration} ms`}`,
    `- ${t('sched.report.exit')}: ${exitCode == null ? '—' : exitCode}`,
    `- ${t('sched.report.error')}: ${error || '—'}`,
  ];
  if (logText) lines.push('', `## ${t('sched.report.log_tail')}`, '', '```text', logText, '```');
  return lines.join('\n') + '\n';
}

export function ensureReport({ store, task, run, result = {} }) {
  const p = runPaths(store, task, run.id);
  const reportPath = store.reportPath(store.reportFileFor(task.id, run.id));
  let text = '';
  try { text = fs.readFileSync(reportPath, 'utf8'); } catch { /* missing */ }
  if (!text.trim()) {
    text = fallbackMarkdown({ task, run, result, logText: readLogTail(logFileOf(store, run)) });
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, text, 'utf8');
  }
  return {
    reportFile: path.relative(store.tasksDir, reportPath),
    reportDir: p.reportDir,
    files: ['report.md'],
  };
}

export function reportDirOf(store, run, task) {
  if (run.reportDir) return run.reportDir;
  const t = task || { id: run.taskId };
  return runPaths(store, t, run.id).reportDir;
}

export function legacyReport({ store, run, task }) {
  return fallbackMarkdown({
    task: task || { name: run.taskId },
    run,
    result: { status: run.status, error: run.error, exitCode: run.exitCode, durationMs: run.durationMs },
    logText: readLogTail(logFileOf(store, run)),
  });
}
