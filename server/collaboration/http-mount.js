import fs from 'node:fs';
import path from 'node:path';

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
      if (seg[0] === 'identity' && m === 'PUT') { engine.setAdvertised({ host: body.host, port: body.port }); return ok(res, { identity: engine.pub }); }
      // snapshot / friends / groups / invites / skills / distribute / inbox / pull
      if (seg.length === 1 && seg[0] === 'snapshot' && m === 'GET') {
        const inbox = engine.store.listInbox().map(({ zipPath, ...rest }) => rest);
        return ok(res, {
          identity: engine.pub,
          friends: engine.store.listFriends(),
          pendingFriends: engine.store.listPendingFriends(),
          groups: engine.store.listGroups(),
          pendingInvites: engine.store.listPendingInvites(),
          skillsInbox: inbox,
          groupSkills: engine.store.listGroupSkills(),
        });
      }
      if (seg[0] === 'skills' && m === 'GET') return ok(res, { skills: listSkillsOf(engine.skillRoot()) });
      // 我的开发工具（决定技能目录）
      if (seg[0] === 'tool' && m === 'GET') return ok(res, engine.getToolInfo());
      if (seg[0] === 'tool' && m === 'POST') {
        const r = engine.setTool(body.kind, body.customRoot);
        if (r.code !== 'ok') return sendJson(res, 400, { error: r.code === 'need-custom-root' ? '自定义路径必填' : r.code });
        return ok(res, r);
      }
      // 我的 upload/download 目录（下载页/收件箱辅助展示）
      if (seg[0] === 'dirs' && m === 'GET') return ok(res, { upload: engine.uploadDir || null, download: engine.downloadDir || null });
      // friends
      if (seg[0] === 'friends' && seg.length === 1 && m === 'POST') { const r = await engine.requestFriend({ host: body.host, port: body.port }); return ok(res, r); }
      if (seg[0] === 'friends' && seg.length === 3 && seg[2] === 'accept' && m === 'POST') { const r = await engine.acceptFriend(seg[1]); return ok(res, r); }
      if (seg[0] === 'friends' && seg.length === 2 && m === 'DELETE') { engine.store.removeFriend(seg[1]); return ok(res, {}); }
      // groups
      if (seg[0] === 'groups' && seg.length === 1 && m === 'POST') { const g = await engine.createGroup(body.name); return ok(res, { group: g }); }
      if (seg[0] === 'groups' && seg.length === 3 && seg[2] === 'invite' && m === 'POST') { const r = await engine.inviteMember({ groupId: seg[1], targetMachineId: body.machineId }); return ok(res, r); }
      if (seg[0] === 'groups' && seg.length === 5 && seg[2] === 'members' && seg[4] === 'kick' && m === 'POST') { const r = await engine.kickMember({ groupId: seg[1], targetMachineId: seg[3] }); return ok(res, r); }
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
      if (seg[0] === 'groups' && seg.length === 2 && m === 'DELETE') { engine.store.removeGroup(seg[1]); return ok(res, {}); }
      // invites
      if (seg[0] === 'invites' && seg.length === 3 && seg[2] === 'accept' && m === 'POST') { const r = await engine.acceptInvite(seg[1]); return ok(res, r); }
      if (seg[0] === 'invites' && seg.length === 3 && seg[2] === 'reject' && m === 'POST') { const inv = engine.store.findPendingInvite(seg[1]); if (inv) engine.store.removePendingInvite(seg[1]); return ok(res, {}); }
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
      // ---- allowlist ----
      if (seg[0] === 'allowlist' && m === 'GET') return ok(res, { allowlist: engine.listAllowlist() });
      if (seg[0] === 'allowlist' && seg.length === 1 && m === 'POST') { const r = engine.allowCmd(body.prefix); return ok(res, r); }
      if (seg[0] === 'allowlist' && seg.length === 2 && m === 'DELETE') { const r = engine.disallowCmd(decodeURIComponent(seg[1])); return ok(res, r); }
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
