import fs from 'node:fs';
import path from 'node:path';
import { transformSync } from 'esbuild';
import { collectGitChanges } from './git-log.js';
import { collectCodeStats } from './code-count.js';
import { createCodeGroups } from './code-groups.js';
import { createCodePrefs } from './code-prefs.js';
import { createComposerPrefs } from './composer-prefs.js';
import { createSessionProjects } from './session-projects.js';
import { createWindowState } from './window-state.js';
import { buildZip, safeZipName } from './collaboration/zip.js';
import { createRemoteCoder } from './remote-coder-mount.js';
import { pickFolder, pickAnyFile } from './native-dialog.js';
import { revealInOs } from './reveal.js';
import { runScript, RUNNABLE_EXT } from './run-script.js';
import { runCurl } from './curl-run.js';

export const requireAuthHttp = async () => true; // TODO(安全): 认证暂缓，接入反�?Token 后在此实�?

const RAW_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

// 读取任意绝对路径的文本文件（供对比面板“其他目录文件”用；路径来自服务端原生文件对话框）
function readAbsText(abs, maxBytes = 1024 * 1024) {
  const st = fs.statSync(abs);
  const size = st.size;
  const base = { name: path.basename(abs), path: abs, size, mtime: st.mtimeMs, abs };
  if (size > 0) {
    const probeLen = Math.min(size, 64 * 1024);
    const buf = Buffer.alloc(probeLen);
    const fd = fs.openSync(abs, 'r');
    try {
      fs.readSync(fd, buf, 0, probeLen, 0);
      if (buf.includes(0)) return { ...base, binary: true };
    } finally {
      fs.closeSync(fd);
    }
  }
  if (size > maxBytes) { const e = new Error('file too large'); e.code = 'too-large'; throw e; }
  return { ...base, binary: false, content: fs.readFileSync(abs, 'utf8') };
}

