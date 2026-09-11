import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SessionManager } from './session-manager.js';
import { WorkflowRunner } from './workflow-runner.js';
import { createGateway } from './ws-gateway.js';
import { createHttpApi, requireAuthHttp } from './http-api.js';
import { Projects } from './projects.js';
import { createLogger } from './log.js';
import { createStaticServer } from './static.js';
import { resolveFiles, ensureDefaults, loadProjects, loadWorkflows } from './config.js';
import { CollabStore } from './collaboration/store.js';
import { loadIdentity } from './collaboration/identity.js';
import { CollabEngine } from './collaboration/engine.js';
import { createCollabMount } from './collaboration/http-mount.js';
import { makePeerClient } from './collaboration/peer-client.js';
import { createEventBus } from './collaboration/event-bus.js';
import { CollabS2C } from '@devflow/shared/collab';
import { SchedulerS2C } from '@devflow/shared/scheduler';
import { S2C } from '@devflow/shared';
import { createScheduler } from './scheduler/index.js';
import { defaultConfigFile, loadDevflowConfig, ensureConfigFile, updateServerAttrs, DEFAULT_PORT } from './devflow-config.js';
import { setLocale } from './i18n.js';
import { LOCALES } from '@devflow/shared/i18n';
import { readHistory, writeHistory, appendHistory } from './message-history.js';
import { collabDir, uploadDir, downloadDir, seedFromLegacy, instanceName, instanceSeedDir, instanceFpRoot, dataHome } from './data-home.js';
import { publicFingerprint } from './collaboration/identity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('[server]');
const configFile = defaultConfigFile(path.join(__dirname, '..'));
ensureConfigFile(configFile);
const HOST = process.env.DEVFLOW_HOST || '127.0.0.1';
const PORT = Number(process.env.DEVFLOW_PORT || loadDevflowConfig(configFile).server.port || DEFAULT_PORT);
setLocale(loadDevflowConfig(configFile).server.language);

process.on('uncaughtException', (err) => log.error('uncaughtException', err));   // 三层兜底 #3
process.on('unhandledRejection', (err) => log.error('unhandledRejection', err));

// requireAuth 占位钩子（spec §11）：HTTP 用 requireAuthHttp，WS 走 upgrade 处的 requireAuthWs
const requireAuthWs = () => true; // TODO(安全): 接入 Token 后校验 ws 握手

let gateway = null;                                  // createGateway 赋值（档案就绪后）
const broadcastCollab = (type, payload) => {
  if (!gateway) return;
  for (const c of gateway.conns) c.send({ type, ...payload });
};
const broadcastSched = (type, payload) => {
  if (!gateway) return;
  for (const c of gateway.conns) c.send({ type, ...payload });
};

