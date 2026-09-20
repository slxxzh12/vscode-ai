# Navicat 小工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在小工具里新增 Navicat：管理 MySQL/PostgreSQL/SQLite/Redis 连接档案（密码双层加密），在线执行 SQL/命令并查看结果，支持复制连接串与导出 Navicat `.ncx`。

**Architecture:** 后端新增 5 个功能模块（`navicat-crypto/store/exec/ncx/mount`），由 `index.js` 装配后在 `/api/navicat/*` 独立挂载；连接档案落 `<端口数据目录>/tools/navicat/profiles.json`，密码用机器密钥 AES-256-GCM 加密，导出 `.ncx` 时再用 Navicat 固定 AES-128-CBC 加密。前端在 `web/src/tools/navicat/` 下实现数据层与面板，并注册进 `web/src/tools/catalog.ts`。

**Tech Stack:** Node ESM、`node:test`、`node:sqlite`、`mysql2`、`pg`、`redis`、Vue3 + TS、Vitest、happy-dom、Element Plus。

**与 spec 的两处细化（不改变需求）：**

1. i18n 前缀用 `nv.*` 而非 `nav.*`（`nav.*` 已被顶栏导航占用，避免冲突）。
2. 后端错误响应为 `{ error: <code>, message: <已翻译文案> }`；前端优先展示 `message`，逻辑分支只看 `error`。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `server/navicat-crypto.js` | 机器密钥管理 + AES-256-GCM 封/解密码 |
| `server/navicat-store.js` | 连接档案 CRUD、掩码、原子落盘 |
| `server/navicat-exec.js` | 四类库连接与执行、写操作识别、Redis 切词 |
| `server/navicat-ncx.js` | Navicat AES、`.ncx` XML、连接串拼装 |
| `server/navicat-mount.js` | `/api/navicat/*` 路由 |
| `web/src/tools/navicat/useNavicat.ts` | 前端数据层 |
| `web/src/tools/navicat/NavicatList.vue` | 左栏连接列表 |
| `web/src/tools/navicat/NavicatTool.vue` | 主面板 |
| `web/src/tools/catalog.ts` | 工具注册（改） |
| `web/src/components/MiniTools.vue` | 渲染 Navicat 面板（改） |

---

## Task 1: 后端新增三个数据库驱动依赖

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: 在 `server/package.json` 的 `dependencies` 里补三个依赖**

把 `"dependencies"` 改成（版本用 npm 解析到的最新兼容版，安装后以 `package-lock` 为准）：

```json
  "dependencies": {
    "esbuild": "^0.21.5",
    "mysql2": "^3.11.0",
    "node-pty": "^1.1.0",
    "pg": "^8.13.0",
    "redis": "^4.7.0",
    "ws": "^8.18.0"
  }
```

- [ ] **Step 2: 安装（在仓库根执行，让 workspace 解析）**

Run: `npm.cmd install`
Expected: 无 error；根 `node_modules` 出现 `mysql2`、`pg`、`redis`。

- [ ] **Step 3: 验证三个包可 import**

Run: `node -e "Promise.all([import('mysql2/promise'),import('pg'),import('redis'),import('node:sqlite')]).then(()=>console.log('navicat deps ok'))"`
Expected: 输出 `navicat deps ok`。

- [ ] **Step 4: Commit**

```bash
git add server/package.json package-lock.json
git commit -m "build(navicat): 新增 mysql2/pg/redis 运行时依赖"
```

---

## Task 2: 密码本地加密层 `navicat-crypto.js`

**Files:**
- Create: `server/navicat-crypto.js`
- Test: `server/test/navicat-crypto.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/navicat-crypto.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNavicatCrypto } from '../navicat-crypto.js';

function tmpKey() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-nvcrypt-')), '.key'); }

test('seal/open：往返得到原文', () => {
  const c = createNavicatCrypto({ keyFile: tmpKey() });
  const box = c.seal('p@ss word');
  assert.equal(box.v, 1);
  assert.equal(c.open(box), 'p@ss word');
});

test('seal：空密码返回 null；open(null) 返回空串', () => {
  const c = createNavicatCrypto({ keyFile: tmpKey() });
  assert.equal(c.seal(''), null);
  assert.equal(c.open(null), '');
});

test('密钥文件首次自动生成，二次实例仍能解开旧密文', () => {
  const keyFile = tmpKey();
  const a = createNavicatCrypto({ keyFile });
  const box = a.seal('secret');
  assert.ok(fs.existsSync(keyFile));
  assert.equal(fs.readFileSync(keyFile).length, 32);
  const b = createNavicatCrypto({ keyFile });
  assert.equal(b.open(box), 'secret');
});

test('open：篡改 tag 抛 bad-secret（认证失败）', () => {
  const c = createNavicatCrypto({ keyFile: tmpKey() });
  const box = c.seal('secret');
  const bad = { ...box, tag: Buffer.from('x'.repeat(16)).toString('base64') };
  assert.throws(() => c.open(bad), (e) => e.code === 'bad-secret');
});

test('open：换密钥后旧密文抛 bad-secret', () => {
  const a = createNavicatCrypto({ keyFile: tmpKey() });
  const box = a.seal('secret');
  const b = createNavicatCrypto({ keyFile: tmpKey() });
  assert.throws(() => b.open(box), (e) => e.code === 'bad-secret');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/navicat-crypto.test.js"`
Expected: FAIL，`Cannot find module '../navicat-crypto.js'`。

- [ ] **Step 3: 实现**

Create `server/navicat-crypto.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const KEY_BYTES = 32;

function b64(buf) { return Buffer.from(buf).toString('base64'); }
function unb64(s) { return Buffer.from(s, 'base64'); }

// 机器密钥：随机 32B，首次使用时落盘（.gitignore 覆盖，不进版本库）
function loadOrCreateKey(keyFile) {
  try {
    const raw = fs.readFileSync(keyFile);
    if (raw.length === KEY_BYTES) return raw;
  } catch { /* 不存在或损坏，重建 */ }
  const key = crypto.randomBytes(KEY_BYTES);
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, key);
  try { fs.chmodSync(keyFile, 0o600); } catch { /* Windows 上尽力而为 */ }
  return key;
}

// 第 1 层加密：本机落盘的密码字段。AES-256-GCM，篡改即解密失败
export function createNavicatCrypto({ keyFile }) {
  let key = null;
  const getKey = () => (key ??= loadOrCreateKey(keyFile));
  return {
    seal(plaintext) {
      if (plaintext === undefined || plaintext === null || plaintext === '') return null;
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
      const ct = Buffer.concat([c.update(Buffer.from(String(plaintext), 'utf8')), c.final()]);
      return { v: 1, iv: b64(iv), tag: b64(c.getAuthTag()), ct: b64(ct) };
    },
    open(box) {
      if (!box) return '';
      const e = new Error('bad secret');
      e.code = 'bad-secret';
      try {
        const d = crypto.createDecipheriv('aes-256-gcm', getKey(), unb64(box.iv));
        d.setAuthTag(unb64(box.tag));
        return Buffer.concat([d.update(unb64(box.ct)), d.final()]).toString('utf8');
      } catch { throw e; }
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/navicat-crypto.test.js"`
Expected: PASS（5 个用例）。

- [ ] **Step 5: Commit**

```bash
git add server/navicat-crypto.js server/test/navicat-crypto.test.js
git commit -m "feat(navicat): 本机机器密钥加密模块"
```

---

## Task 3: 连接档案存储 `navicat-store.js`

**Files:**
- Create: `server/navicat-store.js`
- Test: `server/test/navicat-store.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/navicat-store.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNavicatCrypto } from '../navicat-crypto.js';
import { createNavicatStore, NAVICAT_TYPES } from '../navicat-store.js';

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-nvstore-'));
  return {
    dir,
    file: path.join(dir, 'profiles.json'),
    store: createNavicatStore({
      file: path.join(dir, 'profiles.json'),
      crypto: createNavicatCrypto({ keyFile: path.join(dir, '.key') }),
    }),
  };
}

const INPUT = { name: '本地库', type: 'mysql', host: '127.0.0.1', port: '3306', user: 'root', database: 'app', password: 'p@ss' };

test('NAVICAT_TYPES：四类', () => {
  assert.deepEqual([...NAVICAT_TYPES].sort(), ['mysql', 'postgres', 'redis', 'sqlite']);
});

test('create/list：列表不含密码，带 hasPassword', () => {
  const { store } = makeStore();
  const item = store.create(INPUT);
  assert.ok(item.id);
  assert.equal(item.hasPassword, true);
  assert.equal('secret' in item, false);
  assert.equal('password' in item, false);
  const all = store.list();
  assert.equal(all.length, 1);
  assert.equal(all[0].name, '本地库');
  assert.equal(all[0].secret, undefined);
});

test('password：解密取回明文；无密码返回空串', () => {
  const { store } = makeStore();
  const item = store.create(INPUT);
  assert.equal(store.password(item.id), 'p@ss');
  const noPw = store.create({ ...INPUT, name: '无密码', password: '' });
  assert.equal(store.password(noPw.id), '');
});

test('update：改字段；带 password 才改密码', () => {
  const { store } = makeStore();
  const item = store.create(INPUT);
  const upd = store.update(item.id, { name: '改名', port: '3307' });
  assert.equal(upd.name, '改名');
  assert.equal(upd.port, '3307');
  assert.equal(store.password(item.id), 'p@ss');
  store.update(item.id, { password: 'new' });
  assert.equal(store.password(item.id), 'new');
  store.update(item.id, { password: '' });
  assert.equal(store.password(item.id), '');
});

test('bad-type / 空 name / not-found', () => {
  const { store } = makeStore();
  assert.throws(() => store.create({ ...INPUT, type: 'oracle' }), (e) => e.code === 'bad-type');
  assert.throws(() => store.create({ ...INPUT, name: '  ' }), (e) => e.code === 'bad-request');
  assert.throws(() => store.get('nope'), (e) => e.code === 'not-found');
  assert.throws(() => store.update('nope', { name: 'x' }), (e) => e.code === 'not-found');
  assert.equal(store.remove('nope'), false);
});

test('落盘后重新加载仍在（新实例读同一文件）', () => {
  const { dir, file } = makeStore();
  const crypto = createNavicatCrypto({ keyFile: path.join(dir, '.key') });
  const a = createNavicatStore({ file, crypto });
  const item = a.create(INPUT);
  const b = createNavicatStore({ file, crypto });
  assert.equal(b.list().length, 1);
  assert.equal(b.password(item.id), 'p@ss');
});

test('rename / remove', () => {
  const { store } = makeStore();
  const item = store.create(INPUT);
  assert.equal(store.rename(item.id, '新名').name, '新名');
  assert.equal(store.remove(item.id), true);
  assert.equal(store.list().length, 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/navicat-store.test.js"`
