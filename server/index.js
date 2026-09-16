import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
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
import { loadIdentity, detectHost } from './collaboration/identity.js';
import { CollabEngine } from './collaboration/engine.js';
import { createCollabMount } from './collaboration/http-mount.js';
import { makePeerClient } from './collaboration/peer-client.js';
import { createEventBus } from './collaboration/event-bus.js';
import { UsagePeersStore } from './usage-peers.js';
import { createUsageReporter } from './usage-report.js';
import { createUsageMount } from './usage-mount.js';
import { loadInvite, saveInvite, clearInvite, isInviteActive } from './remote-invite.js';
import { CollabS2C } from '@devflow/shared/collab';
import { SchedulerS2C } from '@devflow/shared/scheduler';
import { S2C } from '@devflow/shared';
import { createScheduler } from './scheduler/index.js';
import { resolveActiveConfigFile, loadDevflowConfig, ensureConfigFile, updateServerAttrs, parseDevflowConfig, updateWorkflows } from './devflow-config.js';
import { readSeed, updateSeed } from './workflow-seed.js';
import { setLocale, t } from './i18n.js';
import { isPeerRequest, matchAccessToken, resolveInviteDaysAllowForever } from './remote-gate.js';
import { LOCALES } from '@devflow/shared/i18n';
import { readHistory, writeHistory, appendHistory } from './message-history.js';
import { instanceName, instanceSeedDir, instanceFpRoot } from './data-home.js';
import { APP_DIR, resolvePort, validPort, writePortFile, writeRuntimePort, readPortFile } from './port-file.js';
import { seedPlugins } from './relay-plugins.js';
import { publicFingerprint } from './collaboration/identity.js';
import { createVault } from './llm-vault.js';
import { createUsageStore, normalizeUsage } from './usage-store.js';
import { createLlmMount } from './llm-mount.js';
import { detectEmployeeId } from './llm-config.js';
import { portPaths, ensurePortDirs } from './port-paths.js';
import { restartGuard, spawnRestart } from './port-restart.js';
import { askPortConflict } from './native-dialog.js';
import { findPidsOnPort, killPids, isPortFree } from './port-conflict.js';
import { VERSION } from './version.js';
import { createNotice } from './notice.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('[server]');
const notice = createNotice();
let configFile = resolveActiveConfigFile(APP_DIR, resolvePort());
let BOOT_CFG = loadDevflowConfig(configFile);
const HOST = process.env.DEVFLOW_HOST || BOOT_CFG.server.host || '127.0.0.1';
const PORT = resolvePort();
const PORT_SOURCE = validPort(process.env.DEVFLOW_PORT) ? 'env' : (readPortFile() ? 'file' : 'default');
setLocale(BOOT_CFG.server.language);
const NODE = instanceName();

process.on('uncaughtException', (err) => log.error('uncaughtException', err));   // 三层兜底 #3
process.on('unhandledRejection', (err) => log.error('unhandledRejection', err));

