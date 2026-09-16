import fs from 'node:fs';
import path from 'node:path';
import { t } from '../i18n.js';

const MAX_BODY = 64 * 1024 * 1024; // 64MB（zip base64）
const MAX_UPLOAD = 40 * 1024 * 1024; // 40MB（raw 文件）

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => { total += c.length; if (total > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
// raw 二进制体（群内发文件），直接给 Buffer
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => { total += c.length; if (total > MAX_UPLOAD) { reject(new Error('file too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function ok(res, obj = {}) { sendJson(res, 200, obj); }

// 递归列出共享目录内的真实文件（相对路径），供「默认开放 downloads 目录」浏览/下载
function listDownloadFiles(root) {
  const out = [];
  const walk = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (r === 'manifest.json') continue;                 // 内部索引，不对外列出
      if (r === 'update.json') continue;                   // 同步种子，不对外列出
      if (d.isDirectory()) { walk(r); continue; }
      if (!d.isFile()) continue;
      try { const st = fs.statSync(path.join(root, r)); out.push({ name: r, size: st.size, updatedAt: st.mtimeMs }); } catch { /* ignore */ }
    }
  };
  walk('');
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

// 解析共享目录内的相对路径，越界返回 null
function resolveInside(root, name) {
  if (typeof name !== 'string' || !name || name.includes('..') || name.includes('\\')) return null;
  const base = path.resolve(root);
  const abs = path.resolve(base, name);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

export function createCollabMount({ engine, logger = console }) {
  async function route(req, res, url) {
    const m = req.method;
    const seg = url.pathname.replace(/^\/api\/collab/, '').split('/').filter(Boolean);
    // 仅 POST/PUT 读 body，避免 GET/DELETE 无 body 时挂起；群发文件走 raw body（另读）
    const isBodyMethod = ['POST', 'PUT'].includes(m);
    const isFileUpload = seg[0] === 'groups' && seg[2] === 'files' && m === 'POST';
    let body = {};
    if (isBodyMethod && !isFileUpload) {
      const bodyRaw = await readBody(req).catch(() => '');
      if (bodyRaw) { try { body = JSON.parse(bodyRaw); } catch { body = {}; } }
    }
    if (seg[0] === 'peer' && m === 'POST') {
      // 机器↔机器信封
      // 文件推送（file-push）额外校验请求头里的公钥+sha256 签名，防仿冒
      if (body && body.type === 'file-push') {
        const h = req.headers;
        const r = engine.verifyFileReceipt(h['x-df-pub'], h['x-df-sha'], h['x-df-sig']);
        if (!r.ok) return ok(res, { ok: false, error: r.error });
        let pubRaw = null;
        try { pubRaw = h['x-df-pub'] ? Buffer.from(h['x-df-pub'], 'base64').toString('utf8') : null; } catch { pubRaw = null; }
        if (body.from && pubRaw && body.from.publicKey !== pubRaw) {
          return ok(res, { ok: false, error: 'identity-mismatch' });
        }
        if (body.payload && body.payload.hash && h['x-df-sha'] !== body.payload.hash) {
          return ok(res, { ok: false, error: 'sha-mismatch' });
        }
      }
      const r = await engine.handleIncoming(body);
      return r.ok ? ok(res, r.data ? { ok: true, data: r.data } : { ok: true }) : ok(res, { ok: false, error: r.error });
    }
    try {
      // identity
      if (seg[0] === 'identity' && m === 'GET') return ok(res, { identity: engine.pub });
      if (seg[0] === 'identity' && m === 'PUT') { engine.setAdvertised({ host: body.host, port: body.port, employeeId: body.employeeId }); return ok(res, { identity: engine.pub }); }
      if (seg[0] === 'identity' && m === 'POST') { engine.setAdvertised({ host: body.host, port: body.port, employeeId: body.employeeId }); return ok(res, { identity: engine.pub }); }
      // 群公告（仅群主可改）
      if (seg[0] === 'announcement' && m === 'POST') {
        if (typeof engine.setAnnouncement !== 'function') return sendJson(res, 404, { error: 'not found' });
        const r = await engine.setAnnouncement(body.text);
        return r.ok ? ok(res, { group: r.group }) : sendJson(res, 400, { error: r.error });
      }
      // snapshot / friends / groups / invites / skills / distribute / inbox / pull
      if (seg.length === 1 && seg[0] === 'snapshot' && m === 'GET') {
        const inbox = engine.store.listInbox().map(({ zipPath, ...rest }) => rest);
        return ok(res, {
          identity: engine.pub,
          group: engine.store.getGroup(),
          groups: engine.store.listGroups(),
          heartbeats: (engine.peers && engine.peers.list) ? engine.peers.list() : {},
          skillsInbox: inbox,
          outbox: engine.store.listOutbox().map(({ storedFile, ...rest }) => rest),
          groupSkills: engine.store.listGroupSkills(),
        });
      }
      if (seg[0] === 'skills' && m === 'GET') return ok(res, { skills: listSkillsOf(engine.skillRoot()) });
      // 可打包资产清单 + 打包/发送两步
      if (seg[0] === 'assets' && m === 'GET') return ok(res, engine.listAssets());
      if (seg[0] === 'packages' && seg.length === 1 && m === 'POST') {
        try { const r = await engine.buildPackage({ skills: body.skills || [], command: body.command || [], agent: body.agent || [] }); return ok(res, { package: r }); }
        catch (e) { return sendJson(res, 400, { error: 'pack-failed', message: String(e && e.message || e) }); }
      }
      if (seg[0] === 'packages' && seg.length === 3 && seg[2] === 'send' && m === 'POST') {
        const r = await engine.sendPackage(seg[1], body.groupId);
        if (r.code !== 'ok') return sendJson(res, 400, { error: r.code });
        return ok(res, r);
      }
      if (seg[0] === 'packages' && seg.length === 3 && seg[2] === 'publish' && m === 'POST') {
        return ok(res, engine.publishPackage(seg[1]));
      }
      // 我发出的文件（upload 目录留档）下载
      if (seg[0] === 'outfile' && seg.length === 2 && m === 'GET') {
        const rec = engine.store.listOutbox().find((r) => r.id === seg[1]);
        if (!rec || !rec.storedFile || !engine.uploadDir) return sendJson(res, 404, { error: 'not found' });
        const abs = path.join(engine.uploadDir, path.basename(rec.storedFile));
        if (!fs.existsSync(abs)) return sendJson(res, 404, { error: 'file missing' });
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(rec.fileName || 'download')}`,
          'Content-Length': fs.statSync(abs).size,
        });
        fs.createReadStream(abs).pipe(res);
        return;
      }
      // 我的开发工具（决定技能目录）
      if (seg[0] === 'tool' && m === 'GET') return ok(res, engine.getToolInfo());
      if (seg[0] === 'tool' && m === 'POST') {
        const r = engine.setTool(body.kind, body.customRoot);
        if (r.code !== 'ok') return sendJson(res, 400, { error: r.code === 'need-custom-root' ? t('collab.err.need_custom_root') : r.code });
        return ok(res, r);
      }
      // 我的 upload/download 目录（下载页/收件箱辅助展示）
      if (seg[0] === 'dirs' && m === 'GET') return ok(res, { upload: engine.uploadDir || null, download: engine.downloadDir || null });
      // join（粘贴开启方链接入群）
      if (seg[0] === 'join' && seg.length === 1 && m === 'POST') {
        const r = await engine.joinByLink({ host: body.host, port: Number(body.port), token: body.token });
        return ok(res, r);
      }
      // downloads（master 共享目录；slave 点击时才拉取）
      if (seg[0] === 'downloads' && seg.length === 1 && m === 'GET') {
        return ok(res, { manifest: engine.readManifest(), usage: { members: (engine.peers && engine.peers.list) ? engine.peers.list() : {} }, group: engine.store.getGroup(), groups: engine.store.listGroups() });
      }
      if (seg[0] === 'downloads' && seg.length === 2 && seg[1] === 'sync' && m === 'POST') {
        return ok(res, await engine.pullDownloads());
      }
      // downloads 目录（默认开放的共享目录）：实时列出目录内真实文件
      if (seg[0] === 'downloads' && seg.length === 2 && seg[1] === 'dir' && m === 'GET') {
        return ok(res, { dir: engine.downloadsDir, files: listDownloadFiles(engine.downloadsDir) });
      }
      if (seg[0] === 'downloads' && seg.length === 2 && seg[1] === 'install' && m === 'POST') {
        return ok(res, engine.installDownload(body.name));
      }
      if (seg[0] === 'downloads' && seg.length === 3 && seg[1] === 'file' && m === 'GET') {
        const name = decodeURIComponent(seg[2]);
        const abs = resolveInside(engine.downloadsDir, name);
        if (!abs) return sendJson(res, 400, { error: 'bad-name' });
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return sendJson(res, 404, { error: 'not found' });
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': fs.statSync(abs).size,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(name))}`,
        });
        fs.createReadStream(abs).pipe(res);
        return;
      }
      // 同步种子（update.json）
      if (seg[0] === 'update' && seg.length === 1 && m === 'GET') {
        return ok(res, { update: engine.readUpdate() });
      }
      if (seg[0] === 'update' && seg.length === 2 && seg[1] === 'publish' && m === 'POST') {
        return ok(res, engine.publishUpdate(body.names || []));
      }
      if (seg[0] === 'update' && seg.length === 2 && seg[1] === 'check' && m === 'POST') {
        return ok(res, await engine.checkUpdate(body.masterId || undefined));
      }
      if (seg[0] === 'update' && seg.length === 2 && seg[1] === 'apply' && m === 'POST') {
        return ok(res, await engine.applyUpdate({ masterId: body.masterId, action: body.action }));
      }
      if (seg[0] === 'downloads' && seg.length === 2 && seg[1] === 'remote' && m === 'GET') {
        return ok(res, await engine.listRemoteFiles(url.searchParams.get('masterId') || undefined));
      }
      if (seg[0] === 'downloads' && seg.length === 2 && seg[1] === 'pull' && m === 'POST') {
        return ok(res, await engine.pullDownloads(body.names || null, body.masterId || null));
      }
      if (seg[0] === 'groups' && seg.length === 3 && seg[2] === 'distribute' && m === 'POST') { const r = await engine.distributeToGroup(seg[1], body.skillNames || []); return ok(res, r); }
      if (seg[0] === 'groups' && seg.length === 3 && seg[2] === 'files' && m === 'POST') {
        const name = url.searchParams.get('name') || '';
        const data = await readRaw(req).catch((e) => null);
        if (!data) return sendJson(res, 413, { error: 'file too large or read failed' });
        const r = await engine.sendFileToGroup(seg[1], { fileName: name, data });
        if (r.code !== 'ok') return sendJson(res, 400, { error: r.code });
        return ok(res, r);
      }
      if (seg[0] === 'outbox' && m === 'GET') return ok(res, { outbox: engine.store.listOutbox() });
      if (seg[0] === 'outbox' && seg.length === 2 && m === 'DELETE') { const r = engine.removeOutbox(seg[1]); return ok(res, r); }
      if (seg[0] === 'download' && seg.length === 2 && m === 'GET') {
        const it = engine.store.findInbox(seg[1]);
        if (!it) return sendJson(res, 404, { error: 'not found' });
        const abs = it.zipPath;
        if (!fs.existsSync(abs)) return sendJson(res, 404, { error: 'file missing' });
        const name = it.kind === 'file' ? (it.fileName || 'download') : `${it.skillName || 'skill'}.zip`;
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          'Content-Length': fs.statSync(abs).size,
        });
        fs.createReadStream(abs).pipe(res);
        return;
      }
      // inbox
      if (seg[0] === 'inbox' && seg.length === 3 && seg[2] === 'install' && m === 'POST') { const r = await engine.installInbox(seg[1]); return ok(res, r); }
      if (seg[0] === 'inbox' && seg.length === 3 && seg[2] === 'ignore' && m === 'POST') { const r = await engine.ignoreInbox(seg[1]); return ok(res, r); }
      if (seg[0] === 'inbox' && seg.length === 2 && m === 'DELETE') { const it = engine.store.findInbox(seg[1]); if (it) { try { fs.unlinkSync(it.zipPath); } catch {} engine.store.removeInbox(seg[1]); } return ok(res, {}); }
      // pull
      if (seg[0] === 'pull' && m === 'POST') {
        const r = await engine.pullSync(body.machineId, { groupIds: body.groupIds || null });
        if (r.code === 'ok' && r.data) engine.applyPull(r.data);
        return ok(res, r);
      }
      // ---- chat ----
      if (seg[0] === 'groups' && seg.length === 3 && seg[2] === 'chat' && m === 'POST') {
        const r = await engine.sendChat({ groupId: seg[1], text: body.text, toId: body.toId ?? null });
        return ok(res, r);
      }
      if (seg[0] === 'groups' && seg.length === 3 && seg[2] === 'chat' && m === 'GET') {
        const afterSeq = Number(url.searchParams.get('afterSeq') || 0);
        return ok(res, { messages: engine.listChat(seg[1], { afterSeq }) });
      }
      if (seg[0] === 'groups' && seg.length === 3 && seg[2] === 'cmd' && m === 'POST') {
        const r = await engine.requestRemoteExec({ groupId: seg[1], text: body.text, toId: body.toId });
        return ok(res, r);
      }
      if (seg[0] === 'groups' && seg.length === 4 && seg[3] === 'chat-pull' && m === 'POST') {
        const r = await engine.pullChatFrom(body.machineId, { groupId: seg[1] });
        if (r.code === 'ok') engine.applyChatPull({ groupId: seg[1], messages: r.messages });
        return ok(res, r);
      }
      // ---- pending cmds（目标机待确认）----
      if (seg[0] === 'cmds' && seg.length === 1 && m === 'GET') return ok(res, { pending: engine.listPendingCmds() });
      if (seg[0] === 'cmds' && seg.length === 3 && seg[2] === 'approve' && m === 'POST') {
        const r = await engine.approveCmd({ reqId: seg[1], approve: body.approve !== false });
        return ok(res, r);
      }
      return sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      logger?.error?.('collab http error', e);
      return sendJson(res, 500, { error: 'internal', message: String(e && e.message || e) });
    }
  }

  return (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/collab')) return sendJson(res, 404, { error: 'not found' });
    route(req, res, url).catch((e) => { logger?.error?.('collab route error', e); sendJson(res, 500, { error: 'internal' }); });
  };
}

function listSkillsOf(root) {
  if (!root || !fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, 'SKILL.md')))
    .map((d) => ({ name: d.name }));
}