Expected: FAIL，找不到 `../navicat-store.js`。

- [ ] **Step 3: 实现**

Create `server/navicat-store.js`:

```js
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/navicat-store.test.js"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/navicat-store.js server/test/navicat-store.test.js
git commit -m "feat(navicat): 连接档案存储（密码加密+掩码）"
```

---

## Task 4: `.ncx` 与连接串 `navicat-ncx.js`

**Files:**
- Create: `server/navicat-ncx.js`
- Test: `server/test/navicat-ncx.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/navicat-ncx.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navicatEncrypt, navicatDecrypt, buildNcx, connectionString, NAVICAT_CONN_TYPE } from '../navicat-ncx.js';

test('navicatEncrypt：已知向量（AES-128-CBC, libcckeylibcckey/libcciv libcciv）', () => {
  assert.equal(navicatEncrypt('test'), 'E7D6D10725AD2445AA63C211943D447D');
  assert.equal(navicatEncrypt('df-pass'), '02C09B731700162E2D11CF31E9AD2B38');
  assert.equal(navicatEncrypt('p@ss word'), 'D76F8E8230DDC0D216E06324E7B58236');
});

test('navicatDecrypt：往返', () => {
  for (const p of ['', 'abc', 'p@ss word', '中文密码']) {
    assert.equal(navicatDecrypt(navicatEncrypt(p)), p);
  }
});

test('buildNcx：结构正确且密码为密文、文本被转义', () => {
  const xml = buildNcx([{ name: 'A & "B"', type: 'mysql', host: 'h', port: '3306', database: 'd', user: 'u', password: 'test' }]);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<Connections>/);
  assert.match(xml, /ConnectionName="A &amp; &quot;B&quot;"/);
  assert.match(xml, new RegExp(`ConnType="${NAVICAT_CONN_TYPE.mysql}"`));
  assert.match(xml, /Password="E7D6D10725AD2445AA63C211943D447D"/);
  assert.match(xml, /<\/Connections>/);
});

test('connectionString：四类格式 + 可含/不含密码', () => {
  const base = { host: 'h', port: '3306', user: 'u', database: 'd' };
  assert.equal(connectionString({ ...base, type: 'mysql' }, 'p', { withPassword: true }), 'mysql://u:p@h:3306/d');
  assert.equal(connectionString({ ...base, type: 'mysql' }, 'p'), 'mysql://u@h:3306/d');
  assert.equal(connectionString({ ...base, type: 'postgres', port: '5432' }, 'p', { withPassword: true }), 'postgresql://u:p@h:5432/d');
  assert.equal(connectionString({ type: 'redis', host: 'h', port: '6379', user: '', database: '2' }, 'p', { withPassword: true }), 'redis://:p@h:6379/2');
  assert.equal(connectionString({ type: 'sqlite', database: 'C:/tmp/a.db' }, ''), 'C:/tmp/a.db');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/navicat-ncx.test.js"`
Expected: FAIL，找不到 `../navicat-ncx.js`。

- [ ] **Step 3: 实现**

Create `server/navicat-ncx.js`:

```js
import crypto from 'node:crypto';

// Navicat 导出文件里的密码算法（与 Navicat 11 系一致）：
// AES-128-CBC，key/IV 固定，输出大写 hex
const NAV_KEY = Buffer.from('libcckeylibcckey', 'latin1');
const NAV_IV = Buffer.from('libcciv libcciv ', 'latin1');

// ConnType 取值 Navicat 未公开，集中在此便于按实测校准
export const NAVICAT_CONN_TYPE = { mysql: 0, postgres: 1, sqlite: 3, redis: 7 };

export function navicatEncrypt(plain) {
  const c = crypto.createCipheriv('aes-128-cbc', NAV_KEY, NAV_IV);
  const ct = Buffer.concat([c.update(Buffer.from(String(plain ?? ''), 'utf8')), c.final()]);
  return ct.toString('hex').toUpperCase();
}

export function navicatDecrypt(hex) {
  const bin = Buffer.from(String(hex ?? '').trim(), 'hex');
  const d = crypto.createDecipheriv('aes-128-cbc', NAV_KEY, NAV_IV);
  return Buffer.concat([d.update(bin), d.final()]).toString('utf8');
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildNcx(entries) {
  const rows = (entries || []).map((e) => {
    const attrs = [
      ['ConnectionName', e.name],
      ['ConnType', NAVICAT_CONN_TYPE[e.type] ?? ''],
      ['Host', e.host ?? ''],
      ['Port', e.port ?? ''],
      ['Database', e.database ?? ''],
      ['UserName', e.user ?? ''],
      ['Password', navicatEncrypt(e.password || '')],
    ];
    return `  <Connection ${attrs.map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`;
  });
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<Connections>', ...rows, '</Connections>', ''].join('\n');
}

export function connectionString(profile, password, { withPassword = false } = {}) {
  if (profile.type === 'sqlite') return String(profile.database || '');
  const user = encodeURIComponent(profile.user || '');
  const pw = withPassword ? encodeURIComponent(password || '') : '';
  let auth = '';
  if (user) auth = withPassword ? `${user}:${pw}@` : `${user}@`;
  else if (withPassword && password) auth = `:${pw}@`;
  const host = profile.host || '';
  if (profile.type === 'mysql') return `mysql://${auth}${host}:${profile.port || 3306}/${encodeURIComponent(profile.database || '')}`;
  if (profile.type === 'postgres') return `postgresql://${auth}${host}:${profile.port || 5432}/${encodeURIComponent(profile.database || '')}`;
  if (profile.type === 'redis') return `redis://${auth}${host}:${profile.port || 6379}/${profile.database || 0}`;
  return '';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/navicat-ncx.test.js"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/navicat-ncx.js server/test/navicat-ncx.test.js
git commit -m "feat(navicat): .ncx 导出与连接串"
```

---

## Task 5: 执行层 `navicat-exec.js`

**Files:**
- Create: `server/navicat-exec.js`
- Test: `server/test/navicat-exec.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/navicat-exec.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNavicatExec, isWriteSql, isWriteRedis, tokenizeRedis } from '../navicat-exec.js';

test('isWriteSql：读/写/多语句/WITH', () => {
  assert.equal(isWriteSql('SELECT * FROM t'), false);
  assert.equal(isWriteSql('  \n-- c\n show tables'), false);
  assert.equal(isWriteSql('PRAGMA table_info(t)'), false);
  assert.equal(isWriteSql('INSERT INTO t VALUES (1)'), true);
  assert.equal(isWriteSql('drop table t'), true);
  assert.equal(isWriteSql('WITH x AS (SELECT 1) SELECT * FROM x'), false);
  assert.equal(isWriteSql('WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x'), true);
  assert.equal(isWriteSql('SELECT 1; UPDATE t SET a=1'), true);
  assert.equal(isWriteSql(''), false);
});

test('isWriteRedis：白名单读/写/子命令', () => {
  assert.equal(isWriteRedis(['GET', 'k']), false);
  assert.equal(isWriteRedis(['SCAN', '0']), false);
  assert.equal(isWriteRedis(['CONFIG', 'GET', 'maxmemory']), false);
  assert.equal(isWriteRedis(['SET', 'k', 'v']), true);
  assert.equal(isWriteRedis(['FLUSHALL']), true);
  assert.equal(isWriteRedis([]), false);
});

test('tokenizeRedis：引号与转义', () => {
  assert.deepEqual(tokenizeRedis('SET k "a b"'), ['SET', 'k', 'a b']);
  assert.deepEqual(tokenizeRedis("SET k 'a\\nb'"), ['SET', 'k', 'a\\nb']);
  assert.deepEqual(tokenizeRedis('  GET   k  '), ['GET', 'k']);
  assert.deepEqual(tokenizeRedis('SET k "a\\"b"'), ['SET', 'k', 'a"b']);
});