// ---- 远程访问门禁：非回环客户端必须持邀请令牌（?access=token → HttpOnly Cookie）----
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function isLocalReq(req) {
  const ip = (req.socket && req.socket.remoteAddress) || '';
  return LOOPBACK.has(ip) || ip.startsWith('127.');
}
function parseCookies(req) {
  const out = {};
  const raw = (req.headers && req.headers.cookie) || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const ACCESS_COOKIE = 'devflow-access';
const MAX_TTL_MS = 100 * 24 * 3600 * 1000;   // 密码/链接最长 100 天
const LOCK_MS = 5 * 60 * 1000;             // 连续错误锁定 5 分钟
const MAX_FAILS = 5;
let remoteInvite = null;   // { token, password, expiresAt }（内存态，重启即失效）
let remoteFails = 0;
let remoteLockedUntil = 0;
function activeInvite() { return isInviteActive(remoteInvite, Date.now()) ? remoteInvite : null; }
function remoteLocked() { return Date.now() < remoteLockedUntil; }
function remoteAllowed(req) {
  const inv = activeInvite();
  if (!inv) return false;
  return parseCookies(req)[ACCESS_COOKIE] === inv.token;
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}
function lanAddress() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of (ifs[name] || [])) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}
function inviteLink(inv) {
  const addr = lanAddress() || HOST;
  return { address: addr, link: `http://${addr}:${actualPort || PORT}/?access=${inv.token}` };
}
function pageShell(title, body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,Segoe UI,sans-serif;background:#1e1e1e;color:#ddd;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.box{max-width:520px;padding:28px 32px;background:#252526;border:1px solid #3c3c3c;border-radius:10px;text-align:center}.box h1{font-size:18px;margin:0 0 12px}.box p{color:#aaa;line-height:1.7;font-size:13px}.box input{width:100%;box-sizing:border-box;margin:14px 0 10px;padding:10px 12px;background:#1e1e1e;border:1px solid #3c3c3c;border-radius:6px;color:#eee;font-size:14px}.box button{width:100%;padding:10px;background:#0e639c;border:none;border-radius:6px;color:#fff;font-size:14px;cursor:pointer}.err{color:#f48771;margin-top:10px}</style></head><body><div class="box"><h1>${title}</h1>${body}</div></body></html>`;
}
function remoteBlockPage() {
  return pageShell(t('remote.block_title'), `<p>${t('remote.need_invite')}</p>`);
}
function remoteLoginPage(showError) {
  const lockedMs = remoteLocked() ? remoteLockedUntil - Date.now() : 0;
  const note = lockedMs > 0
    ? `<p class="err">${t('remote.login_locked', { min: Math.ceil(lockedMs / 60000) })}</p>`
    : (showError ? `<p class="err">${t('remote.login_wrong')}</p>` : '');
  const dis = lockedMs > 0 ? ' disabled' : '';
  return pageShell(t('remote.login_title'),
    `<p>${t('remote.login_hint')}</p><form method="POST" action="/__access"><input type="password" name="password" autocomplete="off" placeholder="${t('remote.password')}"${dis} /><button type="submit"${dis}>${t('remote.login_submit')}</button></form>${note}`);
}

