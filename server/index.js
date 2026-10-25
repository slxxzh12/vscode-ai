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
import { revealInOs } from './reveal.js';
import { createStaticServer } from './static.js';
import { ensureDefaults, loadProjects } from './config.js';
import { createCodeGroups } from './code-groups.js';
import { createCodePrefs } from './code-prefs.js';
import { createComposerPrefs } from './composer-prefs.js';
import { createSessionProjects } from './session-projects.js';
import { createWindowState } from './window-state.js';
import { createSessionLedger } from './session-ledger.js';
import { restoreSessions, restoreRecord } from './session-restore.js';
import { discoverAgentSessionId } from './agent-resume.js';
import { createAgentStartupGuard } from './agent-startup-guard.js';
import { claimedAgentSessionIds, findClaimOwner } from './session-claims.js';
import { CollabStore } from './collaboration/store.js';
import { loadIdentity, detectHost } from './collaboration/identity.js';
import { CollabEngine } from './collaboration/engine.js';
import { createCollabMount } from './collaboration/http-mount.js';
import { makePeerClient } from './collaboration/peer-client.js';
import { createEventBus } from './collaboration/event-bus.js';
import { UsagePeersStore } from './usage-peers.js';
import { createSeedStore } from './seed-store.js';
import { createTaskStore } from './task-store.js';
import { createDownloadStore } from './download-store.js';
import { createSyncStore } from './sync-store.js';
import { mergeWorkflowList } from './collaboration/workflow-merge.js';
import { createCollabDb } from './collab-db.js';
import { createUsageReporter } from './usage-report.js';
import { createUsageMount } from './usage-mount.js';
import { createUsageVision, callChat } from './usage-vision.js';
import { recognizeViaMaster } from './usage-recognize.js';
import { loadProbe, saveProbe, toProbeRecord } from './usage-probe-store.js';
import { createNotepadStore } from './notepad-store.js';
import { ensureAgentOnPath, probeAgentStats } from './collaboration/agent-stats.js';
import { projectDir } from './project-data.js';
import { createTranslator, createTranslateMount, defaultCatalog, defaultProviderResolver } from './translate.js';
import { loadInvite, saveInvite, clearInvite, isInviteActive } from './remote-invite.js';
import { createRemoteUsers } from './remote-users.js';
import { CollabS2C } from '@devflow/shared/collab';
import { SchedulerS2C } from '@devflow/shared/scheduler';
import { S2C } from '@devflow/shared';
import { createScheduler } from './scheduler/index.js';
import { resolveActiveConfigFile, loadDevflowConfig, ensureConfigFile, updateServerAttrs, parseDevflowConfig, setDefaultAgent } from './devflow-config.js';
import { createWorkflowSeedStore } from './workflow-seed.js';
import { createWorkflowStore } from './workflow-store.js';
import { fallbackWorkflows } from './workflow-xml.js';
import { setLocale, t } from './i18n.js';
import { isPeerRequest, resolveInviteDaysAllowForever, resolveBindHost, hostRestartNeeded } from './remote-gate.js';
import { LOCALES } from '@devflow/shared/i18n';
import { readHistory, writeHistory, appendHistory } from './message-history.js';
import { summarizeHistory, dayKey } from './history-stats.js';
import { createInputStats } from './input-stats.js';
import { dataHome, instanceName, instanceSeedDir, instanceFpRoot } from './data-home.js';
import { APP_DIR, resolvePort, validPort, writePortFile, writeRuntimePort, readPortFile } from './port-file.js';
import { seedPlugins } from './relay-plugins.js';
import { publicFingerprint } from './collaboration/identity.js';
import { createVault } from './llm-vault.js';
import { createUsageStore, normalizeUsage } from './usage-store.js';
import { createLlmMount } from './llm-mount.js';
import { createLlmRelayServer, DEFAULT_LLM_RELAY_PORT } from './llm-relay-server.js';
import { detectEmployeeId, resolveRelayModel } from './llm-config.js';
import { portPaths, ensurePortDirs } from './port-paths.js';
import { restartGuard, spawnRestart } from './port-restart.js';
import { available as fileAssocAvailable, getState as getFileAssocState, loadPref as loadFileAssocPref, savePref as saveFileAssocPref, runAssoc as runFileAssoc } from './file-assoc.js';
import { askPortConflict, pickSqliteFile } from './native-dialog.js';
import { findPidsOnPort, killPids, isPortFree } from './port-conflict.js';
import { VERSION } from './version.js';
import { createNotice } from './notice.js';
import { createUpgradeChecker } from './upgrade.js';
import { createPostmanHistory } from './postman-history.js';
import { createNavicatCrypto } from './navicat-crypto.js';
import { createNavicatStore } from './navicat-store.js';
import { createNavicatExec } from './navicat-exec.js';
import { createNavicatMount } from './navicat-mount.js';
import { buildNcx, connectionString } from './navicat-ncx.js';
import { createProxyStore, deepseekFlashSample } from './proxy-store.js';
import { createProxyCapture } from './proxy-capture.js';
import { createProxyEngine } from './proxy-engine.js';
import { createProxyMount } from './proxy-mount.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('[server]');
const notice = createNotice();
const upgradeChecker = createUpgradeChecker({ currentVersion: VERSION });
let configFile = resolveActiveConfigFile(APP_DIR, resolvePort());
let BOOT_CFG = loadDevflowConfig(configFile);
const HOST = resolveBindHost({ masterOn: isInviteActive(loadInvite(portPaths(resolvePort()).inviteFile)), envHost: process.env.DEVFLOW_HOST });
const PORT = resolvePort();
const PORT_SOURCE = validPort(process.env.DEVFLOW_PORT) ? 'env' : (readPortFile() ? 'file' : 'default');
setLocale(BOOT_CFG.server.language);
const NODE = instanceName();
const LLM_RELAY_PORT = validPort(process.env.DEVFLOW_LLM_PORT) || DEFAULT_LLM_RELAY_PORT;
let llmRelayMount = null;
const llmRelay = createLlmRelayServer({ getMount: () => llmRelayMount, host: HOST, port: LLM_RELAY_PORT, logger: log });

