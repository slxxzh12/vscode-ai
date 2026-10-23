import { assignPartitions } from './partition.js';
import { SCHED_HEARTBEAT_MS, SCHED_WORKER_OFFLINE_MS } from '@devflow/shared/scheduler';

export function createWorkerRegistry({
  repo, topic, count = 16, now = () => Date.now(),
  heartbeatMs = SCHED_HEARTBEAT_MS, offlineMs = SCHED_WORKER_OFFLINE_MS, logger = console,
}) {
  let timer = null;
  let running = false;

  async function tick({ self, onPartitions = () => {}, onOffline = () => {}, count: nextCount = count } = {}) {
    if (!self) return;
    const at = now();
    const before = await repo.listWorkers(topic);
    const stale = before.filter((w) => w.id !== self.id && w.status === 1 && w.lastUpdateTime < at - offlineMs);
    await repo.markStaleWorkers(topic, at - offlineMs);
    for (const w of stale) await onOffline(w.hostport);
    await repo.upsertWorker({
      id: self.id, hostport: self.hostport, status: 1, lastUpdateTime: at,
      partitionIds: null, role: self.role, version: self.version || null, topic,
    });
    const workers = await repo.listWorkers(topic);
    const online = workers.filter((w) => w.status === 1).map((w) => w.id);
    const map = assignPartitions(online, nextCount);
    for (const id of online) {
      await repo.setWorkerPartitions(id, JSON.stringify(map.get(id) || []), at);
    }
    const mine = map.get(self.id) || [];
    onPartitions(mine);
  }

  function start({ self, onPartitions, onOffline, count: nextCount = count }) {
    if (timer) return;
    const run = () => {
      if (running) return;
      running = true;
      tick({ self, onPartitions, onOffline, count: nextCount })
        .catch((e) => logger?.error?.('scheduler worker tick failed', e))
        .finally(() => { running = false; });
    };
    run();
    timer = setInterval(run, heartbeatMs);
    timer.unref?.();
  }

  async function list() {
    const at = now();
    const workers = await repo.listWorkers(topic);
    return workers.map((w) => ({ ...w, online: w.status === 1 && w.lastUpdateTime >= at - offlineMs }));
  }

  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  return { start, stop, tick, list };
}