// requireAuth 占位钩子（spec §11）：HTTP 用 requireAuthHttp；WS 走 upgrade 处，远程需邀请 Cookie
const requireAuthWs = (req) => {
  if (isLocalReq(req)) return true;
  return remoteAllowed(req);
};

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

  const identity = loadIdentity({ file: paths.identityFile, employeeId: detectEmployeeId(), host: HOST, port });
  const eventBus = createEventBus();
  const engine = new CollabEngine({
    store: new CollabStore({ file: paths.storeFile, logger: log }),
    identity,
    peers: new UsagePeersStore({ file: paths.usagePeersFile, logger: log }),
    skillsRoot: paths.skillsRoot,
    uploadDir: paths.uploadDir,
    downloadDir: paths.downloadDir,
    downloadsDir: paths.downloadsDir,
    syncDir: path.join(paths.dir, 'sync'),
    events: eventBus,
    logger: log,
    getWorkflows: () => loadDevflowConfig(configFile).workflows,
    mergeWorkflows: (incoming) => {
      const cur = loadDevflowConfig(configFile).workflows;
      const byId = new Map(cur.map((w) => [w.id, w]));
      for (const w of incoming) if (w && w.id) byId.set(w.id, w);
      return updateWorkflows(configFile, [...byId.values()]);
    },
  });
  engine.peer = makePeerClient();
  const collabMount = createCollabMount({ engine, logger: log });
  const usagePeers = engine.peers;
  const usageReporter = createUsageReporter({
    file: paths.usageReportFile,
    identity: () => ({ ...engine.pub }),
    cmd: ((BOOT_CFG.agents.list || []).find((a) => a.id === BOOT_CFG.agents.default) || {}).cmd || 'opencode',
    logger: log,
  });
  const usageMount = createUsageMount({
    peers: usagePeers,
    reporter: usageReporter,
    checkToken: (tk) => { const inv = activeInvite(); return !!inv && safeEqual(tk, inv.token); },
    onReport: () => {
      engine.writeDownload?.('usage.json', Buffer.from(JSON.stringify(usagePeers.snapshot(), null, 2)), 'usage');
      broadcastCollab(CollabS2C.COLLAB_HEARTBEAT, {});
    },
    logger: log,
  });
  eventBus.on('friend-request', (payload) => broadcastCollab(CollabS2C.COLLAB_FRIEND_REQ, payload));
  eventBus.on('group-invite', (payload) => broadcastCollab(CollabS2C.COLLAB_GROUP_INVITE, payload));
  eventBus.on('inbox', (payload) => broadcastCollab(CollabS2C.COLLAB_INBOX, payload));
  eventBus.on('synced', () => broadcastCollab(CollabS2C.COLLAB_SYNCED, {}));
  eventBus.on('chat', (payload) => broadcastCollab(CollabS2C.COLLAB_CHAT, { groupId: payload.groupId, msg: payload.msg }));
  eventBus.on('cmd-pending', (payload) => broadcastCollab(CollabS2C.COLLAB_CMD_PENDING, payload));
  eventBus.on('heartbeat', () => broadcastCollab(CollabS2C.COLLAB_HEARTBEAT, {}));

  const scheduler = createScheduler({
    dir: paths.schedulerDir,
    projectResolver: (id) => projects.listProjects().find((p) => p.id === id)?.root ?? null,
    logger: log,
    opencodeDataDir: path.join(paths.dir, 'opencode-data'),
  });
  scheduler.engine.onEvent((evt, payload) => {
    const type = evt === 'run-start' ? SchedulerS2C.SCHED_RUN_START
      : evt === 'run-end' ? SchedulerS2C.SCHED_RUN_END
      : SchedulerS2C.SCHED_TASKS_CHANGED;
    broadcastSched(type, payload);
  });

  const httpApi = createHttpApi({ projects, saveProjects, logger: log, repoRoot: path.join(__dirname, '..') });
  const llmVault = createVault({ file: path.join(paths.dir, 'llm.vault.json') });
  seedPlugins(paths.relayPluginsDir, path.join(__dirname, '..', 'config', 'relay-plugins'));
  const llmMount = createLlmMount({ vault: llmVault, host: detectHost(), port, logger: log, pluginsDir: paths.relayPluginsDir, relayTestsDir: path.join(paths.downloadsDir, 'relay-tests') });
  const usageStore = createUsageStore({ file: path.join(paths.dir, 'usage.db') });
  return { projects, saveProjects, workflows, sessionManager, workflowRunner, engine, collabMount, usageMount, usageReporter, scheduler, httpApi, llmMount, llmVault, usageStore, historyFile: paths.historyFile, paths };
}

// ---- 工作区（端口档案）----
let ws = null;               // ready 后指向 bundle
let actualPort = null;       // 实际监听端口

function initWorkspace(paths, port) {
  ws = buildWorkspace({ paths, port });
  actualPort = port;
  // 远程访问令牌校验注入：slave 入群时校对本机活跃邀请
  ws.engine.verifyAccessToken = (tk) => { const inv = activeInvite(); return !!inv && safeEqual(tk, inv.token); };
  if (!gateway) {
    gateway = createGateway({ httpServer: server, sessionManager: ws.sessionManager, workflowRunner: ws.workflowRunner, requireAuthWs, log });
  }
  ws.engine.setAdvertised({ host: HOST, port });
  remoteInvite = loadInvite(paths.inviteFile);   // 令牌落盘：重启后仍有效（expiresAt=0 为长期）
  // 用量上报：启动即报一次，之后 60–90 分钟随机再报
  if (ws.usageReporter) { ws.usageReporter.stop(); ws.usageReporter.start(); }
  if (!['0', 'off', 'false'].includes(String(process.env.DEVFLOW_SCHEDULER || '').toLowerCase())) {
    ws.scheduler.engine.start();
    log.info('scheduler started');
  }
  log.info(`workspace ready: port=${port} dataDir=${paths.dir}`);
}