// ---- 由档案路径构建所有数据模块（不监听端口、不建 gateway）----
function buildWorkspace({ paths, port }) {
  const projectsFile = process.env.DEVFLOW_PROJECTS || paths.projectsFile;
  const workflowsFile = process.env.DEVFLOW_WORKFLOWS || paths.workflowsFile;
  ensureDefaults(projectsFile, workflowsFile);
  const projects = new Projects({ projects: loadProjects(projectsFile), logger: log });
  const saveProjects = () => {
    try { fs.writeFileSync(projectsFile, JSON.stringify({ projects: projects.rawProjects() }, null, 2), 'utf8'); }
    catch (e) { log.warn?.('save projects failed', e && e.message); }
  };
  const workflows = loadWorkflows(workflowsFile);
  const sessionManager = new SessionManager({
    logger: log,
    projectResolver: (id) => projects.listProjects().find((p) => p.id === id)?.root ?? null,
  });
  const workflowRunner = new WorkflowRunner({ sessionManager, workflows, logger: log });

  const identity = loadIdentity({ file: paths.identityFile, host: HOST, port });
  const eventBus = createEventBus();
  const engine = new CollabEngine({
    store: new CollabStore({ file: paths.storeFile, logger: log }),
    identity,
    skillsRoot: paths.skillsRoot,
    uploadDir: paths.uploadDir,
    downloadDir: paths.downloadDir,
    events: eventBus,
    logger: log,
  });
  engine.peer = makePeerClient();
  const collabMount = createCollabMount({ engine, logger: log });
  eventBus.on('friend-request', (payload) => broadcastCollab(CollabS2C.COLLAB_FRIEND_REQ, payload));
  eventBus.on('group-invite', (payload) => broadcastCollab(CollabS2C.COLLAB_GROUP_INVITE, payload));
  eventBus.on('inbox', (payload) => broadcastCollab(CollabS2C.COLLAB_INBOX, payload));
  eventBus.on('synced', () => broadcastCollab(CollabS2C.COLLAB_SYNCED, {}));
  eventBus.on('chat', (payload) => broadcastCollab(CollabS2C.COLLAB_CHAT, { groupId: payload.groupId, msg: payload.msg }));
  eventBus.on('cmd-pending', (payload) => broadcastCollab(CollabS2C.COLLAB_CMD_PENDING, payload));

  const scheduler = createScheduler({
    dir: paths.schedulerDir,
    projectResolver: (id) => projects.listProjects().find((p) => p.id === id)?.root ?? null,
    logger: log,
  });
  scheduler.engine.onEvent((evt, payload) => {
    const type = evt === 'run-start' ? SchedulerS2C.SCHED_RUN_START
      : evt === 'run-end' ? SchedulerS2C.SCHED_RUN_END
      : SchedulerS2C.SCHED_TASKS_CHANGED;
    broadcastSched(type, payload);
  });

  const httpApi = createHttpApi({ projects, saveProjects, logger: log });
  return { projects, saveProjects, workflows, sessionManager, workflowRunner, engine, collabMount, scheduler, httpApi, historyFile: paths.historyFile, paths };
}

const HOST_DEFAULT = process.env.DEVFLOW_HOST || '127.0.0.1';
const PORT_DEFAULT = Number(process.env.DEVFLOW_PORT || 22222);
const NODE = instanceName();

// 默认实例（未设 DEVFLOW_NODE）沿用老布局 <root>/collab + <root>/upload|download。
function legacyPaths() {
  const COLLAB_DIR = collabDir();
  seedFromLegacy(path.join(COLLAB_DIR, 'identity.json'), path.join(__dirname, 'collaboration', 'identity.json'));
  seedFromLegacy(path.join(COLLAB_DIR, 'collab.json'), path.join(__dirname, 'collaboration', 'collab.json'));
  const files = resolveFiles();
  return {
    id: 'default',
    identityFile: path.join(COLLAB_DIR, 'identity.json'),
    storeFile: path.join(COLLAB_DIR, 'collab.json'),
    uploadDir: uploadDir(),
    downloadDir: downloadDir(),
    skillsRoot: process.env.DEVFLOW_COLLAB_SKILLS || path.join(os.homedir(), '.config', 'opencode', 'skills'),
    projectsFile: files.projectsFile,
    workflowsFile: files.workflowsFile,
    schedulerDir: path.join(dataHome(), 'scheduler'),
    historyFile: null,   // 按公钥指纹补
  };
}

const _seedPaths = legacyPaths();
const _seedIdentity = loadIdentity({ file: _seedPaths.identityFile, host: HOST_DEFAULT, port: PORT_DEFAULT });
const nodeFp = publicFingerprint(_seedIdentity.publicKey);
_seedPaths.historyFile = path.join(instanceFpRoot(nodeFp), 'message-history.jsonc');
let ws = buildWorkspace({ paths: _seedPaths, port: PORT_DEFAULT });

