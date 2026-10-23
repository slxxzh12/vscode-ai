import path from 'node:path';
import { createQueueConfig } from './config.js';
import { createSqliteDriver } from './driver-sqlite.js';
import { createMysqlDriver } from './driver-mysql.js';
import { createRepository } from './repository.js';
import { createQueueService } from './service.js';

export function createQueue({ dir, dbFile = null, logger = console, now = () => Date.now() }) {
  const config = createQueueConfig({ dir, logger });
  let service = null;
  let driver = null;

  async function init() {
    if (service) return service;
    const c = config.get();
    if (c.backend === 'mysql') {
      driver = await createMysqlDriver({
        host: c.mysql.host, port: c.mysql.port, user: c.mysql.user,
        password: config.openPassword(), database: c.mysql.database, logger,
      });
    } else {
      driver = await createSqliteDriver({ file: dbFile || path.join(dir, '..', 'void.db') });
    }
    const repo = createRepository(driver);
    service = createQueueService({ repo, now, logger });
    return service;
  }

  const proxy = {
    ready: init,
    config,
    topic: 'scheduler.jobs',
    get driver() { return driver; },
    get repo() { return service?.repo || null; },
  };
  for (const name of ['partitionCount', 'enqueueTask', 'approve', 'reject', 'cancel', 'claim', 'complete', 'retry',
    'cleanupFinished', 'deleteTaskJobs', 'failRunningByWorker', 'recoverRunning', 'setPartitionCount', 'rehash',
    'getJob', 'listJobs', 'summary', 'partitionStats', 'parseParam']) {
    proxy[name] = async (...args) => (await init())[name](...args);
  }
  proxy.close = async () => { if (driver) await driver.close(); service = null; driver = null; };
  return proxy;
}