test('exec：SQLite 建表/插入/查询 + 截断 + 写识别', async () => {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-nvexec-')), 'a.db');
  const exec = createNavicatExec({ maxRows: 2 });
  const profile = { type: 'sqlite', database: dbFile };
  const ddl = await exec.exec(profile, '', 'CREATE TABLE t(a INTEGER, b TEXT)');
  assert.equal(exec.isWrite(profile, 'CREATE TABLE t(a)'), true);
  assert.ok(ddl.affected >= 0);
  await exec.exec(profile, '', "INSERT INTO t VALUES (1,'x')");
  await exec.exec(profile, '', "INSERT INTO t VALUES (2,'y')");
  await exec.exec(profile, '', "INSERT INTO t VALUES (3,'z')");
  const r = await exec.exec(profile, '', 'SELECT a, b FROM t ORDER BY a');
  assert.deepEqual(r.columns, ['a', 'b']);
  assert.equal(r.rows.length, 2);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.rows[0], [1, 'x']);
  assert.equal(exec.isWrite(profile, 'SELECT 1'), false);
});

test('exec：SQLite 不存在的目录/文件报错', async () => {
  const exec = createNavicatExec({});
  await assert.rejects(() => exec.exec({ type: 'sqlite', database: '' }, '', 'SELECT 1'));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/navicat-exec.test.js"`
Expected: FAIL，找不到 `../navicat-exec.js`。

- [ ] **Step 3: 实现**

Create `server/navicat-exec.js`:

```js
// 四类库的连接与执行。驱动按需 import：不连库时零开销
const READ_SQL = new Set(['SELECT', 'SHOW', 'DESC', 'DESCRIBE', 'EXPLAIN', 'PRAGMA', 'VALUES']);
const WRITE_WORDS = /\b(INSERT|UPDATE|DELETE|REPLACE|MERGE)\b/i;

function stripSql(s) {
  let t = String(s ?? '').trim();
  for (;;) {
    if (t.startsWith('--')) { const i = t.indexOf('\n'); t = (i < 0 ? '' : t.slice(i + 1)).trim(); continue; }
    if (t.startsWith('/*')) { const i = t.indexOf('*/'); t = (i < 0 ? '' : t.slice(i + 2)).trim(); continue; }
    return t;
  }
}

export function isWriteSql(sql) {
  const stmts = String(sql ?? '').split(';').map(stripSql).filter(Boolean);
  if (!stmts.length) return false;
  return stmts.some((s) => {
    const first = (s.match(/^[A-Za-z]+/)?.[0] || '').toUpperCase();
    if (first === 'WITH') return WRITE_WORDS.test(s);
    return !READ_SQL.has(first);
  });
}

const REDIS_READ = new Set([
  'GET', 'MGET', 'STRLEN', 'EXISTS', 'TYPE', 'TTL', 'PTTL', 'KEYS', 'SCAN', 'RANDOMKEY',
  'HGET', 'HMGET', 'HGETALL', 'HKEYS', 'HVALS', 'HLEN', 'HEXISTS', 'HRANDFIELD',
  'LRANGE', 'LLEN', 'LINDEX', 'SMEMBERS', 'SCARD', 'SISMEMBER', 'SRANDMEMBER',
  'ZRANGE', 'ZRANGEBYSCORE', 'ZREVRANGE', 'ZCARD', 'ZSCORE', 'ZRANK',
  'PING', 'ECHO', 'TIME', 'DBSIZE', 'INFO', 'COMMAND', 'GETRANGE', 'BITCOUNT', 'OBJECT',
]);

export function isWriteRedis(argv) {
  const cmd = String(argv?.[0] || '').toUpperCase();
  if (!cmd) return false;
  if (REDIS_READ.has(cmd)) return false;
  if ((cmd === 'CONFIG' || cmd === 'CLIENT') && String(argv?.[1] || '').toUpperCase().startsWith('GET')) return false;
  return true;
}

export function tokenizeRedis(text) {
  const s = String(text ?? '').trim();
  const out = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < s.length) { cur += s[i + 1]; i += 1; continue; }
      if (ch === quote) { quote = null; continue; }
      cur += ch; continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (has) { out.push(cur); cur = ''; has = false; } continue; }
    cur += ch; has = true;
  }
  if (has) out.push(cur);
  return out;
}

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }

function capRows(raw, columns, maxRows) {
  const list = Array.isArray(raw) ? raw : [];
  const rows = list.slice(0, maxRows).map((r) => columns.map((c) => r[c]));
  return { columns, rows, truncated: list.length > maxRows };
}

function withTimeout(promise, ms, code = 'timeout') {
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(err(code, 'execution timeout')), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

export function createNavicatExec({ connectTimeoutMs = 10000, statementTimeoutMs = 30000, maxRows = 200 } = {}) {
  async function mysqlRun(profile, password, sql) {
    const mysql = await import('mysql2/promise');
    const conn = await mysql.createConnection({
      host: profile.host,
      port: Number(profile.port) || 3306,
      user: profile.user || undefined,
      password: password || undefined,
      database: profile.database || undefined,
      connectTimeout: connectTimeoutMs,
      ssl: profile.options?.ssl ? {} : undefined,
    });
    try {
      const [rows, fields] = await conn.query({ sql, timeout: statementTimeoutMs });
      if (Array.isArray(rows)) {
        const columns = (fields || []).map((f) => f.name);
        const list = rows.slice(0, maxRows).map((r) => columns.map((c) => r[c]));
        return { columns, rows: list, affected: null, truncated: rows.length > maxRows };
      }
      return { columns: [], rows: [], affected: Number(rows?.affectedRows) || 0, truncated: false };
    } finally { await conn.end().catch(() => {}); }
  }

  async function postgresRun(profile, password, sql) {
    const pg = await import('pg');
    const client = new pg.Client({
      host: profile.host,
      port: Number(profile.port) || 5432,
      user: profile.user || undefined,
      password: password || undefined,
      database: profile.database || undefined,
      connectionTimeoutMillis: connectTimeoutMs,
      ssl: profile.options?.ssl ? { rejectUnauthorized: false } : undefined,
    });
    await client.connect();
    try {
      await client.query(`SET statement_timeout = ${Number(statementTimeoutMs) || 30000}`);
      const res = await client.query(sql);
      const one = Array.isArray(res) ? res[res.length - 1] : res;
      const columns = (one?.fields || []).map((f) => f.name);
      if (columns.length) {
        const list = (one.rows || []).slice(0, maxRows).map((r) => columns.map((c) => r[c]));
        return { columns, rows: list, affected: null, truncated: (one.rows || []).length > maxRows };
      }
      return { columns: [], rows: [], affected: Number(one?.rowCount) || 0, truncated: false };
    } finally { await client.end().catch(() => {}); }
  }

  async function sqliteRun(profile, sql) {
    if (!profile.database) throw err('bad-request', 'database file required');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(profile.database);
    try {
      const stmt = db.prepare(sql);
      if (isWriteSql(sql)) {
        const info = stmt.run();
        return { columns: [], rows: [], affected: Number(info?.changes) || 0, truncated: false };
      }
      const raw = stmt.all();
      const columns = typeof stmt.columns === 'function'
        ? stmt.columns().map((c) => c.name)
        : (raw[0] ? Object.keys(raw[0]) : []);
      return capRows(raw, columns, maxRows);
    } finally { db.close(); }
  }

  async function redisRun(profile, password, command) {
    const { createClient } = await import('redis');
    const argv = tokenizeRedis(command);
    if (!argv.length) throw err('bad-request', 'empty command');
    const client = createClient({
      socket: { host: profile.host, port: Number(profile.port) || 6379, connectTimeout: connectTimeoutMs, tls: profile.options?.ssl || undefined },
      password: password || undefined,
      database: Number(profile.database) || 0,
    });
    client.on('error', () => {});
    await client.connect();
    try {
      const reply = await client.sendCommand(argv);
      return { columns: [], rows: [], affected: null, truncated: false, raw: formatReply(reply) };
    } finally { await client.quit().catch(() => client.disconnect()); }
  }

  function formatReply(reply) {
    if (reply === null || reply === undefined) return '(nil)';
    if (typeof reply === 'string') return reply;
    if (typeof reply === 'number' || typeof reply === 'boolean') return String(reply);
    if (Buffer.isBuffer(reply)) return reply.toString('utf8');
    try { return JSON.stringify(reply, null, 2); } catch { return String(reply); }
  }

  async function run(profile, password, sql) {
    const start = Date.now();
    const body = profile.type === 'mysql' ? mysqlRun(profile, password, sql)
      : profile.type === 'postgres' ? postgresRun(profile, password, sql)
        : profile.type === 'sqlite' ? sqliteRun(profile, sql)
          : profile.type === 'redis' ? redisRun(profile, password, sql)
            : Promise.reject(err('bad-type'));
    const out = await body;
    return { ...out, durationMs: Date.now() - start };
  }

  return {
    isWriteSql,
    isWriteRedis,
    tokenizeRedis,
    isWrite(profile, sql) {
      return profile.type === 'redis' ? isWriteRedis(tokenizeRedis(sql)) : isWriteSql(sql);
    },
    async exec(profile, password, sql) {
      try {
        return await withTimeout(run(profile, password, sql), statementTimeoutMs + connectTimeoutMs);
      } catch (e) {
        if (e && !e.code) e.code = 'exec';
        throw e;
      }
    },
    async test(profile, password) {
      try {
        await withTimeout(run(profile, password, profile.type === 'redis' ? 'PING' : profile.type === 'sqlite' ? 'SELECT 1' : 'SELECT 1'), connectTimeoutMs + 5000);
        return { ok: true };
      } catch (e) {
        if (e && !e.code) e.code = 'connect';
        throw e;
      }
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/navicat-exec.test.js"`
Expected: PASS（SQLite 用例真实建库执行）。

- [ ] **Step 5: Commit**

```bash
git add server/navicat-exec.js server/test/navicat-exec.test.js
git commit -m "feat(navicat): 四类库执行层与写识别"
```

---

## Task 6: HTTP 路由 `navicat-mount.js`

**Files:**
- Create: `server/navicat-mount.js`
- Test: `server/test/navicat-http.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/navicat-http.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createNavicatCrypto } from '../navicat-crypto.js';
import { createNavicatStore } from '../navicat-store.js';
import { buildNcx, connectionString } from '../navicat-ncx.js';
import { createNavicatMount } from '../navicat-mount.js';

function fakeExec() {
  const calls = [];
  return {
    calls,
    isWrite: (p, s) => String(s).trim().toUpperCase().startsWith('INSERT'),
    exec: async (p, pw, sql) => {
      calls.push({ type: p.type, password: pw, sql });
      return { columns: ['a'], rows: [[1]], affected: null, truncated: false, durationMs: 3 };
    },
    test: async (p, pw) => { calls.push({ test: p.type, password: pw }); return { ok: true }; },
  };
}

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-nvhttp-'));
  const store = createNavicatStore({ file: path.join(dir, 'profiles.json'), crypto: createNavicatCrypto({ keyFile: path.join(dir, '.key') }) });
  const exec = fakeExec();
  const mount = createNavicatMount({ store, exec, ncx: { buildNcx, connectionString } });
  const server = http.createServer((req, res) => mount(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, server, exec, store };
}

function call(port, method, p, body) {
  return fetch(`http://127.0.0.1:${port}${p}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

const PROFILE = { name: 'A', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'd', password: 'p@ss' };

test('profiles：创建/列表掩码/更新/删除', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const created = await call(A.port, 'POST', '/api/navicat/profiles', PROFILE);
  assert.equal(created.status, 200);
  assert.equal(created.body.item.hasPassword, true);
  const id = created.body.item.id;
  const list = await call(A.port, 'GET', '/api/navicat/profiles');
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].secret, undefined);
  const upd = await call(A.port, 'PATCH', '/api/navicat/profiles', { id, name: 'B' });
  assert.equal(upd.body.item.name, 'B');
  const del = await call(A.port, 'DELETE', `/api/navicat/profiles?id=${id}`);
  assert.equal(del.status, 200);
  assert.equal((await call(A.port, 'GET', '/api/navicat/profiles')).body.items.length, 0);
});

