import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionManager } from './session-manager.js';
import { WorkflowRunner } from './workflow-runner.js';
import { createGateway } from './ws-gateway.js';
import { createHttpApi, requireAuthHttp } from './http-api.js';
import { Projects } from './projects.js';
import { createLogger } from './log.js';
import { createStaticServer } from './static.js';
import { resolveFiles, loadProjects, loadWorkflows } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('[server]');

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

const server = http.createServer(async (req, res) => {
  if (!(await requireAuthHttp(req, res))) { res.writeHead(401); res.end(); return; }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    await createHttpApi({ projects })(req, res);
    return;
  }
  createStaticServer(path.join(__dirname, '..', 'web', 'dist'))(req, res, () => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
});

createGateway({ httpServer: server, sessionManager, workflowRunner, requireAuthWs, log });

const HOST = process.env.DEVFLOW_HOST || '127.0.0.1';
const PORT = Number(process.env.DEVFLOW_PORT || 3001);
server.listen(PORT, HOST, () => {
  log.info(`listening on http://${HOST}:${PORT}  (ws: ws://${HOST}:${PORT}/ws)`);
});

export { server, sessionManager, workflowRunner, projects };
