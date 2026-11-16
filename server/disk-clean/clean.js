import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isExcluded } from './validate.js';

const defaultHelper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'helper.ps1');

function psQuote(s) { return `'${String(s).replace(/'/g, "''")}'`; }

function safeTargets(targets, exclusions) {
  return targets.filter((t) => !isExcluded(t.path, exclusions));
}

export function createDiskCleanCleaner({
  jobsDir,
  helperPath = defaultHelper,
  resolveTargets,
  appendHistory = () => {},
  spawnFn = spawn,
  now = () => Date.now(),
  logger = console,
}) {
  const jobs = new Map();

  function start({ scan, categoryIds, permanent, confirmed = [] }) {
    if (!scan) return { error: 'scan_expired' };
    if (scan.expired) return { error: 'scan_expired' };
    const ids = Array.isArray(categoryIds) ? categoryIds : [];
    if (!ids.length) return { error: 'bad_category' };
    const cats = scan.categories.filter((c) => ids.includes(c.id));
    if (cats.length !== ids.length) return { error: 'bad_category' };
    const risky = cats.filter((c) => c.risk === 'risky').map((c) => c.id);
    if (risky.some((id) => !confirmed.includes(id))) return { error: 'need_confirm' };

    const jobId = crypto.randomUUID();
    const dir = path.join(jobsDir, jobId);
    fs.mkdirSync(dir, { recursive: true });
    const helperCopy = path.join(dir, 'helper.ps1');
    const rawHelper = fs.readFileSync(helperPath);
    const hasBom = rawHelper[0] === 0xef && rawHelper[1] === 0xbb && rawHelper[2] === 0xbf;
    fs.writeFileSync(helperCopy, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), hasBom ? rawHelper.subarray(3) : rawHelper]));

    const job = {
      jobId,
      createdAt: now(),
      mode: permanent ? 'permanent' : 'recycle',
      elevated: cats.some((c) => c.needsAdmin),
      exclusions: scan.exclusions || { dirs: [], patterns: [] },
      categories: cats.map((c) => ({
        id: c.id,
        minAgeDays: c.minAgeDays || 0,
        targets: safeTargets(resolveTargets(c.id, { customDirs: scan.customDirs }), scan.exclusions || {}),
      })).filter((c) => c.targets.length > 0),
    };
    const jobFile = path.join(dir, 'job.json');
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2), 'utf8');

    const state = {
      dir, jobFile, startedAt: now(), elevated: job.elevated, childExit: null,
      categoryIds: job.categories.map((c) => c.id),
    };
    jobs.set(jobId, state);

    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperCopy, '-Job', jobFile];
    if (job.elevated) {
      const launcher = `try { Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList @(${args.map(psQuote).join(',')}) } catch { exit 2 }`;
      const child = spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', launcher], { windowsHide: true });
      child.on?.('exit', (code) => { state.childExit = code; });
    } else {
      const child = spawnFn('powershell.exe', args, { windowsHide: true });
      child.on?.('exit', (code) => { state.childExit = code; });
    }
    return { jobId };
  }

  function get(jobId) {
    const state = jobs.get(jobId);
    if (!state) return null;
    const resultFile = path.join(state.dir, 'result.json');
    try {
      const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      if (result.status !== 'running') {
        if (!state.finished) {
          state.finished = true;
          appendHistory({
            ts: new Date().toISOString(),
            categories: state.categoryIds,
            removed: result.removed || 0,
            bytes: result.bytes || 0,
            failed: Array.isArray(result.failed) ? result.failed.length : 0,
            mode: result.mode,
            elevated: Boolean(result.elevated),
          });
        }
        return { ...result, jobId };
      }
    } catch { /* not ready */ }
    if (state.childExit === 2 && !fs.existsSync(resultFile)) return { status: 'cancelled', jobId };
    if (state.childExit !== null && state.childExit !== 0 && !fs.existsSync(resultFile)) {
      return { status: 'error', jobId, error: `helper exit ${state.childExit}` };
    }
    if (now() - state.startedAt > 30 * 60 * 1000) return { status: 'interrupted', jobId };
    return { status: 'running', jobId, elevated: state.elevated };
  }

  return { start, get };
}
