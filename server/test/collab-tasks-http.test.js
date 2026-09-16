import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCollabMount } from '../collaboration/http-mount.js';
import { createTaskStore } from '../task-store.js';

function tmpFile(name) { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-tasks-http-')), name); }

function fakeEngine() {
  const file = tmpFile('void.db');
  const taskStore = createTaskStore({ file, logger: { warn() {} } });
  taskStore.upsert({ id: 't1', groupId: 'g1', hubId: 'h', kind: 'skills', hash: 'h1', name: 'skills/a.zip', url: 'u', payload: {}, status: 'pending', messageId: 'm', createdAt: 1, updatedAt: 1 });
  const calls = [];
  const engine = {
    taskStore,
    store: { listInbox: () => [] },
    listTasks: (f) => taskStore.list(f),
    acceptTask: async (id) => { calls.push(['accept', id]); return { code: 'ok' }; },
    ignoreTask: (id) => { calls.push(['ignore', id]); return { code: 'ignored' }; },
  };
  return { engine, calls };
}

function res() {
  const out = { status: 0, body: '' };
  return {
    out,
    writeHead(s) { out.status = s; },
    end(b) { out.body = b || ''; },
  };
}

// http-mount 对 POST 会先 await readBody(req) → 假 req 必须支持 on('data'/'end'/'error')
// 且 mount 内部用 req.url 自己解析路径（不吃第三个参数）
function req(method, url) {
  return {
    method,
    url,
    headers: {},
    on(ev, cb) { if (ev === 'end') setImmediate(() => cb()); },
  };
}

async function call(mount, method, url) {
  const r = res();
  // mount 不返回内部 route 的 promise（POST 会先 await readBody），等一拍再读响应
  mount(req(method, url), r);
  await new Promise((done) => setTimeout(done, 5));
  return { status: r.out.status, json: r.out.body ? JSON.parse(r.out.body) : null };
}

test('GET /api/collab/tasks 列表 + 状态过滤', async () => {
  const { engine } = fakeEngine();
  const mount = createCollabMount({ engine, logger: { warn() {}, error() {} } });
  const all = await call(mount, 'GET', '/api/collab/tasks');
  assert.equal(all.status, 200);
  assert.equal(all.json.tasks.length, 1);
  assert.equal(all.json.tasks[0].kind, 'skills');
  const none = await call(mount, 'GET', '/api/collab/tasks?status=done');
  assert.equal(none.json.tasks.length, 0);
});

test('POST accept / ignore 路由到 engine', async () => {
  const { engine, calls } = fakeEngine();
  const mount = createCollabMount({ engine, logger: { warn() {}, error() {} } });
  assert.equal((await call(mount, 'POST', '/api/collab/tasks/t1/accept')).json.code, 'ok');
  assert.equal((await call(mount, 'POST', '/api/collab/tasks/t1/ignore')).json.code, 'ignored');
  assert.deepEqual(calls, [['accept', 't1'], ['ignore', 't1']]);
});
