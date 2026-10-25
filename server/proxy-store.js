import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { NGINX_DEFAULT_PORT, NGINX_SAMPLE_REWRITES } from '@devflow/shared';

export const PROXY_MODES = ['port', 'path'];
export const RESERVED_PREFIXES = ['/api', '/ws'];

const COOKIE_ATTRS = new Set(['expires', 'max-age', 'domain', 'path', 'secure', 'httponly', 'samesite', 'priority', 'partitioned', 'comment']);

export function splitCookieHeader(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  if (/\r?\n/.test(raw)) return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const parts = raw.split(';').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return [raw];
  const allPairs = parts.every((p) => {
    const i = p.indexOf('=');
    if (i <= 0) return false;
    const key = p.slice(0, i).trim().toLowerCase();
    return key && !COOKIE_ATTRS.has(key);
  });
  return allPairs ? parts : [raw];
}
function err(code, message) { const e = new Error(message || code); e.code = code; return e; }
function nowIso() { return new Date().toISOString(); }

export function normalizeRule(input) {
  const mode = String(input?.mode || 'port');
  if (!PROXY_MODES.includes(mode)) throw err('bad-request', 'bad mode');
  const name = String(input?.name || '').trim();
  if (!name) throw err('bad-request', 'name required');
  const listenHost = String(input?.listenHost || '0.0.0.0').trim();
  if (!listenHost || /[\s/]/.test(listenHost)) throw err('bad-request', 'bad listen host');

  const t = input?.target || {};
  const protocol = String(t.protocol || 'http');
  if (!['http', 'https'].includes(protocol)) throw err('bad-request', 'bad protocol');
  const host = String(t.host || '').trim();
  const port = Number(t.port);
  let staticDir = String(input?.staticDir || '').trim();
  if (staticDir) {
    staticDir = path.resolve(staticDir);
    let st = null;
    try { st = fs.statSync(staticDir); } catch { /* missing */ }
    if (!st || !st.isDirectory()) throw err('bad-static-dir', 'static dir missing');
  } else {
    staticDir = '';
    if (!host) throw err('bad-request', 'target host required');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw err('bad-request', 'bad target port');
  }

  const headers = Array.isArray(input?.headers)
    ? input.headers.map((h) => ({ name: String(h?.name || '').trim(), value: String(h?.value ?? '') })).filter((h) => h.name)
    : [];

  const rewrites = Array.isArray(input?.rewrites)
    ? input.rewrites.map((r) => {
      const from = String(r?.from || '').trim();
      if (!from) return null;
      if (from !== '/' && (!/^\/[^/]/.test(from) || from.endsWith('/'))) throw err('bad-rewrite', 'bad rewrite from');
      let to = String(r?.to ?? '').trim();
      if (to && !to.startsWith('/')) throw err('bad-rewrite', 'bad rewrite to');
      if (to === '/') to = '';
      if (to.length > 1) to = to.replace(/\/+$/, '');
      const out = { from, to };
      if (r?.directResponse) {
        const ds = Number(r.directStatus);
        out.directResponse = true;
        out.directStatus = Number.isInteger(ds) && ds >= 100 && ds <= 599 ? ds : 200;
        out.directContentType = String(r.directContentType || '').trim() || 'application/json; charset=utf-8';
        out.directBody = String(r.directBody ?? '');
        out.directHeaders = Array.isArray(r.directHeaders)
          ? r.directHeaders.map((h) => ({ name: String(h?.name || '').trim(), value: String(h?.value ?? '') })).filter((h) => h.name)
          : [];
      }
      return out;
    }).filter(Boolean)
    : [];

  const responseReplace = Array.isArray(input?.responseReplace)
    ? input.responseReplace.map((r) => ({ from: String(r?.from ?? ''), to: String(r?.to ?? '') })).filter((r) => r.from.trim())
    : [];

  const locationReplace = Array.isArray(input?.locationReplace)
    ? input.locationReplace.map((r) => ({ from: String(r?.from ?? ''), to: String(r?.to ?? '') })).filter((r) => r.from.trim())
    : [];

  const responseHeaders = [];
  if (Array.isArray(input?.responseHeaders)) {
    for (const h of input.responseHeaders) {
      const name = String(h?.name || '').trim();
      if (!name) continue;
      const value = String(h?.value ?? '');
      if (name.toLowerCase() === 'set-cookie') {
        for (const v of splitCookieHeader(value)) responseHeaders.push({ name, value: v });
      } else {
        responseHeaders.push({ name, value });
      }
    }
  }

  const directStatus = Number(input?.directStatus);
  const directContentType = String(input?.directContentType || '').trim() || 'application/json; charset=utf-8';
  const base = {
    name, mode, listenHost,
    staticDir,
    target: {
      protocol,
      host,
      port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 0,
    },
    tlsInsecure: input?.tlsInsecure !== false,
    preserveHost: input?.preserveHost !== false,
    headers,
    rewrites,
    responseReplace,
    locationReplace,
    responseHeaders,
    directResponse: !!input?.directResponse,
    directStatus: Number.isInteger(directStatus) && directStatus >= 100 && directStatus <= 599 ? directStatus : 200,
    directContentType,
    directBody: String(input?.directBody ?? ''),
    corsPreflight: !!input?.corsPreflight,
    logRequests: !!input?.logRequests,
    capture: !!input?.capture,
    enabled: !!input?.enabled,
  };

  if (mode === 'port') {
    const listenPort = Number(input?.listenPort ?? NGINX_DEFAULT_PORT);
    if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) throw err('bad-request', 'bad listen port');
    return { ...base, listenPort, pathPrefix: '', stripPrefix: true };
  }

  const pathPrefix = String(input?.pathPrefix || '').trim();
  if (!/^\/[^/]/.test(pathPrefix)) throw err('bad-request', 'bad prefix');
  if (pathPrefix.endsWith('/')) throw err('bad-request', 'bad prefix');
  if (RESERVED_PREFIXES.some((p) => pathPrefix === p || pathPrefix.startsWith(p + '/'))) throw err('bad-request', 'reserved prefix');
  return { ...base, listenPort: 0, pathPrefix, stripPrefix: input?.stripPrefix !== false };
}

