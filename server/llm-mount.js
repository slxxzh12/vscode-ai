import crypto from 'node:crypto';
import fs from 'node:fs';
import { signJwt } from './llm-jwt.js';
import { listProviders, getProvider, buildOpencodeConfig } from './llm-config.js';
import { createProxyHandler } from './llm-proxy.js';
import { createCache } from './llm-cache.js';
import { loadPlugins, EXAMPLE_PLUGIN, writeExamplePlugin } from './relay-plugins.js';
import { revealInOs } from './reveal.js';

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

export function createLlmMount({ vault, host, port, logger = console, pluginsDir = null, cache = createCache(), reveal = revealInOs } = {}) {
  let plugins = [];
  let entries = [];
  const proxy = createProxyHandler({
    vault,
    getProvider: (id) => getProvider(id),
    isEnabled: () => { try { return !!vault.getData().enabled; } catch { return false; } },
    cache,
    plugins,
    logger,
  });

  async function reloadPlugins() {
    if (!pluginsDir) { plugins = []; entries = []; proxy.setPlugins(plugins); return entries; }
    const loaded = await loadPlugins(pluginsDir);
    plugins = loaded.plugins;
    entries = loaded.entries;
    proxy.setPlugins(plugins);
    return entries;
  }

  async function mount(req, res, url) {
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/llm-admin')) {
      const m = pathname.match(/^\/api\/llm\/([^/]+)(\/.*)?$/);
      if (m) return proxy(req, res, { providerId: decodeURIComponent(m[1]), rest: m[2] || '/', query: url.search.replace(/^\?/, '') });
      return sendJson(res, 404, { error: 'not found' });
    }
    const seg = pathname.replace(/^\/api\/llm-admin\/?/, '').split('/').filter(Boolean);
    const method = req.method;
    const locked = () => !vault.status().unlocked;
    try {
      if (seg[0] === 'status' && method === 'GET') {
        const s = vault.status();
        const lp = listProviders();
        const hasSecret = s.unlocked ? !!vault.getData().jwtSecret : false;
        return sendJson(res, 200, { vault: s, enabled: s.unlocked ? !!vault.getData().enabled : false, hasSecret, host, port, defaultProvider: lp.defaultProvider, providers: lp.providers });
      }
      if (seg[0] === 'plugins' && !seg[1] && method === 'GET') return sendJson(res, 200, { entries, dir: pluginsDir, template: EXAMPLE_PLUGIN });
      if (seg[0] === 'plugins' && seg[1] === 'reveal' && method === 'POST') {
        if (!pluginsDir) return sendJson(res, 400, { error: 'no-plugins-dir' });
        fs.mkdirSync(pluginsDir, { recursive: true });
        return reveal(pluginsDir, true) ? sendJson(res, 200, { ok: true }) : sendJson(res, 501, { error: 'unsupported' });
      }
      if (seg[0] === 'vault' && seg[1] === 'init' && method === 'POST') { const b = await readJson(req); vault.init(String(b.passphrase || '')); return sendJson(res, 200, { ok: true, vault: vault.status() }); }
      if (seg[0] === 'vault' && seg[1] === 'unlock' && method === 'POST') { const b = await readJson(req); vault.unlock(String(b.passphrase || '')); return sendJson(res, 200, { ok: true, vault: vault.status() }); }
      if (seg[0] === 'vault' && seg[1] === 'lock' && method === 'POST') { vault.lock(); return sendJson(res, 200, { ok: true, vault: vault.status() }); }
      if (seg[0] === 'vault' && seg[1] === 'passphrase' && method === 'POST') { const b = await readJson(req); vault.changePassphrase(String(b.old || ''), String(b.new || '')); return sendJson(res, 200, { ok: true }); }
      if (seg[0] === 'vault' && seg[1] === 'reset' && method === 'POST') { return sendJson(res, 200, { ok: true, vault: vault.reset() }); }
      if (locked()) return sendJson(res, 423, { error: 'locked' });
      if (seg[0] === 'plugins' && seg[1] === 'reload' && method === 'POST') return sendJson(res, 200, { entries: await reloadPlugins() });
      if (seg[0] === 'plugins' && seg[1] === 'example' && method === 'POST') {
        if (!pluginsDir) return sendJson(res, 400, { error: 'no-plugins-dir' });
        const file = writeExamplePlugin(pluginsDir);
        return sendJson(res, 200, { entries: await reloadPlugins(), file });
      }
      if (seg[0] === 'enabled' && method === 'POST') { const b = await readJson(req); vault.update((d) => { d.enabled = !!b.enabled; }); return sendJson(res, 200, { ok: true, enabled: !!b.enabled }); }
      if (seg[0] === 'secret' && seg[1] === 'regenerate' && method === 'POST') {
        const secret = crypto.randomBytes(32).toString('base64url');
        vault.update((d) => { d.jwtSecret = secret; });
        return sendJson(res, 200, { ok: true });
      }
      if (seg[0] === 'secret' && !seg[1] && method === 'POST') {
        const b = await readJson(req);
        if (typeof b.secret === 'string' && b.secret) {
          vault.update((d) => { d.jwtSecret = b.secret; });
          return sendJson(res, 200, { ok: true, changed: true });
        }
        if (vault.getData().jwtSecret) return sendJson(res, 200, { ok: true, changed: false });
        const secret = crypto.randomBytes(32).toString('base64url');
        vault.update((d) => { d.jwtSecret = secret; });
        return sendJson(res, 200, { ok: true, changed: true });
      }
      if (seg[0] === 'tokens' && method === 'GET') return sendJson(res, 200, { tokens: vault.getData().tokens });
      if (seg[0] === 'tokens' && method === 'POST') {
        const b = await readJson(req);
        const d = vault.getData();
        if (!d.jwtSecret) return sendJson(res, 400, { error: 'no-secret' });
        const employeeId = String(b.employeeId || '').trim();
        const days = Number(b.days) || 0;
        if (!employeeId || days <= 0) return sendJson(res, 400, { error: 'bad-input' });
        const now = Date.now();
        const exp = Math.floor(now / 1000) + days * 86400;
        const jti = crypto.randomUUID();
        const jwt = signJwt({ sub: employeeId, jti, exp }, d.jwtSecret);
        const rec = { id: crypto.randomUUID(), employeeId, jwt, iat: Math.floor(now / 1000), exp, jti, revoked: false };
        vault.update((x) => { x.tokens.push(rec); });
        return sendJson(res, 200, { ok: true, token: rec });
      }
      if (seg[0] === 'tokens' && seg[1] && method === 'DELETE') {
        const id = decodeURIComponent(seg[1]);
        vault.update((d) => { const t = d.tokens.find((x) => x.id === id); if (t) t.revoked = true; });
        return sendJson(res, 200, { ok: true });
      }
      if (seg[0] === 'opencode-config' && method === 'GET') {
        const providerId = url.searchParams.get('provider') || '';
        const tokenId = url.searchParams.get('token') || '';
        const asked = url.searchParams.getAll('models').flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);
        const d = vault.getData();
        const rec = d.tokens.find((t) => t.id === tokenId);
        if (!rec) return sendJson(res, 404, { error: 'token not found' });
        const p = getProvider(providerId);
        if (!p || !p.baseURL) return sendJson(res, 404, { error: 'provider not found' });
        let models = p.models;
        if (asked.length) {
          const filtered = p.models.filter((m) => asked.includes(m));
          models = filtered.length ? filtered : asked;
        }
        const config = JSON.stringify(buildOpencodeConfig({ host, port, providerId, baseURL: p.baseURL, token: rec.jwt, models }), null, 2);
        return sendJson(res, 200, { config });
      }
      return sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      if (e.code === 'bad-passphrase') return sendJson(res, 400, { error: 'bad-passphrase' });
      if (e.code === 'exists') return sendJson(res, 409, { error: 'exists' });
      if (e.code === 'not-init') return sendJson(res, 400, { error: 'not-init' });
      logger?.warn?.('llm mount error', e && e.message);
      return sendJson(res, 500, { error: 'internal', message: String((e && e.message) || e) });
    }
  }

  mount.reloadPlugins = reloadPlugins;
  mount.ready = reloadPlugins().catch((e) => { logger?.warn?.('relay plugins load failed', e && e.message); return []; });
  return mount;
}
