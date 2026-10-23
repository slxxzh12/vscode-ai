import test from 'node:test';
import assert from 'node:assert/strict';
import { createPairHarness } from '../collaboration/engine.js';

test('QUEUE_CONFIG：成员从 master 拉取队列配置', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    A.setQueueConfigProvider(() => ({ host: 'db', port: 3306, user: 'u', password: 'p', database: 'devflow' }));
    const cfg = await B.pullQueueConfig();
    assert.equal(cfg.host, 'db');
    assert.equal(cfg.password, 'p');
  } finally {
    await h.stop();
  }
});
