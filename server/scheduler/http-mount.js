import fs from 'node:fs';
import { listAiCommands } from './ai-commands.js';

const LOG_TAIL_MAX = 256 * 1024;

export function createSchedulerMount({ engine, store, logger = console }) {
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
  const withNext = (task) => ({ ...task, nextRunAt: engine.nextRunAtOf(task.id), runningRunId: engine.runIdOf(task.id) });

  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (p === '/api/scheduler/tasks' && req.method === 'GET') {
        return sendJson(res, 200, { tasks: store.listTasks().map(withNext), serverTime: Date.now() });
      }
      if (p === '/api/scheduler/tasks' && req.method === 'POST') {
        const r = store.createTask(await readBody(req));
        if (r.error) return sendJson(res, 400, { error: r.error });
        engine.reschedule(r.task);
        engine.notifyTasksChanged();
        return sendJson(res, 200, { task: withNext(r.task) });
      }
      const m = p.match(/^\/api\/scheduler\/tasks\/([^/]+)(?:\/(run|stop))?$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const action = m[2];
        if (action === 'run' && req.method === 'POST') {
          const r = engine.manualRun(id);
          if (r.error === 'not-found') return sendJson(res, 404, { error: 'not-found' });
          if (r.error) return sendJson(res, 409, { error: r.error });
          return sendJson(res, 200, { run: r.run });
        }
        if (action === 'stop' && req.method === 'POST') {
          return sendJson(res, 200, { ok: engine.stop(id) });
        }
        if (!action && req.method === 'PUT') {
          const r = store.updateTask(id, await readBody(req));
          if (r.error === 'not-found') return sendJson(res, 404, { error: 'not-found' });
          if (r.error) return sendJson(res, 400, { error: r.error });
          engine.reschedule(r.task);
          engine.notifyTasksChanged();
          return sendJson(res, 200, { task: withNext(r.task) });
        }
        if (!action && req.method === 'DELETE') {
          const r = store.deleteTask(id);
          if (r.error) return sendJson(res, 404, { error: 'not-found' });
          engine.notifyTasksChanged();
          return sendJson(res, 200, { ok: true });
        }
      }
      if (p === '/api/scheduler/runs' && req.method === 'GET') {
        const taskId = url.searchParams.get('taskId');
        const limit = Number(url.searchParams.get('limit')) || 50;
        return sendJson(res, 200, { runs: store.listRuns({ taskId, limit }) });
      }
      const rm = p.match(/^\/api\/scheduler\/runs\/([^/]+)\/log$/);
      if (rm && req.method === 'GET') {
        const run = store.getRun(decodeURIComponent(rm[1]));
        if (!run) return sendJson(res, 404, { error: 'not-found' });
        let text = '';
        try { text = fs.readFileSync(store.logPath(run.logFile), 'utf8'); } catch { text = ''; }
        if (text.length > LOG_TAIL_MAX) text = text.slice(text.length - LOG_TAIL_MAX);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(text);
      }
      if (p === '/api/scheduler/ai-commands' && req.method === 'GET') {
        return sendJson(res, 200, { commands: listAiCommands() });
      }
      return sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      logger.error('scheduler http', err);
      return sendJson(res, 500, { error: 'internal', message: String(err && err.message || err) });
    }
  };
}
