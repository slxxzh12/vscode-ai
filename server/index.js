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
import { resolveFiles, loadProjects, loadWorkflows } from './config.js';
import { CollabStore } from './collaboration/store.js';
import { loadIdentity } from './collaboration/identity.js';
import { CollabEngine } from './collaboration/engine.js';
import { createCollabMount } from './collaboration/http-mount.js';
import { makePeerClient } from './collaboration/peer-client.js';
import { createEventBus } from './collaboration/event-bus.js';
import { CollabS2C } from '@devflow/shared/collab';
import { loadWorkflowXml, defaultWorkflowFile } from './workflow-xml.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('[server]');
const workflowXmlFile = defaultWorkflowFile(path.join(__dirname, '..'));

process.on('uncaughtException', (err) => log.error('uncaughtException', err));   // 三层兜底 #3
process.on('unhandledRejection', (err) => log.error('unhandledRejection', err));

const files = resolveFiles();
const projects = new Projects({ projects: loadProjects(files.projectsFile), logger: log });
const workflows = loadWorkflows(files.workflowsFile);
const sessionManager = new SessionManager({
  logger: log,
  projectResolver: (id) => projects.listProjects().find((p) => p.id === id)?.root ?? null,
});
const workflowRunner = new WorkflowRunner({ sessionManager, workflows, logger: log });

// requireAuth 占位钩子（spec §11）：HTTP 用 requireAuthHttp，WS 走 upgrade 处的 requireAuthWs
const requireAuthWs = () => true; // TODO(安全): 接入 Token 后校验 ws 握手

// ---- 协作子系统（隔离目录 server/collaboration/**，数据存用户数据目录）----
import { collabDir, uploadDir, downloadDir, seedFromLegacy, instanceName, instanceSeedDir, instanceFpRoot } from './data-home.js';
import { publicFingerprint } from './collaboration/identity.js';
const HOST_DEFAULT = process.env.DEVFLOW_HOST || '127.0.0.1';
const PORT_DEFAULT = Number(process.env.DEVFLOW_PORT || 3001);
const NODE = instanceName();

// 多实例引导：DEVFLOW_NODE=某名 → 该实例自己的 identity（nodes/<名>），其余状态按公钥指纹隔离；
// 默认实例（未设 DEVFLOW_NODE）沿用老布局 <root>/collab + <root>/upload|download，不迁移。
let identityFile;
let storeFile;
let upDir;
let downDir;
let skillDefaultRoot;
if (NODE) {
  const seedDir = instanceSeedDir(NODE);
  identityFile = path.join(seedDir, 'identity.json');
  storeFile = null; upDir = null; downDir = null;
} else {
  const COLLAB_DIR = collabDir();
  seedFromLegacy(path.join(COLLAB_DIR, 'identity.json'), path.join(__dirname, 'collaboration', 'identity.json'));
  seedFromLegacy(path.join(COLLAB_DIR, 'collab.json'), path.join(__dirname, 'collaboration', 'collab.json'));
  identityFile = path.join(COLLAB_DIR, 'identity.json');
  storeFile = path.join(COLLAB_DIR, 'collab.json');
  upDir = uploadDir();
  downDir = downloadDir();
  skillDefaultRoot = process.env.DEVFLOW_COLLAB_SKILLS || path.join(os.homedir(), '.config', 'opencode', 'skills');
}

const collabIdentity = loadIdentity({
  file: identityFile,
  host: HOST_DEFAULT,
  port: PORT_DEFAULT,
});
const nodeFp = publicFingerprint(collabIdentity.publicKey);

if (NODE) {
  // 状态按本实例公钥指纹隔离（同一密钥永远同一目录；不同密钥互不干扰）
  const fp = nodeFp;
  const stateRoot = instanceFpRoot(fp);
  storeFile = path.join(stateRoot, 'collab.json');
  upDir = path.join(stateRoot, 'upload');
  downDir = path.join(stateRoot, 'download');
  skillDefaultRoot = process.env.DEVFLOW_COLLAB_SKILLS || path.join(stateRoot, 'skills-opencode');
  fs.mkdirSync(upDir, { recursive: true });
  fs.mkdirSync(downDir, { recursive: true });
  fs.mkdirSync(skillDefaultRoot, { recursive: true });
}

const collabEventBus = createEventBus();
let gateway;                                  // 后续 createGateway 赋值
const broadcastCollab = (type, payload) => {
  if (!gateway) return;
  for (const c of gateway.conns) c.send({ type, ...payload });
};
const collabEngine = new CollabEngine({
  store: new CollabStore({ file: storeFile, logger: log }),
  identity: collabIdentity,
  skillsRoot: skillDefaultRoot,
  uploadDir: upDir,
  downloadDir: downDir,
  events: collabEventBus,
  logger: log,
});
collabEngine.peer = makePeerClient();
const collabMount = createCollabMount({ engine: collabEngine, logger: log });
collabEventBus.on('friend-request', (payload) => broadcastCollab(CollabS2C.COLLAB_FRIEND_REQ, payload));
collabEventBus.on('group-invite', (payload) => broadcastCollab(CollabS2C.COLLAB_GROUP_INVITE, payload));
collabEventBus.on('inbox', (payload) => broadcastCollab(CollabS2C.COLLAB_INBOX, payload));
collabEventBus.on('synced', () => broadcastCollab(CollabS2C.COLLAB_SYNCED, {}));
collabEventBus.on('chat', (payload) => broadcastCollab(CollabS2C.COLLAB_CHAT, { groupId: payload.groupId, msg: payload.msg }));
collabEventBus.on('cmd-pending', (payload) => broadcastCollab(CollabS2C.COLLAB_CMD_PENDING, payload));

const server = http.createServer(async (req, res) => {
  if (!(await requireAuthHttp(req, res))) { res.writeHead(401); res.end(); return; }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/workflows-xml' && req.method === 'GET') {
    const workflows = loadWorkflowXml(workflowXmlFile);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ workflows }));
    return;
  }
  if (url.pathname.startsWith('/api/collab')) { await collabMount(req, res); return; }
  if (url.pathname.startsWith('/api/')) {
    await createHttpApi({ projects })(req, res);
    return;
  }
  createStaticServer(path.join(__dirname, '..', 'web', 'dist'))(req, res, () => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
});

gateway = createGateway({ httpServer: server, sessionManager, workflowRunner, requireAuthWs, log });

const HOST = process.env.DEVFLOW_HOST || '127.0.0.1';
const PORT = Number(process.env.DEVFLOW_PORT || 3001);
server.listen(PORT, HOST, () => {
  collabEngine.setAdvertised({ host: HOST, port: PORT });
  log.info(`listening on http://${HOST}:${PORT}  (ws: ws://${HOST}:${PORT}/ws)`);
  log.info(`collab node=${NODE || 'default'} fp=${nodeFp} store=${storeFile}`);
});

export { server, sessionManager, workflowRunner, projects };