const server = http.createServer(async (req, res) => {
  if (!(await requireAuthHttp(req, res))) { res.writeHead(401); res.end(); return; }
  const url = new URL(req.url, 'http://localhost');

  // 远程访问门禁：非回环客户端必须持有效 Cookie；否则需输入一次性访问密码
  if (!isLocalReq(req)) {
    // ?access=<token> 免密换 Cookie（首次带链接访问）
    const access = url.searchParams.get('access');
    const invAccess = activeInvite();
    if (matchAccessToken(access, invAccess, safeEqual)) {
      const maxAge = Math.max(0, Math.floor((invAccess.expiresAt - Date.now()) / 1000));
      const clean = new URL(req.url, 'http://localhost');
      clean.searchParams.delete('access');
      res.writeHead(302, { 'Set-Cookie': `${ACCESS_COOKIE}=${invAccess.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`, Location: clean.pathname + (clean.search ? clean.search : '') });
      res.end();
      return;
    }
    // 机器↔机器 peer 端点豁免 Cookie 门禁（鉴权交给信封签名 + 令牌/成员校验）
    if (!isPeerRequest(url.pathname, req.method)) {
      const inv = activeInvite();
      if (!inv) {
        if (url.pathname.startsWith('/api/')) {
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'remote-disabled' }));
          return;
        }
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(remoteBlockPage());
        return;
      }
      if (!remoteAllowed(req)) {
        if (url.pathname === '/__access' && req.method === 'POST') {
          let body = '';
          req.on('data', (c) => { body += c; });
          req.on('end', () => {
            if (remoteLocked()) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(remoteLoginPage(true)); return; }
            const pw = new URLSearchParams(body).get('password') || '';
            if (safeEqual(pw, inv.password)) {
              remoteFails = 0;
              const maxAge = Math.max(0, Math.floor((inv.expiresAt - Date.now()) / 1000));
              res.writeHead(302, { 'Set-Cookie': `${ACCESS_COOKIE}=${inv.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`, Location: '/' });
              res.end();
            } else {
              remoteFails += 1;
              if (remoteFails >= MAX_FAILS) { remoteLockedUntil = Date.now() + LOCK_MS; remoteFails = 0; }
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(remoteLoginPage(true));
            }
          });
          return;
        }
        if (url.pathname.startsWith('/api/')) {
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'remote-auth-required' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(remoteLoginPage(false));
        return;
      }
    }
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
  if (url.pathname === '/api/version' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ version: VERSION }));
    return;
  }
  if (url.pathname === '/api/notice' && req.method === 'GET') {
    const r = await notice.get(url.searchParams.get('lang'));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(r));
    return;
  }
  if (url.pathname === '/api/settings' && req.method === 'GET') {
    const s = loadDevflowConfig(configFile).server;
    const canRestart = restartGuard({ appDir: APP_DIR }).ok;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ settings: { ...s, port: PORT }, envPort: process.env.DEVFLOW_PORT || null, currentPort: PORT, host: HOST, portSource: PORT_SOURCE, restartable: canRestart }));
    return;
  }
  if (url.pathname === '/api/settings' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const port = validPort(body.port);
      if (!port) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid port' })); return; }
      try {
        writePortFile(port);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'port-save-failed', message: String(e && e.message || e) }));
        return;
      }
      log.info(t('term.port_saved'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ port, needRestart: true }));
    });
    return;
  }
  if (url.pathname === '/api/server/restart' && req.method === 'POST') {
    const g = restartGuard({ appDir: APP_DIR });
    if (!g.ok) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: g.code, message: g.message }));
      return;
    }
    spawnRestart({ appDir: APP_DIR });
    log.info('restart requested; exiting so the launcher can bring it back');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, restarting: true }));
    setTimeout(() => process.exit(0), 300);
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
  if (url.pathname === '/api/remote/state' && req.method === 'GET') {
    const inv = activeInvite();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      enabled: !!inv,
      host: HOST,
      port: actualPort || PORT,
      expiresAt: inv ? inv.expiresAt : null,
      forever: !!inv && inv.expiresAt === 0,
      address: lanAddress(),
      needRestart: HOST === '127.0.0.1' || HOST === 'localhost',
      locked: remoteLocked(),
      lockedUntil: remoteLocked() ? remoteLockedUntil : null,
    }));
    return;
  }
  if (url.pathname === '/api/remote/reveal' && req.method === 'GET') {
    if (!isLocalReq(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'local-only' }));
      return;
    }
    const inv = activeInvite();
    if (!inv) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ enabled: false }));
      return;
    }
    const { address, link } = inviteLink(inv);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ enabled: true, password: inv.password, token: inv.token, link, address, expiresAt: inv.expiresAt, forever: inv.expiresAt === 0 }));
    return;
  }
  if (url.pathname === '/api/remote/invite' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const days = resolveInviteDaysAllowForever(body);   // days=0 = 长期不过期；缺省 1 天，最长 100 天
      const token = crypto.randomBytes(24).toString('hex');
      const password = crypto.randomBytes(16).toString('base64url');        // 22 字符，≥16
      remoteInvite = { token, password, expiresAt: days === 0 ? 0 : Date.now() + Math.min(days * 24 * 3600 * 1000, MAX_TTL_MS) };
      saveInvite(paths.inviteFile, remoteInvite);
      remoteFails = 0;
      remoteLockedUntil = 0;
      let needRestart = false;
      // 仍是本机监听时，自动改为 0.0.0.0（需重启生效）
      if (!process.env.DEVFLOW_HOST && (HOST === '127.0.0.1' || HOST === 'localhost')) {
        updateServerAttrs(configFile, { host: '0.0.0.0' });
        needRestart = true;
      }
      if (ws && ws.engine) ws.engine.ensureGroup();
      const { address: addr, link } = inviteLink(remoteInvite);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ enabled: true, token, password, days, expiresAt: remoteInvite.expiresAt, link, address: addr, needRestart }));
    });
    return;
  }
  if (url.pathname === '/api/remote/revoke' && req.method === 'POST') {
    remoteInvite = null;
    clearInvite(paths.inviteFile);
    remoteFails = 0;
    remoteLockedUntil = 0;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ enabled: false }));
    return;
  }
  if (url.pathname === '/api/config/xml' && req.method === 'GET') {
    ensureConfigFile(configFile);
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(fs.readFileSync(configFile, 'utf8'));
    return;
  }
  if (url.pathname === '/api/config/xml' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const xml = typeof body.xml === 'string' ? body.xml : '';
      if (!xml || !/<devflow\b/i.test(xml)) {
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid config xml' })); return;
      }
      const parsed = parseDevflowConfig(xml);
      fs.writeFileSync(configFile, xml, 'utf8');
      try { updateSeed(configFile, loadDevflowConfig(configFile).workflows); } catch { /* ignore */ }
      setLocale(parsed.server.language);
      for (const conn of (gateway?.conns || [])) conn.send({ type: S2C.CONFIG_CHANGED });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, workflows: parsed.workflows }));
    });
    return;
  }
  if (url.pathname === '/api/workflows-seed' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(readSeed(configFile)));
    return;
  }
  if (url.pathname === '/api/workflows' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      let saved;
      try { saved = updateWorkflows(configFile, body.workflows); }
      catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid workflows', message: String(e && e.message || e) })); return; }
      for (const conn of (gateway?.conns || [])) conn.send({ type: S2C.CONFIG_CHANGED });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ workflows: saved }));
    });
    return;
  }

  // 用量统计：按天写入 SQLite，存于当前端口档案目录（与个人数据一起按端口隔离）
  if (url.pathname === '/api/usage' && req.method === 'POST') {
    if (!ws) { res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'workspace-not-ready' })); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const { record, error } = normalizeUsage(body);
      if (error) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error })); return; }
      ws.usageStore.upsert(record);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, date: record.date }));
    });
    return;
  }
  if (url.pathname === '/api/usage' && req.method === 'GET') {
    if (!ws) { res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'workspace-not-ready' })); return; }
    const rows = ws.usageStore.query({
      from: url.searchParams.get('from') || undefined,
      to: url.searchParams.get('to') || undefined,
      memberId: url.searchParams.get('memberId') || undefined,
      agent: url.searchParams.get('agent') || undefined,
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ usage: rows }));
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
  if (url.pathname.startsWith('/api/llm')) { await ws.llmMount(req, res, url); return; }
  if (url.pathname.startsWith('/api/collab')) { await ws.collabMount(req, res); return; }
  if (url.pathname.startsWith('/api/usage/')) { await ws.usageMount(req, res, url); return; }
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

