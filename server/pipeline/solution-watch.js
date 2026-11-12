import fs from 'node:fs';
import { listUsDirs } from './us-detect.js';
import { resetBaseline, selectPending } from './us-state.js';

export const WATCH_INTERVAL_MS = 15 * 1000;

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// 15 秒扫描一次方案目录；发现新方案（相对基线）后触发自动编码任务。
export function createSolutionWatch({
  configStore, stateStore, docsState = () => ({}), scheduler,
  logger = console, intervalMs = WATCH_INTERVAL_MS, now = Date.now,
} = {}) {
  let timer = null;
  let scanning = false;
  const status = {
    running: false, scanning: false, intervalMs,
    lastScanAt: 0, lastTriggerAt: 0, pending: 0, solutionDir: '', error: null,
  };

  function solutionDirOf() {
    const ds = docsState() || {};
    return ds.solution?.selected ? String(ds.solution.path || '').trim() : '';
  }

  async function hasActiveJob() {
    try {
      const rows = await scheduler?.queue?.listJobs?.({
        taskIds: ['auto_docs_update'], status: [0, 3, 4], limit: 1,
      });
      return Array.isArray(rows) && rows.length > 0;
    } catch {
      return false;
    }
  }

  async function scan() {
    if (scanning) return { ...status };
    scanning = true;
    status.scanning = true;
    try {
      const cfg = configStore?.read?.() || {};
      if (!cfg.watch || !cfg.autoDev) {
        status.pending = 0;
        return { ...status };
      }
      const dir = solutionDirOf();
      status.solutionDir = dir;
      status.lastScanAt = now();
      if (!dir || !isDir(dir)) {
        status.pending = 0;
        status.error = 'no-solution';
        return { ...status };
      }
      let state = stateStore.read();
      const current = listUsDirs(dir);
      if (!state.solutionDir || state.solutionDir !== dir) {
        stateStore.write(resetBaseline(dir, current));
        status.pending = 0;
        status.error = null;
        return { ...status };
      }
      const pending = selectPending(state, current);
      stateStore.write(state);
      status.pending = pending.length;
      status.error = null;
      if (pending.length && !(await hasActiveJob())) {
        await scheduler?.engine?.manualRun?.('auto_docs_update');
        status.lastTriggerAt = now();
        logger?.info?.(`solution-watch: ${pending.length} new solution(s) -> auto coding`);
      }
      return { ...status };
    } catch (e) {
      status.error = String((e && e.message) || e);
      logger?.warn?.('solution-watch scan failed', status.error);
      return { ...status };
    } finally {
      scanning = false;
      status.scanning = false;
    }
  }

  function start() {
    if (timer) return { ...status };
    status.running = true;
    status.error = null;
    void scan();
    timer = setInterval(() => { void scan(); }, intervalMs);
    timer.unref?.();
    return { ...status };
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    status.running = false;
    status.pending = 0;
    return { ...status };
  }

  // 按配置同步运行状态：autoDev + watch 都开启时监控，否则停止。
  function sync() {
    const cfg = configStore?.read?.() || {};
    if (cfg.watch && cfg.autoDev) return start();
    return stop();
  }

  return { start, stop, sync, scan, status: () => ({ ...status, intervalMs }) };
}
