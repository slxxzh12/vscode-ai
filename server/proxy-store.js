import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PROXY_MODES = ['port', 'path'];
export const RESERVED_PREFIXES = ['/api', '/ws'];

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }
function nowIso() { return new Date().toISOString(); }

export function normalizeRule(input) {
  const mode = String(input?.mode || 'port');
  if (!PROXY_MODES.includes(mode)) throw err('bad-request', 'bad mode');
  const name = String(input?.name || '').trim();
  if (!name) throw err('bad-request', 'name required');
  const listenHost = String(input?.listenHost || '127.0.0.1');
  if (!['127.0.0.1', '0.0.0.0'].includes(listenHost)) throw err('bad-request', 'bad listen host');

  const t = input?.target || {};
  const protocol = String(t.protocol || 'http');
  if (!['http', 'https'].includes(protocol)) throw err('bad-request', 'bad protocol');
  const host = String(t.host || '').trim();
  if (!host) throw err('bad-request', 'target host required');
  const port = Number(t.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw err('bad-request', 'bad target port');

  const headers = Array.isArray(input?.headers)
    ? input.headers.map((h) => ({ name: String(h?.name || '').trim(), value: String(h?.value ?? '') })).filter((h) => h.name)
    : [];

  const base = {
    name, mode, listenHost,
    target: { protocol, host, port },
    tlsInsecure: input?.tlsInsecure !== false,
    headers,
    capture: !!input?.capture,
    enabled: !!input?.enabled,
  };

  if (mode === 'port') {
    const listenPort = Number(input?.listenPort);
    if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) throw err('bad-request', 'bad listen port');
    return { ...base, listenPort, pathPrefix: '', stripPrefix: true };
  }

  const pathPrefix = String(input?.pathPrefix || '').trim();
  if (!/^\/[^/]/.test(pathPrefix)) throw err('bad-request', 'bad prefix');
  if (pathPrefix.endsWith('/')) throw err('bad-request', 'bad prefix');
  if (RESERVED_PREFIXES.some((p) => pathPrefix === p || pathPrefix.startsWith(p + '/'))) throw err('bad-request', 'reserved prefix');
  return { ...base, listenPort: 0, pathPrefix, stripPrefix: input?.stripPrefix !== false };
}

export function createProxyStore({ file }) {
  let items = null;

  function load() {
    if (items) return items;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      items = Array.isArray(raw?.items) ? raw.items : [];
    } catch { items = []; }
    return items;
  }

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ items }, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  function checkConflict(list, rule, selfId) {
    const others = list.filter((x) => x.id !== selfId);
    if (rule.mode === 'port') {
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
