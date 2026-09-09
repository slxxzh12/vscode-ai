import fs from 'node:fs';
import path from 'node:path';

const MAX_BODY = 64 * 1024 * 1024; // 64MB（zip base64）

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => { total += c.length; if (total > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
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
    // 仅 POST/PUT 读 body，避免 GET/DELETE 无 body 时挂起
    const isBodyMethod = ['POST', 'PUT'].includes(m);
    let body = {};
    if (isBodyMethod) {
      const bodyRaw = await readBody(req).catch(() => '');
      if (bodyRaw) { try { body = JSON.parse(bodyRaw); } catch { body = {}; } }
    }
    if (seg[0] === 'peer' && m === 'POST') {
      // 机器↔机器信封
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
      if (seg[0] === 'skills' && m === 'GET') return ok(res, { skills: listSkillsOf(engine.skillsRoot) });
      // friends
      if (seg[0] === 'friends' && seg.length === 1 && m === 'POST') { const r = await engine.requestFriend({ host: body.host, port: body.port }); return ok(res, r); }
      if (seg[0] === 'friends' && seg.length === 3 && seg[2] === 'accept' && m === 'POST') { const r = await engine.acceptFriend(seg[1]); return ok(res, r); }
      if (seg[0] === 'friends' && seg.length === 2 && m === 'DELETE') { engine.store.removeFriend(seg[1]); return ok(res, {}); }
      // groups
      if (seg[0] === 'groups' && seg.length === 1 && m === 'POST') { const g = await engine.createGroup(body.name); return ok(res, { group: g }); }
      if (seg[0] === 'groups' && seg.length === 3 && seg[2] === 'invite' && m === 'POST') { const r = await engine.inviteMember({ groupId: seg[1], targetMachineId: body.machineId }); return ok(res, r); }
      if (seg[0] === 'groups' && seg.length === 5 && seg[2] === 'members' && seg[4] === 'kick' && m === 'POST') { const r = await engine.kickMember({ groupId: seg[1], targetMachineId: seg[3] }); return ok(res, r); }
      if (seg[0] === 'groups' && seg.length === 3 && seg[2] === 'distribute' && m === 'POST') { const r = await engine.distributeToGroup(seg[1], body.skillNames || []); return ok(res, r); }
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