const server = http.createServer(async (req, res) => {
  if (!(await requireAuthHttp(req, res))) { res.writeHead(401); res.end(); return; }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/workflows-xml' && req.method === 'GET') {
    const workflows = loadDevflowConfig(configFile).workflows;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ workflows }));
    return;
  }
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    const c = loadDevflowConfig(configFile);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ default: c.agents.default, agents: c.agents.list }));
    return;
  }
  if (url.pathname === '/api/settings' && req.method === 'GET') {
    const s = loadDevflowConfig(configFile).server;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ settings: s, envPort: process.env.DEVFLOW_PORT || null, currentPort: PORT }));
    return;
  }
  if (url.pathname === '/api/settings' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const port = Number(body.port);
      if (!port || port < 1 || port > 65535) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid port' })); return; }
      const next = updateServerAttrs(configFile, { port });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ settings: next, needRestart: true }));
    });
    return;
  }
  if (url.pathname === '/api/settings/language' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      if (!LOCALES.includes(body.language)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid language' }));
        return;
      }
      updateServerAttrs(configFile, { language: body.language });
      setLocale(body.language);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ language: body.language }));
    });
    return;
  }
  if (url.pathname === '/api/history' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ messages: readHistory(ws.historyFile), file: ws.historyFile }));
    return;
  }
  if (url.pathname === '/api/history' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      let messages;
      if (typeof body.append === 'string') messages = appendHistory(ws.historyFile, body.append);
      else if (Array.isArray(body.messages)) messages = writeHistory(ws.historyFile, body.messages);
      else { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'messages[] or append required' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ messages }));
    });
    return;
  }
  if (url.pathname.startsWith('/api/collab')) { await ws.collabMount(req, res); return; }
  if (url.pathname.startsWith('/api/scheduler')) { await ws.scheduler.mount(req, res); return; }
  if (url.pathname.startsWith('/api/')) {
    await ws.httpApi(req, res);
    return;
  }
  createStaticServer(path.join(__dirname, '..', 'web', 'dist'))(req, res, () => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
});

gateway = createGateway({ httpServer: server, sessionManager: ws.sessionManager, workflowRunner: ws.workflowRunner, requireAuthWs, log });

// 配置热重载：config/devflow.xml 变更 → 重载语言并向已连浏览器推送（端口需重启才生效）
try {
  let cfgTimer = null;
  fs.watch(configFile, () => {
    clearTimeout(cfgTimer);
    cfgTimer = setTimeout(() => {
      try {
        const c = loadDevflowConfig(configFile);
        setLocale(c.server.language);
        for (const conn of (gateway?.conns || [])) conn.send({ type: S2C.CONFIG_CHANGED });
        log.info('config/devflow.xml reloaded');
      } catch (e) { log.warn?.('config reload failed', e && e.message); }
    }, 300);
  });
} catch (e) { log.warn?.('config watch failed', e && e.message); }

// 端口占用时自动回退：默认端口 → 33333 → 44444
const CANDIDATE_PORTS = [...new Set([PORT, 33333, 44444])].filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535);
let listenAttempt = 0;
function writeRuntimePort(port) {
  try { fs.writeFileSync(path.join(__dirname, '..', 'config', 'runtime-port.txt'), String(port), 'utf8'); } catch { /* ignore */ }
}
function startListening() {
  if (listenAttempt >= CANDIDATE_PORTS.length) {
    log.error(`all candidate ports are in use: ${CANDIDATE_PORTS.join(', ')}`);
    process.exit(1);
  }
  const port = CANDIDATE_PORTS[listenAttempt++];
  const onError = (err) => {
    server.removeListener('listening', onListening);
    if (err && err.code === 'EADDRINUSE') { log.warn?.(`port ${port} in use, trying next`); startListening(); }
    else { log.error('listen error', err); process.exit(1); }
  };
  const onListening = () => {
    server.removeListener('error', onError);
    const actual = server.address().port;
    ws.engine.setAdvertised({ host: HOST, port: actual });
    writeRuntimePort(actual);
    log.info(`listening on http://${HOST}:${actual}  (ws: ws://${HOST}:${actual}/ws)`);
    log.info(`collab node=${NODE || 'default'} fp=${nodeFp} store=${ws.paths.storeFile}`);
    if (!['0', 'off', 'false'].includes(String(process.env.DEVFLOW_SCHEDULER || '').toLowerCase())) {
      ws.scheduler.engine.start();
      log.info('scheduler started');
    }
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, HOST);
}
startListening();

export { server };
