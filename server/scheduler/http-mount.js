import fs from 'node:fs';
import { listAiCommands } from './ai-commands.js';
import { pickFile, pickFolder as defaultPickFolder } from '../native-dialog.js';

export function createSchedulerMount({ engine, store, queue, logger = console, pickFolder = defaultPickFolder }) {
  const sendJson = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  const readBody = (req, limit = 1024 * 1024) => new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
  const withNext = async (task) => ({
    ...task,
    nextRunAt: engine.nextRunAtOf(task.id),
    recentJobs: await queue.listJobs({ taskIds: [task.id], limit: 10 }),
  });

  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (p === '/api/scheduler/tasks' && req.method === 'GET') {
        return sendJson(res, 200, { tasks: await Promise.all(store.listTasks().map(withNext)), serverTime: Date.now() });
      }
      if (p === '/api/scheduler/tasks' && req.method === 'POST') {
        const r = store.createTask(await readBody(req));
        if (r.error) return sendJson(res, 400, { error: r.error });
        engine.reschedule(r.task);
        engine.notifyTasksChanged();
        return sendJson(res, 200, { task: await withNext(r.task) });
      }
      const m = p.match(/^\/api\/scheduler\/tasks\/([^/]+)(?:\/(run|stop))?$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const action = m[2];
        if (action === 'run' && req.method === 'POST') {
          const r = await engine.manualRun(id);
          if (r.error === 'not-found') return sendJson(res, 404, { error: 'not-found' });
          if (r.error) return sendJson(res, 409, { error: r.error });
          return sendJson(res, 200, { job: r.job });
        }
        if (action === 'stop' && req.method === 'POST') {
          return sendJson(res, 200, { ok: await engine.stop(id) });
        }
        if (!action && req.method === 'PUT') {
          const r = store.updateTask(id, await readBody(req));
          if (r.error === 'not-found') return sendJson(res, 404, { error: 'not-found' });
          if (r.error) return sendJson(res, 400, { error: r.error });
          engine.reschedule(r.task);
          store.syncManifest(r.task.id);
          engine.notifyTasksChanged();
          return sendJson(res, 200, { task: await withNext(r.task) });
        }
        if (!action && req.method === 'DELETE') {
          if (!store.getTask(id)) return sendJson(res, 404, { error: 'not-found' });
          await engine.stop(id);
          await queue.deleteTaskJobs(id);
          const r = store.deleteTask(id);
          if (r.error) return sendJson(res, 404, { error: 'not-found' });
          engine.notifyTasksChanged();
          return sendJson(res, 200, { ok: true });
        }
      }
      if (p === '/api/scheduler/summary' && req.method === 'GET') {
        return sendJson(res, 200, await queue.summary());
      }
      if (p === '/api/scheduler/ai-commands' && req.method === 'GET') {
        return sendJson(res, 200, { commands: listAiCommands() });
      }
      if (p === '/api/scheduler/pick-file' && req.method === 'POST') {
        logger?.info?.('pick-file: dialog opened');
        const r = await pickFile();
        logger?.info?.('pick-file:', r.error || (r.path ? 'ok' : 'cancelled'));
        if (r.error) return sendJson(res, 200, { error: r.error, message: r.message || null });
        if (r.cancelled || !r.path) return sendJson(res, 200, { cancelled: true });
        let content = null;
        try { if (/\.md$/i.test(r.path)) content = fs.readFileSync(r.path, 'utf8').slice(0, 65536); } catch { /* ignore */ }
        return sendJson(res, 200, { path: r.path, content });
      }
      if (p === '/api/scheduler/pick-folder' && req.method === 'POST') {
        const r = await pickFolder();
        if (r.error) return sendJson(res, 200, { error: r.error, message: r.message || null });
        if (r.cancelled || !r.path) return sendJson(res, 200, { cancelled: true });
        return sendJson(res, 200, { path: r.path });
      }
      if (p === '/api/scheduler/import' && req.method === 'POST') {
        const body = await readBody(req);
        const dir = body && typeof body.dir === 'string' ? body.dir.trim() : '';
        if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
          return sendJson(res, 400, { error: 'bad-dir' });
        }
        const summary = store.importManifestDir(dir);
        engine.refreshAll();
        for (const t of store.listTasks()) store.syncManifest(t.id);
        engine.notifyTasksChanged();
        return sendJson(res, 200, summary);
      }
      return sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      logger.error('scheduler http', err);
      return sendJson(res, 500, { error: 'internal', message: String(err && err.message || err) });
    }
  };
}
