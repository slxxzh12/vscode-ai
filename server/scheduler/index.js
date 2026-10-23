import { SchedulerStore } from './store.js';
import { createEngine } from './engine.js';
import { createRunner } from './runner.js';
import { createSchedulerMount } from './http-mount.js';
import { createJobsMount } from './jobs-mount.js';
import { readAiCommand } from './ai-commands.js';
import { createQueue } from './queue/index.js';
import { createWorkerRegistry } from './queue/workers.js';
import { createConsumer } from './queue/consumer.js';

export function createScheduler({
  dir, projectResolver = () => null, logger = console, runner = null, agentCmd = 'opencode',
  opencodeDataDir = null, manifestRoot = null,
  machineId = 'local', hostport = '127.0.0.1:22222', publicBaseUrl = null, role = 'master', version = '',
  dbFile = null, pullQueueConfig = null, onJobEvent = () => {},
}) {
  const store = new SchedulerStore({ dir, logger, ...(manifestRoot ? { manifestRoot } : {}) });
  const queue = createQueue({ dir, dbFile, logger });
  let registry = null;
  let consumer = null;
  let started = false;
  let cleanupTimer = null;
  const ONCE_TTL_MS = 15 * 24 * 60 * 60 * 1000;

  const engine = createEngine({ store, queue, logger, onStop: (id) => consumer?.stopTask(id) });

  async function cleanupExpiredOnce() {
    const at = Date.now();
    let changed = false;
    for (const task of store.listTasks()) {
      if (!task.once || !task.deleteAfter || task.deleteAfter > at) continue;
      try {
        await queue.deleteTaskJobs(task.id);
        store.deleteTask(task.id);
        changed = true;
      } catch (e) {
        logger?.warn?.('cleanup once task failed', (e && e.message) || e);
      }
    }
    if (changed) {
      engine.refreshAll();
      engine.notifyTasksChanged();
    }
  }

  function applyQueueConfig(c) {
    if (!c) return;
    const cur = queue.config.get();
    const same = cur.backend === 'mysql'
      && cur.mysql.host === c.host && cur.mysql.port === Number(c.port) && cur.mysql.user === c.user
      && cur.mysql.database === c.database && queue.config.openPassword() === c.password;
    if (!same) queue.config.save(c);
  }

  async function start({ startWorkers = true } = {}) {
    if (started) return;
    if (role !== 'master' && pullQueueConfig) {
      const c = await pullQueueConfig().catch(() => null);
      applyQueueConfig(c);
    }
    await queue.ready();
    await cleanupExpiredOnce();
    if (!cleanupTimer) {
      cleanupTimer = setInterval(() => { void cleanupExpiredOnce(); }, 6 * 60 * 60 * 1000);
      cleanupTimer.unref?.();
    }
    for (const id of store.removedTaskIds) await queue.purgeTaskJobs(id);
    store.removedTaskIds = [];
    if (startWorkers) {
      await queue.rehash();
      await queue.recoverRunning(hostport);
      registry = createWorkerRegistry({ repo: queue.repo, topic: queue.topic, count: await queue.partitionCount(), logger });
      consumer = createConsumer({
        queue, store, runner: runner || createRunner(),
        aiPromptLoader: (name) => readAiCommand(name), worker: { id: `${machineId}:${queue.topic}`, hostport, machineId },
        aiBin: agentCmd, opencodeDataDir, projectResolver, publicBaseUrl, logger,
        onEvent: (evt, payload) => onJobEvent(evt, payload),
      });
      registry.start({
        self: { id: `${machineId}:${queue.topic}`, hostport, role, version },
        onPartitions: (ids) => consumer.setPartitions(ids),
        onOffline: (deadHostport) => queue.failRunningByWorker(deadHostport),
        count: await queue.partitionCount(),
      });
    }
    engine.start();
    started = true;
  }
  async function stop() {
    if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
    consumer?.stop(); registry?.stop(); engine.stopAll(); await queue.close(); started = false;
  }
  async function syncQueueConfig() {
    if (!pullQueueConfig) return null;
    const c = await pullQueueConfig().catch(() => null);
    applyQueueConfig(c);
    return c;
  }

  const mount = createSchedulerMount({ engine, store, queue, logger });
  const jobsMount = createJobsMount({
    queue, store, registry: () => registry, role, hostport, machineId, logger,
    stopJob: (jobId) => consumer?.stopJob(jobId),
    onCallback: (jobId, token, body) => (consumer ? consumer.handleCallback(jobId, token, body) : Promise.resolve({ error: 'not-running' })),
  });
  return {
    store, engine, queue, mount, jobsMount, start, stop, syncQueueConfig,
    getRole: () => role,
    get registry() { return registry; }, get consumer() { return consumer; },
  };
}

export { SchedulerStore } from './store.js';
export { createEngine } from './engine.js';
export { createRunner } from './runner.js';
export { computeNextRun } from './schedule.js';
