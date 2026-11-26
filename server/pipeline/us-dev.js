import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildSpawnSpec } from '../scheduler/runner.js';
import { hashPartition } from '../scheduler/queue/partition.js';
import { SchedulerJobStatus as S } from '@devflow/shared/scheduler';
import { t } from '../i18n.js';
import { createUsConfigStore } from './us-config.js';
import { listUsDirs } from './us-detect.js';
import { readEffectiveTemplate } from './us-prompt.js';
import {
  createUsStateStore, resetBaseline, selectPending, markInterrupted,
} from './us-state.js';
import { runOneUs } from './us-runner.js';
import { mergeUsBranch } from './us-merge.js';
import * as defaultGit from './us-git.js';
import { docRevOf as defaultDocRevOf, docAuthorOf as defaultDocAuthorOf } from './us-doc-git.js';
import {
  docHeadOf as defaultDocHeadOf, readMonitorState as defaultReadMonitor,
  writeMonitorState as defaultWriteMonitor, changedUsSince as defaultChangedUsSince,
} from './us-monitor-state.js';

// 代码生成改为「在定时任务列表里新增一条 AI 任务并运行」：
// - auto_docs_update 仍负责定时 git pull 与新增 US 探测；
// - 每个 US 对应一条固定 id 的 AI 任务（幂等复用），执行完保留一段时间供查看；
// - 这里同步等待该 AI 作业结束，再回到原有 test/build/commit/push/merge 流程。
const AI_TASK_SCHEDULE = { mode: 'interval', interval: { every: 365, unit: 'day' } };
const AI_TASK_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const AI_TASK_POLL_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => { const timer = setTimeout(resolve, ms); timer.unref?.(); });
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function samePath(a, b) {
  const norm = (p) => path.resolve(String(p || '')).replace(/\\/g, '/').toLowerCase();
  return norm(a) === norm(b);
}

function aiTaskBaseId(us) {
  return 'pipeline_' + crypto.createHash('sha1').update(String(us)).digest('hex').slice(0, 12);
}

// 选一个不会和 auto_docs_update 落在同一分区的任务 id，避免同分区循环被阻塞导致相互等待。
async function resolveAiTaskId(scheduler, us) {
  const store = scheduler.store;
  const queue = scheduler.queue;
  const count = await queue.partitionCount();
  const topic = queue.topic;
  const avoid = hashPartition(topic, 'auto_docs_update', count);
  const ids = Array.from({ length: count }, (_, i) => {
    const base = aiTaskBaseId(us);
    return i === 0 ? base : `${base}_${i}`;
  });
  const reusable = ids.find((id) => store.getTask(id) && hashPartition(topic, id, count) !== avoid);
  if (reusable) return reusable;
  return ids.find((id) => !store.getTask(id) && hashPartition(topic, id, count) !== avoid) || ids[0];
}

function copyTaskLog(scheduler, taskId, jobId, logPath) {
  try {
    const src = scheduler.store.logPath(scheduler.store.logFileFor(taskId, jobId));
    if (src && fs.existsSync(src) && logPath) fs.copyFileSync(src, logPath);
  } catch { /* best-effort */ }
}