// 默认 agent 配置（终端启动命令 + 用量采集命令 statsCmd 共用同一份）；每次实时读配置，
// 设置默认 agent 后无需重启即生效
function defaultAgent() {
  const c = loadDevflowConfig(configFile);
  const a = (c.agents.list || []).find((x) => x.id === c.agents.default) || {};
  return { id: a.id || '', cmd: a.cmd || 'opencode', statsCmd: a.statsCmd || '' };
}

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
let remoteUsers = null;    // 多用户登录（<数据目录>/collab/users.json）
let remoteFails = 0;
let remoteLockedUntil = 0;
function activeInvite() { return isInviteActive(remoteInvite, Date.now()) ? remoteInvite : null; }
function remoteLocked() { return Date.now() < remoteLockedUntil; }
// 生成/查看/失效邀请都属于「主机侧」操作：只允许本机访问（忘记密码可在本机重置）
function denyRemote(res) {
  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'local-only' }));
}
function remoteAllowed(req) {
  const inv = activeInvite();
  const tk = parseCookies(req)[ACCESS_COOKIE];
  if (!tk) return false;
  if (inv && safeEqual(tk, inv.token)) return true;
  return !!(remoteUsers && remoteUsers.findByToken(tk));
}
// 当前请求对应的登录用户（本机 / 邀请密码登录返回 null，视为主机本人）
function remoteUserOf(req) {
  if (isLocalReq(req)) return null;
  const tk = parseCookies(req)[ACCESS_COOKIE];
  return tk && remoteUsers ? remoteUsers.findByToken(tk) : null;
}
function clientIpOf(req) {
  return String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
}
// 文档请求（打开/刷新页面）即使持 Cookie 也要求重新输密码：登录后发一次性页面令牌随 302 带回
const PAGE_TOKEN_MS = 60 * 1000;
const pageTokens = new Map();   // token -> expiresAt
function issuePageToken() {
  const t = crypto.randomBytes(16).toString('hex');
  for (const [k, exp] of pageTokens) if (exp <= Date.now()) pageTokens.delete(k);
  pageTokens.set(t, Date.now() + PAGE_TOKEN_MS);
  return t;
}
function consumePageToken(t) {
  if (!t) return false;
  const exp = pageTokens.get(t);
  if (!exp) return false;
  pageTokens.delete(t);
  return exp > Date.now();
}
// 页面文档请求：GET 且无扩展名（SPA fallback），排除 /api、/ws
function isDocumentReq(url, method) {
  if (method !== 'GET') return false;
  const p = url.pathname;
  if (p.startsWith('/api/') || p.startsWith('/ws')) return false;
  if (p === '/index.html') return true;
  return !/\.[^/]+$/.test(p);
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
  // 链接 = 授权口令（access）+ 群主公钥（pk，身份锚点：群主换 IP 后成员仍能认出同一台机器）
  const pk = publicKeyParam();
  const pkPart = pk ? `&pk=${encodeURIComponent(pk)}` : '';
  return { address: addr, link: `http://${addr}:${actualPort || PORT}/?access=${inv.token}${pkPart}`, publicKey: pk };
}
// 本机协作身份公钥（PEM → base64url），未就绪时返回空
function publicKeyParam() {
  try {
    const pem = ws && ws.engine && ws.engine.identity && ws.engine.identity.publicKey;
    return pem ? Buffer.from(pem, 'utf8').toString('base64url') : '';
  } catch { return ''; }
}
// 登录后要回跳的本地路径：只允许站内绝对路径，剥掉 access/pk/password 等敏感参数
function safeNextPath(raw) {
  const s = String(raw || '');
  if (!s.startsWith('/') || s.startsWith('//')) return '/';
  try {
    const u = new URL(s, 'http://localhost');
    u.searchParams.delete('access');
    u.searchParams.delete('pk');
    u.searchParams.delete('password');
    u.searchParams.delete('__df');
    return u.pathname + (u.search ? u.search : '');
  } catch { return '/'; }
}
// 页面级请求（首页）才回跳原查询串；静态资源请求一律回首页，避免把 login 后重定向到资源
function pageNext(url) {
  return url.pathname === '/' || url.pathname === '/index.html'
    ? safeNextPath(url.pathname + url.search)
    : '/';
}
function escapeAttr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function pageShell(title, body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,Segoe UI,sans-serif;background:#1e1e1e;color:#ddd;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.box{max-width:520px;padding:28px 32px;background:#252526;border:1px solid #3c3c3c;border-radius:10px;text-align:center}.box h1{font-size:18px;margin:0 0 12px}.box p{color:#aaa;line-height:1.7;font-size:13px}.box input{width:100%;box-sizing:border-box;margin:14px 0 10px;padding:10px 12px;background:#1e1e1e;border:1px solid #3c3c3c;border-radius:6px;color:#eee;font-size:14px}.box button{width:100%;padding:10px;background:#0e639c;border:none;border-radius:6px;color:#fff;font-size:14px;cursor:pointer}.err{color:#f48771;margin-top:10px}</style></head><body><div class="box"><h1>${title}</h1>${body}</div></body></html>`;
}
function remoteBlockPage() {
  return pageShell(t('remote.block_title'), `<p>${t('remote.need_invite')}</p>`);
}
function remoteLoginPage(showError, next = '/') {
  const lockedMs = remoteLocked() ? remoteLockedUntil - Date.now() : 0;
  const note = lockedMs > 0
    ? `<p class="err">${t('remote.login_locked', { min: Math.ceil(lockedMs / 60000) })}</p>`
    : (showError ? `<p class="err">${t('remote.login_wrong')}</p>` : '');
  const dis = lockedMs > 0 ? ' disabled' : '';
  return pageShell(t('remote.login_title'),
    `<p>${t('remote.login_hint')}</p><form method="POST" action="/__access"><input type="hidden" name="next" value="${escapeAttr(next)}" /><input type="text" name="username" autocomplete="username" placeholder="${t('remote.username')}"${dis} /><input type="password" name="password" autocomplete="current-password" placeholder="${t('remote.token_or_password')}"${dis} /><button type="submit"${dis}>${t('remote.login_submit')}</button></form>${note}`);
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
const broadcastNginx = (ev) => {
  if (!gateway) return;
  for (const c of gateway.conns) c.send({ type: 'nginx', ...ev });
};

// ---- 由档案路径构建所有数据模块（不监听端口、不建 gateway）----
function buildWorkspace({ paths, port }) {
  // 所有表共用一个 SQLite 文件：<数据目录>/void.db（usage / seed / member / member_command / message）
  const usageDbFile = path.join(paths.dir, 'void.db');
  // 老库兼容：曾用名 usage.db，存在则改名迁移（不丢数据）
  try {
    const legacyDb = path.join(paths.dir, 'usage.db');
    if (!fs.existsSync(usageDbFile) && fs.existsSync(legacyDb)) fs.renameSync(legacyDb, usageDbFile);
  } catch { /* 迁移失败就按新库启动 */ }
  // usage 表既是 agent 明细，也存每台每天的合计行（agent='*'，原 peer_daily），故先建 store 供各方共用
  const usageStore = createUsageStore({ file: usageDbFile, logger: log });
  const inputStats = createInputStats({ file: paths.inputStatsFile, logger: log });
  const taskStore = createTaskStore({ file: usageDbFile, logger: log });
  // 协作元数据（下载索引/同步种子/工作流种子）一律进 void.db，不再落 json 文件
  const downloadStore = createDownloadStore({ file: usageDbFile, logger: log });
  const syncStore = createSyncStore({ file: usageDbFile, logger: log });
  const workflowSeedStore = createWorkflowSeedStore({ file: usageDbFile, logger: log });
  // 工作流改为每端口一个目录、单文件存一条；首次启动从包内 config/workflows 复制种子
  const workflowStore = createWorkflowStore({ dir: paths.workflowsDir, configFile, seedDir: path.join(__dirname, '..', 'config', 'workflows'), seedStore: workflowSeedStore, logger: log });
  workflowStore.migrateFromConfigXml();
  if (!workflowStore.readAll().length) workflowStore.writeAll(fallbackWorkflows());
  const projectsFile = process.env.DEVFLOW_PROJECTS || paths.projectsFile;
  ensureDefaults(projectsFile);
  const projects = new Projects({ projects: loadProjects(projectsFile), logger: log });
  const saveProjects = () => {
    try { fs.writeFileSync(projectsFile, JSON.stringify({ projects: projects.rawProjects() }, null, 2), 'utf8'); }
    catch (e) { log.warn?.('save projects failed', e && e.message); }
  };
  // projectId → 项目根目录（权威来源 projects 列表）；对话数据按项目分目录存，键 = sha256(根路径)
  const projectRootOf = (projectId) => {
    if (!projectId) return '';
    const p = projects.listProjects().find((x) => x.id === projectId);
    return p ? p.root : '';
  };
  // 项目数据目录：<port>/projects/<sha256(root)>；无项目（全局）落 <port>/projects/_global
  const projectDataDirOf = (projectId) => {
    const root = projectRootOf(projectId);
    return root ? projectDir(paths.dir, root) : path.join(paths.projectsDataDir, '_global');
  };
  // 所有项目数据目录（含 _global）：供按项目分片存储的会话账本/消息历史合并读取
  const listProjectDataDirs = () => {
    const dirs = new Set([path.join(paths.projectsDataDir, '_global')]);
    for (const p of projects.listProjects()) dirs.add(projectDir(paths.dir, p.root));
    return [...dirs];
  };
  // 一次性迁移：老单文件 sessions.json 按 projectId 拆到各项目目录（在 sessionLedger 加载前执行）
  function migrateSessionsToProjects() {
    const old = paths.sessionsFile;
    if (!fs.existsSync(old)) return;
    let sessions = [];
    try { const j = JSON.parse(fs.readFileSync(old, 'utf8')); sessions = Array.isArray(j && j.sessions) ? j.sessions : []; } catch { sessions = []; }
    const buckets = new Map();
    for (const s of sessions) {
      const projectId = (s && typeof s.projectId === 'string' && s.projectId) || '';
      if (!buckets.has(projectId)) buckets.set(projectId, []);
      buckets.get(projectId).push(s);
    }
    for (const [projectId, list] of buckets) {
      const f = path.join(projectDataDirOf(projectId), 'sessions.json');
      try {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify({ sessions: list }, null, 2), 'utf8');
      } catch (e) { log.warn?.('sessions migrate failed', f, (e && e.message) || e); }
    }
    try { fs.rmSync(old, { force: true }); } catch { /* ignore */ }
  }
  migrateSessionsToProjects();
  // 统计采集公用一个目录（与 projectId 无关）：用户选中目录根，从它向上找 .git 执行，找不到回退用户主目录
  let statsStartDir = '';
  const setStatsCwd = (root) => { statsStartDir = String(root || ''); };
  const getStatsStartDir = () => statsStartDir || os.homedir();
  const codeGroups = createCodeGroups({ file: paths.codeGroupsFile, logger: log });
  const codePrefs = createCodePrefs({ file: paths.codePrefsFile, logger: log });
  const composerPrefs = createComposerPrefs({ file: paths.composerPrefsFile, logger: log });
  const sessionProjects = createSessionProjects({ file: paths.sessionProjectsFile, logger: log });
  const windowState = createWindowState({ file: paths.windowStateFile, logger: log });
  const sessionLedger = createSessionLedger({ file: paths.sessionsFile, logsDir: paths.sessionLogsDir, logDirFor: (projectId) => path.join(projectDataDirOf(projectId), 'session-logs'), sessionsDirs: listProjectDataDirs, sessionsDirFor: projectDataDirOf, logger: log });
  // 一次性迁移：老单文件 message-history.jsonc 搬到按项目分目录的位置（按 sessionId 归属，无归属落 _global）
  function migrateHistoryToProjects() {
    const old = paths.historyFile;
    if (!fs.existsSync(old)) return;
    let msgs;
    try { msgs = readHistory(old); } catch { msgs = []; }
    if (!msgs.length) { try { fs.rmSync(old, { force: true }); } catch { /* ignore */ } return; }
    const byId = new Map(sessionLedger.read().sessions.map((s) => [s.id, s.projectId || '']));
    const buckets = new Map();
    for (const m of msgs) {
      const projectId = (m.sessionId && byId.get(m.sessionId)) || '';
      if (!buckets.has(projectId)) buckets.set(projectId, []);
      buckets.get(projectId).push(m);
    }
    for (const [projectId, list] of buckets) {
      const file = path.join(projectDataDirOf(projectId), 'message-history.jsonc');
      if (!fs.existsSync(file)) writeHistory(file, list);
    }
    try { fs.rmSync(old, { force: true }); } catch { /* ignore */ }
  }
  sessionLedger.migrateLogs();
  migrateHistoryToProjects();
  // 合并读取：所有项目 + _global 的 message-history（前端一次拉全量再按项目筛选，保持旧行为）
  // 登录用户各用一份文件（message-history.<userId>.jsonc），主机本人沿用原文件
  function historyFileName(userId) { return userId ? `message-history.${userId}.jsonc` : 'message-history.jsonc'; }
  function historyFileFor(projectId, userId = '') { return path.join(projectDataDirOf(projectId), historyFileName(userId)); }
  function readHistoryAll(userId = '') {
    const all = [];
    for (const dir of listProjectDataDirs()) all.push(...readHistory(path.join(dir, historyFileName(userId))));
    return all.sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
  }
  // 拆分写入：按 sessionId 归属项目，把全量列表写回各项目文件（无归属落 _global）
  function writeHistorySplit(messages, userId = '') {
    const list = Array.isArray(messages) ? messages : [];
    const byId = new Map(sessionLedger.read().sessions.map((s) => [s.id, s.projectId || '']));
    const buckets = new Map();
    for (const m of list) {
      const projectId = (m && m.sessionId && byId.get(m.sessionId)) || '';
      if (!buckets.has(projectId)) buckets.set(projectId, []);
      buckets.get(projectId).push(m);
    }
    for (const [projectId, items] of buckets) writeHistory(historyFileFor(projectId, userId), items);
    return readHistoryAll(userId);
  }
  const localUsername = (() => { try { return os.userInfo().username || 'host'; } catch { return 'host'; } })();
  function listHistoryScopes() {
    const out = [{ projectId: '', dir: path.join(paths.projectsDataDir, '_global') }];
    for (const p of projects.listProjects()) out.push({ projectId: p.id, dir: projectDataDirOf(p.id) });
    return out;
  }
  function historyFileList() {
    const files = [];
    const remote = remoteUsers ? remoteUsers.list() : [];
    for (const scope of listHistoryScopes()) {
      files.push({ file: path.join(scope.dir, historyFileName('')), userId: '', userName: localUsername, projectId: scope.projectId });
      for (const u of remote) files.push({ file: path.join(scope.dir, historyFileName(u.id)), userId: u.id, userName: u.username, projectId: scope.projectId });
    }
    return files;
  }
  function historyStats() {
    const base = summarizeHistory(historyFileList());
    if (!inputStats.seeded()) inputStats.seed(base.days);
    const exact = inputStats.summary();
    const merged = new Map();
    const ensure = (userId, userName) => {
      const id = String(userId || '');
      if (!merged.has(id)) merged.set(id, { userId: id, userName: '', messages: 0, chars: 0, sessions: 0, firstTs: 0, lastTs: 0 });
      const u = merged.get(id);
      if (userName && !u.userName) u.userName = userName;
      return u;
    };
    for (const u of base.users) {
      const m = ensure(u.userId, u.userName);
      m.messages = u.messages;
      m.chars = u.chars;
      m.sessions = u.sessions;
      m.firstTs = u.firstTs;
      m.lastTs = u.lastTs;
    }
    for (const u of exact.users) {
      const m = ensure(u.userId, u.userName);
      m.messages = u.messages;
      m.chars = u.chars;
    }
    const users = [...merged.values()];
    const hasExact = exact.users.length > 0;
    return {
      totals: {
        messages: hasExact ? exact.totals.messages : base.totals.messages,
        chars: hasExact ? exact.totals.chars : base.totals.chars,
        sessions: base.totals.sessions,
        users: hasExact ? users.length : base.totals.users,
      },
      users,
      sessions: base.sessions,
      months: hasExact ? exact.months : base.months,
      days: hasExact ? exact.days : base.days,
    };
  }
  function chatDailyCounts() {
    const nowTs = Date.now();
    const wanted = new Set([dayKey(nowTs), dayKey(nowTs - 24 * 3600 * 1000)]);
    const out = {};
    for (const d of historyStats().days) {
      if (wanted.has(d.day)) out[d.day] = (out[d.day] || 0) + d.messages;
    }
    return out;
  }
  const agentList = () => loadDevflowConfig(configFile).agents.list || [];
  let discoveryQueue = Promise.resolve();
  function runDiscovery(session, { requireAlive = true } = {}) {
    // 串行化：避免同批会话并发读到同一份旧「已认领」集合而错配
    discoveryQueue = discoveryQueue.then(async () => {
      if (requireAlive) {
        const cur = sessionManager.get(session.id);
        if (!cur || !cur.alive) return;
      }
      const rows = sessionLedger.read().sessions;
      const already = rows.find((r) => r.id === session.id);
      if (already && already.agentSessionId) return;
      const agent = agentList().find((a) => a.id === session.agentId) || null;
      const exclude = claimedAgentSessionIds(rows, session.id);
      const sid = await discoverAgentSessionId({ agent, cwd: session.cwd, since: session.createdAt, exclude });
      if (!sid) return;
      const fresh = sessionLedger.read().sessions;
      if (claimedAgentSessionIds(fresh, session.id).has(sid)) return;   // 竞态兜底：已被别会话认领
      const row = fresh.find((r) => r.id === session.id);
      if (row) sessionLedger.upsert({ ...row, agentSessionId: sid, updatedAt: Date.now() });
    }).catch(() => { /* 发现失败不影响使用 */ });
  }
  function scheduleAgentDiscovery(session) {
    const known = sessionLedger.read().sessions.find((r) => r.id === session.id);
    if (known && known.agentSessionId) return;
    // 多次重试：agent 自己的会话可能在某次尝试时还没出现在 session list 里（首次发现越早越好）
    for (const delay of [15000, 60000, 300000, 900000]) {
      setTimeout(() => { void runDiscovery(session); }, delay).unref?.();
    }
  }
  let startupGuard = null;   // 构造 SessionManager 后立即赋值；onCreated 触发时已就绪
  const sessionManager = new SessionManager({
    logger: log,
    projectResolver: (id) => projects.listProjects().find((p) => p.id === id)?.root ?? null,
    onCreated: (s) => {
      sessionProjects.record(s.id, s.projectId);
      if (s.kind === 'workflow') return;
      sessionLedger.upsert({
        id: s.id, name: s.name, projectId: s.projectId, cwd: s.cwd, kind: s.kind,
        agentId: s.agentId, agentCmd: s.agentCmd, cols: s.cols, rows: s.rows,
        createdAt: s.createdAt, updatedAt: Date.now(), state: 'running',
      });
      if (s.kind === 'agent') {
        scheduleAgentDiscovery(s);
        startupGuard?.arm(s);
      }
    },
  });
  startupGuard = createAgentStartupGuard({ sessionManager, logger: log });
  sessionManager.on('data', (s, chunk) => sessionLedger.appendLog(s.id, chunk));
  sessionManager.on('exit', (s) => {
    startupGuard.disarm(s.id);
    sessionLedger.flushLog(s.id);
    const row = sessionLedger.read().sessions.find((r) => r.id === s.id);
    if (row) sessionLedger.upsert({ ...row, state: 'exited', updatedAt: Date.now() });
    // 退出/关闭时补一次 agent 会话发现：避免在 15s/60s 定时发现前就关闭而丢失 agentSessionId，
    // 导致下次恢复只能重开 agent、不能续回原对话。
    if (s.kind === 'agent') runDiscovery(s, { requireAlive: false });
  });
  sessionManager.on('removed', (id) => {
    startupGuard.disarm(id);
    sessionLedger.close(id);
    const row = sessionLedger.read().sessions.find((r) => r.id === id);
    if (row) sessionLedger.upsert({ ...row, state: 'exited', updatedAt: Date.now() });
  });
  function findLiveByAgentSessionId(agentSessionId, exceptDevflowId) {
    return findClaimOwner(sessionManager.live(), sessionLedger.read().sessions, agentSessionId, exceptDevflowId);
  }
  function isAgentSessionIdTaken(agentSessionId, exceptDevflowId) {
    return !!findLiveByAgentSessionId(agentSessionId, exceptDevflowId);
  }
  // 账本缺 agentSessionId 时现场发现一次：启动重建与左侧点击恢复共用，确保续会话命令带上 --session <id>
  async function discoverForRecord(rec) {
    const agent = (loadDevflowConfig(configFile).agents.list || []).find((a) => a.id === rec.agentId) || null;
    if (!agent) return null;
    const exclude = claimedAgentSessionIds(sessionLedger.read().sessions, rec.id);
    return await discoverAgentSessionId({ agent, cwd: rec.cwd, since: rec.createdAt, exclude });
  }
  async function restoreSessionById(id, { name } = {}) {
    const live = sessionManager.get(id);
    if (live && live.state === 'running') return { ok: true, session: live, redirected: false };
    const rec = sessionLedger.read().sessions.find((r) => r.id === id);
    if (!rec) {
      const projectId = sessionProjects.read()[id] || null;
      const session = await sessionManager.create({ id, name: name || id, projectId, kind: 'shell' });
      return { ok: true, session, recreated: true };
    }
    if (rec.agentSessionId) {
      const owner = findLiveByAgentSessionId(rec.agentSessionId, id);
      if (owner) return { ok: true, session: owner, redirected: true };
    }
    try {
      const { session } = await restoreRecord({
        ledger: sessionLedger, sessionManager, agents: agentList(), logger: log, rec,
        isAgentSessionIdTaken, discover: discoverForRecord,
      });
      return { ok: true, session, redirected: false };
    } catch (e) {
      return { ok: false, reason: (e && e.message) || 'restore-failed' };
    }
  }
  setInterval(() => sessionLedger.flushAll(), 10000).unref?.();
  const workflowRunner = new WorkflowRunner({
    sessionManager,
    getWorkflows: () => workflowStore.readAll(),
    doneMarker: (token, { runId, index }) => t('wf.done_marker', { runId, index }),
    logger: log,
  });

  // 机器级密钥文件：同机各端口共用同一 machineId/公私钥（NODE 多实例模式保持各自隔离）
  const identityKeyFile = NODE ? null : path.join(dataHome(), 'identity.json');
  const identity = loadIdentity({ file: paths.identityFile, keyFile: identityKeyFile, employeeId: detectEmployeeId(), host: HOST, port });
  const eventBus = createEventBus();
  const engine = new CollabEngine({
    store: new CollabStore({ file: paths.storeFile, logger: log }),
    identity,
    peers: new UsagePeersStore({ file: paths.usagePeersFile, usageStore, logger: log }),
    seedStore: createSeedStore({ file: usageDbFile, logger: log }),
    collabDb: createCollabDb({ file: usageDbFile, logger: log }),
    taskStore,
    downloadStore,
    syncStore,
    getWorkflowsUpdatedAt: () => { try { return fs.statSync(configFile).mtimeMs; } catch { return 0; } },
    skillsRoot: paths.skillsRoot,
    uploadDir: paths.uploadDir,
    downloadDir: paths.downloadDir,
    downloadsDir: paths.downloadsDir,
    events: eventBus,
    logger: log,
    getWorkflows: () => workflowStore.readAll(),
    getAgents: () => loadDevflowConfig(configFile).agents,
    mergeWorkflows: (incoming) => workflowStore.writeAll(mergeWorkflowList(workflowStore.readAll(), incoming)),
  });
  engine.peer = makePeerClient();
  engine.cleanupStagedImports();
  const collabMount = createCollabMount({ engine, logger: log });
  const usagePeers = engine.peers;
  // agent 可执行文件解析：显式配置(DEVFLOW_OPENCODE) → PATH → 包内 opencode/、env/；命中后把目录插到 PATH
  // 这样用量采集（execFile）与 pty 终端命中同一份，绿色包直启也不会因 PATH 缺失而 ENOENT
  const agent = defaultAgent();
  const agentBin = ensureAgentOnPath(agent.cmd);
  if (agentBin) log.info(`agent bin resolved: ${agentBin}`);
  else log.warn(`agent "${agent.cmd}" not found on PATH; usage collection will fail (set DEVFLOW_OPENCODE to override)`);
  const usageReporter = createUsageReporter({
    file: paths.usageReportFile,
    identity: () => ({ ...engine.pub }),
    peers: usagePeers,
    cmd: agent.cmd,
    statsCmd: agent.statsCmd,
    resolveAgent: () => defaultAgent(),
    getStartDir: getStatsStartDir,
    statsFile: paths.statsFile,
    getChatDaily: () => chatDailyCounts(),
    onCollected: (u) => saveProbe(paths.usageProbeFile, toProbeRecord(u)),
  });
  const usageMount = createUsageMount({
    peers: usagePeers,
    reporter: usageReporter,
    checkToken: (tk) => { const inv = activeInvite(); return !!inv && safeEqual(tk, inv.token); },
    pullFromHub: async (masterId) => {
      const owned = engine.store.ownedGroup(engine.pub.machineId);
      if (owned && (!masterId || owned.hubId === masterId)) {
        return { code: 'ok', updatedAt: Date.now(), members: usagePeers.list() };
      }
      return engine.pullUsageFrom(masterId);
    },
    probe: () => probeAgentStats({ ...defaultAgent(), days: usageReporter.config().days, startDir: getStatsStartDir(), statsFile: paths.statsFile }),
    isHub: (groupId) => { try { const g = engine.store.findGroup(groupId); return !!g && g.hubId === engine.pub.machineId; } catch { return false; } },
    selfId: () => engine.pub.machineId,
    loadProbe: () => loadProbe(paths.usageProbeFile),
    saveProbe: (r) => saveProbe(paths.usageProbeFile, r),
    setCwd: setStatsCwd,
    onImage: async ({ data, mime }) => {
      const cfg = usageReporter.config();
      if (cfg && cfg.masterUrl && cfg.token) {
        return recognizeViaMaster({ masterUrl: cfg.masterUrl, token: cfg.token, data, mime, identity: engine.pub, days: usageReporter.config().days });
      }
      const vision = createUsageVision({ resolveProvider: defaultProviderResolver() });
      const { metrics, model } = await vision.recognize({ data, mime });
      const a = defaultAgent();
      const usage = { agent: a.cmd, ...metrics, days: usageReporter.config().days };
      const rep = await usageReporter.reportImage(usage);
      return { metrics, model, reported: !!rep.ok, reportError: rep.error || '' };
    },
    onMultimodal: async ({ messages, model }) => {
      const r = resolveRelayModel(model);
      if (!r) { const e = new Error('bad-model'); e.code = 'bad-model'; throw e; }
      return callChat({ resolveProvider: async () => r.provider, messages, model: r.model || 'image' });
    },
    logger: log,
  });
  // 默认上报目标：入群时记住 master 的地址与邀请令牌（无需手填链接），并立刻补报一次
  engine.onJoined = ({ host, port, token }) => {
    if (!host || !port || !token) return;
    const cfg = usageReporter.setConfig({ masterUrl: `http://${host}:${port}`, token });
    log.info(`usage report target set: ${cfg.masterUrl}`);
    usageReporter.reportNow().catch(() => { /* 失败只记状态 */ });
  };
  eventBus.on('friend-request', (payload) => broadcastCollab(CollabS2C.COLLAB_FRIEND_REQ, payload));
  eventBus.on('group-invite', (payload) => broadcastCollab(CollabS2C.COLLAB_GROUP_INVITE, payload));
  eventBus.on('inbox', (payload) => broadcastCollab(CollabS2C.COLLAB_INBOX, payload));
  eventBus.on('synced', () => broadcastCollab(CollabS2C.COLLAB_SYNCED, {}));
  eventBus.on('chat', (payload) => broadcastCollab(CollabS2C.COLLAB_CHAT, { groupId: payload.groupId, msg: payload.msg }));
  eventBus.on('cmd-pending', (payload) => broadcastCollab(CollabS2C.COLLAB_CMD_PENDING, payload));
  eventBus.on('heartbeat', () => broadcastCollab(CollabS2C.COLLAB_HEARTBEAT, {}));
  eventBus.on('tasks', (payload) => broadcastCollab(CollabS2C.COLLAB_TASKS, payload));

  const groups = engine.store.listGroups();
  const isHub = groups.some((g) => g.hubId === engine.pub.machineId);
  const scheduler = createScheduler({
    dir: paths.schedulerDir,
    manifestRoot: path.join(paths.schedulerDir, 'manifests'),
    projectResolver: (id) => projects.listProjects().find((p) => p.id === id)?.root ?? null,
    logger: log,
    agentCmd: agentBin || agent?.cmd || 'opencode',
    opencodeDataDir: path.join(paths.dir, 'opencode-data'),
    machineId: engine.pub.machineId,
    hostport: `${HOST}:${port}`,
    role: isHub || !groups.length ? 'master' : 'slave',
    version: VERSION,
    dbFile: usageDbFile,
    pullQueueConfig: () => engine.pullQueueConfig?.(),
    operatorOf: (req) => ({
      createIP: clientIpOf(req),
      employeeId: String(remoteUserOf(req)?.username || engine.pub.employeeId || identity.employeeId || engine.pub.username || identity.username || ''),
    }),
    defaultOperator: { createIP: '127.0.0.1', employeeId: String(engine.pub.employeeId || identity.employeeId || engine.pub.username || identity.username || '') },
    onJobEvent: (evt, payload) => {
      broadcastSched(evt === 'run-end' ? SchedulerS2C.SCHED_RUN_END : SchedulerS2C.SCHED_RUN_START, payload);
    },
  });
  engine.setQueueConfigProvider?.(() => scheduler.queue.config.syncConfig());
  scheduler.store.setRuntimeProvider((id) => ({
    nextRunAt: scheduler.engine.nextRunAtOf(id),
    lastRun: null,
  }));
  scheduler.engine.onEvent((evt, payload) => {
    broadcastSched(SchedulerS2C.SCHED_TASKS_CHANGED, payload);
  });

  const postmanHistory = createPostmanHistory({ dir: paths.postmanDir });
  const notepadStore = createNotepadStore({ dir: paths.notepadDir });
  // 左侧文件树：每个小工具各用一份独立目录，复用同一套 store/路由逻辑
  const fileStores = {
    notepad: notepadStore,
    yaml: createNotepadStore({ dir: paths.yamlDir }),
    js: createNotepadStore({ dir: paths.jsDir }),
    translate: createNotepadStore({ dir: paths.translateDir }),
    markdown: createNotepadStore({ dir: paths.markdownDir }),
  };
  const navicatCrypto = createNavicatCrypto({ keyFile: path.join(paths.navicatDir, '.key') });
  const navicatStore = createNavicatStore({ file: path.join(paths.navicatDir, 'profiles.json'), crypto: navicatCrypto });
  const navicatMount = createNavicatMount({
    store: navicatStore,
    exec: createNavicatExec({}),
    ncx: { buildNcx, connectionString },
    pickFile: pickSqliteFile,
    logger: log,
  });
  const proxyStore = createProxyStore({ file: path.join(paths.proxyDir, 'rules.json'), reservedPorts: [port, LLM_RELAY_PORT], seed: [deepseekFlashSample()] });
  const proxyCapture = createProxyCapture({ rootDir: paths.proxyCapturesDir, onEvent: broadcastNginx });
  const proxyEngine = createProxyEngine({ store: proxyStore, capture: proxyCapture, httpServer: server, onEvent: broadcastNginx, logger: log });
  const proxyMount = createProxyMount({ store: proxyStore, engine: proxyEngine, capture: proxyCapture, logger: log });
  const httpApi = createHttpApi({ projects, saveProjects, logger: log, repoRoot: path.join(__dirname, '..'), codeGroups, codePrefs, composerPrefs, sessionProjects, windowState, sessionLedger, postmanHistory, notepadStore, fileStores });
  const llmVault = createVault({ file: path.join(paths.dir, 'llm.vault.json') });
  seedPlugins(paths.relayPluginsDir, path.join(__dirname, '..', 'config', 'relay-plugins'));
  const llmMount = createLlmMount({ vault: llmVault, host: detectHost(), port: LLM_RELAY_PORT, logger: log, pluginsDir: paths.relayPluginsDir, relayTestsDir: path.join(paths.downloadsDir, 'relay-tests') });
  const translateMount = createTranslateMount({
    translator: createTranslator({ provider: defaultProviderResolver() }),
    catalog: defaultCatalog(),
    logger: log,
    isLocal: isLocalReq,
    projectRoots: () => projects.listProjects().map((p) => p.root),
  });
  return { projects, saveProjects, workflowStore, sessionManager, workflowRunner, engine, collabMount, usageMount, usageReporter, scheduler, httpApi, llmMount, translateMount, llmVault, usageStore, inputStats, taskStore, workflowSeedStore, sessionLedger, historyFile: paths.historyFile, paths, restoreSessionById, discoverForRecord, navicatMount, proxyStore, proxyEngine, proxyMount, projectDataDirOf, historyFileFor, readHistoryAll, writeHistorySplit, historyStats };
}