// 端口被占用时弹窗询问（不自动换端口）
let currentPort = PORT;
let conflictAttempts = 0;
const MAX_CONFLICT_ATTEMPTS = 5;
const PORT_CANDIDATES = [33333, 44444];

async function freeCandidatePorts() {
  const free = [];
  for (const p of PORT_CANDIDATES) {
    if (p === currentPort) continue;
    if (await isPortFree(HOST, p)) free.push(p);
  }
  return free;
}

async function handlePortConflict(port) {
  if (conflictAttempts++ >= MAX_CONFLICT_ATTEMPTS) {
    log.error(t('port.in_use.exit', { port }));
    process.exit(1);
  }
  if (process.platform !== 'win32') {
    log.error(t('port.in_use.unsupported', { port }));
    process.exit(1);
  }
  const candidates = await freeCandidatePorts();
  const r = await askPortConflict({
    port,
    candidates,
    title: t('port.in_use.title'),
    message: t('port.in_use.message', { port }),
    killLabel: t('port.in_use.kill', { port }),
    switchLabel: t('port.in_use.switch'),
    warnLabel: t('port.in_use.warn'),
    okLabel: t('common.ok'),
    cancelLabel: t('common.cancel'),
  });
  if (r && r.action === 'kill') {
    const pids = await findPidsOnPort(port);
    const killed = pids.length ? await killPids(pids) : [];
    if (killed.length) log.info(t('port.in_use.killed', { port, pids: killed.join(',') }));
    else log.warn(t('port.in_use.kill_failed', { err: `no process found on port ${port}` }));
    await new Promise((res) => setTimeout(res, 500));
    startListening(port);
    return;
  }
  if (r && r.action === 'switch' && Number.isInteger(r.port)) {
    try { writePortFile(r.port); log.info(t('port.in_use.switched', { port: r.port })); }
    catch (e) { log.warn('failed to persist port', e && e.message); }
    currentPort = r.port;
    startListening(r.port);
    return;
  }
  log.error(t('port.in_use.exit', { port }));
  process.exit(1);
}