export async function runAiViaTask({ scheduler, machineId, us, cwd, prompt, timeoutMs, logPath, resumeSessionId }) {
  if (!scheduler?.store || !scheduler?.queue) return { ok: false, error: 'missing-scheduler' };
  const id = await resolveAiTaskId(scheduler, us);
  const label = String(us).split(/[\\/]/).pop() || String(us);
  const input = {
    name: t('sched.pipeline.codegen_name', { us: label }),
    enabled: true,
    once: true,
    deleteAfter: Date.now() + AI_TASK_KEEP_MS,
    type: 'ai',
    // 只把代码仓作为「运行目录」，cwd 保持空：避免把 void_manifest.json 写进代码仓、也避免同目录任务冲突。
    runCwd: cwd,
    ai: { source: 'prompt', prompt, ...(resumeSessionId ? { sessionId: String(resumeSessionId) } : {}) },
    schedule: AI_TASK_SCHEDULE,
    onlyLocal: true,
    maxRunMilliSecond: timeoutMs,
  };
  const saved = scheduler.store.getTask(id)
    ? scheduler.store.updateTask(id, input)
    : scheduler.store.ensureTask(id, input);
  if (!saved || saved.error) return { ok: false, error: `ai-task-${saved?.error || 'failed'}` };
  // 已有排队/运行中的同名作业时复用，避免重复入队。
  let jobId = '';
  try {
    if (typeof scheduler.queue.listJobs === 'function') {
      const active = await scheduler.queue.listJobs({ taskIds: [saved.task.id], status: [0, 3, 4], limit: 1 });
      if (Array.isArray(active) && active.length) jobId = active[0].jobId;
    }
  } catch { jobId = ''; }
  if (!jobId) {
    const enq = await scheduler.queue.enqueueTask(saved.task, { trigger: 'pipeline', createMachineId: machineId || null });
    if (!enq || enq.error || !enq.job) return { ok: false, error: `ai-enqueue-${enq?.error || 'failed'}` };
    jobId = enq.job.jobId;
  }
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 0);
  while (Date.now() < deadline) {
    await sleep(AI_TASK_POLL_MS);
    const job = await scheduler.queue.getJob(jobId).catch(() => null);
    if (!job) continue;
    if (job.status === S.SUCCESS) { copyTaskLog(scheduler, saved.task.id, jobId, logPath); return { ok: true, jobId, taskId: saved.task.id }; }
    if (job.status === S.FAILED) { copyTaskLog(scheduler, saved.task.id, jobId, logPath); return { ok: false, jobId, taskId: saved.task.id, error: 'ai-failed' }; }
  }
  copyTaskLog(scheduler, saved.task.id, jobId, logPath);
  return { ok: false, jobId, taskId: saved.task.id, error: 'timeout' };
}

