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
import { ensureDefaults, loadProjects, loadWorkflows } from './config.js';
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
import { dataHome, instanceName, instanceSeedDir, instanceFpRoot } from './data-home.js';
import { publicFingerprint } from './collaboration/identity.js';
import {
  migrateLegacy, resolveProfile, createProfile, bindProfile, touchProfile,
  profilePaths, createWorkspaceService,
} from './workspace.js';
import { createWorkspaceHttp } from './workspace-http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('[server]');
const configFile = defaultConfigFile(path.join(__dirname, '..'));
ensureConfigFile(configFile);
const HOST = process.env.DEVFLOW_HOST || '127.0.0.1';
const PORT = Number(process.env.DEVFLOW_PORT || loadDevflowConfig(configFile).server.port || DEFAULT_PORT);
setLocale(loadDevflowConfig(configFile).server.language);
const NODE = instanceName();

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

// ---- 工作区（端口档案）----
let ws = null;               // ready 后指向 bundle
let actualPort = null;       // 实际监听端口
let workspaceHttp = null;    // needs-selection 时可用

function initWorkspace(paths, port) {
  ws = buildWorkspace({ paths, port });
  actualPort = port;
  if (!gateway) {
    gateway = createGateway({ httpServer: server, sessionManager: ws.sessionManager, workflowRunner: ws.workflowRunner, requireAuthWs, log });
  }
  ws.engine.setAdvertised({ host: HOST, port });
  if (!['0', 'off', 'false'].includes(String(process.env.DEVFLOW_SCHEDULER || '').toLowerCase())) {
    ws.scheduler.engine.start();
    log.info('scheduler started');
  }
  log.info(`workspace ready: profile=${paths.id} port=${port}`);
}

const server = http.createServer(async (req, res) => {
  if (!(await requireAuthHttp(req, res))) { res.writeHead(401); res.end(); return; }
  const url = new URL(req.url, 'http://localhost');

  // 工作区选择（永远可用）
  if (url.pathname.startsWith('/api/workspace')) {
    if (!ws && workspaceHttp) { await workspaceHttp(req, res, url); return; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ready: true, needSelect: false, listenPort: actualPort, current: ws ? ws.paths.id : null, profiles: [] }));
    return;
  }

  // 配置类接口永远可用（不依赖档案）
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

  // 未就绪：其余 /api/* 返回 409，静态页仍可打开以显示选择弹窗
  if (url.pathname.startsWith('/api/') && !ws) {
    res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not-ready' }));
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
    actualPort = actual;
    writeRuntimePort(actual);
    log.info(`listening on http://${HOST}:${actual}  (ws: ws://${HOST}:${actual}/ws)`);

    if (NODE) {   // 逃生通道：沿用 nodes/<name> 机制，不进入端口档案系统
      const seedDir = instanceSeedDir(NODE);
      const identity = loadIdentity({ file: path.join(seedDir, 'identity.json'), host: HOST, port: actual });
      const stateRoot = instanceFpRoot(publicFingerprint(identity.publicKey));
      const paths = {
        id: `node-${NODE}`,
        dir: stateRoot,
        identityFile: path.join(seedDir, 'identity.json'),
        storeFile: path.join(stateRoot, 'collab.json'),
        uploadDir: path.join(stateRoot, 'upload'),
        downloadDir: path.join(stateRoot, 'download'),
        skillsRoot: process.env.DEVFLOW_COLLAB_SKILLS || path.join(stateRoot, 'skills-opencode'),
        projectsFile: path.join(dataHome(), 'projects.json'),
        workflowsFile: path.join(dataHome(), 'workflows.json'),
        schedulerDir: path.join(dataHome(), 'scheduler'),
        historyFile: path.join(stateRoot, 'message-history.jsonc'),
      };
      fs.mkdirSync(paths.uploadDir, { recursive: true });
      fs.mkdirSync(paths.downloadDir, { recursive: true });
      fs.mkdirSync(paths.skillsRoot, { recursive: true });
      initWorkspace(paths, actual);
      return;
    }

    migrateLegacy(dataHome());      // 首次：复制旧数据为档案 22222
    const r = resolveProfile({ listenPort: actual });
    if (r.status === 'ready') {
      const prof = r.profile || createProfile(dataHome(), { id: String(actual), name: `端口 ${actual}`, port: actual });
      bindProfile(dataHome(), actual, prof.id);
      touchProfile(dataHome(), prof.id);
      initWorkspace(profilePaths(dataHome(), prof.id), actual);
    } else {
      const service = createWorkspaceService({
        root: dataHome(), listenPort: actual,
        onProfile: (paths) => initWorkspace(paths, actual),
        logger: log,
      });
      workspaceHttp = createWorkspaceHttp({ service });
      log.info(`workspace: ${r.profiles.length} profiles found, awaiting selection`);
    }
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, HOST);
}
startListening();

export { server };