// ---- 工作区（端口档案）----
let ws = null;               // ready 后指向 bundle
let actualPort = null;       // 实际监听端口

function initWorkspace(paths, port) {
  ws = buildWorkspace({ paths, port });
  actualPort = port;
  llmRelayMount = ws.llmMount;
  void llmRelay.start();
  // 远程访问令牌校验注入：slave 入群时校对本机活跃邀请
  ws.engine.verifyAccessToken = (tk) => { const inv = activeInvite(); return !!inv && safeEqual(tk, inv.token); };
  if (!gateway) {
    gateway = createGateway({ httpServer: server, sessionManager: ws.sessionManager, workflowRunner: ws.workflowRunner, requireAuthWs, log, restoreSessionById: ws.restoreSessionById });
  }
  void ws.proxyEngine.startEnabled().catch((e) => log.warn('proxy start failed', (e && e.message) || e));
  void restoreSessions({
    ledger: ws.sessionLedger,
    sessionManager: ws.sessionManager,
    agents: loadDevflowConfig(configFile).agents.list || [],
    logger: log,
    // 账本缺 agentSessionId 时现场补发现：尽量续回原对话，而不是重开新对话
    discover: (rec) => ws.discoverForRecord(rec),
  }).then((r) => {
    if (r.restored || r.skipped.length) log.info(`session restore: restored=${r.restored} skipped=${r.skipped.length}`);
  }).catch((e) => log.warn('session restore failed', (e && e.message) || e));
  ws.engine.setAdvertised({ host: HOST, port });
  // 群主换了地址后重新上线：自动签名广播一次，成员据此把群主指到新地址
  Promise.resolve(ws.engine.announceIfMoved?.()).catch((e) => log.warn('announce group move failed', (e && e.message) || e));
  // 启动即把本机的 command 等资产注册到群里（hub 落 collab.db 的成员/命令表）
  Promise.resolve(ws.engine.registerSelfAssets?.()).then((r) => { if (r) log.info(`assets registered: groups=${r.groups} commands=${r.commands}`); }).catch((e) => log.warn('register assets failed', (e && e.message) || e));
  // 启动补扫：把离线期间错过的分发通知补成本机任务（拉不到就等下次）
  Promise.resolve(ws.engine.backfillDistTasks?.()).then((r) => { if (r) log.info(`dist backfill: groups=${r.groups} dist=${r.distMessages} pending=${r.pending}`); }).catch((e) => log.warn('dist backfill failed', (e && e.message) || e));
  // 分发任务定时轮询：补 master 下发的任务（非阻塞，默认 60s，可 DEVFLOW_DIST_POLL_MS 覆盖）
  const distPollMs = Number(process.env.DEVFLOW_DIST_POLL_MS) || 60000;
  const distPollTimer = setInterval(() => { ws.engine.pollDistTasks?.().catch(() => { /* 单次失败忽略 */ }); }, distPollMs);
  distPollTimer.unref?.();
  remoteInvite = loadInvite(paths.inviteFile);   // 令牌落盘：重启后仍有效（expiresAt=0 为长期）
  remoteUsers = createRemoteUsers({ file: path.join(path.dirname(paths.inviteFile), 'users.json'), logger: log });
  // 用量上报：启动即报一次，之后每 4 小时左右再报
  if (ws.usageReporter) { ws.usageReporter.stop(); ws.usageReporter.start(); }
  // 升级检测：启动查一次，之后每 10 天一次（非阻塞、失败静默）
  upgradeChecker.check().catch(() => { /* ignore */ });
  const upgradeTimer = setInterval(() => { upgradeChecker.check().catch(() => { /* ignore */ }); }, 10 * 24 * 3600 * 1000);
  upgradeTimer.unref?.();
  if (!['0', 'off', 'false'].includes(String(process.env.DEVFLOW_SCHEDULER || '').toLowerCase())) {
    ws.scheduler.start().then(() => log.info('scheduler started')).catch((e) => log.error('scheduler start failed', e));
  }
  const queueCfgTimer = setInterval(() => {
    if (ws.scheduler.getRole?.() === 'slave') ws.scheduler.syncQueueConfig?.().catch(() => { /* ignore */ });
  }, 60000);
  queueCfgTimer.unref?.();
  log.info(`workspace ready: port=${port} dataDir=${paths.dir}`);
}

