import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limit) { reject(new Error('too large')); req.destroy(); return; }
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

function defaultOverview() {
  const fallback = path.parse(os.homedir()).root.replace(/[\\/]+$/, '');
  const drive = (process.env.SystemDrive || fallback).replace(/[\\/]+$/, '');
  try {
    const s = fs.statfsSync(`${drive}\\`);
    return { drive, total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return { drive, total: 0, free: 0 };
  }
}

export function createDiskCleanMount({
  platform = process.platform,
  store,
  scanner,
  cleaner,
  overview = defaultOverview,
  validateCustomDir = () => ({ ok: true }),
  forbiddenRoots = [],
  listCategories = () => [],
} = {}) {
  const supported = platform === 'win32';

  return async function route(req, res, url) {
    if (!supported) { sendJson(res, 501, { error: 'unsupported_platform' }); return; }
    const seg = url.pathname.replace(/^\/api\/disk-clean\/?/, '').split('/').filter(Boolean);
    const head = seg[0] || '';
    let body = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
    }

    if (head === 'overview' && req.method === 'GET') { sendJson(res, 200, overview()); return; }

    if (head === 'categories' && req.method === 'GET') {
      sendJson(res, 200, { items: listCategories({ customDirs: store.readSettings().customDirs }) });
      return;
    }

    if (head === 'settings') {
      if (req.method === 'GET') { sendJson(res, 200, store.readSettings()); return; }
      if (req.method === 'PUT') {
        const dirs = Array.isArray(body.customDirs) ? body.customDirs : [];
        const accepted = [];
        for (const raw of dirs) {
          const r = validateCustomDir(raw, { forbidden: forbiddenRoots });
          if (!r.ok) { sendJson(res, 400, { error: r.error || 'bad_dir', path: raw }); return; }
          accepted.push(r.path || path.resolve(String(raw)));
        }
        const saved = store.writeSettings({
          exclusions: {
            dirs: Array.isArray(body?.exclusions?.dirs) ? body.exclusions.dirs.map(String) : [],
            patterns: Array.isArray(body?.exclusions?.patterns) ? body.exclusions.patterns.map(String) : [],
          },
          customDirs: accepted,
        });
        sendJson(res, 200, saved);
        return;
      }
    }

    if (head === 'history' && req.method === 'GET') {
      sendJson(res, 200, { items: store.readHistory(100) });
      return;
    }

    if (head === 'scan' && seg.length === 1 && req.method === 'POST') {
      sendJson(res, 200, scanner.start({ customDirs: Array.isArray(body.customDirs) ? body.customDirs : undefined }));
      return;
    }
    if (head === 'scan' && seg.length === 2 && req.method === 'GET') {
      const task = scanner.get(seg[1]);
      if (!task) { sendJson(res, 410, { error: 'scan_expired' }); return; }
      sendJson(res, 200, task);
      return;
    }

    if (head === 'clean' && seg.length === 1 && req.method === 'POST') {
      const scan = scanner.get(String(body.scanId || ''));
      if (!scan) { sendJson(res, 410, { error: 'scan_expired' }); return; }
      const r = cleaner.start({
        scan,
        categoryIds: Array.isArray(body.categoryIds) ? body.categoryIds.map(String) : [],
        permanent: Boolean(body.permanent),
        confirmed: Array.isArray(body.confirmed) ? body.confirmed.map(String) : [],
      });
      if (r.error === 'bad_category') { sendJson(res, 400, { error: r.error }); return; }
      if (r.error === 'need_confirm') { sendJson(res, 400, { error: r.error }); return; }
      if (r.error === 'scan_expired') { sendJson(res, 410, { error: r.error }); return; }
      sendJson(res, 200, r);
      return;
    }
    if (head === 'clean' && seg.length === 2 && req.method === 'GET') {
      const st = cleaner.get(seg[1]);
      if (!st) { sendJson(res, 404, { error: 'not_found' }); return; }
      sendJson(res, 200, st);
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  };
}
