import fs from 'node:fs';
import path from 'node:path';
import { buildSpawnSpec } from '../scheduler/runner.js';
import { createUsConfigStore } from './us-config.js';
import { listUsDirs } from './us-detect.js';
import {
  createUsStateStore, resetBaseline, selectPending, markInterrupted,
} from './us-state.js';
import { runOneUs } from './us-runner.js';
import { mergeUsBranch } from './us-merge.js';
import * as defaultGit from './us-git.js';

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function samePath(a, b) {
  const norm = (p) => path.resolve(String(p || '')).replace(/\\/g, '/').toLowerCase();
  return norm(a) === norm(b);
}

function makeRunAi(ctx) {
  return async ({ cwd, prompt, logPath, timeoutMs }) => {
    const promptFile = path.join(path.dirname(logPath), 'prompt.md');
    fs.mkdirSync(path.dirname(promptFile), { recursive: true });
    fs.writeFileSync(promptFile, prompt, 'utf8');
    const r = await ctx.runner.run({
      runId: ctx.runId,
      spec: buildSpawnSpec({ type: 'ai', ai: { source: 'prompt' } }, {
        cwd, aiPrompt: prompt, aiBin: ctx.aiBin, opencodeDataDir: ctx.opencodeDataDir,
        promptFilePath: promptFile, jsonFormat: true,
      }),
      logPath,
      timeoutMs: Math.min(timeoutMs, ctx.remaining ? ctx.remaining() : timeoutMs),
    });
    return {
      ok: !r.spawnError && !r.timedOut && r.exitCode === 0,
      exitCode: r.exitCode ?? null,
      timedOut: !!r.timedOut,
      error: r.error || (r.timedOut ? 'timeout' : null),
    };
  };
}

export function createUsDev({
  dir, docsState = () => ({}), templateFile, logger = console,
  git = defaultGit, runOne = runOneUs, merge = mergeUsBranch, now = Date.now,
}) {
  const configStore = createUsConfigStore({ file: path.join(dir, 'config.json'), logger });
  const stateStore = createUsStateStore({ file: path.join(dir, 'us-state.json'), logger });

  function failAll(state, usList, error) {
    for (const us of usList) {
      state.items[us] = { ...(state.items[us] || {}), status: 'failed', error, lastRunAt: now() };
    }
    stateStore.write(state);
  }

  return async function run(ctx = {}) {
    const cfg = configStore.read();
    if (!cfg.autoDev) return { skipped: 'disabled', items: [], failed: 0 };

    const ds = docsState() || {};
    const solutionDir = ds.solution?.selected ? String(ds.solution.path || '').trim() : '';
    const codeDir = ds.code?.selected ? String(ds.code.path || '').trim() : '';
    if (!solutionDir || !isDir(solutionDir)) return { skipped: 'no-solution', items: [], failed: 0 };

    const solutionPull = (ctx.docResults || []).find((r) => samePath(r.dir, solutionDir));
    if (solutionPull && !solutionPull.ok) return { skipped: 'solution-pull-failed', items: [], failed: 0 };

    const current = listUsDirs(solutionDir);
    let state = stateStore.read();
    if (!state.solutionDir || state.solutionDir !== solutionDir) {
      stateStore.write(resetBaseline(solutionDir, current));
      return { skipped: 'baseline', items: [], failed: 0 };
    }

    markInterrupted(state);
    const pending = selectPending(state, current);
    if (!pending.length) {
      stateStore.write(state);
      return { items: [], failed: 0 };
    }

    if (!codeDir || !isDir(codeDir)) {
      failAll(state, pending, 'code-dir-missing');
      return { items: pending.map((us) => state.items[us]), failed: pending.length };
    }

    const user = await git.getGitUserName(codeDir);
    if (!user) {
      failAll(state, pending, 'missing-user-name');
      return { items: pending.map((us) => state.items[us]), failed: pending.length };
    }

    const template = fs.readFileSync(templateFile, 'utf8');
    const runAi = makeRunAi(ctx);
    const items = [];
    for (const us of pending) {
      state.items[us] = {
        ...state.items[us], status: 'running', attempts: (state.items[us].attempts || 0) + 1,
        lastJobId: ctx.runId || null,
      };
      stateStore.write(state);
      const item = await (async () => {
        try {
          return await runOne({
            us, solutionDir, codeDir, user,
            logDir: path.join(ctx.logDir, 'us', us),
            runId: ctx.runId, template, git, runAi, now,
            runner: ctx.runner, aiBin: ctx.aiBin, opencodeDataDir: ctx.opencodeDataDir,
          });
        } catch (e) {
          return { us, status: 'failed', error: String(e?.message || e), finishedAt: now() };
        }
      })();
      if (cfg.autoMerge && item.status === 'success' && item.commit) {
        try {
          const m = await merge({ codeDir, branch: item.branch, us, logger });
          item.merge = m;
          item.prUrl = m.url || null;
          item.mergeProvider = m.provider || null;
          if (!m.ok) {
            item.status = 'failed';
            item.error = m.error || 'merge-failed';
          } else {
            item.mergeStatus = 'merged';
            if (git.syncBranchToRemote) await git.syncBranchToRemote(codeDir, item.branch, m.base);
          }
        } catch (e) {
          item.status = 'failed';
          item.error = 'merge-failed';
          item.merge = { ok: false, error: 'merge-failed', message: String(e?.message || e) };
        }
      }
      state.items[us] = {
        ...state.items[us], ...item,
        lastJobId: ctx.runId || null, lastRunAt: now(),
      };
      stateStore.write(state);
      items.push(state.items[us]);
    }

    return {
      items,
      failed: items.filter((x) => x.status !== 'success').length,
    };
  };
}
