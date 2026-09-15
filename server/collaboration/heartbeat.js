import { collectAgentStats } from './agent-stats.js';

export function createHeartbeat({ engine, cmd = 'opencode', days = 7, intervalMinMs = 60 * 60 * 1000, intervalMaxMs = 65 * 60 * 1000, collect = collectAgentStats, logger = console }) {
  let timer = null;
  let stopped = false;
  const nextDelay = () => intervalMinMs + Math.floor(Math.random() * Math.max(1, intervalMaxMs - intervalMinMs));
  async function collectOnce() {
    let usage;
    try { usage = await collect({ cmd, days }); }
    catch (e) { usage = { agent: cmd, days, error: String((e && e.message) || e) }; }
    try { await engine.reportHeartbeat(usage); }
    catch (e) { logger?.warn?.('heartbeat report failed', (e && e.message) || e); }
    return usage;
  }
  function schedule() {
    if (stopped) return;
    timer = setTimeout(async () => { await collectOnce(); schedule(); }, nextDelay());
    if (timer.unref) timer.unref();
  }
  return {
    start() { if (stopped) stopped = false; collectOnce().then(schedule); },
    stop() { stopped = true; if (timer) { clearTimeout(timer); timer = null; } },
    collectOnce,
  };
}