test('reveal / connstr：明文只在服务端拼装/按需返回', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const id = (await call(A.port, 'POST', '/api/navicat/profiles', PROFILE)).body.item.id;
  const rev = await call(A.port, 'POST', '/api/navicat/reveal', { id });
  assert.equal(rev.body.password, 'p@ss');
  const noPw = await call(A.port, 'POST', '/api/navicat/connstr', { id });
  assert.equal(noPw.body.text, 'mysql://u@h:3306/d');
  const withPw = await call(A.port, 'POST', '/api/navicat/connstr', { id, withPassword: true });
  assert.equal(withPw.body.text, 'mysql://u:p%40ss@h:3306/d');
});

test('test：用档案密码测试连接', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const id = (await call(A.port, 'POST', '/api/navicat/profiles', PROFILE)).body.item.id;
  const r = await call(A.port, 'POST', '/api/navicat/test', { id });
  assert.equal(r.status, 200);
  assert.equal(A.exec.calls[0].password, 'p@ss');
});

test('exec：写操作先要 confirm，确认后执行', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const id = (await call(A.port, 'POST', '/api/navicat/profiles', PROFILE)).body.item.id;
  const need = await call(A.port, 'POST', '/api/navicat/exec', { id, sql: 'INSERT INTO t VALUES (1)' });
  assert.equal(need.body.needConfirm, true);
  assert.equal(need.body.kind, 'write');
  assert.equal(A.exec.calls.length, 0);
  const ok = await call(A.port, 'POST', '/api/navicat/exec', { id, sql: 'INSERT INTO t VALUES (1)', confirm: true });
  assert.equal(ok.body.result.rows.length, 1);
  assert.equal(A.exec.calls.length, 1);
  const read = await call(A.port, 'POST', '/api/navicat/exec', { id, sql: 'SELECT 1' });
  assert.equal(read.body.result.columns[0], 'a');
});

test('ncx：返回 XML，密码为密文', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const id = (await call(A.port, 'POST', '/api/navicat/profiles', PROFILE)).body.item.id;
  const r = await call(A.port, 'POST', '/api/navicat/ncx', { ids: [id] });
  assert.match(r.body.xml, /<Connection /);
  assert.doesNotMatch(r.body.xml, /p@ss/);
});