function makeRunAi(ctx) {
  return async ({ us, cwd, prompt, logPath, timeoutMs }) => {
    const budget = Math.min(timeoutMs, ctx.remaining ? ctx.remaining() : timeoutMs);
    if (ctx.scheduler?.store && ctx.scheduler?.queue) {
      return runAiViaTask({
        scheduler: ctx.scheduler, machineId: ctx.machineId,
        us, cwd, prompt, timeoutMs: budget, logPath,
        resumeSessionId: ctx.findSessionByUs ? ctx.findSessionByUs(us, cwd) : '',
      });
    }
    // 没有调度器（单测/独立调用）时回退为直接运行，避免功能不可用。
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
      timeoutMs: budget,
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
  docRevOf = defaultDocRevOf, docAuthorOf = defaultDocAuthorOf,
  docHeadOf = defaultDocHeadOf, readMonitor = defaultReadMonitor,
  writeMonitor = defaultWriteMonitor, changedUsSince = defaultChangedUsSince,
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

    const finish = async (result) => {
      try {
        const head = await docHeadOf(solutionDir);
        if (head) await writeMonitor(solutionDir, { commit: head });
      } catch { /* best-effort */ }
      return result;
    };

    const solutionPull = (ctx.docResults || []).find((r) => samePath(r.dir, solutionDir));
    if (solutionPull && !solutionPull.ok) return finish({ skipped: 'solution-pull-failed', items: [], failed: 0 });

    const current = listUsDirs(solutionDir);
    let state = stateStore.read();
    if (!state.solutionDir || state.solutionDir !== solutionDir) {
      stateStore.write(resetBaseline(solutionDir, current));
      return finish({ skipped: 'baseline', items: [], failed: 0 });
    }

    // 以方案目录里的 .devflow-monitor.json 记录的提交为基准：处理之后变更的方案，
    // 按提交先后顺序（旧→新）执行；取不到 git 信息时回退到目录/修订扫描。
    let revs = {};
    let pending = null;
    const head = await docHeadOf(solutionDir);
    if (head) {
      const mon = readMonitor(solutionDir);
      const base = String(mon?.lastCommit || '').trim();
      if (!base) {
        // 首次接管：当前 HEAD 作为基线，已有方案不补跑（finish 会写入时间戳与 HEAD）
        stateStore.write(state);
        return finish({ skipped: 'baseline', items: [], failed: 0 });
      }
      let changed = null;
      try { changed = await changedUsSince(solutionDir, base); } catch { changed = null; }
      if (changed) {
        markInterrupted(state);
        const seen = new Set();
        const ordered = [];
        for (const us of changed) {
          if (seen.has(us)) continue;
          seen.add(us);
          ordered.push(us);
        }
        // 手动重试的 pending 排在变更方案之后
        for (const [us, it] of Object.entries(state.items || {})) {
          if (it.status === 'pending' && !seen.has(us)) { seen.add(us); ordered.push(us); }
        }
        for (const us of ordered) state.items[us] = { ...(state.items[us] || {}), status: 'pending', error: null };
        pending = ordered;
      }
    }
    if (!pending) {
      const revsMap = {};
      for (const us of current) revsMap[us] = await docRevOf(solutionDir, us);
      revs = revsMap;
      markInterrupted(state);
      pending = selectPending(state, current, revsMap);
    }
    if (!pending.length) {
      stateStore.write(state);
      return finish({ items: [], failed: 0 });
    }

    if (!codeDir || !isDir(codeDir)) {
      failAll(state, pending, 'code-dir-missing');
      return finish({ items: pending.map((us) => state.items[us]), failed: pending.length });
    }

    // 本地 git 用户名只作为「文档提交人信息缺失」时的兜底。
    const localUser = await git.getGitUserName(codeDir);

    const template = readEffectiveTemplate({ dir, templateFile }).template;
    const runAi = makeRunAi(ctx);
    const items = [];
    for (const us of pending) {
      const rev = Object.prototype.hasOwnProperty.call(revs, us) ? (revs[us] || '') : '';
      if (rev) state.revs[us] = rev;
      const author = await docAuthorOf(solutionDir, us);
      const branchUser = (ctx.resolveBranchUser ? ctx.resolveBranchUser(author.name, author.email) : '')
        || author.name || localUser;
      if (!branchUser) {
        failAll(state, [us], 'missing-user-name');
        items.push(state.items[us]);
        continue;
      }
      state.items[us] = {
        ...state.items[us], status: 'running', attempts: (state.items[us].attempts || 0) + 1,
        lastJobId: ctx.runId || null, docRev: rev || null, docAuthor: author.name || null,
      };
      stateStore.write(state);
      const item = await (async () => {
        try {
          return await runOne({
            us, solutionDir, codeDir, user: branchUser,
            logDir: path.join(ctx.logDir, 'us', us),
            runId: ctx.runId, template, baseBranch: cfg.baseBranch, git, runAi, now,
            runner: ctx.runner, aiBin: ctx.aiBin, opencodeDataDir: ctx.opencodeDataDir,
          });
        } catch (e) {
          return { us, status: 'failed', error: String(e?.message || e), finishedAt: now() };
        }
      })();
      // 自测通过且有提交：分支已在 runOne 里推送；这里单独发起 PR/MR 到目标分支。
      // 默认只发起 PR（需人工审核后在远端合入）；仅当开启 autoMerge 才自动合并。
      if (item.status === 'success' && item.commit) {
        try {
          const m = await merge({ codeDir, branch: item.branch, us, base: cfg.baseBranch, logger, autoMerge: cfg.autoMerge });
          item.prUrl = m.url || null;
          item.mergeProvider = m.provider || null;
          if (cfg.autoMerge) {
            item.merge = m;
            if (!m.ok) {
              item.status = 'failed';
              item.error = m.error || 'merge-failed';
            } else {
              item.mergeStatus = 'merged';
              if (git.syncBranchToRemote) await git.syncBranchToRemote(codeDir, item.branch, m.base);
            }
          } else if (!m.ok) {
            // 发起 PR 失败不改变“编码成功”，仅记录原因供人工处理
            item.error = m.error || 'pr-failed';
          } else {
            item.mergeStatus = 'opened';   // 已发起 PR，待人工审核合入
          }
        } catch (e) {
          if (cfg.autoMerge) {
            item.status = 'failed';
            item.error = 'merge-failed';
            item.merge = { ok: false, error: 'merge-failed', message: String(e?.message || e) };
          } else {
            item.error = 'pr-failed';
          }
        }
      }
      state.items[us] = {
        ...state.items[us], ...item,
        lastJobId: ctx.runId || null, lastRunAt: now(),
      };
      stateStore.write(state);
      items.push(state.items[us]);
    }

    return finish({
      items,
      failed: items.filter((x) => x.status !== 'success').length,
    });
  };
}
