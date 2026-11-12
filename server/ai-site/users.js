import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { genUserToken, normalizeUsername } from '../remote-users.js';

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}

function normalizeStored(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const username = String(raw.username || '').trim();
  const token = String(raw.token || '').trim();
  if (!id || !username || !token) return null;
  return {
    id, username, token,
    enabled: raw.enabled !== false,
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
    lastLoginAt: Number(raw.lastLoginAt) || 0,
    lastRunAt: Number(raw.lastRunAt) || 0,
    uses: Number(raw.uses) || 0,
  };
}

export function createAiSiteUsers({ file } = {}) {
  let list = null;

  function load() {
    if (list) return list;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      list = (Array.isArray(raw?.users) ? raw.users : []).map(normalizeStored).filter(Boolean);
    } catch { list = []; }
    return list;
  }

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ users: list }, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  function view(u) { return { ...u }; }

  function ensureUnique(username, selfId) {
    const uname = username.toLowerCase();
    if (load().some((x) => x.id !== selfId && x.username.toLowerCase() === uname)) throw err('duplicate-username', 'username exists');
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
        id: crypto.randomUUID(), username, token: genUserToken(), enabled: input.enabled !== false,
        createdAt: ts, updatedAt: ts, lastLoginAt: 0, lastRunAt: 0, uses: 0,
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
      arr[i] = {
        ...arr[i], username,
        enabled: patch.enabled === undefined ? arr[i].enabled : !!patch.enabled,
        updatedAt: Date.now(),
      };
      persist();
      return view(arr[i]);
    },
    remove(id) {
      const arr = load();
      const i = arr.findIndex((x) => x.id === String(id || ''));
      if (i < 0) return false;
      arr.splice(i, 1);
      persist();
      return true;
    },
    findByLogin(username, token) {
      const name = String(username || '').trim().toLowerCase();
      const tk = String(token || '');
      if (!name || !tk) return null;
      const u = load().find((x) => x.enabled && x.username.toLowerCase() === name && safeEqual(tk, x.token));
      if (!u) return null;
      u.lastLoginAt = Date.now();
      try { persist(); } catch { /* ignore */ }
      return view(u);
    },
    findByToken(token) {
      const tk = String(token || '');
      if (!tk) return null;
      const u = load().find((x) => x.enabled && safeEqual(tk, x.token));
      return u ? view(u) : null;
    },
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