const server = http.createServer(async (req, res) => {
  if (!(await requireAuthHttp(req, res))) { res.writeHead(401); res.end(); return; }
  const url = new URL(req.url, 'http://localhost');

  // 远程访问门禁：非回环客户端必须持有效 Cookie；链接（?access=）不再免密，一律需输入访问密码
  if (!isLocalReq(req)) {
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
      if (isDocumentReq(url, req.method)) {
        // 文档请求：邀请密码登录需带登录后下发的一次性页面令牌；多用户令牌 Cookie 可直接续用
        if (!consumePageToken(url.searchParams.get('__df')) && !remoteUserOf(req)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(remoteLoginPage(false, pageNext(url)));
          return;
        }
      } else if (!remoteAllowed(req)) {
        if (url.pathname === '/__access' && req.method === 'POST') {
          let body = '';
          req.on('data', (c) => { body += c; });
          req.on('end', () => {
            const form = new URLSearchParams(body);
            const next = safeNextPath(form.get('next'));
            if (remoteLocked()) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(remoteLoginPage(true, next)); return; }
            const username = String(form.get('username') || '').trim();
            const secret = form.get('password') || '';
            let cookieValue = '';
            if (username) {
              const u = remoteUsers ? remoteUsers.findByLogin(username, secret) : null;
              if (u) cookieValue = u.token;
            } else if (safeEqual(secret, inv.password)) {
              cookieValue = inv.token;
            }
            if (cookieValue) {
              remoteFails = 0;
              // 会话级 Cookie（供资源和 /api、/ws 使用）；文档每次加载都靠一次性页面令牌重新验证
              const loc = new URL(next, 'http://localhost');
              loc.searchParams.set('__df', issuePageToken());
              res.writeHead(302, { 'Set-Cookie': `${ACCESS_COOKIE}=${cookieValue}; HttpOnly; SameSite=Lax; Path=/`, Location: loc.pathname + (loc.search || '') });
              res.end();
            } else {
              remoteFails += 1;
              if (remoteFails >= MAX_FAILS) { remoteLockedUntil = Date.now() + LOCK_MS; remoteFails = 0; }
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(remoteLoginPage(true, next));
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
        res.end(remoteLoginPage(false, pageNext(url)));
        return;
      }
    }
  }

  // 配置类接口永远可用（不依赖档案）
  if (url.pathname === '/api/workflows-xml' && req.method === 'GET') {
    const workflows = ws?.workflowStore?.readAll() || [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ workflows }));
    return;
  }
  if (url.pathname === '/api/workflows-tree' && req.method === 'GET') {
    const tree = ws?.workflowStore?.tree(url.searchParams.get('workflowId') || '') || [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ tree, root: ws?.workflowStore?.dir || '' }));
    return;
  }
  if (url.pathname === '/api/workflows-file' && req.method === 'GET') {
    if (!ws?.workflowStore) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not-ready' })); return; }
    try {
      const text = ws.workflowStore.readFile(url.searchParams.get('path') || '');
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(text);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e && e.message || e) }));
    }
    return;
  }
  if (url.pathname === '/api/workflows-reveal' && req.method === 'POST') {
    if (!ws?.workflowStore) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not-ready' })); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      let abs = '';
      try { abs = ws.workflowStore.absPath(typeof body.path === 'string' ? body.path : ''); }
      catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'bad-path' })); return; }
      let st = null;
      try { st = fs.statSync(abs); } catch { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not-found' })); return; }
      if (!revealInOs(abs, st.isDirectory())) { res.writeHead(501, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'unsupported' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, abs }));
    });
    return;
  }
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    const c = loadDevflowConfig(configFile);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ default: c.agents.default, agents: c.agents.list, chosen: !!c.agents.chosen }));
    return;
  }
  if (url.pathname === '/api/agents/default' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      try {
        const r = setDefaultAgent(configFile, body.id);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, default: r.default }));
      } catch (e) {
        const code = (e && e.code === 'bad-agent') ? 400 : 500;
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: (e && e.code) || 'error', message: String((e && e.message) || e) }));
      }
    });
    return;
  }
  if (url.pathname === '/api/version' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ version: VERSION }));
    return;
  }
  if (url.pathname === '/api/upgrade' && req.method === 'GET') {
    const r = await upgradeChecker.check(url.searchParams.get('refresh') === '1');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(r));
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
      res.end(JSON.stringify({ settings: { ...s, host: HOST, port: PORT }, envPort: process.env.DEVFLOW_PORT || null, currentPort: PORT, host: HOST, portSource: PORT_SOURCE, restartable: canRestart }));
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
  if (url.pathname === '/api/file-assoc' && req.method === 'GET') {
    const pref = loadFileAssocPref(ws?.paths?.dir);
    const st = await getFileAssocState({ appDir: APP_DIR });
    const extensions = st.extensions.map((x) => ({ ext: x.ext, isDefault: x.isDefault, enabled: pref.selected.includes(x.ext) }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ available: st.available, enabled: !!pref.enabled, prompted: !!pref.prompted, extensions }));
    return;
  }
  if (url.pathname === '/api/file-assoc' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const avail = fileAssocAvailable({ appDir: APP_DIR });
      if (!avail.ok) {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'not-available' }));
        return;
      }
      const next = saveFileAssocPref(ws?.paths?.dir, { enabled: !!body.enabled, prompted: true, selected: body.selected });
      runFileAssoc(APP_DIR, next.enabled ? 'apply' : 'remove');
      const st = await getFileAssocState({ appDir: APP_DIR });
      const extensions = st.extensions.map((x) => ({ ext: x.ext, isDefault: x.isDefault, enabled: next.selected.includes(x.ext) }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ available: true, enabled: next.enabled, prompted: true, extensions }));
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
      local: isLocalReq(req),
      expiresAt: inv ? inv.expiresAt : null,
      forever: !!inv && inv.expiresAt === 0,
      address: lanAddress(),
      users: remoteUsers ? remoteUsers.list().length : 0,
      needRestart: hostRestartNeeded({ current: HOST, masterOn: !!inv, envHost: process.env.DEVFLOW_HOST }),
      locked: remoteLocked(),
      lockedUntil: remoteLocked() ? remoteLockedUntil : null,
    }));
    return;
  }
  if (url.pathname === '/api/remote/reveal' && req.method === 'GET') {
    if (!isLocalReq(req)) { denyRemote(res); return; }
    const inv = activeInvite();
    if (!inv) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ enabled: false }));
      return;
    }
    const { address, link, publicKey: pk } = inviteLink(inv);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ enabled: true, password: inv.password, token: inv.token, link, address, publicKey: pk, expiresAt: inv.expiresAt, forever: inv.expiresAt === 0 }));
    return;
  }
  if (url.pathname === '/api/master/stats' && req.method === 'GET') {
    if (!isLocalReq(req)) { denyRemote(res); return; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ stats: ws ? ws.historyStats() : { totals: { messages: 0, chars: 0, sessions: 0, users: 0 }, users: [], sessions: [], months: [], days: [] } }));
    return;
  }
  if (url.pathname === '/api/remote/users' && req.method === 'GET') {
    if (!isLocalReq(req)) { denyRemote(res); return; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ items: remoteUsers ? remoteUsers.list() : [] }));
    return;
  }
  if (url.pathname === '/api/remote/users' && req.method === 'POST') {
    if (!isLocalReq(req)) { denyRemote(res); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      try {
        const item = remoteUsers.create({ username: body.username, token: body.token });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ item }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.code || 'bad-request' }));
      }
    });
    return;
  }
  if (url.pathname === '/api/remote/users' && req.method === 'PATCH') {
    if (!isLocalReq(req)) { denyRemote(res); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      try {
        const item = remoteUsers.update(url.searchParams.get('id') || '', body);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ item }));
      } catch (e) {
        res.writeHead(e.code === 'not-found' ? 404 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.code || 'bad-request' }));
      }
    });
    return;
  }
  if (url.pathname === '/api/remote/users' && req.method === 'DELETE') {
    if (!isLocalReq(req)) { denyRemote(res); return; }
    const removed = remoteUsers ? remoteUsers.remove(url.searchParams.get('id') || '') : false;
    res.writeHead(removed ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: removed, error: removed ? undefined : 'not-found' }));
    return;
  }
  if (url.pathname === '/api/remote/invite' && req.method === 'POST') {
    if (!isLocalReq(req)) { denyRemote(res); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const days = resolveInviteDaysAllowForever(body);   // days=0 = 长期不过期；缺省 1 天，最长 100 天
      const token = crypto.randomBytes(24).toString('hex');
      const password = crypto.randomBytes(16).toString('base64url');        // 22 字符，≥16
      remoteInvite = { token, password, expiresAt: days === 0 ? 0 : Date.now() + Math.min(days * 24 * 3600 * 1000, MAX_TTL_MS) };
      if (ws && ws.paths) saveInvite(ws.paths.inviteFile, remoteInvite);
      remoteFails = 0;
      remoteLockedUntil = 0;
      let needRestart = hostRestartNeeded({ current: HOST, masterOn: true, envHost: process.env.DEVFLOW_HOST });
      if (ws && ws.engine) ws.engine.ensureGroup();
      const { address: addr, link, publicKey: pk } = inviteLink(remoteInvite);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ enabled: true, token, password, days, expiresAt: remoteInvite.expiresAt, link, address: addr, publicKey: pk, needRestart }));
    });
    return;
  }
  if (url.pathname === '/api/remote/revoke' && req.method === 'POST') {
    if (!isLocalReq(req)) { denyRemote(res); return; }
    remoteInvite = null;
    if (ws && ws.paths) clearInvite(ws.paths.inviteFile);
    remoteFails = 0;
    remoteLockedUntil = 0;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ enabled: false, needRestart: hostRestartNeeded({ current: HOST, masterOn: false, envHost: process.env.DEVFLOW_HOST }) }));
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
      try {
        if (/<workflows\b/i.test(xml)) ws?.workflowStore?.migrateFromConfigXml();
        ws?.workflowSeedStore?.update(ws?.workflowStore?.readAll() || []);
      } catch { /* ignore */ }
      setLocale(parsed.server.language);
      for (const conn of (gateway?.conns || [])) conn.send({ type: S2C.CONFIG_CHANGED });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, workflows: parsed.workflows }));
    });
    return;
  }
  if (url.pathname === '/api/workflows-seed' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(ws?.workflowSeedStore?.read() || { version: 0, updatedAt: 0, workflows: [] }));
    return;
  }
  if (url.pathname === '/api/workflows' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      let saved;
      try { saved = ws?.workflowStore?.writeAll(body.workflows) || []; }
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
    const projectId = url.searchParams.get('project') || '';
    const uid = remoteUserOf(req)?.id || '';
    const messages = projectId
      ? readHistory(ws.historyFileFor(projectId, uid))
      : ws.readHistoryAll(uid);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ messages, file: ws.historyFileFor(projectId, uid), projectId }));
    return;
  }
  if (url.pathname === '/api/history' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const projectId = typeof body.projectId === 'string' ? body.projectId : (url.searchParams.get('project') || '');
      const ru = remoteUserOf(req);
      const uid = ru?.id || '';
      if (Array.isArray(body.events)) {
        ws.inputStats?.recordMany({ userId: uid, userName: ru?.username || '', events: body.events });
      }
      let messages;
      if (typeof body.append === 'string') messages = appendHistory(ws.historyFileFor(projectId, uid), body.append);
      else if (Array.isArray(body.messages)) messages = ws.writeHistorySplit(body.messages, uid);
      else { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'messages[] or append required' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ messages }));
    });
    return;
  }
  if (ws && ws.proxyEngine && ws.proxyEngine.matchPath(url.pathname)) {
    ws.proxyEngine.handleHttp(req, res, url);
    return;
  }
  if (url.pathname.startsWith('/api/llm')) { await ws.llmMount(req, res, url); return; }
  if (url.pathname.startsWith('/api/translate')) { await ws.translateMount(req, res, url); return; }
  if (url.pathname.startsWith('/api/collab')) { await ws.collabMount(req, res); return; }
  if (url.pathname.startsWith('/api/usage/')) { await ws.usageMount(req, res, url); return; }
  if (url.pathname.startsWith('/api/scheduler/jobs') || url.pathname === '/api/scheduler/workers' || url.pathname.startsWith('/api/scheduler/queue')) {
    await ws.scheduler.jobsMount(req, res); return;
  }
  if (url.pathname.startsWith('/api/scheduler')) { await ws.scheduler.mount(req, res); return; }
  if (url.pathname.startsWith('/api/navicat')) { await ws.navicatMount(req, res, url); return; }
  if (url.pathname.startsWith('/api/nginx')) { await ws.proxyMount(req, res, url); return; }
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

    try {
      const pref = loadFileAssocPref(portPaths(actual).dir);
      if (pref.enabled && fileAssocAvailable({ appDir: APP_DIR }).ok) runFileAssoc(APP_DIR, 'apply');
    } catch { /* ignore */ }

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
        workflowsDir: path.join(stateRoot, 'workflows'),
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
