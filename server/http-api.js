import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { transformSync } from 'esbuild';
import { collectGitChanges } from './git-log.js';

export const requireAuthHttp = async () => true; // TODO(安全): 认证暂缓，接入反�?Token 后在此实�?

// 在宿主机上用系统文件管理器展示目标（文件 → 定位选中；目录 → 打开）。
// Windows：直接 spawn explorer（/select 必须作为同一参数），不要用 cmd start（会回退到“文档”）。
function revealInOs(abs, isDir) {
  if (process.platform === 'win32') {
    const arg = isDir ? abs : `/select,${abs}`;
    const p = spawn('explorer', [arg], { detached: true, stdio: 'ignore' });
    p.unref();
    // 尝试把资源管理器窗口置顶（best-effort，晚 400ms 激活最新 explorer 窗口）
    setTimeout(() => {
      const focus = spawn('powershell.exe', [
        '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
        `$sh=New-Object -ComObject WScript.Shell; $w=Get-Process explorer | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -Last 1; if ($w) { [void]$sh.AppActivate($w.Id) }`,
      ], { detached: true, stdio: 'ignore', windowsHide: true });
      focus.unref();
    }, 400);
    return true;
  }
  if (process.platform === 'darwin') {
    const p = spawn('open', isDir ? [abs] : ['-R', abs], { detached: true, stdio: 'ignore' });
    p.unref();
    return true;
  }
  if (process.platform === 'linux') {
    const p = spawn('xdg-open', [isDir ? abs : path.dirname(abs)], { detached: true, stdio: 'ignore' });
    p.unref();
    return true;
  }
  return false;
}

const RUNNABLE_EXT = new Set(['bat', 'cmd', 'ps1', 'sh']);
// 执行脚本（双击效果：独立进程/独立控制台窗口，不阻塞请求）。
function runScript(abs, ext) {
  if (process.platform !== 'win32') {
    if (ext === 'sh') {
      const p = spawn('bash', [abs], { detached: true, stdio: 'ignore' });
      p.unref();
      return true;
    }
    return false;
  }
  if (ext === 'bat' || ext === 'cmd') {
    const p = spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath ${JSON.stringify(abs)}`], { detached: true, stdio: 'ignore', windowsHide: false });
    p.unref();
    return true;
  }
  if (ext === 'ps1') {
    const p = spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${JSON.stringify(abs)}`], { detached: true, stdio: 'ignore', windowsHide: false });
    p.unref();
    return true;
  }
  return false;
}

const RAW_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

export function createHttpApi({ projects }) {
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
        if (!runScript(abs, ext)) return sendJson(res, 501, { error: 'platform not supported' });
        sendJson(res, 200, { ok: true, platform: process.platform });
        return;
      }
      if (url.pathname === '/api/explorer/reveal' && req.method === 'POST') {
        const project = url.searchParams.get('project');
        const rel = url.searchParams.get('path') || '';
        const { abs, isDir } = projects.revealTarget(project, rel);
        if (!fs.existsSync(abs)) return sendJson(res, 404, { error: 'file not found' });
        if (!revealInOs(abs, isDir)) return sendJson(res, 501, { error: 'platform not supported' });
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
        sendJson(res, 200, await collectGitChanges({ repoPath: body.repoPath, since: body.since, until: body.until }));
        return;
      }
    } catch (err) {
      if (err.code === 'not-a-repo') return sendJson(res, 400, { error: 'not a git repo' });
      if (err.code === 'bad-date') return sendJson(res, 400, { error: 'bad date' });
      if (err.code === 'bad-range') return sendJson(res, 400, { error: 'bad range' });
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