export function createHttpApi({ projects, saveProjects = null, logger = console, repoRoot = process.cwd(), codeGroups = createCodeGroups({}), codePrefs = createCodePrefs({}), composerPrefs = createComposerPrefs({}), sessionProjects = createSessionProjects({}), windowState = createWindowState({}), sessionLedger = null, pickFolderFn = pickFolder, pickAnyFileFn = pickAnyFile, remoteCoder = null, remoteCoderGit = undefined, remoteCoderIsGitRepo = undefined, revealInOsFn = revealInOs, runScriptFn = runScript, runCurlFn = runCurl, postmanHistory = null }) {
  const remoteCoderFn = remoteCoder || createRemoteCoder({ repoRoot, logger, git: remoteCoderGit, isGitRepoFn: remoteCoderIsGitRepo });
  const sendJson = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  const readJsonBody = (req, limit = 4 * 1024 * 1024) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      req.on('data', (c) => {
        total += c.length;
        if (total > limit) { const e = new Error('body too large'); e.code = 'too-large'; reject(e); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) { resolve({}); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  return async (req, res) => {
    if (!(await requireAuthHttp(req, res))) { sendJson(res, 401, { error: 'unauthorized' }); return; }
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/projects' && req.method === 'GET') {
        sendJson(res, 200, { projects: projects.listProjects() });
        return;
      }
      if (url.pathname === '/api/open-file' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const r = projects.resolveAbsolute(String(body.path || ''));
        sendJson(res, 200, { ok: true, project: r.project, rel: r.rel });
        return;
      }
      if (url.pathname === '/api/projects/pick' && req.method === 'POST') {
        logger?.info?.('pick-folder: dialog opened');
        const r = await pickFolderFn();
        logger?.info?.('pick-folder:', r.error || (r.path ? 'ok' : 'cancelled'));
        if (r.error) return sendJson(res, 200, { error: r.error, message: r.message || null });
        if (r.cancelled || !r.path) return sendJson(res, 200, { cancelled: true });
        return sendJson(res, 200, { path: r.path });
      }
      if (url.pathname === '/api/projects' && req.method === 'POST') {
        let body;
        try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: 'bad body' }); return; }
        const raw = typeof body.path === 'string' ? body.path.trim() : '';
        if (!raw) { sendJson(res, 400, { error: 'path required' }); return; }
        const abs = path.resolve(raw);
        let st;
        try { st = fs.statSync(abs); } catch { sendJson(res, 404, { error: 'path not found' }); return; }
        if (!st.isDirectory()) { sendJson(res, 400, { error: 'not a directory' }); return; }
        const list = projects.rawProjects();
        const norm = abs.replace(/[\\/]+$/, '').toLowerCase();
        if (list.some((p) => path.resolve(p.root).replace(/[\\/]+$/, '').toLowerCase() === norm)) {
          sendJson(res, 409, { error: 'already added' });
          return;
        }
        const base = path.basename(abs) || abs;
        const slug = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
        const ids = new Set(list.map((p) => p.id));
        let id = slug, i = 2;
        while (ids.has(id)) id = `${slug}-${i++}`;
        const name = (typeof body.name === 'string' && body.name.trim()) || base;
        const proj = projects.addProject({ id, name, root: abs });
        try { saveProjects?.(); } catch { /* ignore */ }
        sendJson(res, 200, { project: { id: proj.id, name: proj.name, root: proj.root } });
        return;
      }
      if (url.pathname === '/api/tree' && req.method === 'GET') {
        const project = url.searchParams.get('project');
        const rel = url.searchParams.get('path') || '';
        const items = projects.tree(project, rel);
        sendJson(res, 200, { items });
        return;
      }
      if (url.pathname === '/api/run-script' && req.method === 'POST') {
        const project = url.searchParams.get('project');
        const rel = url.searchParams.get('path') || '';
        const { abs } = projects.revealTarget(project, rel);
        const ext = path.extname(abs).toLowerCase().replace('.', '');
        if (!RUNNABLE_EXT.has(ext)) return sendJson(res, 400, { error: 'unsupported script type' });
        if (!runScriptFn(abs, ext)) return sendJson(res, 501, { error: 'platform not supported' });
        sendJson(res, 200, { ok: true, platform: process.platform });
        return;
      }
      if (url.pathname === '/api/explorer/reveal' && req.method === 'POST') {
        const project = url.searchParams.get('project');
        const rel = url.searchParams.get('path') || '';
        const { abs, isDir } = projects.revealTarget(project, rel);
        if (!fs.existsSync(abs)) return sendJson(res, 404, { error: 'file not found' });
        if (!revealInOsFn(abs, isDir)) return sendJson(res, 501, { error: 'platform not supported' });
        sendJson(res, 200, { ok: true, platform: process.platform });
        return;
      }
      if (url.pathname === '/api/file' && req.method === 'GET') {
        const project = url.searchParams.get('project');
        const rel = url.searchParams.get('path') || '';
        const f = projects.readText(project, rel);
        sendJson(res, 200, f);
        return;
      }
      if (url.pathname === '/api/file' && req.method === 'POST') {
        const project = url.searchParams.get('project');
        const rel = url.searchParams.get('path') || '';
        const body = await readJsonBody(req);
        if (body.create) {
          const f = body.dir
            ? projects.createDir(project, rel)
            : projects.createFile(project, rel, typeof body.content === 'string' ? body.content : '');
          sendJson(res, 200, f);
          return;
        }
        if (typeof body.content !== 'string') return sendJson(res, 400, { error: 'content required' });
        const f = projects.writeText(project, rel, body.content);
        sendJson(res, 200, f);
        return;
      }
      if (url.pathname === '/api/file/pick' && req.method === 'POST') {
        const r = await pickAnyFileFn();
        if (r.error) return sendJson(res, 200, { error: r.error, message: r.message || null });
        if (r.cancelled || !r.path) return sendJson(res, 200, { cancelled: true });
        sendJson(res, 200, readAbsText(r.path));
        return;
      }
      // 只返回所选文件路径（不读内容），供终端输入框插入「文�?图片路径」用
      if (url.pathname === '/api/file/pick-path' && req.method === 'POST') {
        const r = await pickAnyFileFn();
        if (r.error) return sendJson(res, 200, { error: r.error, message: r.message || null });
        if (r.cancelled || !r.path) return sendJson(res, 200, { cancelled: true });
        sendJson(res, 200, { path: r.path });
        return;
      }
      if (url.pathname === '/api/file/meta' && req.method === 'GET') {
        const project = url.searchParams.get('project');
        const rel = url.searchParams.get('path') || '';
        sendJson(res, 200, projects.meta(project, rel));
        return;
      }
      if (url.pathname === '/api/file/hash' && req.method === 'GET') {
        const project = url.searchParams.get('project');
        const rel = url.searchParams.get('path') || '';
        sendJson(res, 200, await projects.hash(project, rel));
        return;
      }
      if (url.pathname === '/api/format' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const name = String(body.name || '');
        const content = String(body.content ?? '');
        const ext = path.extname(name).toLowerCase().slice(1);
        let out;
        if (ext === 'json') {
          try { out = JSON.stringify(JSON.parse(content)); } catch (e) { return sendJson(res, 400, { error: 'invalid json', message: String(e?.message || e) }); }
        } else if (['js', 'mjs', 'cjs', 'jsx'].includes(ext)) {
          try {
            const r = transformSync(content, { minify: true, loader: ext === 'jsx' ? 'jsx' : 'js' });
            out = r.code.replace(/\n/g, '');   // 压成一�?
          } catch (e) { return sendJson(res, 400, { error: 'invalid javascript', message: String(e?.message || e) }); }
        } else {
          return sendJson(res, 400, { error: 'unsupported type' });
        }
        sendJson(res, 200, { content: out, size: Buffer.byteLength(out, 'utf8') });
        return;
      }
      if (url.pathname === '/api/curl' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const command = String(body.command ?? '');
        if (!command.trim()) return sendJson(res, 400, { error: 'empty' });
        try {
          const result = await runCurlFn(command);
          try { postmanHistory?.record?.(command, result, { folder: String(body.folder ?? '') }); } catch (e) { logger?.warn?.('postman history write failed:', e?.message || e); }
          sendJson(res, 200, result);
        } catch (e) {
          sendJson(res, 400, { error: e?.code || 'bad-command', message: String(e?.message || e) });
        }
        return;
      }
      if (url.pathname === '/api/postman/history' && req.method === 'GET') {
        sendJson(res, 200, { items: postmanHistory?.list?.() ?? [], folders: postmanHistory?.listFolders?.() ?? [] });
        return;
      }
      if (url.pathname === '/api/postman/history' && req.method === 'DELETE') {
        const ok = postmanHistory?.remove?.(url.searchParams.get('id') || '') ?? false;
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not-found' });
        return;
      }
      if (url.pathname === '/api/postman/folder' && req.method === 'POST') {
        const body = await readJsonBody(req);
        try {
          const folder = postmanHistory?.createFolder?.(String(body.path ?? '')) ?? '';
          sendJson(res, 200, { ok: true, folder });
        } catch (e) {
          sendJson(res, 400, { error: e?.code || 'bad-path' });
        }
        return;
      }
      if (url.pathname === '/api/postman/folder' && req.method === 'PATCH') {
        const body = await readJsonBody(req);
        try {
          const folder = postmanHistory?.renameFolder?.(String(body.path ?? ''), String(body.name ?? '')) ?? '';
          sendJson(res, 200, { ok: true, path: folder });
        } catch (e) {
          sendJson(res, 400, { error: e?.code || 'bad-path' });
        }
        return;
      }
      if (url.pathname === '/api/postman/folder' && req.method === 'DELETE') {
        const ok = postmanHistory?.removeFolder?.(url.searchParams.get('path') || '') ?? false;
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not-found' });
        return;
      }
      if (url.pathname === '/api/postman/history' && req.method === 'PATCH') {
        const body = await readJsonBody(req);
        const ok = postmanHistory?.setRecordTitle?.(String(body.id ?? ''), String(body.title ?? '')) ?? false;
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not-found' });
        return;
      }
      if (url.pathname === '/api/postman/move' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const ok = postmanHistory?.move?.(String(body.id ?? ''), String(body.folder ?? '')) ?? false;
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not-found' });
        return;
      }
      if (url.pathname === '/api/raw' && req.method === 'GET') {
        const project = url.searchParams.get('project');
        const rel = url.searchParams.get('path') || '';
        const { file, size, name } = projects.rawFile(project, rel);
        const ext = path.extname(name).toLowerCase();
        res.writeHead(200, {
          'Content-Type': RAW_MIME[ext] || 'application/octet-stream',
          'Content-Length': size,
          'Cache-Control': 'no-store',
        });
        fs.createReadStream(file).pipe(res);
        return;
      }
      if (url.pathname === '/api/git/changes' && req.method === 'POST') {
        const body = await readJsonBody(req);
        sendJson(res, 200, await collectGitChanges({ repo: body.repo, since: body.since, until: body.until, filter: body.filter }));
        return;
      }
      if (url.pathname === '/api/code/groups' && req.method === 'GET') {
        sendJson(res, 200, codeGroups.read());
        return;
      }
      if (url.pathname === '/api/code/groups' && req.method === 'POST') {
        const body = await readJsonBody(req);
        sendJson(res, 200, codeGroups.write(body));
        return;
      }
      if (url.pathname === '/api/code/prefs' && req.method === 'GET') {
        sendJson(res, 200, codePrefs.read());
        return;
      }
      if (url.pathname === '/api/code/prefs' && req.method === 'POST') {
        const body = await readJsonBody(req);
        sendJson(res, 200, codePrefs.write(body));
        return;
      }
      if (url.pathname === '/api/composer/prefs' && req.method === 'GET') {
        sendJson(res, 200, composerPrefs.read());
        return;
      }
      if (url.pathname === '/api/composer/prefs' && req.method === 'POST') {
        const body = await readJsonBody(req);
        sendJson(res, 200, composerPrefs.write(body));
        return;
      }
      if (url.pathname === '/api/sessions' && req.method === 'GET') {
        sendJson(res, 200, { sessions: sessionLedger ? sessionLedger.read().sessions : [] });
        return;
      }
      if (url.pathname === '/api/session-projects' && req.method === 'GET') {
        sendJson(res, 200, sessionProjects.read());
        return;
      }
      if (url.pathname === '/api/window-state' && req.method === 'GET') {
        sendJson(res, 200, windowState.read());
        return;
      }
      if (url.pathname === '/api/window-state' && req.method === 'POST') {
        const body = await readJsonBody(req);
        sendJson(res, 200, windowState.write(body));
        return;
      }
      if (url.pathname === '/api/code/stats' && req.method === 'POST') {
        const body = await readJsonBody(req);
        sendJson(res, 200, await collectCodeStats({ dir: body.dir, filter: body.filter }));
        return;
      }
      if (url.pathname === '/api/export/zip' && req.method === 'POST') {
        const body = await readJsonBody(req, 16 * 1024 * 1024);
        const files = Array.isArray(body.files) ? body.files : [];
        if (!files.length) return sendJson(res, 400, { error: 'bad-zip', message: 'no files' });
        if (files.length > 100) return sendJson(res, 413, { error: 'too-many-files' });
        let total = 0;
        const entries = [];
        for (const f of files) {
          const name = String((f && f.name) || '');
          if (!safeZipName(name)) return sendJson(res, 400, { error: 'bad-zip', message: name });
          const content = typeof f.content === 'string' ? f.content : '';
          total += Buffer.byteLength(content);
          entries.push({ name, data: Buffer.from(content, 'utf8') });
        }
        if (total > 8 * 1024 * 1024) return sendJson(res, 413, { error: 'too-large' });
        const raw = String(body.zipName || '').replace(/[^A-Za-z0-9._-]/g, '');
        const zipName = raw.endsWith('.zip') ? raw : `${raw || 'export'}.zip`;
        const zip = buildZip(entries);
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${zipName}"`, 'Content-Length': zip.length });
        res.end(zip);
        return;
      }
      if (await remoteCoderFn({ pathname: url.pathname, req, res, sendJson, readJsonBody })) return;
    } catch (err) {
      if (err.code === 'bad-image') return sendJson(res, 400, { error: 'bad image' });
      if (err.code === 'bad-dir') return sendJson(res, 400, { error: 'bad dir', message: String(err.message) });
      if (err.code === 'not-a-repo') return sendJson(res, 400, { error: 'not a git repo' });      if (err.code === 'bad-repo') return sendJson(res, 400, { error: 'bad repo', message: String(err.message) });
      if (err.code === 'bad-date') return sendJson(res, 400, { error: 'bad date' });
      if (err.code === 'bad-range') return sendJson(res, 400, { error: 'bad range' });
      if (err.code === 'clone-failed') return sendJson(res, 400, { error: 'clone failed', message: String(err.message) });
      if (err.code === 'clone-timeout') return sendJson(res, 400, { error: 'clone timeout', message: String(err.message) });
      if (err.code === 'git-unavailable') return sendJson(res, 500, { error: 'git unavailable', message: String(err.message) });
      if (err.code === 'forbidden') return sendJson(res, 403, { error: 'forbidden' });
      if (err.code === 'not-found') return sendJson(res, 404, { error: 'not found' });
      if (err.code === 'not-file') return sendJson(res, 400, { error: 'not a file' });
      if (err.code === 'too-large') return sendJson(res, 413, { error: 'file too large' });
      if (err.code === 'exists') return sendJson(res, 409, { error: 'already exists' });
      sendJson(res, 500, { error: 'internal', message: String(err && err.message || err) });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  };
}