test('错误：404 / 400 bad-type / 未知路径', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  assert.equal((await call(A.port, 'POST', '/api/navicat/reveal', { id: 'nope' })).status, 404);
  assert.equal((await call(A.port, 'POST', '/api/navicat/profiles', { ...PROFILE, type: 'oracle' })).status, 400);
  assert.equal((await call(A.port, 'GET', '/api/navicat/unknown')).status, 404);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/navicat-http.test.js"`
Expected: FAIL，找不到 `../navicat-mount.js`。

- [ ] **Step 3: 实现**

Create `server/navicat-mount.js`:

```js
import { t } from './i18n.js';

const MAX_BODY = 2 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const STATUS = { 'not-found': 404, 'bad-type': 400, 'bad-request': 400, 'bad-secret': 400, timeout: 504, connect: 502, exec: 502 };

function sendErr(res, code, extra = {}) {
  const c = code && STATUS[code] ? code : 'exec';
  sendJson(res, STATUS[c] || 500, { error: c, message: t(`nv.err.${c.replace(/-/g, '_')}`), ...extra });
}

// /api/navicat/*：连接档案 CRUD + 测试/执行 + 连接串/导出
export function createNavicatMount({ store, exec, ncx, logger = console }) {
  async function route(req, res, url) {
    const m = req.method;
    const seg = url.pathname.replace(/^\/api\/navicat\/?/, '').split('/').filter(Boolean);
    const head = seg[0] || '';
    let body = {};
    if (m === 'POST' || m === 'PATCH') {
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
    }

    if (head === 'profiles' && seg.length === 1) {
      if (m === 'GET') return sendJson(res, 200, { items: store.list() });
      if (m === 'POST') return sendJson(res, 200, { ok: true, item: store.create(body) });
      if (m === 'PATCH') return sendJson(res, 200, { ok: true, item: store.update(String(body.id || ''), body) });
      if (m === 'DELETE') return sendJson(res, 200, { ok: store.remove(String(url.searchParams.get('id') || '')) });
      return sendJson(res, 405, { error: 'method' });
    }

    if (head === 'reveal' && m === 'POST') {
      return sendJson(res, 200, { password: store.password(String(body.id || '')) });
    }

    if (head === 'connstr' && m === 'POST') {
      const p = store.get(String(body.id || ''));
      const text = ncx.connectionString(p, store.password(p.id), { withPassword: !!body.withPassword });
      return sendJson(res, 200, { text });
    }

    if (head === 'ncx' && m === 'POST') {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const entries = ids.map((id) => {
        const p = store.get(String(id));
        return { ...p, password: store.password(p.id) };
      });
      return sendJson(res, 200, { xml: ncx.buildNcx(entries) });
    }

    if (head === 'test' && m === 'POST') {
      const p = body.profile ? body.profile : store.get(String(body.id || ''));
      const password = body.profile ? String(body.profile.password || '') : store.password(p.id);
      await exec.test(p, password);
      return sendJson(res, 200, { ok: true });
    }

    if (head === 'exec' && m === 'POST') {
      const p = store.get(String(body.id || ''));
      const sql = String(body.sql || '');
      if (!sql.trim()) return sendErr(res, 'bad-request');
      if (exec.isWrite(p, sql) && body.confirm !== true) {
        return sendJson(res, 200, { needConfirm: true, kind: 'write' });
      }
      const result = await exec.exec(p, store.password(p.id), sql);
      return sendJson(res, 200, { ok: true, result });
    }

    return sendJson(res, 404, { error: 'not-found', message: t('nv.err.not_found') });
  }

  return (req, res, url) => {
    const u = url || new URL(req.url, 'http://localhost');
    if (!u.pathname.startsWith('/api/navicat')) return sendJson(res, 404, { error: 'not-found' });
    route(req, res, u).catch((e) => {
      logger?.warn?.('navicat mount error', (e && e.message) || e);
      sendErr(res, (e && e.code) || 'exec');
    });
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/navicat-http.test.js"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/navicat-mount.js server/test/navicat-http.test.js
git commit -m "feat(navicat): /api/navicat 路由"
```

---

## Task 7: 路径与装配

**Files:**
- Modify: `server/port-paths.js:40-46`
- Modify: `server/index.js`（import 区、`buildWorkspace`、HTTP 分发）
- Test: `server/test/port-paths.test.js`（已有，补断言）

- [ ] **Step 1: 写失败测试（改已有 `server/test/port-paths.test.js`）**

在 `portPaths 全部落在 ports/<端口> 下` 用例里，`notepadDir` 断言后加一行：

```js
  assert.equal(p.navicatDir, path.join(base, 'tools', 'navicat'));
```

在 `ensurePortDirs 幂等创建必需子目录` 用例的数组末尾加 `p.navicatDir`：

```js
  for (const d of [p.dir, p.schedulerDir, p.collabDir, p.uploadDir, p.downloadDir, p.downloadsDir, p.skillsRoot, p.sessionLogsDir, p.postmanDir, p.notepadDir, p.navicatDir]) {
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/port-paths.test.js"`
Expected: FAIL（`paths.navicatDir` 为 undefined）。

- [ ] **Step 3: 改 `server/port-paths.js`**

在 `notepadDir` 下一行加：

```js
    navicatDir: path.join(dir, 'tools', 'navicat'),
```

并把 `ensurePortDirs` 的数组末尾补上 `paths.navicatDir`：

```js
  for (const d of [paths.dir, paths.schedulerDir, paths.collabDir, paths.uploadDir, paths.downloadDir, paths.downloadsDir, paths.skillsRoot, paths.sessionLogsDir, paths.postmanDir, paths.notepadDir, paths.navicatDir]) {
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/port-paths.test.js"`
Expected: PASS。

- [ ] **Step 5: 改 `server/index.js`**

在 `import { createPostmanHistory } from './postman-history.js';`（约 line 67）后加：

```js
import { createNavicatCrypto } from './navicat-crypto.js';
import { createNavicatStore } from './navicat-store.js';
import { createNavicatExec } from './navicat-exec.js';
import { createNavicatMount } from './navicat-mount.js';
import { buildNcx, connectionString } from './navicat-ncx.js';
```

在 `const notepadStore = ...`（约 line 396）后加：

```js
  const navicatCrypto = createNavicatCrypto({ keyFile: path.join(paths.navicatDir, '.key') });
  const navicatStore = createNavicatStore({ file: path.join(paths.navicatDir, 'profiles.json'), crypto: navicatCrypto });
  const navicatMount = createNavicatMount({
    store: navicatStore,
    exec: createNavicatExec({}),
    ncx: { buildNcx, connectionString },
    logger: log,
  });
```

把 `buildWorkspace` 的 `return { ... }`（约 line 408）里加入 `navicatMount`：

```js
  return { projects, saveProjects, workflows, sessionManager, workflowRunner, engine, collabMount, usageMount, usageReporter, scheduler, httpApi, llmMount, translateMount, llmVault, usageStore, taskStore, sessionLedger, historyFile: paths.historyFile, paths, restoreSessionById, navicatMount };
```

在 HTTP 分发的 `/api/scheduler` 后（约 line 787）加：

```js
  if (url.pathname.startsWith('/api/navicat')) { await ws.navicatMount(req, res, url); return; }
```

- [ ] **Step 6: 冒烟：起后端并打接口**

Run: `node --test "server/test/port-paths.test.js" "server/test/http-api.test.js"`
Expected: PASS（装配未破坏其他测试）。

- [ ] **Step 7: Commit**

```bash
git add server/port-paths.js server/index.js server/test/port-paths.test.js
git commit -m "feat(navicat): 装配端口路径与 /api/navicat 挂载"
```

---

## Task 8: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`（`tools.*` 区，约 line 697 / 771）
- Modify: `shared/i18n/en.js`（对应位置）

- [ ] **Step 1: 中文词条**

在 `zh-CN.js` 的 `'tools.sort'` 后加 `'tools.navicat': 'Navicat',`；在 `'tools.desc.postman'` 后加 `'tools.desc.navicat': '数据库连接与 SQL 执行',`；并在 `tools.*` 区末尾（`'tools.desc.postman'` 之后）追加一整个 `nv.*` 区块：

```js
  'nv.new': '新建连接',
  'nv.search_ph': '搜索连接',
  'nv.empty': '暂无连接',
  'nv.name': '名称',
  'nv.type': '类型',
  'nv.host': '主机',
  'nv.port': '端口',
  'nv.user': '用户名',
  'nv.password': '密码',
  'nv.database': '数据库 / 文件路径',
  'nv.db_index': '库索引',
  'nv.save': '保存',
  'nv.saved': '已保存',
  'nv.test': '测试连接',
  'nv.testing': '测试中…',
  'nv.test_ok': '连接成功',
  'nv.exec': '执行',
  'nv.running': '执行中…',
  'nv.clear': '清空',
  'nv.result': '结果',
  'nv.no_result': '暂无结果',
  'nv.rows': '共 {n} 行',
  'nv.affected': '影响 {n} 行',
  'nv.truncated': '仅显示前 {n} 行',
  'nv.duration': '耗时 {ms} ms',
  'nv.confirm_title': '确认执行写操作',
  'nv.confirm_write': '该语句可能修改数据，确定执行？',
  'nv.copy_connstr': '复制连接串',
  'nv.copy_with_pw': '含密码复制',
  'nv.copied': '已复制',
  'nv.export_ncx': '导出 .ncx',
  'nv.exported': '已导出',
  'nv.rename': '重命名',
  'nv.rename_ph': '新名称',
  'nv.delete': '删除',
  'nv.delete_confirm': '删除该连接？',
  'nv.sql_ph': '在此输入 SQL / Redis 命令',
  'nv.required_name': '请填写连接名称',
  'nv.save_first': '请先保存连接',
  'nv.err.not_found': '连接不存在',
  'nv.err.bad_type': '不支持的数据库类型',
  'nv.err.bad_request': '参数不合法',
  'nv.err.bad_secret': '密码无法解密',
  'nv.err.timeout': '执行超时',
  'nv.err.connect': '连接失败',
  'nv.err.exec': '执行失败',
```

- [ ] **Step 2: 英文词条**

在 `en.js` 对应位置加同键集：

```js
  'tools.navicat': 'Navicat',
  'tools.desc.navicat': 'DB connections & SQL runner',
```

以及：

```js
  'nv.new': 'New connection',
  'nv.search_ph': 'Search connections',
  'nv.empty': 'No connections',
  'nv.name': 'Name',
  'nv.type': 'Type',
  'nv.host': 'Host',
  'nv.port': 'Port',
  'nv.user': 'User',
  'nv.password': 'Password',
  'nv.database': 'Database / file path',
  'nv.db_index': 'DB index',
  'nv.save': 'Save',
  'nv.saved': 'Saved',
  'nv.test': 'Test connection',
  'nv.testing': 'Testing…',
  'nv.test_ok': 'Connection OK',
  'nv.exec': 'Run',
  'nv.running': 'Running…',
  'nv.clear': 'Clear',
  'nv.result': 'Result',
  'nv.no_result': 'No result',
  'nv.rows': '{n} rows',
  'nv.affected': '{n} affected',
  'nv.truncated': 'Showing first {n} rows',
  'nv.duration': '{ms} ms',
  'nv.confirm_title': 'Confirm write',
  'nv.confirm_write': 'This statement may modify data. Run it?',
  'nv.copy_connstr': 'Copy connection string',
  'nv.copy_with_pw': 'Copy with password',
  'nv.copied': 'Copied',
  'nv.export_ncx': 'Export .ncx',
  'nv.exported': 'Exported',
  'nv.rename': 'Rename',
  'nv.rename_ph': 'New name',
  'nv.delete': 'Delete',
  'nv.delete_confirm': 'Delete this connection?',
  'nv.sql_ph': 'Enter SQL / Redis command',
  'nv.required_name': 'Name is required',
  'nv.save_first': 'Save the connection first',
  'nv.err.not_found': 'Connection not found',
  'nv.err.bad_type': 'Unsupported database type',
  'nv.err.bad_request': 'Invalid request',
  'nv.err.bad_secret': 'Cannot decrypt password',
  'nv.err.timeout': 'Execution timed out',
  'nv.err.connect': 'Connection failed',
  'nv.err.exec': 'Execution failed',
```

- [ ] **Step 3: 校验键对称**

Run: `npm.cmd run check:i18n`
Expected: 通过（中英键集合一致）。

- [ ] **Step 4: Commit**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n(navicat): 新增 Navicat 工具词条"
```

---

## Task 9: 前端数据层 `useNavicat.ts`

**Files:**
- Create: `web/src/tools/navicat/useNavicat.ts`
- Test: `web/src/tools/navicat/useNavicat.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/src/tools/navicat/useNavicat.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useNavicat } from './useNavicat';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
function errJson(status: number, body: unknown) { return { ok: false, status, json: async () => body }; }

afterEach(() => vi.unstubAllGlobals());

const PROFILE = { name: 'A', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'd', password: 'p' };

