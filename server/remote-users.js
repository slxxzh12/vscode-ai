import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_USERNAME = 64;
const MIN_TOKEN = 6;
const MAX_TOKEN = 256;

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }
function now() { return Date.now(); }
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}
export function genUserToken() { return crypto.randomBytes(24).toString('hex'); }

export function normalizeUsername(value) {
  const s = String(value || '').trim();
  if (!s || s.length > MAX_USERNAME || /[\u0000-\u001f]/.test(s)) throw err('bad-username', 'invalid username');
  return s;
}

export function normalizeUserToken(value) {
  const s = String(value || '').trim();
  if (s.length < MIN_TOKEN || s.length > MAX_TOKEN || /[\s\u0000-\u001f]/.test(s)) throw err('bad-token', 'invalid token');
  return s;
}

function normalizeStoredUser(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const username = String(raw.username || '').trim();
  const token = String(raw.token || '').trim();
  if (!id || !username || !token) return null;
  return {
    id,
    username,
    token,
    enabled: raw.enabled !== false,
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
    lastLoginAt: Number(raw.lastLoginAt) || 0,
  };
}

export function createRemoteUsers({ file, logger = console } = {}) {
  let users = null;

  function load() {
    if (users) return users;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      users = (Array.isArray(raw?.users) ? raw.users : []).map(normalizeStoredUser).filter(Boolean);
    } catch { users = []; }
    return users;
  }

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ users }, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  function view(u) {
    return {
      id: u.id, username: u.username, token: u.token, enabled: u.enabled,
      createdAt: u.createdAt, updatedAt: u.updatedAt, lastLoginAt: u.lastLoginAt,
    };
  }

  function ensureUnique(list, username, token, selfId) {
    const uname = username.toLowerCase();
    if (list.some((x) => x.id !== selfId && x.username.toLowerCase() === uname)) throw err('duplicate-username', 'username exists');
    if (list.some((x) => x.id !== selfId && x.token === token)) throw err('duplicate-token', 'token exists');
  }

  return {
    list() { return load().map(view); },
    get(id) {
      const u = load().find((x) => x.id === String(id || ''));
      return u ? view(u) : null;
    },
    create(input = {}) {
      const list = load();
      const username = normalizeUsername(input.username);
      const token = normalizeUserToken(input.token || genUserToken());
      ensureUnique(list, username, token, null);
      const ts = now();
      const u = { id: crypto.randomUUID(), username, token, enabled: input.enabled !== false, createdAt: ts, updatedAt: ts, lastLoginAt: 0 };
      list.push(u);
      persist();
      return view(u);
    },
    update(id, patch = {}) {
      const list = load();
      const i = list.findIndex((x) => x.id === String(id || ''));
      if (i < 0) throw err('not-found', 'user not found');
      const u = list[i];
      const username = patch.username === undefined ? u.username : normalizeUsername(patch.username);
      const token = patch.token === undefined || patch.token === '' ? u.token : normalizeUserToken(patch.token);
      ensureUnique(list, username, token, u.id);
      list[i] = {
        ...u, username, token,
        enabled: patch.enabled === undefined ? u.enabled : !!patch.enabled,
        updatedAt: now(),
      };
      persist();
      return view(list[i]);
    },
    remove(id) {
      const list = load();
      const i = list.findIndex((x) => x.id === String(id || ''));
      if (i < 0) return false;
      list.splice(i, 1);
      persist();
      return true;
    },
    findByLogin(username, token) {
      const name = String(username || '').trim().toLowerCase();
      const tk = String(token || '');
      if (!name || !tk) return null;
      const u = load().find((x) => x.enabled && x.username.toLowerCase() === name && safeEqual(tk, x.token));
      if (!u) return null;
      u.lastLoginAt = now();
      try { persist(); } catch (e) { logger?.warn?.('remote user login persist failed', (e && e.message) || e); }
      return view(u);
    },
    findByToken(token) {
      const tk = String(token || '');
      if (!tk) return null;
      const u = load().find((x) => x.enabled && safeEqual(tk, x.token));
      return u ? view(u) : null;
    },
  };
}
