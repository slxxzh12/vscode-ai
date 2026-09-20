import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signJwt } from './llm-jwt.js';
import { listProviders, getProvider, buildOpencodeConfigMulti, opencodeConfigDir } from './llm-config.js';
import { readActiveConfig, mergeAndWrite } from './llm-opencode-config.js';
import { validateSelections, mergeConfiguredProviders } from './llm-provider-presets.js';
import { createProxyHandler } from './llm-proxy.js';
import { createCache } from './llm-cache.js';
import { loadPlugins, EXAMPLE_PLUGIN, writeExamplePlugin } from './relay-plugins.js';
import { revealInOs } from './reveal.js';
import { buildZip } from './collaboration/zip.js';

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

const INSTALL_BAT = [
  '@echo off',
  'setlocal',
  'set "DEST=%USERPROFILE%\\.config\\opencode"',
  'if not exist "%DEST%" mkdir "%DEST%"',
  'if exist "%DEST%\\opencode.json" copy /Y "%DEST%\\opencode.json" "%DEST%\\opencode.json.bak" >nul',
  'copy /Y "%~dp0opencode.json" "%DEST%\\opencode.json" >nul',
  'echo DevFlow opencode.json installed:',
  'echo   %DEST%\\opencode.json',
  'pause',
  '',
].join('\r\n');

function pickModels(available, asked) {
  if (!asked.length) return available;
  const filtered = available.filter((m) => asked.includes(m));
  return filtered.length ? filtered : asked;
}

function parseSelections(url) {
  const pids = url.searchParams.getAll('pid');
  const models = url.searchParams.getAll('model');
  const byPid = new Map();
  for (let i = 0; i < pids.length; i += 1) {
    const pid = pids[i];
    if (!pid) continue;
    if (!byPid.has(pid)) byPid.set(pid, []);
    const m = models[i];
    if (m) byPid.get(pid).push(m);
  }
  return byPid;
}

function selectionsToProviders(url) {
  const providers = [];
  for (const [pid, asked] of parseSelections(url)) {
    const p = getProvider(pid);
    if (!p || !p.baseURL) continue;
    providers.push({ id: pid, baseURL: p.baseURL, models: pickModels(p.models, asked) });
  }
  return providers;
}

function relayUrl(host, port, pid, baseURL, suffix = '/chat/completions') {
  let basePath = '';
  try { basePath = new URL(baseURL).pathname.replace(/\/+$/, ''); } catch { basePath = ''; }
  return `http://${host}:${port}/api/llm/${encodeURIComponent(pid)}${basePath}${suffix}`;
}

function testPayload(model, stream) {
  const base = { model, messages: [{ role: 'user', content: 'Hello!' }] };
  return JSON.stringify(stream ? { ...base, stream: true } : base);
}

