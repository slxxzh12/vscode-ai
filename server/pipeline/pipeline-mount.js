import fs from 'node:fs';
import path from 'node:path';
import { createUsConfigStore } from './us-config.js';
import { createUsStateStore, resetBaseline } from './us-state.js';
import { US_RE, listUsDirs } from './us-detect.js';
import { detectDocDefaults } from './doc-defaults.js';
import { createSolutionWatch } from './solution-watch.js';
import { ensureDocsAgents, docsRepoRootOf } from '../docs-agents.js';

const LOG_FILES = new Set(['ai.log', 'test.log', 'build.log', 'package.log']);
const JOB_RE = /^j_[A-Za-z0-9]+$/;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function inside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function createPipelineMount({
  dir, docsState = () => ({}), scheduler, logger = console,
  runDirFor = (jobId) => scheduler.store.runDirFor('auto_docs_update', jobId),
}) {
  const config = createUsConfigStore({ file: path.join(dir, 'config.json'), logger });
  const state = createUsStateStore({ file: path.join(dir, 'us-state.json'), logger });
  const watch = createSolutionWatch({ configStore: config, stateStore: state, docsState, scheduler, logger });

  function resetWatchBaseline() {
    const ds = docsState() || {};
    const solutionDir = ds.solution?.selected ? String(ds.solution.path || '').trim() : '';
    if (solutionDir && fs.existsSync(solutionDir)) state.write(resetBaseline(solutionDir, listUsDirs(solutionDir)));
  }

  async function mount(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/pipeline/defaults' && req.method === 'GET') {
        const root = String(url.searchParams.get('root') || '').trim();
        if (!root) return sendJson(res, 400, { error: 'bad-root' });
        const create = url.searchParams.get('create') === '1';
        const r = detectDocDefaults(root, { create });
        if (create && !r.error) r.agents = ensureDocsAgents(docsRepoRootOf(root));
        return sendJson(res, r.error ? 400 : 200, r);
      }
      if (url.pathname === '/api/pipeline/config' && req.method === 'GET') {
        return sendJson(res, 200, config.read());
      }
      if (url.pathname === '/api/pipeline/config' && req.method === 'POST') {
        const body = await readBody(req);
        const before = config.read();
        const next = config.write({ ...before, ...body });
        if (!before.autoDev && next.autoDev) resetWatchBaseline();
        watch.sync();
        return sendJson(res, 200, next);
      }
      if (url.pathname === '/api/pipeline/watch' && req.method === 'GET') {
        return sendJson(res, 200, watch.status());
      }
      if (url.pathname === '/api/pipeline/watch' && req.method === 'POST') {
        const body = await readBody(req);
        const cfg = config.read();
        if (body.enabled === false) {
          const next = config.write({ ...cfg, watch: false });
          watch.stop();
          return sendJson(res, 200, { ...watch.status(), config: next });
        }
        // 启动监控：同时开启自动编码，并把当前已有方案记为基线（只处理之后新增的方案）。
        const next = config.write({ ...cfg, autoDev: true, watch: true });
        resetWatchBaseline();
        watch.start();
        await watch.scan();
        return sendJson(res, 200, { ...watch.status(), config: next });
      }
      if (url.pathname === '/api/pipeline/retry' && req.method === 'POST') {
        const body = await readBody(req);
        const us = String(body.us || '');
        if (!US_RE.test(us)) return sendJson(res, 400, { error: 'bad-us' });
        const current = state.read();
        if (!current.items[us]) return sendJson(res, 404, { error: 'not-found' });
        current.items[us].status = 'pending';
        current.items[us].error = null;
        state.write(current);
        if (config.read().autoDev && scheduler?.engine?.manualRun) await scheduler.engine.manualRun('auto_docs_update');
        return sendJson(res, 200, { ok: true });
      }
      if (url.pathname === '/api/pipeline/logs' && req.method === 'GET') {
        const jobId = String(url.searchParams.get('jobId') || '');
        const us = String(url.searchParams.get('us') || '');
        const file = String(url.searchParams.get('file') || '');
        if (!JOB_RE.test(jobId) || !US_RE.test(us) || !LOG_FILES.has(file)) return sendJson(res, 400, { error: 'bad-args' });
        const runDir = path.resolve(runDirFor(jobId));
        const target = path.resolve(runDir, 'us', us, file);
        if (!inside(runDir, target) || !fs.existsSync(target)) return sendJson(res, 404, { error: 'not-found' });
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(target, 'utf8'));
      }
      return sendJson(res, 404, { error: 'not-found' });
    } catch (e) {
      logger?.error?.('pipeline http', e);
      return sendJson(res, 500, { error: 'internal', message: String(e?.message || e) });
    }
  }

  mount.watch = watch;
  mount.syncWatch = () => watch.sync();
  return mount;
}
