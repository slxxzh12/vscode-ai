import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeUsername } from '../remote-users.js';
import { signJwt, verifyJwt } from '../llm-jwt.js';

const DAY = 86400000;
const DEFAULT_DAYS = 30;

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }

// 「有效日期」：接受毫秒时间戳或可解析的日期字符串；为空/非法则回退为 now+N 天。
export function normalizeExpiry(value, now = Date.now()) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const parsed = Date.parse(String(value || ''));
  if (Number.isFinite(parsed)) return parsed;
  return now + DEFAULT_DAYS * DAY;
}

export function isExpired(user, now = Date.now()) {
  return Number(user?.exp) > 0 && Math.floor(now / 1000) >= Number(user.exp);
}

function normalizeStored(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const username = String(raw.username || '').trim();
  if (!id || !username) return null;
  return {
    id,
    username,
    jwt: String(raw.jwt || ''),
    jti: String(raw.jti || ''),
    iat: Number(raw.iat) || 0,
    exp: Number(raw.exp) || 0,
    enabled: raw.enabled !== false,
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
    lastLoginAt: Number(raw.lastLoginAt) || 0,
    lastRunAt: Number(raw.lastRunAt) || 0,
    uses: Number(raw.uses) || 0,
  };
}

export function createAiSiteUsers({ file, getSecret = () => '' } = {}) {
  let list = null;
  let blacklist = null;

  function issue(username, expiresAt, now = Date.now()) {
    const exp = Math.floor(normalizeExpiry(expiresAt, now) / 1000);
    const jti = crypto.randomUUID();
    const iat = Math.floor(now / 1000);
    return { jwt: signJwt({ sub: username, jti, exp }, getSecret(), { now }), jti, iat, exp };
  }

  function load() {
    if (list && blacklist) return list;
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { raw = {}; }
    list = (Array.isArray(raw?.users) ? raw.users : []).map(normalizeStored).filter(Boolean);
    blacklist = new Set((Array.isArray(raw?.blacklist) ? raw.blacklist : [])
      .map((s) => String(s || '').trim().toLowerCase()).filter(Boolean));
    // 旧档案（随机 token，无 JWT）迁移为 30 天有效的 JWT
    let changed = false;
    for (const u of list) {
      if (!u.jwt || !u.jti || !u.exp) {
        Object.assign(u, issue(u.username, Date.now() + DEFAULT_DAYS * DAY));
        changed = true;
      }
    }
    if (changed) { try { persist(); } catch { /* ignore */ } }
    return list;
  }

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ users: list, blacklist: [...blacklist] }, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  function isRevoked(username) {
    load();
    return blacklist.has(String(username || '').trim().toLowerCase());
  }

  function view(u) { return { ...u, revoked: isRevoked(u.username) }; }

  function ensureUnique(username, selfId) {
    const uname = username.toLowerCase();
    if (load().some((x) => x.id !== selfId && x.username.toLowerCase() === uname)) throw err('duplicate-username', 'username exists');
  }

  function findByJwt(jwt) {
    let payload;
    try { payload = verifyJwt(String(jwt || ''), getSecret()); } catch { return null; }
    const u = load().find((x) => x.jti === payload.jti && x.enabled);
    if (!u || payload.sub !== u.username || isExpired(u) || isRevoked(u.username)) return null;
    u.lastLoginAt = Date.now();
    try { persist(); } catch { /* ignore */ }
    return view(u);
  }

  function revoke(username, revoked = true) {
    load();
    const name = String(username || '').trim().toLowerCase();
    if (!name) throw err('bad-request', 'username required');
    if (revoked) blacklist.add(name); else blacklist.delete(name);
    persist();
    return { blacklist: [...blacklist] };
  }

  return {
    list() { return load().map(view); },
    get(id) {
      const u = load().find((x) => x.id === String(id || ''));
      return u ? view(u) : null;
    },
    create(input = {}) {
      const username = normalizeUsername(input.username);
      ensureUnique(username, null);
      const ts = Date.now();
      const u = {
        id: crypto.randomUUID(), username, ...issue(username, input.expiresAt, ts),
        enabled: input.enabled !== false, createdAt: ts, updatedAt: ts,
        lastLoginAt: 0, lastRunAt: 0, uses: 0,
      };
      load().push(u);
      persist();
      return view(u);
    },
    update(id, patch = {}) {
      const arr = load();
      const i = arr.findIndex((x) => x.id === String(id || ''));
      if (i < 0) throw err('not-found', 'user not found');
      const username = patch.username === undefined ? arr[i].username : normalizeUsername(patch.username);
      ensureUnique(username, arr[i].id);
      const ts = Date.now();
      const next = {
        ...arr[i], username,
        enabled: patch.enabled === undefined ? arr[i].enabled : !!patch.enabled,
        updatedAt: ts,
      };
      if (patch.username !== undefined || patch.expiresAt !== undefined) {
        const expiresAt = patch.expiresAt !== undefined ? patch.expiresAt : Number(arr[i].exp) * 1000;
        Object.assign(next, issue(username, expiresAt, ts));
      }
      arr[i] = next;
      persist();
      return view(next);
    },
    remove(id) {
      const arr = load();
      const i = arr.findIndex((x) => x.id === String(id || ''));
      if (i < 0) return false;
      arr.splice(i, 1);
      persist();
      return true;
    },
    // 首次登录：校验 JWT 签名/有效期，并确认用户与 jti 匹配且未停用。
    findByJwt,
    findByToken: findByJwt,
    isExpired(user, now) { return isExpired(user, now); },
    isRevoked,
    revoke,
    blacklist() { load(); return [...blacklist]; },
    recordUse(id, at = Date.now()) {
      const u = load().find((x) => x.id === String(id || ''));
      if (!u) return null;
      u.uses += 1;
      u.lastRunAt = at;
      try { persist(); } catch { /* ignore */ }
      return view(u);
    },
  };
}
