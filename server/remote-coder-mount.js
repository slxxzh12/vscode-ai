// /api/remote-coder/* 端点：手机发命令/消息，桌面端取件与回执。文件与 git 全在 store 里。
// 只吃注入的 sendJson/readJsonBody，不认识 http-api 内部实现。
import fs from 'node:fs';
import path from 'node:path';
import * as defaultStore from './remote-coder-store.js';

const PREFIX = '/api/remote-coder';

export function createRemoteCoder({ repoRoot, logger = console, store = defaultStore, git, isGitRepoFn } = {}) {
  const dir = store.dirOf(repoRoot);
  return async function handle({ pathname, req, res, sendJson, readJsonBody }) {
    if (!pathname.startsWith(PREFIX)) return false;
    try {
      if (pathname === `${PREFIX}/inbox` && req.method === 'GET') {
        sendJson(res, 200, { entries: store.inbox(dir) });
        return true;
      }
      if (pathname === `${PREFIX}/state` && req.method === 'GET') {
        sendJson(res, 200, { rev: store.screenRev(dir) });
        return true;
      }
      if (pathname === `${PREFIX}/message` && req.method === 'POST') {
        const body = await readJsonBody(req);
        const entry = store.makeEntry(body);
        store.appendMessage(dir, entry);
        sendJson(res, 200, { ok: true, id: entry.id });
        return true;
      }
      if (pathname === `${PREFIX}/ack` && req.method === 'POST') {
        const body = await readJsonBody(req);
        sendJson(res, 200, { ok: true, changed: store.markHandled(dir, body.ids) });
        return true;
      }
      if (pathname === `${PREFIX}/screen.png` && req.method === 'GET') {
        const file = path.join(dir, store.SCREEN_FILE);
        if (!fs.existsSync(file)) { sendJson(res, 404, { error: 'no-screen' }); return true; }
        const size = fs.statSync(file).size;
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': size, 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res);
        return true;
      }
      if (pathname === `${PREFIX}/screen` && req.method === 'POST') {
        const body = await readJsonBody(req, 32 * 1024 * 1024);
        const saved = store.saveScreen(dir, body.dataUrl);
        const commit = await store.commitScreen(repoRoot, { git, isGitRepoFn });
        logger?.info?.('remote-coder: screen saved', saved.bytes, commit.uploaded ? '(pushed)' : `(${commit.reason || 'local'})`);
        sendJson(res, 200, { ok: true, rev: saved.rev, uploaded: commit.uploaded, reason: commit.reason });
        return true;
      }
      sendJson(res, 400, { error: 'bad-request' });
      return true;
    } catch (err) {
      if (err.code === 'bad-image' || err.code === 'bad-message' || err.code === 'bad-jsonc') {
        sendJson(res, 400, { error: err.code, message: String(err.message) });
        return true;
      }
      if (err.code === 'too-large') { sendJson(res, 413, { error: 'too-large' }); return true; }
      sendJson(res, 500, { error: 'internal', message: String((err && err.message) || err) });
      return true;
    }
  };
}