describe('useNavicat', () => {
  it('load 拉取 items', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [{ id: '1', name: 'A' }] })));
    const s = useNavicat();
    await s.load();
    expect(s.profiles.value).toHaveLength(1);
  });

  it('save：无 id 走 POST，有 id 走 PATCH', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push([String(u), init?.method]);
      return okJson({ ok: true, item: { id: '1', name: 'A' } });
    }));
    const s = useNavicat();
    await s.save({ ...PROFILE });
    await s.save({ ...PROFILE, id: '1' });
    expect(calls[0]).toEqual(['/api/navicat/profiles', 'POST']);
    expect(calls[1]).toEqual(['/api/navicat/profiles', 'PATCH']);
  });

  it('exec：needConfirm 透出，确认后返回结果', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      const b = init?.body ? JSON.parse(String(init.body)) : {};
      if (b.confirm) return okJson({ ok: true, result: { columns: ['a'], rows: [[1]], affected: null, truncated: false, durationMs: 2 } });
      return okJson({ needConfirm: true, kind: 'write' });
    }));
    const s = useNavicat();
    const a = await s.exec('1', 'INSERT INTO t VALUES (1)');
    expect(a.needConfirm).toBe(true);
    const b = await s.exec('1', 'INSERT INTO t VALUES (1)', true);
    expect(b.result?.rows).toEqual([[1]]);
  });

  it('exec：失败抛 message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(504, { error: 'timeout', message: '执行超时' })));
    const s = useNavicat();
    await expect(s.exec('1', 'SELECT 1')).rejects.toThrow('执行超时');
  });

  it('reveal/connstr/exportNcx 打对应端点', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(String(u));
      if (String(u).endsWith('/reveal')) return okJson({ password: 'p' });
      if (String(u).endsWith('/connstr')) return okJson({ text: 'mysql://u@h/d' });
      return okJson({ xml: '<Connections/>' });
    }));
    const s = useNavicat();
    expect(await s.reveal('1')).toBe('p');
    expect(await s.connstr('1', true)).toBe('mysql://u@h/d');
    expect(await s.exportNcx(['1'])).toContain('Connections');
    expect(urls).toEqual(['/api/navicat/reveal', '/api/navicat/connstr', '/api/navicat/ncx']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/tools/navicat/useNavicat.test.ts`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现**

Create `web/src/tools/navicat/useNavicat.ts`:

```ts
import { ref, type Ref } from 'vue';

export type NavicatType = 'mysql' | 'postgres' | 'sqlite' | 'redis';

export type NavicatProfile = {
  id?: string;
  name: string;
  type: NavicatType;
  host: string;
  port: string;
  user: string;
  database: string;
  options?: { ssl?: boolean };
  hasPassword?: boolean;
  password?: string;
  updatedAt?: string;
};

export type ExecResult = {
  columns: string[];
  rows: unknown[][];
  affected: number | null;
  truncated: boolean;
  durationMs: number;
  raw?: string;
};

export type ExecOutcome = { needConfirm: boolean; result?: ExecResult };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function jfetch(url: string, opt: RequestInit = {}): Promise<any> {
  const res = await fetch(url, opt);
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(j?.message || j?.error || `HTTP ${res.status}`));
  return j;
}

export function useNavicat(): {
  profiles: Ref<NavicatProfile[]>;
  load: () => Promise<void>;
  save: (p: NavicatProfile) => Promise<NavicatProfile>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  test: (p: { id?: string } | { profile: NavicatProfile }) => Promise<void>;
  exec: (id: string, sql: string, confirm?: boolean) => Promise<ExecOutcome>;
  reveal: (id: string) => Promise<string>;
  connstr: (id: string, withPassword: boolean) => Promise<string>;
  exportNcx: (ids: string[]) => Promise<string>;
} {
  const profiles = ref<NavicatProfile[]>([]);

  async function load(): Promise<void> {
    try {
      const j = await jfetch('/api/navicat/profiles');
      profiles.value = Array.isArray(j.items) ? j.items : [];
    } catch { /* 列表失败不阻塞 */ }
  }

  async function save(p: NavicatProfile): Promise<NavicatProfile> {
    const j = await jfetch('/api/navicat/profiles', {
      method: p.id ? 'PATCH' : 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(p),
    });
    await load();
    return j.item as NavicatProfile;
  }

  async function remove(id: string): Promise<void> {
    await jfetch(`/api/navicat/profiles?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  }

  async function rename(id: string, name: string): Promise<void> {
    await jfetch('/api/navicat/profiles', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ id, name }) });
    await load();
  }

  async function test(p: { id?: string } | { profile: NavicatProfile }): Promise<void> {
    await jfetch('/api/navicat/test', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(p) });
  }

  async function exec(id: string, sql: string, confirm = false): Promise<ExecOutcome> {
    const j = await jfetch('/api/navicat/exec', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id, sql, confirm }) });
    if (j.needConfirm) return { needConfirm: true };
    return { needConfirm: false, result: j.result as ExecResult };
  }

  async function reveal(id: string): Promise<string> {
    const j = await jfetch('/api/navicat/reveal', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id }) });
    return String(j.password || '');
  }

  async function connstr(id: string, withPassword: boolean): Promise<string> {
    const j = await jfetch('/api/navicat/connstr', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id, withPassword }) });
    return String(j.text || '');
  }

  async function exportNcx(ids: string[]): Promise<string> {
    const j = await jfetch('/api/navicat/ncx', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ids }) });
    return String(j.xml || '');
  }

  return { profiles, load, save, remove, rename, test, exec, reveal, connstr, exportNcx };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/tools/navicat/useNavicat.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/tools/navicat/useNavicat.ts web/src/tools/navicat/useNavicat.test.ts
git commit -m "feat(navicat): 前端数据层 useNavicat"
```

---

## Task 10: 左栏列表 `NavicatList.vue`

**Files:**
- Create: `web/src/tools/navicat/NavicatList.vue`
- Test: `web/src/tools/navicat/NavicatList.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/src/tools/navicat/NavicatList.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import ElementPlus from 'element-plus';
import { mountC } from '../../test-utils';
import NavicatList from './NavicatList.vue';

const P = (id: string, name: string, type = 'mysql') => ({ id, name, type, host: 'h', port: '1', user: 'u', database: 'd', hasPassword: true });
function mount(props: any) {
  return mountC(NavicatList, { props, global: { plugins: [ElementPlus] } });
}

describe('NavicatList', () => {
  it('渲染连接并高亮当前项，按名称过滤', async () => {
    const w = mount({ profiles: [P('1', 'Alpha'), P('2', 'Beta')], activeId: '2' });
    expect(w.findAll('.nv-row')).toHaveLength(2);
    expect(w.find('.nv-row.active').text()).toContain('Beta');
    await w.find('.nv-search input').setValue('alp');
    expect(w.findAll('.nv-row')).toHaveLength(1);
    expect(w.text()).toContain('Alpha');
  });

  it('点击项发出 select，新建/重命名/删除发出对应事件', async () => {
    const w = mount({ profiles: [P('1', 'Alpha')], activeId: '' });
    await w.find('.nv-row').trigger('click');
    await w.find('.nv-new').trigger('click');
    await w.find('.nv-rename').trigger('click');
    await w.find('.nv-del').trigger('click');
    expect(w.emitted('select')?.[0]).toEqual(['1']);
    expect(w.emitted('create')).toBeTruthy();
    expect(w.emitted('rename')?.[0]).toEqual(['1']);
    expect(w.emitted('remove')?.[0]).toEqual(['1']);
  });

  it('空列表显示占位文案', () => {
    const w = mount({ profiles: [], activeId: '' });
    expect(w.find('.nv-empty').exists()).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/tools/navicat/NavicatList.test.ts`
Expected: FAIL，找不到组件。

- [ ] **Step 3: 实现**

Create `web/src/tools/navicat/NavicatList.vue`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { NavicatProfile } from './useNavicat';

const props = defineProps<{ profiles: NavicatProfile[]; activeId: string }>();
const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'create'): void;
  (e: 'rename', id: string): void;
  (e: 'remove', id: string): void;
}>();

const q = ref('');
const list = computed(() => {
  const kw = q.value.trim().toLowerCase();
  if (!kw) return props.profiles;
  return props.profiles.filter((p) => p.name.toLowerCase().includes(kw) || p.type.includes(kw));
});
</script>

<template>
  <aside class="nv-side">
    <div class="nv-sidehead">
      <span class="nv-sidetitle">{{ $t('tools.navicat') }}</span>
      <button class="nv-new" @click="emit('create')">＋</button>
    </div>
    <el-input v-model="q" class="nv-search" size="small" :placeholder="$t('nv.search_ph')" clearable />
    <div class="nv-list">
      <div
        v-for="p in list"
        :key="p.id"
        class="nv-row"
        :class="{ active: p.id === activeId }"
        @click="emit('select', p.id as string)"
      >
        <span class="nv-badge">{{ p.type }}</span>
        <span class="nv-name" :title="p.name">{{ p.name }}</span>
        <span class="nv-acts">
          <button class="nv-mini nv-rename" :title="$t('nv.rename')" @click.stop="emit('rename', p.id as string)">✎</button>
          <button class="nv-mini nv-del" :title="$t('nv.delete')" @click.stop="emit('remove', p.id as string)">🗑</button>
        </span>
      </div>
      <div v-if="!list.length" class="nv-empty">{{ $t('nv.empty') }}</div>
    </div>
  </aside>
</template>

<style scoped>
.nv-side { width: 260px; flex: none; display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--bd); border-radius: 8px; background: var(--bg2); padding: 6px; box-sizing: border-box; overflow: hidden; }
.nv-sidehead { display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; }
.nv-sidetitle { font-size: 12px; color: var(--tx3); }
.nv-new { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; width: 24px; height: 22px; cursor: pointer; }
.nv-new:hover { border-color: var(--ac2); color: var(--ac2); }
.nv-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
.nv-row { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 5px; cursor: pointer; font-size: 13px; color: var(--tx2); }
.nv-row:hover { background: var(--bg4); }
.nv-row.active { background: var(--bg4); color: var(--ac2); }
.nv-badge { flex: none; font-size: 10px; color: var(--tx4); border: 1px solid var(--bd); border-radius: 3px; padding: 0 4px; text-transform: uppercase; }
.nv-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nv-acts { display: none; gap: 2px; }
.nv-row:hover .nv-acts { display: flex; }
.nv-mini { background: none; border: none; color: var(--tx3); cursor: pointer; font-size: 12px; padding: 0 2px; }
.nv-mini:hover { color: var(--ac2); }
.nv-empty { color: var(--tx4); font-size: 12px; text-align: center; padding: 12px 0; }
</style>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/tools/navicat/NavicatList.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/tools/navicat/NavicatList.vue web/src/tools/navicat/NavicatList.test.ts
git commit -m "feat(navicat): 左栏连接列表组件"
```

---

## Task 11: 主面板 `NavicatTool.vue`

**Files:**
- Create: `web/src/tools/navicat/NavicatTool.vue`
- Test: `web/src/tools/navicat/NavicatTool.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/src/tools/navicat/NavicatTool.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../../test-utils';
import NavicatTool from './NavicatTool.vue';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
const P = { id: '1', name: 'A', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'd', hasPassword: true };