function curlCommand({ host, port, pid, baseURL, jwt, model, stream }) {
  const url = relayUrl(host, port, pid, baseURL);
  const body = JSON.stringify(stream
    ? { model, messages: [{ role: 'user', content: 'Hello!' }], stream: true }
    : { model, messages: [{ role: 'user', content: 'Hello!' }] }).replace(/"/g, '\\"');
  return `curl ${stream ? '-N ' : ''}"${url}" -H "Content-Type: application/json" -H "Authorization: Bearer ${jwt}" -d "${body}"`;
}

function buildTestBat({ host, port, pid, baseURL, jwt, model, stream }) {
  const url = relayUrl(host, port, pid, baseURL);
  return [
    '@echo off',
    'setlocal',
    `set "URL=${url}"`,
    `set "TOKEN=${jwt}"`,
    `>"%TEMP%\\devflow-payload.json" echo ${testPayload(model, stream)}`,
    `curl ${stream ? '-N ' : ''}-s "%URL%" -H "Authorization: Bearer %TOKEN%" -H "Content-Type: application/json" -d @"%TEMP%\\devflow-payload.json"`,
    'echo.',
    'pause',
    '',
  ].join('\r\n');
}

export function createLlmMount({ vault, host, port, logger = console, pluginsDir = null, relayTestsDir = null, opencodeDir = opencodeConfigDir(), cache = createCache(), reveal = revealInOs } = {}) {
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
      if (seg[0] === 'opencode' && !seg[1] && method === 'GET') {
        return sendJson(res, 200, readActiveConfig({ dir: opencodeDir }));
      }
      if (seg[0] === 'opencode' && !seg[1] && method === 'POST') {
        const b = await readJson(req);
        const selections = Array.isArray(b.providers) ? b.providers : [];
        validateSelections(selections);
        const remove = Array.isArray(b.remove) ? b.remove : [];
        const current = readActiveConfig({ dir: opencodeDir }).config?.provider || {};
        const { provider, skipped } = mergeConfiguredProviders({ current, selections, remove });
        const saved = mergeAndWrite({
          dir: opencodeDir,
          provider,
          model: typeof b.model === 'string' ? b.model : '',
        });
        return sendJson(res, 200, { ok: true, path: saved.path, backups: saved.backups, config: saved.config, skipped });
      }
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
        vault.update((d) => { d.jwtSecret = secret; for (const t of d.tokens) t.revoked = true; });
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
        const tokenId = url.searchParams.get('token') || '';
        const rec = vault.getData().tokens.find((t) => t.id === tokenId);
        if (!rec) return sendJson(res, 404, { error: 'token not found' });
        const providers = selectionsToProviders(url);
        if (!providers.length) return sendJson(res, 404, { error: 'provider not found' });
        const config = JSON.stringify(buildOpencodeConfigMulti({ host, port, token: rec.jwt, providers }), null, 2);
        return sendJson(res, 200, { config });
      }
      if (seg[0] === 'opencode-bundle' && method === 'GET') {
        const tokenId = url.searchParams.get('token') || '';
        const rec = vault.getData().tokens.find((t) => t.id === tokenId);
        if (!rec) return sendJson(res, 404, { error: 'token not found' });
        const providers = selectionsToProviders(url);
        if (!providers.length) return sendJson(res, 404, { error: 'provider not found' });
        const config = JSON.stringify(buildOpencodeConfigMulti({ host, port, token: rec.jwt, providers }), null, 2);
        const zip = buildZip([
          { name: 'opencode.json', data: Buffer.from(config, 'utf8') },
          { name: 'Install.bat', data: Buffer.from(INSTALL_BAT, 'utf8') },
        ]);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="devflow-opencode.zip"',
          'Content-Length': zip.length,
        });
        return res.end(zip);
      }
      if (seg[0] === 'test-example' && method === 'GET') {
        const tokenId = url.searchParams.get('token') || '';
        const pid = url.searchParams.get('pid') || '';
        const model = url.searchParams.get('model') || '';
        const rec = vault.getData().tokens.find((t) => t.id === tokenId);
        if (!rec) return sendJson(res, 404, { error: 'token not found' });
        const p = getProvider(pid);
        if (!p || !p.baseURL) return sendJson(res, 404, { error: 'provider not found' });
        const m = model || p.models[0] || '';
        return sendJson(res, 200, {
          nonStream: curlCommand({ host, port, pid, baseURL: p.baseURL, jwt: rec.jwt, model: m, stream: false }),
          stream: curlCommand({ host, port, pid, baseURL: p.baseURL, jwt: rec.jwt, model: m, stream: true }),
        });
      }
      if (seg[0] === 'test-script' && method === 'POST') {
        const b = await readJson(req);
        const rec = vault.getData().tokens.find((t) => t.id === String(b.token || ''));
        if (!rec) return sendJson(res, 404, { error: 'token not found' });
        const pid = String(b.pid || '');
        const p = getProvider(pid);
        if (!p || !p.baseURL) return sendJson(res, 404, { error: 'provider not found' });
        const stream = !!b.stream;
        const model = String(b.model || '') || p.models[0] || '';
        const bat = buildTestBat({ host, port, pid, baseURL: p.baseURL, jwt: rec.jwt, model, stream });
        const dir = relayTestsDir || (pluginsDir ? path.join(path.dirname(pluginsDir), 'relay-tests') : path.join(os.tmpdir(), 'devflow-relay-tests'));
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `test-${pid}-${stream ? 'stream' : 'plain'}.bat`);
        fs.writeFileSync(file, bat, 'utf8');
        return sendJson(res, 200, { path: file });
      }
      return sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      if (e.code === 'bad-passphrase') return sendJson(res, 400, { error: 'bad-passphrase' });
      if (e.code === 'exists') return sendJson(res, 409, { error: 'exists' });
      if (e.code === 'not-init') return sendJson(res, 400, { error: 'not-init' });
      if (e.code === 'bad-config') return sendJson(res, 400, { error: 'bad-config' });
      if (e.code === 'bad-existing') return sendJson(res, 400, { error: 'bad-existing' });
      logger?.warn?.('llm mount error', e && e.message);
      return sendJson(res, 500, { error: 'internal', message: String((e && e.message) || e) });
    }
  }

  mount.reloadPlugins = reloadPlugins;
  mount.ready = reloadPlugins().catch((e) => { logger?.warn?.('relay plugins load failed', e && e.message); return []; });
  return mount;
}
