const sendJson = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};
const readBody = (req, limit = 1024 * 1024) => new Promise((resolve, reject) => {
  const chunks = []; let total = 0;
  req.on('data', (c) => { total += c.length; if (total > limit) { reject(new Error('body too large')); req.destroy(); return; } chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

export function createJobsMount({ queue, registry = () => null, role = 'master', logger = console, hostport = '', machineId = '', stopJob = null }) {
  const isMaster = () => role === 'master';
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (p === '/api/scheduler/jobs' && req.method === 'GET') {
        const status = url.searchParams.get('status');
        const partition = url.searchParams.get('partition');
        const taskId = url.searchParams.get('taskId');
        const limit = Number(url.searchParams.get('limit')) || 500;
        const jobs = await queue.listJobs({
          status: status === null || status === '' ? null : Number(status),
          partitionId: partition === null || partition === '' ? null : Number(partition),
          taskIds: taskId ? [taskId] : null,
          limit,
        });
        return sendJson(res, 200, {
          jobs, summary: await queue.summary(), partitions: await queue.partitionStats(),
          topic: queue.topic, partitionCount: await queue.partitionCount(),
        });
      }
      const m = p.match(/^\/api\/scheduler\/jobs\/([^/]+)(?:\/(approve|reject|cancel|retry))?$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const action = m[2];
        if (!action && req.method === 'GET') {
          const job = await queue.getJob(id);
          if (!job) return sendJson(res, 404, { error: 'not-found' });
          return sendJson(res, 200, { job, local: job.workIP === hostport });
        }
        if (action === 'approve' || action === 'reject') {
          if (!isMaster()) return sendJson(res, 403, { error: 'master-only' });
          const r = await queue[action](id);
          if (r.error) return sendJson(res, 409, { error: r.error });
          return sendJson(res, 200, r);
        }
        if (action === 'cancel') {
          const r = await queue.cancel(id);
          if (r.error) return sendJson(res, 409, { error: r.error });
          if (r.needsStop && stopJob) await stopJob(id);
          return sendJson(res, 200, { ok: true });
        }
        if (action === 'retry') {
          const r = await queue.retry(id, { createMachineId: machineId, createIP: hostport });
          if (r.error) return sendJson(res, 409, { error: r.error });
          return sendJson(res, 200, r);
        }
      }
      if (p === '/api/scheduler/jobs/cleanup' && req.method === 'POST') {
        if (!isMaster()) return sendJson(res, 403, { error: 'master-only' });
        const body = await readBody(req);
        const deleted = await queue.cleanupFinished({ partitionId: body.partitionId ?? null });
        return sendJson(res, 200, { deleted });
      }
      if (p === '/api/scheduler/workers' && req.method === 'GET') {
        const reg = registry();
        return sendJson(res, 200, { workers: reg ? await reg.list() : [] });
      }
      if (p === '/api/scheduler/queue/config' && req.method === 'GET') {
        return sendJson(res, 200, { ...queue.config.publicConfig(), partitionCount: await queue.partitionCount(), role });
      }
      if (p === '/api/scheduler/queue/config' && req.method === 'PUT') {
        if (!isMaster()) return sendJson(res, 403, { error: 'master-only' });
        const r = queue.config.save(await readBody(req));
        if (r.error) return sendJson(res, 400, r);
        return sendJson(res, 200, r);
      }
      if (p === '/api/scheduler/queue/partitions' && req.method === 'PUT') {
        if (!isMaster()) return sendJson(res, 403, { error: 'master-only' });
        const body = await readBody(req);
        const r = await queue.setPartitionCount(body.count);
        if (r.error) return sendJson(res, 400, r);
        return sendJson(res, 200, r);
      }
      return sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      logger.error('scheduler jobs http', e);
      return sendJson(res, 500, { error: 'internal', message: String(e?.message || e) });
    }
  };
}
