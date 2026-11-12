import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MODES = ['port', 'path'];
const RESERVED_PREFIXES = ['/api', '/ws'];
export const DEFAULT_AI_SITE_PORT = 22300;

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }

function normalizePrefix(raw) {
  const s = String(raw == null ? '/ai' : raw).trim();
  if (!/^\/[^/]/.test(s)) throw err('bad-request', 'bad prefix');
  if (s.endsWith('/')) throw err('bad-request', 'bad prefix');
  return s;
}

export function normalizeConfig(input, prev = {}, { isPrefixTaken = () => false, checkRoot = true } = {}) {
  const mode = String(input?.mode ?? prev.mode ?? 'port');
  if (!MODES.includes(mode)) throw err('bad-request', 'bad mode');

  const listenHost = String(input?.listenHost ?? prev.listenHost ?? '0.0.0.0').trim();
  if (!listenHost || /[\s/]/.test(listenHost)) throw err('bad-request', 'bad listen host');

  const listenPort = Number(input?.listenPort ?? prev.listenPort ?? DEFAULT_AI_SITE_PORT);
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) throw err('bad-request', 'bad listen port');

  const requireAuth = input?.requireAuth === undefined ? (prev.requireAuth !== false) : !!input.requireAuth;
  const enabled = input?.enabled === undefined ? !!prev.enabled : !!input.enabled;

  let pluginRoot = String(input?.pluginRoot ?? prev.pluginRoot ?? '').trim();
  if (pluginRoot) {
    pluginRoot = path.resolve(pluginRoot);
    if (checkRoot) {
      let st = null;
      try { st = fs.statSync(pluginRoot); } catch { /* missing */ }
      if (!st || !st.isDirectory()) throw err('bad-static-dir', 'plugin root missing');
    }
  }

  let sessionSecret = String(input?.sessionSecret ?? prev.sessionSecret ?? '').trim();
  if (!sessionSecret) sessionSecret = crypto.randomBytes(24).toString('hex');

  const pathPrefix = normalizePrefix(input?.pathPrefix ?? prev.pathPrefix);
  if (mode === 'path') {
    if (RESERVED_PREFIXES.some((p) => pathPrefix === p || pathPrefix.startsWith(p + '/'))) throw err('bad-request', 'reserved prefix');
    if (isPrefixTaken(pathPrefix)) throw err('bad-request', 'prefix conflict');
  }

  return { pluginRoot, mode, listenHost, listenPort, pathPrefix, requireAuth, enabled, sessionSecret };
}

export function createAiSiteConfigStore({ file, isPrefixTaken = () => false } = {}) {
  let cfg = null;

  function load() {
    if (cfg) return cfg;
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { raw = {}; }
    cfg = normalizeConfig(raw, {}, { isPrefixTaken, checkRoot: false });
    if (!fs.existsSync(file)) persist();
    return cfg;
  }

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  return {
    get() { return { ...load() }; },
    save(patch) {
      cfg = normalizeConfig({ ...load(), ...patch }, load(), { isPrefixTaken });
      persist();
      return { ...cfg };
    },
  };
}
