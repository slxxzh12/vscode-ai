import { JOB_COLUMNS } from './schema.js';

const JOB_FIELDS = new Set(JOB_COLUMNS);
const WORK_FIELDS = new Set(['id', 'hostport', 'status', 'lastUpdateTime', 'partitionIds', 'role', 'version', 'topic']);

function pick(obj, fields) {
  const out = {};
  for (const k of fields) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export function createRepository(driver) {
  async function insertJob(job) {
    const row = pick(job, JOB_FIELDS);
    const cols = Object.keys(row);
    const sql = `INSERT INTO t_sched_job (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
    try {
      await driver.run(sql, cols.map((c) => row[c]));
      return { ok: true };
    } catch (e) {
      if (driver.isDuplicate(e)) return { error: 'unique-conflict' };
      throw e;
    }
  }

  async function updateJob(jobId, patch) {
    const row = pick(patch, JOB_FIELDS);
    const cols = Object.keys(row).filter((c) => c !== 'jobId');
    if (!cols.length) return { ok: true };
    const sql = `UPDATE t_sched_job SET ${cols.map((c) => `${c}=?`).join(',')} WHERE jobId=?`;
    try {
      const r = await driver.run(sql, [...cols.map((c) => row[c]), jobId]);
      return r.changes ? { ok: true } : { error: 'not-found' };
    } catch (e) {
      if (driver.isDuplicate(e)) return { error: 'unique-conflict' };
      throw e;
    }
  }

  async function getJob(jobId) {
    const rows = await driver.query('SELECT * FROM t_sched_job WHERE jobId=?', [jobId]);
    return rows[0] || null;
  }

  async function listJobs({ topic = null, taskIds = null, status = null, partitionId = null, limit = 500 } = {}) {
    const where = [];
    const params = [];
    if (topic) { where.push('topic=?'); params.push(topic); }
    if (taskIds && taskIds.length) {
      where.push(`taskId IN (${taskIds.map(() => '?').join(',')})`);
      params.push(...taskIds);
    }
    if (status !== null && status !== undefined) {
      const arr = Array.isArray(status) ? status : [status];
      where.push(`status IN (${arr.map(() => '?').join(',')})`);
      params.push(...arr);
    }
    if (partitionId !== null && partitionId !== undefined) { where.push('partitionId=?'); params.push(partitionId); }
    const sql = `SELECT * FROM t_sched_job ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY createTime DESC LIMIT ?`;
    params.push(Math.max(1, Math.min(5000, Number(limit) || 500)));
    return driver.query(sql, params);
  }

  async function claim({ topic, partitionId, machineId, hostport, now }) {
    return driver.transaction(async (tx) => {
      const rows = await tx.query(
        `SELECT * FROM t_sched_job
          WHERE topic=? AND partitionId=? AND status=0
            AND (onlyLocal=0 OR createMachineId=?)
          ORDER BY weight DESC, createTime ASC LIMIT 1`,
        [topic, partitionId, machineId],
      );
      const row = rows[0];
      if (!row) return null;
      await tx.run('UPDATE t_sched_job SET status=3, workIP=?, activeKey=NULL, lastUpdateTime=? WHERE jobId=?', [hostport, now, row.jobId]);
      return { ...row, status: 3, workIP: hostport, activeKey: null, lastUpdateTime: now };
    });
  }

  async function summary(topic) {
    const out = { queued: 0, running: 0, pending: 0, success: 0, failed: 0, total: 0 };
    const rows = await driver.query('SELECT status, COUNT(*) AS n FROM t_sched_job WHERE topic=? GROUP BY status', [topic]);
    const key = { 0: 'queued', 1: 'success', 2: 'failed', 3: 'running', 4: 'pending' };
    for (const r of rows) {
      out[key[r.status]] = Number(r.n);
      out.total += Number(r.n);
    }
    return out;
  }

  async function partitionStats(topic, count) {
    const rows = await driver.query('SELECT partitionId, status, COUNT(*) AS n FROM t_sched_job WHERE topic=? GROUP BY partitionId, status', [topic]);
    const out = Array.from({ length: count }, (_, id) => ({ id, queued: 0, running: 0, pending: 0 }));
    for (const r of rows) {
      const p = out[r.partitionId];
      if (!p) continue;
      if (r.status === 0) p.queued = Number(r.n);
      else if (r.status === 3) p.running = Number(r.n);
      else if (r.status === 4) p.pending = Number(r.n);
    }
    return out;
  }

  async function purgeTaskJobs(topic, taskId) {
    const r = await driver.run('DELETE FROM t_sched_job WHERE topic=? AND taskId=?', [topic, taskId]);
    return r.changes;
  }

  async function deleteFinished({ topic, partitionId = null }) {
    const params = [topic];
    let sql = 'DELETE FROM t_sched_job WHERE topic=? AND status IN (1,2)';
    if (partitionId !== null && partitionId !== undefined) { sql += ' AND partitionId=?'; params.push(partitionId); }
    const r = await driver.run(sql, params);
    return r.changes;
  }

  async function rehash(topic, count, hashFn) {
    const rows = await driver.query('SELECT jobId, taskId FROM t_sched_job WHERE topic=? AND status IN (0,4)', [topic]);
    for (const r of rows) {
      if (!r.taskId) continue;
      await driver.run('UPDATE t_sched_job SET partitionId=? WHERE jobId=?', [hashFn(topic, r.taskId, count), r.jobId]);
    }
    return rows.length;
  }

  async function upsertWorker(w) {
    const row = pick(w, WORK_FIELDS);
    const cols = Object.keys(row);
    const sql = driver.dialect === 'mysql'
      ? `INSERT INTO t_work_status (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
         ON DUPLICATE KEY UPDATE ${cols.filter((c) => c !== 'id').map((c) => `${c}=VALUES(${c})`).join(',')}`
      : `INSERT INTO t_work_status (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
         ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(',')}`;
    await driver.run(sql, cols.map((c) => row[c]));
  }

  async function listWorkers(topic) {
    return driver.query('SELECT * FROM t_work_status WHERE topic=? ORDER BY id', [topic]);
  }

  async function setWorkerPartitions(id, partitionIds, now) {
    await driver.run('UPDATE t_work_status SET partitionIds=?, lastUpdateTime=? WHERE id=?', [partitionIds, now, id]);
  }

  async function markStaleWorkers(topic, cutoff) {
    await driver.run('UPDATE t_work_status SET status=0 WHERE topic=? AND status=1 AND lastUpdateTime<?', [topic, cutoff]);
  }

  async function getConfig(k) {
    const rows = await driver.query('SELECT v FROM t_sched_config WHERE k=?', [k]);
    return rows[0] ? rows[0].v : null;
  }

  async function setConfig(k, v) {
    if (driver.dialect === 'mysql') {
      await driver.run('INSERT INTO t_sched_config (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)', [k, v]);
    } else {
      await driver.run('INSERT INTO t_sched_config (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', [k, v]);
    }
  }

  async function getLatestPrompt(taskId) {
    const rows = await driver.query('SELECT * FROM t_sched_prompt WHERE taskId=? ORDER BY id DESC LIMIT 1', [taskId]);
    return rows[0] || null;
  }

  async function listPrompts(taskId, limit = 50) {
    return driver.query('SELECT * FROM t_sched_prompt WHERE taskId=? ORDER BY id DESC LIMIT ?', [taskId, Math.max(1, Math.min(500, Number(limit) || 50))]);
  }

  async function insertPrompt({ taskId, prompt, hash, createIP, employeeId, createdAt }) {
    try {
      const r = await driver.run(
        'INSERT INTO t_sched_prompt (taskId,prompt,hash,createIP,employeeId,createdAt) VALUES (?,?,?,?,?,?)',
        [taskId, prompt, hash, createIP || '', employeeId || '', createdAt],
      );
      return { id: r.insertId };
    } catch (e) {
      if (driver.isDuplicate(e)) return { duplicate: true };
      throw e;
    }
  }

  async function getPromptByHash(taskId, hash) {
    const rows = await driver.query('SELECT * FROM t_sched_prompt WHERE taskId=? AND hash=? ORDER BY id DESC LIMIT 1', [taskId, hash]);
    return rows[0] || null;
  }

  async function deleteTaskPrompts(taskId) {
    const r = await driver.run('DELETE FROM t_sched_prompt WHERE taskId=?', [taskId]);
    return r.changes;
  }

  return {
    insertJob, updateJob, getJob, listJobs, claim, summary, partitionStats,
    deleteFinished, purgeTaskJobs, rehash, upsertWorker, listWorkers, setWorkerPartitions,
    markStaleWorkers, getConfig, setConfig,
    getLatestPrompt, listPrompts, insertPrompt, getPromptByHash, deleteTaskPrompts, driver,
  };
}
