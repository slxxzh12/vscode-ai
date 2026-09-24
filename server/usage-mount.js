import { parseInviteLink } from './usage-report.js';

const MAX_BODY = 1024 * 1024;   // 上报体只放用量数字，1MB 足够
const MAX_IMAGE_BODY = 10 * 1024 * 1024;   // 统计截图（多模态识别）上限

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

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_IMAGE_BODY) { reject(new Error('image too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// /api/usage/* 的 HTTP 面：远端收上报（令牌），本机界面看汇总/配上报器
export function createUsageMount({ peers, reporter, checkToken, onReport, pullFromHub = null, probe = null, loadProbe = null, saveProbe = null, onImage = null, setCwd = null, logger = console }) {
  const freshCache = new Map();   // masterId -> 最近一次成功拉到的 members
  async function route(req, res, url) {
    const m = req.method;
    const seg = url.pathname.replace(/^\/api\/usage\/?/, '').split('/').filter(Boolean);

    if (seg[0] === 'report' && seg.length === 1 && m === 'POST') {
      const tk = String(req.headers['x-df-token'] || '');
      if (!checkToken || !checkToken(tk)) return sendJson(res, 403, { error: 'bad-token' });
      let body = {};
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
      if (!body || typeof body.machineId !== 'string' || !body.machineId || !body.usage || typeof body.usage !== 'object' || Array.isArray(body.usage)) {
        return sendJson(res, 400, { error: 'bad-body' });
      }
      const rec = peers.upsert({
        ...body.usage,
        machineId: body.machineId,
        employeeId: typeof body.employeeId === 'string' ? body.employeeId : '',
        username: typeof body.username === 'string' ? body.username : '',
        host: typeof body.host === 'string' ? body.host : '',
        port: Number(body.port) || 0,
      });
      try { onReport?.(rec); } catch (e) { logger?.warn?.('usage onReport failed', (e && e.message) || e); }
      return sendJson(res, 200, { ok: true });
    }

    if (seg[0] === 'peers' && seg.length === 1 && m === 'GET') {
      const fresh = ['1', 'true', 'yes'].includes(String(url.searchParams.get('fresh') || '').toLowerCase());
      if (!fresh) return sendJson(res, 200, peers.snapshot());
      const masterId = url.searchParams.get('masterId') || undefined;
      const key = masterId || '*';
      if (typeof pullFromHub === 'function') {
        try {
          const r = await pullFromHub(masterId);
          if (r && r.code === 'ok') {
            freshCache.set(key, r.members || {});
            return sendJson(res, 200, { updatedAt: r.updatedAt || Date.now(), peers: r.members || {} });
          }
        } catch (e) { logger?.warn?.('usage fresh pull failed', (e && e.message) || e); }
      }
      const cached = freshCache.get(key);
      if (cached) return sendJson(res, 200, { updatedAt: Date.now(), peers: cached, stale: true });
      return sendJson(res, 200, { ...peers.snapshot(), stale: true });
    }

    // 每日留存（每台每天一条，最多 30 天）供趋势曲线；始终按 machineId 嵌套
    if (seg[0] === 'daily' && seg.length === 1 && m === 'GET') {
      const id = url.searchParams.get('machineId') || '';
      if (!id) return sendJson(res, 200, { daily: peers.listDaily() });
      const days = peers.listDaily(id);
      return sendJson(res, 200, { daily: Object.keys(days).length ? { [id]: days } : {} });
    }

    // 本机用量探针缓存：上次采集/探针的命令行原文（仅本机有原文，故只对自己那台有意义）
    if (seg[0] === 'probe' && seg.length === 1 && m === 'GET') {
      const cached = typeof loadProbe === 'function' ? loadProbe() : null;
      return sendJson(res, 200, cached ? { ...cached, cached: true } : { none: true });
    }
    // 现场跑一次统计命令，回原文 + 解析结果，并写入缓存
    if (seg[0] === 'probe' && seg.length === 1 && m === 'POST') {
      if (typeof probe !== 'function') return sendJson(res, 500, { error: 'probe-unavailable' });
      try {
        const r = await probe();
        try { saveProbe?.(r); } catch (e) { logger?.warn?.('usage probe cache save failed', (e && e.message) || e); }
        return sendJson(res, 200, r);
      } catch (e) {
        logger?.warn?.('usage probe failed', (e && e.message) || e);
        return sendJson(res, 500, { error: String((e && e.message) || e) });
      }
    }

    if (seg[0] === 'reporter' && seg.length === 1 && m === 'GET') {
      return sendJson(res, 200, { config: reporter.config(), status: reporter.status() });
    }
    if (seg[0] === 'reporter' && seg.length === 1 && m === 'POST') {
      let body = {};
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
      if (typeof body.link === 'string' && body.link.trim()) {
        const parsed = parseInviteLink(body.link);
        if (parsed.error) return sendJson(res, 400, { error: parsed.error });
        reporter.setConfig({ masterUrl: parsed.masterUrl, token: parsed.token, days: body.days, masterPublicKey: parsed.masterPublicKey });
      } else {
        reporter.setConfig({ masterUrl: body.masterUrl, token: body.token, days: body.days });
      }
      return sendJson(res, 200, { config: reporter.config(), status: reporter.status() });
    }
    if (seg[0] === 'reporter' && seg[1] === 'now' && seg.length === 2 && m === 'POST') {
      await reporter.reportNow();
      return sendJson(res, 200, { status: reporter.status() });
    }

    // 记录用户当前选中目录（根）：stats 采集从该目录向上找 .git 执行，找不到回退用户主目录
    if (seg[0] === 'cwd' && seg.length === 1 && m === 'POST') {
      let body = {};
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
      const root = typeof body.root === 'string' ? body.root.trim() : '';
      try { setCwd?.(root); } catch (e) { logger?.warn?.('usage setCwd failed', (e && e.message) || e); }
      return sendJson(res, 200, { ok: true, root });
    }

    // 统计截图多模态识别：识别结果写回用量库（source=image）并上报 master
    if (seg[0] === 'image' && seg.length === 1 && m === 'POST') {
      if (typeof onImage !== 'function') return sendJson(res, 500, { error: 'unavailable' });
      let data;
      try { data = await readRaw(req); } catch { return sendJson(res, 413, { error: 'image too large' }); }
      const mime = String(url.searchParams.get('mime') || '');
      try {
        const r = await onImage({ data, mime });
        return sendJson(res, 200, r);
      } catch (e) {
        const code = (e && e.code) || 'internal';
        const status = ['no-provider', 'no-key', 'bad-model', 'empty-image', 'image-too-large', 'bad-json', 'empty-result'].includes(code)
          ? 400 : code === 'timeout' ? 504 : code === 'upstream' ? 502 : 500;
        return sendJson(res, status, { error: code, message: (e && e.message) || '' });
      }
    }

    return sendJson(res, 404, { error: 'not found' });
  }

  return (req, res, url) => {
    const u = url || new URL(req.url, 'http://localhost');
    if (!u.pathname.startsWith('/api/usage/')) return sendJson(res, 404, { error: 'not found' });
    route(req, res, u).catch((e) => {
      logger?.error?.('usage mount error', e);
      sendJson(res, 500, { error: 'internal' });
    });
  };
}
