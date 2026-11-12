import http from 'node:http';
import path from 'node:path';
import { createAiSiteConfigStore } from './config-store.js';
import { createAiSiteUsers } from './users.js';
import { createAiSiteRunner } from './runner.js';
import { createAiSiteServe } from './serve.js';
import { createAiSiteMount } from './mount.js';
import { listPlugins } from './plugins.js';

function matchPrefix(prefix, pathname) {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

export function createAiSite({ dir, logger = console, isPrefixTaken = () => false, runnerOptions = {}, onRunState = () => {} } = {}) {
  const configStore = createAiSiteConfigStore({ file: path.join(dir, 'config.json'), isPrefixTaken });
  const users = createAiSiteUsers({ file: path.join(dir, 'users.json') });
  const runner = createAiSiteRunner({ runsDir: path.join(dir, 'runs'), onStateChange: onRunState, ...runnerOptions });
  const serve = createAiSiteServe({ getConfig: () => configStore.get(), users, runner, logger });
  let server = null;
  let state = { status: 'stopped', error: null };

  function matchPath(pathname) {
    const cfg = configStore.get();
    return !!(cfg.enabled && cfg.mode === 'path' && matchPrefix(cfg.pathPrefix, pathname));
  }

  function handleHttp(req, res, url) {
    const cfg = configStore.get();
    const prefix = cfg.mode === 'path' ? cfg.pathPrefix : '';
    let nextUrl = url;
    if (prefix && matchPrefix(prefix, url.pathname)) {
      const stripped = url.pathname.slice(prefix.length) || '/';
      nextUrl = new URL(stripped + url.search, 'http://localhost');
    }
    serve.handle(req, res, nextUrl, { base: prefix });
  }

  async function start() {
    await stop();
    const cfg = configStore.get();
    if (!cfg.enabled || cfg.mode !== 'port') { state = { status: 'stopped', error: null }; return; }
    server = http.createServer((req, res) => {
      let url;
      try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); res.end(); return; }
      serve.handle(req, res, url, { base: '' });
    });
    await new Promise((resolve) => {
      server.once('error', (e) => {
        state = { status: 'error', error: e && e.code === 'EADDRINUSE' ? 'port-in-use' : String((e && e.message) || e) };
        logger?.warn?.(`ai-site listen failed: ${state.error}`);
        server = null;
        resolve();
      });
      server.listen(cfg.listenPort, cfg.listenHost, () => {
        state = { status: 'running', error: null };
        logger?.info?.(`ai-site listening on http://${cfg.listenHost}:${cfg.listenPort}`);
        resolve();
      });
    });
  }

  async function stop() {
    const s = server;
    server = null;
    state = { status: 'stopped', error: null };
    if (!s) return;
    await new Promise((resolve) => { try { s.close(() => resolve()); } catch { resolve(); } });
  }

  async function apply() { await start(); }

  const mount = createAiSiteMount({
    configStore, users, apply,
    status: () => ({ ...state, mode: configStore.get().mode, enabled: configStore.get().enabled }),
    pluginsRoot: () => configStore.get().pluginRoot,
  });

  return {
    configStore, users, runner, serve, mount,
    matchPath, handleHttp, start, stop, apply,
    status: () => ({ ...state }),
    listPlugins: () => listPlugins(configStore.get().pluginRoot),
  };
}