afterEach(() => vi.unstubAllGlobals());

function mount() {
  return mountC(NavicatTool, { global: { plugins: [ElementPlus], stubs: { teleport: true } } });
}

describe('NavicatTool', () => {
  it('加载列表并可选中填充表单', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [P] })));
    const w = mount();
    await flushPromises();
    expect(w.findAll('.nv-row')).toHaveLength(1);
    await w.find('.nv-row').trigger('click');
    await flushPromises();
    expect((w.find('.nv-name-input input').element as HTMLInputElement).value).toBe('A');
  });

  it('执行读语句渲染结果表格与行数', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (String(u) === '/api/navicat/profiles') return okJson({ items: [P] });
      return okJson({ ok: true, result: { columns: ['a'], rows: [[1]], affected: null, truncated: false, durationMs: 2 } });
    }));
    const w = mount();
    await flushPromises();
    await w.find('.nv-row').trigger('click');
    await w.find('.nv-sql').setValue('SELECT 1');
    await w.find('.nv-run').trigger('click');
    await flushPromises();
    expect(w.find('.nv-table').exists()).toBe(true);
    expect(w.find('.nv-meta').text()).toContain('1');
  });

  it('写语句先弹确认，确认后执行', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (String(u) === '/api/navicat/profiles') return okJson({ items: [P] });
      const b = init?.body ? JSON.parse(String(init.body)) : {};
      if (b.confirm) return okJson({ ok: true, result: { columns: [], rows: [], affected: 1, truncated: false, durationMs: 1 } });
      return okJson({ needConfirm: true, kind: 'write' });
    }));
    const w = mount();
    await flushPromises();
    await w.find('.nv-row').trigger('click');
    await w.find('.nv-sql').setValue('INSERT INTO t VALUES (1)');
    await w.find('.nv-run').trigger('click');
    await flushPromises();
    // ElMessageBox 的确认按钮在 teleport 到 body 的 overlay 内
    const confirm = document.querySelector('.el-message-box__btns .el-button--primary') as HTMLElement | null;
    expect(confirm).toBeTruthy();
    confirm?.click();
    await flushPromises();
    expect(w.find('.nv-meta').text()).toContain('1');
  });

  it('新建连接 → 保存发出 POST', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push([String(u), init?.method]);
      if (String(u) === '/api/navicat/profiles' && (!init || !init.method)) return okJson({ items: [] });
      return okJson({ ok: true, item: P });
    }));
    const w = mount();
    await flushPromises();
    await w.find('.nv-new').trigger('click');
    await w.find('.nv-name-input input').setValue('新连接');
    await w.find('.nv-save').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/navicat/profiles' && m === 'POST')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/tools/navicat/NavicatTool.test.ts`
Expected: FAIL，找不到组件。

- [ ] **Step 3: 实现**

