import fs from 'node:fs';
import { listAiCommands } from './ai-commands.js';
import { pickFile, pickFolder as defaultPickFolder } from '../native-dialog.js';

export function createSchedulerMount({ engine, store, queue, logger = console, pickFolder = defaultPickFolder, operatorOf = () => ({}) }) {
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
    promptHash: store.promptHashOf ? store.promptHashOf(task) : '',
    nextRunAt: engine.nextRunAtOf(task.id),
    recentJobs: await queue.listJobs({ taskIds: [task.id], limit: 10 }),
  });
  const savePrompt = async (task, meta) => {
    if (!task || task.type !== 'ai' || task.ai?.source !== 'prompt') return;
    const prompt = store.promptTextOf ? store.promptTextOf(task) : String(task.ai.prompt || '');
    try { await queue.recordPrompt(task.id, prompt, meta); } catch { /* 提示词历史写入失败不阻断任务保存 */ }
  };

  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (p === '/api/scheduler/tasks' && req.method === 'GET') {
        return sendJson(res, 200, { tasks: await Promise.all(store.listTasks().map(withNext)), serverTime: Date.now() });
      }
      if (p === '/api/scheduler/tasks' && req.method === 'POST') {
        const meta = operatorOf(req);
        const r = store.createTask(await readBody(req), meta);
        if (r.error) return sendJson(res, 400, { error: r.error });
        await savePrompt(r.task, meta);
        engine.reschedule(r.task);
        engine.notifyTasksChanged();
        return sendJson(res, 200, { task: await withNext(r.task) });
      }
      if (p === '/api/scheduler/tasks/export' && req.method === 'GET') {
        return sendJson(res, 200, {
          format: 'devflow_scheduler_tasks',
          version: 1,
          exportedAt: Date.now(),
          tasks: store.listTasks(),
        });
      }
      if (p === '/api/scheduler/tasks/import-all' && req.method === 'POST') {
        const body = await readBody(req, 8 * 1024 * 1024);
        const tasks = Array.isArray(body?.tasks) ? body.tasks : (Array.isArray(body) ? body : []);
        const result = { imported: 0, updated: 0, failed: [] };
        const meta = operatorOf(req);
        for (const raw of tasks) {
          const input = { ...(raw || {}) };
          const id = typeof input.id === 'string' ? input.id : '';
          delete input.id;
          delete input.createdAt;
          delete input.updatedAt;
          try {
            if (id && store.getTask(id)) {
              let r = store.replaceTask(id, input, meta);
              if (r.error === 'dir-taken') r = store.replaceTask(id, { ...input, cwd: null }, meta);
              if (r.error) result.failed.push({ name: input.name || id, error: r.error });
              else result.updated += 1;
            } else {
              let r = store.createTask(input, meta);
              if (r.error === 'dir-taken') r = store.createTask({ ...input, cwd: null }, meta);
              if (r.error) result.failed.push({ name: input.name || id, error: r.error });
              else result.imported += 1;
            }
          } catch (e) {
            result.failed.push({ name: input.name || id, error: String(e && e.message || e) });
          }
        }
        engine.refreshAll();
        engine.notifyTasksChanged();
        return sendJson(res, 200, result);
      }
      const m = p.match(/^\/api\/scheduler\/tasks\/([^/]+)(?:\/(run|stop|prompts))?$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const action = m[2];
        if (action === 'prompts' && req.method === 'GET') {
          if (!store.getTask(id)) return sendJson(res, 404, { error: 'not-found' });
          const hash = String(url.searchParams.get('hash') || '');
          const prompts = await queue.listPrompts(id, 100);
          const matched = hash ? (prompts.find((x) => x.hash === hash) || await queue.getPromptByHash(id, hash)) : null;
          return sendJson(res, 200, {
            prompts, hash, activeId: matched?.id ?? prompts[0]?.id ?? null,
          });
        }
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
          const meta = operatorOf(req);
          const r = store.updateTask(id, await readBody(req), meta);
          if (r.error === 'not-found') return sendJson(res, 404, { error: 'not-found' });
          if (r.error) return sendJson(res, 400, { error: r.error });
          await savePrompt(r.task, meta);
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
        const summary = store.importManifestDir(dir, operatorOf(req));
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
