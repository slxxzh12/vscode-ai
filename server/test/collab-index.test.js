import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CollabEngine } from '../collaboration/engine.js';
import { CollabStore } from '../collaboration/store.js';
import { loadIdentity } from '../collaboration/identity.js';
import { createEventBus } from '../collaboration/event-bus.js';
import { createCollabMount } from '../collaboration/http-mount.js';
import { makePeerClient } from '../collaboration/peer-client.js';
import { CollabS2C } from '@devflow/shared/collab';

test('事件总线按原始 engine 事件转发（index 层再映射到 CollabS2C）', async () => {
  const bus = createEventBus();
  const seen = [];
  // index.js 的接线：监听原始事件，转发为 CollabS2C 消息
  bus.on('synced', () => seen.push([CollabS2C.COLLAB_SYNCED]));
  bus.on('inbox', (payload) => seen.push([CollabS2C.COLLAB_INBOX, payload.inboxId]));
  bus.emit('synced', {});
  bus.emit('inbox', { inboxId: 'i1' });
  assert.deepEqual(seen, [[CollabS2C.COLLAB_SYNCED], [CollabS2C.COLLAB_INBOX, 'i1']]);
});

test('事件总线按原始事件名转发，index 层映射到 chat / cmd-pending 推送', async () => {
  const bus = createEventBus();
  const seen = [];
  // 镜像 index.js 的接线：监听原始事件，转发为 CollabS2C 推送
  bus.on('chat', (payload) => seen.push([CollabS2C.COLLAB_CHAT, payload.groupId]));
  bus.on('cmd-pending', (payload) => seen.push([CollabS2C.COLLAB_CMD_PENDING, payload.reqId]));
  bus.emit('chat', { groupId: 'g1', msg: null });
  bus.emit('cmd-pending', { reqId: 'r1' });
  assert.deepEqual(seen, [[CollabS2C.COLLAB_CHAT, 'g1'], [CollabS2C.COLLAB_CMD_PENDING, 'r1']]);
});

test('mount GET /api/collab/snapshot 返回身份', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-idx-'));
  const store = new CollabStore({ file: path.join(dir, 'c.json') });
  const identity = loadIdentity({ file: path.join(dir, 'i.json'), username: 'u', host: '127.0.0.1', port: 3001 });
  const engine = new CollabEngine({ store, identity, skillsRoot: path.join(dir, 's'), inboxDir: path.join(dir, 'in') });
  engine.peer = makePeerClient();
  const mount = createCollabMount({ engine });
  const server = http.createServer((req, res) => mount(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/collab/snapshot`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.identity.username, 'u');
    assert.equal(body.group, null);
    assert.deepEqual(body.groups, []);
  } finally { server.close(); }
});
