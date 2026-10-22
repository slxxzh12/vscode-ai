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

export function writeRunContext({ store, task, run }) {
  const reportFile = store.reportFileFor(task.id, run.id);
  const contextFile = store.contextFileFor(task.id, run.id);
  const reportPath = store.reportPath(reportFile);
  const contextPath = store.reportPath(contextFile);
  const outputDir = path.dirname(reportPath);
  fs.mkdirSync(outputDir, { recursive: true });
  const context = {
    runId: run.id,
    taskId: task.id,
    taskName: task.name,
    trigger: run.trigger,
    startedAt: run.startedAt,
    reportPath,
    logPath: logFileOf(store, run),
    outputDir,
  };
  fs.writeFileSync(contextPath, JSON.stringify(context, null, 2), 'utf8');
  return { contextPath, reportPath, reportFile };
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
  const reportFile = store.reportFileFor(task.id, run.id);
  const reportPath = store.reportPath(reportFile);
  let text = '';
  try { text = fs.readFileSync(reportPath, 'utf8'); } catch { /* missing */ }
  if (!text.trim()) {
    text = fallbackMarkdown({ task, run, result, logText: readLogTail(logFileOf(store, run)) });
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, text, 'utf8');
  }
  return reportFile;
}

export function legacyReport({ store, run, task }) {
  return fallbackMarkdown({
    task: task || { name: run.taskId },
    run,
    result: { status: run.status, error: run.error, exitCode: run.exitCode, durationMs: run.durationMs },
    logText: readLogTail(logFileOf(store, run)),
  });
}