Create `web/src/tools/navicat/NavicatTool.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { t } from '../../i18n';
import NavicatList from './NavicatList.vue';
import { useNavicat, type ExecResult, type NavicatProfile, type NavicatType } from './useNavicat';

const { profiles, load, save, remove, rename, test, exec, reveal, connstr, exportNcx } = useNavicat();

const TYPES: NavicatType[] = ['mysql', 'postgres', 'sqlite', 'redis'];

const form = ref<NavicatProfile>(blank());
const sql = ref('');
const busy = ref(false);
const testing = ref(false);
const msg = ref('');
const result = ref<ExecResult | null>(null);

function blank(): NavicatProfile {
  return { name: '', type: 'mysql', host: '127.0.0.1', port: '3306', user: 'root', database: '', password: '' };
}

const isSqlite = computed(() => form.value.type === 'sqlite');
const isRedis = computed(() => form.value.type === 'redis');
const dbLabel = computed(() => (isSqlite.value ? t('nv.database') : isRedis.value ? t('nv.db_index') : t('nv.database')));

function defaultPort(type: NavicatType): string {
  return type === 'mysql' ? '3306' : type === 'postgres' ? '5432' : type === 'redis' ? '6379' : '';
}

function onTypeChange() {
  if (!form.value.port || ['3306', '5432', '6379', ''].includes(form.value.port)) form.value.port = defaultPort(form.value.type);
}

function selectProfile(id: string) {
  const p = profiles.value.find((x) => x.id === id);
  if (!p) return;
  form.value = { ...blank(), ...p, password: '' };
  result.value = null;
  msg.value = '';
}

function newProfile() {
  form.value = blank();
  result.value = null;
  msg.value = '';
}

async function doSave() {
  if (!form.value.name.trim()) { msg.value = t('nv.required_name'); return; }
  busy.value = true; msg.value = '';
  try {
    const payload = { ...form.value };
    const savedItem = await save(payload);
    form.value = { ...form.value, id: savedItem.id, hasPassword: savedItem.hasPassword, password: '' };
    msg.value = t('nv.saved');
  } catch (e) { msg.value = (e as Error).message; } finally { busy.value = false; }
}

async function doTest() {
  testing.value = true; msg.value = '';
  try {
    if (form.value.id && !form.value.password) await test({ id: form.value.id });
    else await test({ profile: form.value });
    msg.value = t('nv.test_ok');
  } catch (e) { msg.value = (e as Error).message; } finally { testing.value = false; }
}

async function doExec() {
  if (!form.value.id) { msg.value = t('nv.save_first'); return; }
  if (!sql.value.trim()) return;
  busy.value = true; msg.value = '';
  try {
    let out = await exec(form.value.id, sql.value);
    if (out.needConfirm) {
      try {
        await ElMessageBox.confirm(t('nv.confirm_write'), t('nv.confirm_title'), { type: 'warning' });
      } catch { busy.value = false; return; }
      out = await exec(form.value.id, sql.value, true);
    }
    result.value = out.result || null;
  } catch (e) { msg.value = (e as Error).message; } finally { busy.value = false; }
}

async function doReveal() {
  if (!form.value.id) return;
  try { form.value.password = await reveal(form.value.id); } catch { /* ignore */ }
}

async function copyConn(withPassword: boolean) {
  if (!form.value.id) { msg.value = t('nv.save_first'); return; }
  try {
    const text = await connstr(form.value.id, withPassword);
    await navigator.clipboard.writeText(text);
    msg.value = t('nv.copied');
  } catch (e) { msg.value = (e as Error).message; }
}

async function doExport() {
  if (!form.value.id) { msg.value = t('nv.save_first'); return; }
  try {
    const xml = await exportNcx([form.value.id as string]);
    const blob = new Blob([xml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'navicat.ncx';
    a.click();
    URL.revokeObjectURL(a.href);
    msg.value = t('nv.exported');
  } catch (e) { msg.value = (e as Error).message; }
}

async function onRename(id: string) {
  try {
    const { value } = await ElMessageBox.prompt(t('nv.rename'), t('nv.rename_ph'), { inputValue: profiles.value.find((p) => p.id === id)?.name || '' });
    if (value) await rename(id, value);
  } catch { /* cancelled */ }
}

async function onRemove(id: string) {
  try {
    await ElMessageBox.confirm(t('nv.delete_confirm'), t('nv.rename'), { type: 'warning' });
  } catch { return; }
  await remove(id);
  if (form.value.id === id) newProfile();
}

function exportCsv() {
  if (!result.value) return;
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [result.value.columns.map(esc).join(',')];
  for (const row of result.value.rows) lines.push(row.map(esc).join(','));
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'result.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

onMounted(() => { void load(); });
</script>

<template>
  <div class="nvbody">
    <NavicatList :profiles="profiles" :active-id="form.id || ''" @select="selectProfile" @create="newProfile" @rename="onRename" @remove="onRemove" />

    <section class="nvmain">
      <div class="nvform">
        <el-input v-model="form.name" class="nv-name-input" size="small" :placeholder="$t('nv.name')" />
        <el-select v-model="form.type" size="small" class="nv-type" @change="onTypeChange">
          <el-option v-for="ty in TYPES" :key="ty" :label="ty" :value="ty" />
        </el-select>
        <template v-if="!isSqlite">
          <el-input v-model="form.host" size="small" class="nv-host" :placeholder="$t('nv.host')" />
          <el-input v-model="form.port" size="small" class="nv-port" :placeholder="$t('nv.port')" />
          <el-input v-if="!isRedis" v-model="form.user" size="small" :placeholder="$t('nv.user')" />
          <div v-if="!isRedis" class="nv-pw">
            <el-input v-model="form.password" size="small" type="password" show-password :placeholder="form.hasPassword && !form.password ? '••••••' : $t('nv.password')" />
            <button v-if="form.id && form.hasPassword" class="nv-mini" @click="doReveal">{{ $t('nv.password') }}</button>
          </div>
        </template>
        <el-input v-model="form.database" size="small" :placeholder="dbLabel" />
        <div class="nvactions">
          <button class="nvbtn primary nv-save" :disabled="busy" @click="doSave">{{ $t('nv.save') }}</button>
          <button class="nvbtn nv-test" :disabled="testing" @click="doTest">{{ testing ? $t('nv.testing') : $t('nv.test') }}</button>
          <button class="nvbtn nv-copy" @click="copyConn(false)">{{ $t('nv.copy_connstr') }}</button>
          <button class="nvbtn nv-copy-pw" @click="copyConn(true)">{{ $t('nv.copy_with_pw') }}</button>
          <button class="nvbtn nv-export" @click="doExport">{{ $t('nv.export_ncx') }}</button>
        </div>
      </div>

      <div v-if="msg" class="nvmsg">{{ msg }}</div>

      <textarea v-model="sql" class="nv-sql" :placeholder="$t('nv.sql_ph')" spellcheck="false" />

      <div class="nvresbar">
        <button class="nvbtn primary nv-run" :disabled="busy" @click="doExec">{{ busy ? $t('nv.running') : $t('nv.exec') }}</button>
        <button class="nvbtn" @click="sql = ''; result = null; msg = ''">{{ $t('nv.clear') }}</button>
        <span class="nv-meta">
          <template v-if="result">
            <span v-if="result.truncated">{{ $t('nv.truncated', { n: result.rows.length }) }} · </span>
            <span v-if="result.affected !== null">{{ $t('nv.affected', { n: result.affected }) }} · </span>
            <span>{{ $t('nv.duration', { ms: result.durationMs }) }}</span>
          </template>
        </span>
        <button v-if="result && result.columns.length" class="nvbtn nvexport" style="margin-left:auto" @click="exportCsv">CSV</button>
      </div>

      <div class="nvresult">
        <table v-if="result && result.columns.length" class="nv-table">
          <thead><tr><th v-for="c in result.columns" :key="c">{{ c }}</th></tr></thead>
          <tbody><tr v-for="(row, i) in result.rows" :key="i"><td v-for="(cell, j) in row" :key="j">{{ cell }}</td></tr></tbody>
        </table>
        <pre v-else-if="result && result.raw" class="nv-raw">{{ result.raw }}</pre>
        <div v-else class="nv-noresult">{{ $t('nv.no_result') }}</div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.nvbody { display: flex; flex-direction: row; gap: 12px; height: calc(100vh - 150px); }
.nvmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.nvform { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.nv-name-input { width: 150px; }
.nv-type { width: 110px; }
.nv-host { width: 140px; }
.nv-port { width: 80px; }
.nv-pw { display: flex; gap: 4px; align-items: center; width: 190px; }
.nvform .el-input { flex: none; }
.nvactions { display: flex; flex-wrap: wrap; gap: 6px; }
.nvbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.nvbtn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.nvbtn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.nvbtn:disabled { opacity: .55; cursor: default; }
.nvmsg { color: var(--tx3); font-size: 12px; }
.nv-sql { flex: none; min-height: 110px; resize: vertical; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 6px; padding: 10px 12px; font-size: 13px; line-height: 1.6; font-family: ui-monospace, Consolas, monospace; box-sizing: border-box; }
.nv-sql:focus { outline: none; border-color: var(--ac2); }
.nvresbar { display: flex; gap: 8px; align-items: center; }
.nv-meta { color: var(--tx4); font-size: 12px; }
.nvresult { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--bd); border-radius: 6px; background: var(--bg2); }
.nv-table { border-collapse: collapse; font-size: 12px; font-family: ui-monospace, Consolas, monospace; width: max-content; min-width: 100%; }
.nv-table th, .nv-table td { border: 1px solid var(--bd); padding: 4px 8px; text-align: left; white-space: nowrap; color: var(--tx); }
.nv-table th { background: var(--bg4); position: sticky; top: 0; }
.nv-raw { margin: 0; padding: 10px 12px; font-size: 13px; color: var(--tx); white-space: pre-wrap; }
.nv-noresult { color: var(--tx4); font-size: 12px; padding: 14px; text-align: center; }
</style>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/tools/navicat/NavicatTool.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/tools/navicat/NavicatTool.vue web/src/tools/navicat/NavicatTool.test.ts
git commit -m "feat(navicat): 主面板（表单/执行/结果/导出）"
```

---

## Task 12: 注册进小工具入口

**Files:**
- Modify: `web/src/tools/catalog.ts`
- Modify: `web/src/components/MiniTools.vue`
- Modify: `web/src/components/MiniTools.test.ts`
- Modify: `web/src/components/WelcomeView.test.ts`

- [ ] **Step 1: 改测试（先失败）**

在 `web/src/components/MiniTools.test.ts`：
- 把 `渲染 5 个工具` 用例改名为 `渲染 6 个工具` 并把 `toHaveLength(5)` 改成 `toHaveLength(6)`。
- 新增用例：

```ts
  it('Navicat：渲染 NavicatTool 子组件', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [] })));
    const w = mount();
    await w.findAll('.mticon')[5].trigger('click');
    await flushPromises();
    expect(w.find('.nvbody').exists()).toBe(true);
  });
```

在 `web/src/components/WelcomeView.test.ts`：把 `渲染主按钮与 5 张工具卡片` 用例的 `toHaveLength(5)` 改成 `toHaveLength(6)`（欢迎页的卡片列表来自 `MINI_TOOLS`，会自动多出 Navicat）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/components/MiniTools.test.ts`
Expected: FAIL（仍只有 5 个图标 / 无 `.nvbody`）。

- [ ] **Step 3: 改 `web/src/tools/catalog.ts`**

```ts
export type ToolId = 'translate' | 'yaml' | 'js' | 'sort' | 'postman' | 'navicat';
```

并在 `MINI_TOOLS` 末尾加：

```ts
  { id: 'navicat', icon: '🗄️', labelKey: 'tools.navicat', descKey: 'tools.desc.navicat' },
```

- [ ] **Step 4: 改 `web/src/components/MiniTools.vue`**

脚本区加 import：

```ts
import NavicatTool from '../tools/navicat/NavicatTool.vue';
```

模板里在 `<PostmanTool v-if="open === 'postman'" />` 后插入：

```html
      <NavicatTool v-else-if="open === 'navicat'" />
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/components/MiniTools.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add web/src/tools/catalog.ts web/src/components/MiniTools.vue web/src/components/MiniTools.test.ts web/src/components/WelcomeView.test.ts
git commit -m "feat(navicat): 注册进小工具入口"
```

---

## Task 13: 全量验证

**Files:** 无（仅验证）

- [ ] **Step 1: 服务端测试**

Run: `npm.cmd run test:server`
Expected: 全 PASS。

- [ ] **Step 2: 前端测试**

Run: `npm.cmd run test:web`
Expected: 全 PASS。

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误。

- [ ] **Step 4: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: 通过。

- [ ] **Step 5: 手动冒烟（可选，需本机起 dev）**

`npm.cmd run dev:server` + `npm.cmd run dev:web`，访问 http://localhost:5173 → 小工具 → Navicat：
1. 新建 SQLite 连接，`database` 填一个临时 `.db` 路径，保存；
2. 执行 `CREATE TABLE t(a)` → 应弹"确认执行写操作"→ 确认；
3. 执行 `SELECT * FROM t` → 表格显示；
4. 复制连接串、导出 `.ncx` 成功。

- [ ] **Step 6: 最终提交（若前面步骤有未提交的收尾改动）**

```bash
git status --short
git add <仅本次涉及文件>
git commit -m "chore(navicat): 收尾"
```

---

## 已知风险与后续

- **`.ncx` 的 `ConnType`** 取值 Navicat 未公开，`NAVICAT_CONN_TYPE` 为最佳猜测（mysql=0/postgres=1/sqlite=3/redis=7）。导出后用真实 Navicat 导入实测；若类型不符，只改 `server/navicat-ncx.js` 的常量。测试只锁定 XML 结构与 Navicat AES 已知向量。
- **大结果集**：只做 `maxRows` 截断，未做流式游标；超大表全量查询仍会占用内存，必要时后续加游标/分页。
- **Redis 写识别**为白名单推断，未知命令按"写"处理（更保守，多一次确认）。
- 连接串里的密码做了 URL 编码，复制到其他工具时按需自行解码。
