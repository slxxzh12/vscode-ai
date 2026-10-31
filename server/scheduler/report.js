import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

function listMarkdown(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch { return []; }
}

// 优先使用 AI 在 result.json 里指定的报告，否则扫描运行目录里的 Markdown。
export function scanReportFile(store, task, runId, preferred = null) {
  const p = runPaths(store, task, runId);
  const root = path.resolve(p.runDir);
  const candidates = [];
  if (typeof preferred === 'string' && preferred.trim()) {
    const abs = path.isAbsolute(preferred) ? path.resolve(preferred) : path.resolve(root, preferred);
    if (abs === root || abs.startsWith(root + path.sep)) candidates.push(abs);
  }
  candidates.push(p.defaultReportPath);
  const reportDir = path.join(root, 'report');
  for (const name of listMarkdown(reportDir)) candidates.push(path.join(reportDir, name));
  for (const name of listMarkdown(root)) {
    if (name.toLowerCase() === 'prompt.md') continue;
    candidates.push(path.join(root, name));
  }
  for (const abs of candidates) {
    try {
      if (abs.toLowerCase().endsWith('.md') && fs.readFileSync(abs, 'utf8').trim()) return abs;
    } catch { /* next */ }
  }
  return null;
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
    resultPath: path.join(p.runDir, 'result.json'),
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
    resultPath: context.resultPath,
    outputDir: p.runDir,
  };
}

export function writeRunResult({ store, task, run, data = {} }) {
  const p = runPaths(store, task, run.id);
  const file = path.join(p.runDir, 'result.json');
  fs.mkdirSync(p.runDir, { recursive: true });
  const payload = {
    runId: run.id,
    taskId: task.id,
    taskName: task.name,
    trigger: run.trigger,
    startedAt: run.startedAt,
    ...data,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return file;
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

export function ensureReport({ store, task, run, result = {}, reportPathHint = null }) {
  const p = runPaths(store, task, run.id);
  const found = scanReportFile(store, task, run.id, reportPathHint);
  if (found) {
    return {
      reportFile: path.relative(store.tasksDir, found),
      reportDir: p.reportDir,
      files: listMarkdown(p.runDir),
    };
  }
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

function archiveSegment(id) {
  const raw = String(id || '').trim();
  const safe = raw.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^[._-]+/, '').slice(0, 80) || 'report';
  if (safe === raw) return safe;
  const suffix = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8);
  return `${safe}-${suffix}`;
}

// 报告唯一 ID 由任务的 uniqueKey 指定；未设置时只保留临时运行目录。
// 设置后把本次报告复制到 scheduler/reports/<uniqueKey>/report.md，供后续 RAG 使用。
export function archiveReport({ store, task, jobId, reportFile, result = {}, now = Date.now() }) {
  const reportId = task.uniqueKey ? String(task.uniqueKey) : jobId;
  const base = { reportId };
  if (!task.uniqueKey || !reportFile) return base;
  try {
    const dir = path.join(store.dir, 'reports', archiveSegment(task.uniqueKey));
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, 'report.md');
    const tmp = dest + '.tmp';
    fs.copyFileSync(store.reportPath(reportFile), tmp);
    fs.renameSync(tmp, dest);
    const meta = {
      reportId,
      uniqueKey: task.uniqueKey,
      taskId: task.id,
      taskName: task.name,
      jobId,
      status: result.status || null,
      error: result.error || null,
      sourceReportFile: reportFile,
      reportFile: 'report.md',
      createdAt: now,
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    return { reportId, reportArchivePath: dir, reportArchiveFile: dest };
  } catch {
    return base;
  }
}

export function legacyReport({ store, run, task }) {
  return fallbackMarkdown({
    task: task || { name: run.taskId },
    run,
    result: { status: run.status, error: run.error, exitCode: run.exitCode, durationMs: run.durationMs },
    logText: readLogTail(logFileOf(store, run)),
  });
}