// 默认样例：把 DeepSeek 官方 API 代理到本机端口，客户端用 deepseek-flash 模型调用
export function deepseekFlashSample() {
  return {
    name: 'deepseek-flash',
    mode: 'port',
    listenHost: '0.0.0.0',
    listenPort: NGINX_DEFAULT_PORT,
    target: { protocol: 'https', host: 'api.deepseek.com', port: 443 },
    tlsInsecure: true,
    headers: [{ name: 'Authorization', value: 'Bearer ak-123456' }],
    rewrites: NGINX_SAMPLE_REWRITES.map((r) => ({ ...r })),
    capture: false,
    enabled: true,
  };
}

export function createProxyStore({ file, reservedPorts = [], seed = [] }) {
  const reserved = reservedPorts.map(Number);
  let items = null;
  let loadedMtimeMs = 0;

  function fileMtimeMs() {
    try { return fs.statSync(file).mtimeMs; } catch { return 0; }
  }

  function load() {
    if (items) return items;
    loadedMtimeMs = fileMtimeMs();
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      items = Array.isArray(raw?.items) ? raw.items : [];
    } catch { items = []; }
    // 旧版 DeepSeek 样例一次性升级：18090/未启用 → 新默认端口并启用；
    // 错误的 /v1→/v2 或空改写 → 换成 /rest/v1 → /v1 样例
    let changed = false;
    items = items.map((x) => {
      const sample = x && x.name === 'deepseek-flash' && x.mode === 'port'
        && x.target && x.target.host === 'api.deepseek.com';
      if (!sample) return x;
      const patch = {};
      if (x.tlsInsecure !== true) patch.tlsInsecure = true;
      const rewrites = Array.isArray(x.rewrites) ? x.rewrites : [];
      const hasAllSample = NGINX_SAMPLE_REWRITES.every((s) => rewrites.some((r) => r && r.from === s.from && r.to === s.to));
      const hasBad = rewrites.some((r) => r && r.from === '/v1' && r.to === '/v2');
      const onlySample = rewrites.length > 0
        && rewrites.every((r) => r && NGINX_SAMPLE_REWRITES.some((s) => r.from === s.from && r.to === s.to));
      const oldPort = Number(x.listenPort) === 18090;
      if (hasBad || (oldPort && !hasAllSample) || (!hasAllSample && onlySample)) {
        const custom = rewrites.filter((r) => r && r.from !== '/v1'
          && !NGINX_SAMPLE_REWRITES.some((s) => r.from === s.from && r.to === s.to));
        patch.rewrites = [...NGINX_SAMPLE_REWRITES.map((s) => ({ ...s })), ...custom];
      }
      if (oldPort) { patch.listenPort = NGINX_DEFAULT_PORT; patch.enabled = true; }
      if (!Object.keys(patch).length) return x;
      changed = true;
      return { ...x, ...patch, updatedAt: nowIso() };
    });
    if (changed) persist();
    return items;
  }

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ items }, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    loadedMtimeMs = fileMtimeMs();
  }

  function refreshFromDisk() {
    const mtime = fileMtimeMs();
    if (!mtime || mtime <= loadedMtimeMs) return false;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      items = Array.isArray(raw?.items) ? raw.items : [];
      loadedMtimeMs = fileMtimeMs();
      return true;
    } catch {
      return false;
    }
  }

  // 首次（文件不存在）才写入样例；之后用户删光也不会自动加回
  if (seed.length && !fs.existsSync(file)) {
    items = seed.map((input) => {
      const rule = normalizeRule(input);
      return { id: crypto.randomUUID(), ...rule, createdAt: nowIso(), updatedAt: nowIso() };
    });
    persist();
  }

  function checkConflict(list, rule, selfId) {
    const others = list.filter((x) => x.id !== selfId);
    if (rule.mode === 'port') {
      if (rule.enabled && reserved.includes(Number(rule.listenPort))) throw err('port-in-use', 'reserved port (app)');
      const clash = others.some((x) => x.mode === 'port' && x.enabled && rule.enabled
        && x.listenHost === rule.listenHost && x.listenPort === rule.listenPort);
      if (clash) throw err('port-in-use', 'listen port conflict');
    } else {
      const clash = others.some((x) => x.mode === 'path'
        && (x.pathPrefix === rule.pathPrefix
          || x.pathPrefix.startsWith(rule.pathPrefix + '/')
          || rule.pathPrefix.startsWith(x.pathPrefix + '/')));
      if (clash) throw err('bad-request', 'prefix conflict');
    }
  }

  return {
    list() { return load().map((x) => ({ ...x })); },
    refreshFromDisk,
    get(id) {
      const it = load().find((x) => x.id === id);
      if (!it) throw err('not-found');
      return it;
    },
    create(input) {
      const rule = normalizeRule(input);
      checkConflict(load(), rule, null);
      const it = { id: crypto.randomUUID(), ...rule, createdAt: nowIso(), updatedAt: nowIso() };
      load().push(it);
      persist();
      return { ...it };
    },
    update(id, patch) {
      const list = load();
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) throw err('not-found');
      const rule = normalizeRule({ ...list[i], ...patch });
      checkConflict(list, rule, id);
      const it = { ...list[i], ...rule, updatedAt: nowIso() };
      list[i] = it;
      persist();
      return { ...it };
    },
    remove(id) {
      const list = load();
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      persist();
      return true;
    },
  };
}
