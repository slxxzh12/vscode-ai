import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { t } from './i18n.js';
import { pickSqliteFile } from './native-dialog.js';
import { createZip } from './zip-writer.js';
import { createNavicatExport } from './navicat-export.js';

const MAX_BODY = 2 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const STATUS = { 'not-found': 404, 'bad-type': 400, 'bad-request': 400, 'bad-secret': 400, timeout: 504, connect: 502, exec: 502 };

function sendErr(res, code) {
  const c = code && STATUS[code] ? code : 'exec';
  sendJson(res, STATUS[c] || 500, { error: c, message: t(`nv.err.${c.replace(/-/g, '_')}`) });
}

// /api/navicat/*：连接档案 CRUD + 测试/执行 + 连接串/导出
export function createNavicatMount({ store, exec, ncx, pickFile = pickSqliteFile, exporter, logger = console }) {
  const exp = exporter || createNavicatExport({ exec });
  // 异步导出任务：几十个库 × 每个库几百张表时，同步请求会超时；改为后台跑 + 轮询进度 + 完成后下载。
  const exportJobs = new Map();

  function pruneJobs() {
    const now = Date.now();
    for (const [id, job] of exportJobs) {
      if (job.status === 'running') continue;
      if (now - job.createdAt > 60 * 60 * 1000) {
        try { if (job.file) fs.unlinkSync(job.file); } catch { /* ignore */ }
        exportJobs.delete(id);
      }
    }
  }

  function startExportJob({ items, n, formats, sample, outDir }) {
    pruneJobs();
    const id = crypto.randomBytes(8).toString('hex');
    const job = {
      id, status: 'running', cancelled: false,
      progress: { dbsDone: 0, tablesDone: 0 },
      errors: [], error: '', file: '', outputDir: '',
      name: `navicat-export-${stamp()}.zip`,
      createdAt: Date.now(),
    };
    exportJobs.set(id, job);
    void (async () => {
      try {
        const { files, errors } = await exp.build({
          items, n, formats, sample,
          onProgress: (p) => { job.progress = p || job.progress; },
          shouldStop: () => job.cancelled,
        });
        job.errors = errors || [];
        if (job.errors.length) files.push({ path: 'errors.txt', data: job.errors.join('\n') });
        if (outDir) {
          // 直接写入用户选择的目录：表很多时比下载 zip 更实用，也便于后续处理。
          const base = path.resolve(outDir);
          fs.mkdirSync(base, { recursive: true });
          for (const f of files) {
            const abs = path.resolve(base, f.path);
            const rel = path.relative(base, abs);
            if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, f.data);
          }
          job.outputDir = base;
          job.status = 'done';
          return;
        }
        const zip = createZip(files);
        const file = path.join(os.tmpdir(), `df-navicat-export-${id}.zip`);
        fs.writeFileSync(file, zip);
        job.file = file;
        job.status = 'done';
      } catch (e) {
        const msg = String((e && e.message) || e);
        job.status = msg === 'cancelled' ? 'cancelled' : 'error';
        job.error = job.status === 'error' ? msg : '';
        if (job.status === 'error') logger?.warn?.('navicat export failed', msg);
      }
    })();
    return job;
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  async function route(req, res, url) {
    const m = req.method;
    const seg = url.pathname.replace(/^\/api\/navicat\/?/, '').split('/').filter(Boolean);
    const head = seg[0] || '';
    let body = {};
    if (m === 'POST' || m === 'PATCH') {
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
    }

    if (head === 'profiles' && seg.length === 1) {
      if (m === 'GET') return sendJson(res, 200, { items: store.list() });
      if (m === 'POST') return sendJson(res, 200, { ok: true, item: store.create(body) });
      if (m === 'PATCH') return sendJson(res, 200, { ok: true, item: store.update(String(body.id || ''), body) });
      if (m === 'DELETE') return sendJson(res, 200, { ok: store.remove(String(url.searchParams.get('id') || '')) });
      return sendJson(res, 405, { error: 'method' });
    }

    if (head === 'schema' && seg[1] === 'databases' && m === 'GET') {
      const p = store.get(String(url.searchParams.get('id') || ''));
      const items = await exec.listDatabases(p, store.password(p.id));
      return sendJson(res, 200, { items });
    }

    if (head === 'schema' && seg[1] === 'tables' && m === 'GET') {
      const p = store.get(String(url.searchParams.get('id') || ''));
      const database = url.searchParams.get('database') || '';
      const items = await exec.listTables(p, store.password(p.id), database || p.database);
      return sendJson(res, 200, { items });
    }

    if (head === 'reveal' && m === 'POST') {
      return sendJson(res, 200, { password: store.password(String(body.id || '')) });
    }

    if (head === 'connstr' && m === 'POST') {
      const p = store.get(String(body.id || ''));
      const text = ncx.connectionString(p, store.password(p.id), { withPassword: !!body.withPassword });
      return sendJson(res, 200, { text });
    }

    if (head === 'ncx' && m === 'POST') {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const entries = ids.map((id) => {
        const p = store.get(String(id));
        return { ...p, password: store.password(p.id) };
      });
      return sendJson(res, 200, { xml: ncx.buildNcx(entries) });
    }

    if (head === 'export' && seg[1] === 'jobs') {
      const job = exportJobs.get(String(seg[2] || ''));
      if (!job) return sendJson(res, 404, { error: 'not-found' });
      if (seg[3] === 'download' && m === 'GET') {
        if (job.status !== 'done' || !job.file) return sendJson(res, 409, { error: job.status || 'not-ready' });
        const stream = fs.createReadStream(job.file);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${job.name}"`,
        });
        stream.pipe(res);
        stream.on('close', () => {
          try { fs.unlinkSync(job.file); } catch { /* ignore */ }
          exportJobs.delete(job.id);
        });
        return undefined;
      }
      if (seg[3] === 'cancel' && m === 'POST') {
        job.cancelled = true;
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 200, {
        status: job.status,
        progress: job.progress,
        errors: job.errors.slice(0, 20),
        errorsCount: job.errors.length,
        error: job.error,
        outputDir: job.outputDir || '',
      });
    }

    if (head === 'export' && m === 'POST') {
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      if (!ids.length) return sendErr(res, 'bad-request');
      const n = Math.min(Math.max(Number(body.n) || 30, 1), 1000);
      const formats = (Array.isArray(body.formats) ? body.formats : ['sql', 'csv'])
        .filter((f) => f === 'sql' || f === 'csv');
      if (!formats.length) return sendErr(res, 'bad-request');
      const sample = body.sample !== false;
      const outDir = typeof body.outDir === 'string' ? body.outDir.trim() : '';
      // databases: { [profileId]: dbName }；显式给空串表示导出该连接的全部数据库。
      const dbSel = body.databases && typeof body.databases === 'object' ? body.databases : {};
      const items = ids.map((id) => {
        const p = store.get(id);
        const profile = Object.prototype.hasOwnProperty.call(dbSel, id)
          ? { ...p, database: String(dbSel[id] ?? '').trim() }
          : p;
        return { profile, password: store.password(p.id) };
      });
      if (body.async === true) {
        const job = startExportJob({ items, n, formats, sample, outDir });
        return sendJson(res, 200, { ok: true, jobId: job.id });
      }
      const { files, errors } = await exp.build({ items, n, formats, sample });
      if (errors.length) files.push({ path: 'errors.txt', data: errors.join('\n') });
      const zip = createZip(files);
      const name = `navicat-export-${stamp()}.zip`;
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Content-Length': String(zip.length),
      });
      res.end(zip);
      return undefined;
    }

    if (head === 'test' && m === 'POST') {
      const p = body.profile ? body.profile : store.get(String(body.id || ''));
      const password = body.profile ? String(body.profile.password || '') : store.password(p.id);
      await exec.test(p, password);
      return sendJson(res, 200, { ok: true });
    }

    if (head === 'exec' && m === 'POST') {
      const base = store.get(String(body.id || ''));
      const p = body.database !== undefined && body.database !== null && String(body.database) !== ''
        ? { ...base, database: String(body.database) }
        : base;
      const sql = String(body.sql || '');
      if (!sql.trim()) return sendErr(res, 'bad-request');
      if (exec.isWrite(p, sql) && body.confirm !== true) {
        return sendJson(res, 200, { needConfirm: true, kind: 'write' });
      }
      const result = await exec.exec(p, store.password(p.id), sql);
      return sendJson(res, 200, { ok: true, result });
    }

    if (head === 'pick-file' && m === 'POST') {
      const r = await pickFile();
      if (r.error) return sendJson(res, 200, { error: r.error, message: r.message || null });
      if (r.cancelled || !r.path) return sendJson(res, 200, { cancelled: true });
      return sendJson(res, 200, { path: r.path });
    }

    return sendJson(res, 404, { error: 'not-found', message: t('nv.err.not_found') });
  }

  return (req, res, url) => {
    const u = url || new URL(req.url, 'http://localhost');
    if (!u.pathname.startsWith('/api/navicat')) return sendJson(res, 404, { error: 'not-found' });
    route(req, res, u).catch((e) => {
      logger?.warn?.('navicat mount error', (e && e.message) || e);
      sendErr(res, (e && e.code) || 'exec');
    });
  };
}
