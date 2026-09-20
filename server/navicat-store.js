import fs from 'node:fs';
import path from 'node:path';
import nodeCrypto from 'node:crypto';

export const NAVICAT_TYPES = ['mysql', 'postgres', 'sqlite', 'redis'];

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }
function nowIso() { return new Date().toISOString(); }

// 连接档案：profiles.json；密码字段经 crypto.seal 加密（第 1 层），列表不下发密文/明文
export function createNavicatStore({ file, crypto }) {
  let items = null;

  function load() {
    if (items) return items;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      items = Array.isArray(raw?.items) ? raw.items : [];
    } catch { items = []; }
    return items;
  }

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ items }, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  function normalize(input) {
    const type = String(input?.type || '').trim();
    if (!NAVICAT_TYPES.includes(type)) throw err('bad-type');
    const name = String(input?.name || '').trim();
    if (!name) throw err('bad-request', 'name required');
    return {
      name,
      type,
      host: String(input?.host ?? '').trim(),
      port: String(input?.port ?? '').trim(),
      user: String(input?.user ?? '').trim(),
      database: String(input?.database ?? '').trim(),
      options: { ssl: !!input?.options?.ssl },
    };
  }

  function mask(it) {
    const { secret, ...rest } = it;
    return { ...rest, hasPassword: !!secret };
  }

  const api = {
    list() { return load().map(mask); },
    get(id) {
      const it = load().find((x) => x.id === id);
      if (!it) throw err('not-found');
      return it;
    },
    create(input) {
      const password = String(input?.password ?? '');
      const it = {
        id: nodeCrypto.randomUUID(),
        ...normalize(input),
        secret: password ? crypto.seal(password) : null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      load().push(it);
      persist();
      return mask(it);
    },
    update(id, patch) {
      const list = load();
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) throw err('not-found');
      const it = { ...list[i], ...normalize({ ...list[i], ...patch }), updatedAt: nowIso() };
      if (Object.prototype.hasOwnProperty.call(patch || {}, 'password')) {
        const password = String(patch.password ?? '');
        it.secret = password ? crypto.seal(password) : null;
      }
      list[i] = it;
      persist();
      return mask(it);
    },
    rename(id, name) { return api.update(id, { name }); },
    remove(id) {
      const list = load();
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      persist();
      return true;
    },
    password(id) {
      const it = api.get(id);
      return it.secret ? crypto.open(it.secret) : '';
    },
  };
  return api;
}