function startListening(port = currentPort) {
  const onError = (err) => {
    server.removeListener('listening', onListening);
    if (err && err.code === 'EADDRINUSE') {
      log.warn(`port ${port} in use, asking user`);
      handlePortConflict(port);
    } else { log.error('listen error', err); process.exit(1); }
  };
  const onListening = () => {
    server.removeListener('error', onError);
    const actual = server.address().port;
    actualPort = actual;
    currentPort = actual;
    writeRuntimePort(actual);
    // 端口可能因冲突弹窗变化：配置路径与数据目录一律按「实际端口」重算
    configFile = resolveActiveConfigFile(APP_DIR, actual);
    BOOT_CFG = loadDevflowConfig(configFile);
    setLocale(BOOT_CFG.server.language);
    log.info(`listening on http://${HOST}:${actual}  (ws: ws://${HOST}:${actual}/ws)  ${VERSION}`);

    if (NODE) {   // 逃生通道：沿用 nodes/<name> 机制，不进端口数据目录
      const seedDir = instanceSeedDir(NODE);
      const identity = loadIdentity({ file: path.join(seedDir, 'identity.json'), host: HOST, port: actual });
      const stateRoot = instanceFpRoot(publicFingerprint(identity.publicKey));
      const paths = ensurePortDirs({
        ...portPaths(actual),
        id: `node-${NODE}`,
        dir: stateRoot,
        identityFile: path.join(seedDir, 'identity.json'),
        storeFile: path.join(stateRoot, 'collab.json'),
        uploadDir: path.join(stateRoot, 'upload'),
        downloadDir: path.join(stateRoot, 'download'),
        downloadsDir: path.join(stateRoot, 'downloads'),
        relayPluginsDir: path.join(stateRoot, 'downloads', 'relay-plugins'),
        schedulerDir: path.join(stateRoot, 'scheduler'),
        projectsFile: path.join(stateRoot, 'projects.json'),
        workflowsFile: path.join(stateRoot, 'workflows.json'),
        historyFile: path.join(stateRoot, 'message-history.jsonc'),
        skillsRoot: process.env.DEVFLOW_COLLAB_SKILLS || path.join(stateRoot, 'skills-opencode'),
      });
      initWorkspace(paths, actual);
      return;
    }

    const paths = ensurePortDirs(portPaths(actual));
    initWorkspace(paths, actual);
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, HOST);
}
startListening();

export { server };
