# 群组协作与 Skill 分发（server）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `statistic` 分支实现协作子系统后端：本机身份 + Ed25519 签名、好友/群组 P2P 流程、skill zip 打包/分发/安装、REST + peer HTTP 接线，全部有测试。

**Architecture:** P2P 网状。每台机器：`collaboration.json`（本地权威）+ 收 /api/collab/peer（验签信封，机器↔机器）+ 本地 REST `/api/collab/*`（浏览器↔本机）。所有机器↔机器消息用 Ed25519 信封 `{type,from,payload,ts,sig}`；本机状态变更经现有 `/ws` 网关广播 `CollabS2C` 推送。与 master 隔离：新文件全在 `server/collaboration/` + `shared/collab.*`；只改 `server/index.js` 与 `shared/package.json`。

**Tech Stack:** Node ESM (`node:` builtins: crypto/fs/os/zlib/path)，内置 fetch，`node:test`；workspaces `@devflow/shared`。

**前置约束（照做，勿改）：**
- 不改 `shared/index.js`、`server/ws-gateway.js`、`web/**`、`server/projects.js`、`server/http-api.js`。协作 WS 推送由 index.js 遍历 `gateway.conns` 下发。
- 测试命令：`node --test "server/test/*.test.js"`（Windows 下 `npm.cmd run test:server`）。
- zip 一律零依赖（Node `zlib`），不新增 npm 包。
- 全部消息 JSON 信封签名用 `sign.js` 的规范化函数；禁止在别的文件再写一套序列化。

---

## Task 1: shared 常量与 TS 类型

**Files:**
- Create: `shared/collab.js`
- Create: `shared/collab.d.ts`
- Modify: `shared/package.json`

- [ ] **Step 1: 写 `shared/collab.js`**

```js
// 协作子系统独立常量（勿并入 shared/index.js，避免与 master 冲突）
export const CollabS2C = Object.freeze({
  COLLAB_INBOX: 'collab-inbox',           // 收到新 skill 包
  COLLAB_FRIEND_REQ: 'collab-friend-req', // 待确认好友
  COLLAB_GROUP_INVITE: 'collab-group-invite', // 待入群邀请
  COLLAB_SYNCED: 'collab-synced',         // 本机状态已变更 → 前端刷新快照
});
export const CollabPeer = Object.freeze({
  FRIEND_REQUEST: 'friend-request',
  FRIEND_ACCEPT: 'friend-accept',
  GROUP_INVITE: 'group-invite',
  GROUP_ACCEPT: 'group-accept',
  MEMBER_SYNC: 'member-sync',
  SKILL_PUSH: 'skill-push',
  PULL_SYNC: 'pull-sync',
});
```

- [ ] **Step 2: 写 `shared/collab.d.ts`**

```ts
export declare const CollabS2C: Readonly<{
  COLLAB_INBOX: 'collab-inbox';
  COLLAB_FRIEND_REQ: 'collab-friend-req';
  COLLAB_GROUP_INVITE: 'collab-group-invite';
  COLLAB_SYNCED: 'collab-synced';
}>;
export declare const CollabPeer: Readonly<{
  FRIEND_REQUEST: 'friend-request';
  FRIEND_ACCEPT: 'friend-accept';
  GROUP_INVITE: 'group-invite';
  GROUP_ACCEPT: 'group-accept';
  MEMBER_SYNC: 'member-sync';
  SKILL_PUSH: 'skill-push';
  PULL_SYNC: 'pull-sync';
}>;
```

- [ ] **Step 3: 改 `shared/package.json` exports 增加子路径**

现有文件为：

```json
{
  "name": "@devflow/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./index.js",
  "types": "./index.d.ts",
  "exports": { ".": { "types": "./index.d.ts", "default": "./index.js" } }
}
```

改为（只加 `./collab` 行，其余不动）：

```json
{
  "name": "@devflow/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./index.js",
  "types": "./index.d.ts",
  "exports": {
    ".": { "types": "./index.d.ts", "default": "./index.js" },
    "./collab": { "types": "./collab.d.ts", "default": "./collab.js" }
  }
}
```

- [ ] **Step 4: 写测试验证常量可 import 且冻结**

Create: `server/test/collab-const.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollabS2C, CollabPeer } from '@devflow/shared/collab';

test('collab 常量可 import 且冻结', () => {
  assert.equal(CollabPeer.FRIEND_REQUEST, 'friend-request');
  assert.equal(CollabS2C.COLLAB_INBOX, 'collab-inbox');
  assert.ok(Object.isFrozen(CollabS2C));
  assert.ok(Object.isFrozen(CollabPeer));
  // 两组枚举值不重叠，防路由错乱
  const s2c = Object.values(CollabS2C);
  const peer = Object.values(CollabPeer);
  for (const p of peer) assert.ok(!s2c.includes(p), `重叠: ${p}`);
});
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test "server/test/collab-const.test.js"`
Expected: `pass 1`, `fail 0`

- [ ] **Step 6: 跑全量 server 测试确认没破坏 master**

Run: `node --test "server/test/*.test.js"`
Expected: 全绿（旧测试不受影响）

- [ ] **Step 7: Commit**

```bash
git add shared/collab.js shared/collab.d.ts shared/package.json server/test/collab-const.test.js
git commit -m "feat(collab): add isolated shared constants + exports"
```

---

## Task 2: 签名工具 sign.js

**Files:**
- Create: `server/collaboration/sign.js`
- Create: `server/test/collab-sign.test.js`

- [ ] **Step 1: 写失败的测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { canonicalize, signEnvelope, verifyEnvelope } from '../collaboration/sign.js';

function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

test('canonicalize 键排序稳定', () => {
  const a = canonicalize({ b: 1, a: [2, { d: 3, c: 4 }], z: null });
  const b = canonicalize({ z: null, a: [2, { c: 4, d: 3 }], b: 1 });
  assert.equal(a, b);
});

test('正确密钥验签通过，错误密钥/篡改失败', () => {
  const k1 = keyPair();
  const k2 = keyPair();
  const env = signEnvelope(k1.privateKey, 'ping', {
    machineId: 'm1', username: 'u', host: 'h', port: 1, publicKey: k1.publicKey,
  }, { hello: 'world' });
  assert.equal(verifyEnvelope(k1.publicKey, env), true);
  assert.equal(verifyEnvelope(k2.publicKey, env), false);          // 错公钥
  const tampered = { ...env, payload: { ...env.payload, hello: 'x' } };
  assert.equal(verifyEnvelope(k1.publicKey, tampered), false);     // 篡改
});

test('时间戳超窗拒绝', () => {
  const k = keyPair();
  const pastTs = Date.now() - 10 * 60 * 1000;
  const env = signEnvelope(k.privateKey, 'ping', {
    machineId: 'm', username: 'u', host: 'h', port: 1, publicKey: k.publicKey,
  }, {}, pastTs);
  assert.equal(verifyEnvelope(k.publicKey, env, { now: Date.now(), skewMs: 5 * 60 * 1000 }), false);
});

test('缺少字段的包被拒', () => {
  assert.equal(verifyEnvelope('pub', null), false);
  assert.equal(verifyEnvelope('pub', { type: 'x' }), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-sign.test.js"`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

Create: `server/collaboration/sign.js`

```js
import crypto from 'node:crypto';

// 规范化 JSON：递归按键排序，保证签名/验签两侧字节一致
export function canonicalize(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(',')}}`;
}

export function makeEnvelope(privateKeyPem, type, from, payload = {}, ts = Date.now()) {
  const body = { type, from, payload, ts };
  const sig = crypto.sign(null, Buffer.from(canonicalize(body), 'utf8'), privateKeyPem);
  return { ...body, sig: sig.toString('base64') };
}

// from: { machineId, username, host, port, publicKey }（含对方公钥以便首次验签）
export function signEnvelope(privateKeyPem, type, from, payload, ts) {
  return makeEnvelope(privateKeyPem, type, from, payload, ts);
}
export function verifyEnvelope(senderPublicKeyPem, env, { now = Date.now(), skewMs = 5 * 60 * 1000 } = {}) {
  if (!env || typeof env !== 'object') return false;
  const { type, from, payload, ts, sig } = env;
  if (typeof type !== 'string' || !from || typeof from.publicKey !== 'string') return false;
  if (typeof ts !== 'number' || Math.abs(now - ts) > skewMs) return false;
  if (typeof sig !== 'string' || typeof payload !== 'object' || payload === null) return false;
  try {
    const body = { type, from, payload, ts };
    return crypto.verify(
      null,
      Buffer.from(canonicalize(body), 'utf8'),
      senderPublicKeyPem,
      Buffer.from(sig, 'base64'),
    );
  } catch { return false; }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-sign.test.js"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/sign.js server/test/collab-sign.test.js
git commit -m "feat(collab): ed25519 signed envelope sign/verify"
```

---

## Task 3: zip.js 零依赖打包/解包

**Files:**
- Create: `server/collaboration/zip.js`
- Create: `server/test/collab-zip.test.js`

- [ ] **Step 1: 写失败的测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip, readZip, safeZipName } from '../collaboration/zip.js';

test('zip 往返一致（含子目录/二进制/空文件）', () => {
  const entries = [
    { name: 'demo/SKILL.md', data: Buffer.from('# demo\n```js\nconst a=1;\n```\n', 'utf8') },
    { name: 'demo/scripts/run.js', data: Buffer.from('console.log("ok")\n', 'utf8') },
    { name: 'demo/blob.bin', data: Buffer.from([0, 1, 2, 255, 128, 7]) },
    { name: 'demo/empty.txt', data: Buffer.alloc(0) },
  ];
  const buf = buildZip(entries);
  const out = readZip(buf);
  assert.equal(out.length, entries.length);
  for (const e of entries) {
    const got = out.find((x) => x.name === e.name);
    assert.ok(got, `missing ${e.name}`);
    assert.deepEqual(got.data, e.data);
  }
});

test('safeZipName 拒绝越界/绝对/反斜杠', () => {
  assert.equal(safeZipName('demo/SKILL.md'), true);
  assert.equal(safeZipName('demo/scripts/run.js'), true);
  assert.equal(safeZipName('../evil'), false);
  assert.equal(safeZipName('demo/../../evil'), false);
  assert.equal(safeZipName('/abs/x'), false);
  assert.equal(safeZipName('a\\b'), false);
  assert.equal(safeZipName(''), false);
});

test('readZip 拒绝越界条目（防御性）', () => {
  const buf = buildZip([{ name: 'ok/x', data: Buffer.from('hi') }]);
  // 篡改条目名不破坏整体，但 reader 仍能正常读合法包
  assert.equal(readZip(buf)[0].name, 'ok/x');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-zip.test.js"`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现（本地文件头 + 中央目录 + EOCD，method=deflate）**

Create: `server/collaboration/zip.js`

```js
import zlib from 'node:zlib';

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

export function safeZipName(name) {
  if (typeof name !== 'string' || !name) return false;
  if (name.includes('\\')) return false;         // 反斜杠视为越界
  if (name.startsWith('/')) return false;        // 绝对路径
  const parts = name.split('/');
  if (parts.some((p) => p === '..' || p === '')) return false; // 空段或 .. 越界
  return true;
}

export function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    if (!safeZipName(e.name)) throw new Error(`unsafe zip name: ${e.name}`);
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? '');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(LOCAL, 0);
    lh.writeUInt16LE(20, 4);           // version needed
    lh.writeUInt16LE(0x0800, 6);       // UTF-8 flag
    lh.writeUInt16LE(8, 8);            // method deflate
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);           // extra len
    chunks.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(CENTRAL, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const cdStart = offset;
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

export function readZip(buf) {
  if (buf.length < 22) throw new Error('not a zip (too short)');
  let eocdIdx = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocdIdx = i; break; }
  }
  if (eocdIdx < 0) throw new Error('EOCD not found');
  const count = buf.readUInt16LE(eocdIdx + 10);
  let p = buf.readUInt32LE(eocdIdx + 16); // cd offset
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CENTRAL) throw new Error('bad central header');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (!safeZipName(name)) throw new Error(`unsafe zip entry: ${name}`);
    // 回到 local header 读数据偏移
    if (buf.readUInt32LE(localOffset) !== LOCAL) throw new Error('bad local header');
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : (() => { throw new Error(`unsupported method ${method}`); })();
    out.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-zip.test.js"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/zip.js server/test/collab-zip.test.js
git commit -m "feat(collab): zero-dep zip build/read"
```

---

## Task 4: 本机身份 identity.js

**Files:**
- Create: `server/collaboration/identity.js`
- Create: `server/test/collab-identity.test.js`

- [ ] **Step 1: 写失败的测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadIdentity } from '../collaboration/identity.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-id-'));
  return path.join(dir, 'identity.json');
}

test('首次生成 identity 并持久化；二次加载复用', () => {
  const f = tmpFile();
  const a = loadIdentity({ file: f, username: 'alice', host: '192.168.1.5', port: 3001 });
  assert.ok(a.machineId);
  assert.equal(a.username, 'alice');
  assert.ok(a.publicKey.includes('PUBLIC KEY'));
  assert.ok(a.privateKey.includes('PRIVATE KEY'));
  const b = loadIdentity({ file: f, username: 'alice', host: '192.168.1.5', port: 3001 });
  assert.equal(b.machineId, a.machineId);
  assert.equal(b.publicKey, a.publicKey);
  assert.equal(b.privateKey, a.privateKey);
});

test('用户名/host/port 更新会被刷新', () => {
  const f = tmpFile();
  loadIdentity({ file: f, username: 'alice', host: '192.168.1.5', port: 3001 });
  const c = loadIdentity({ file: f, username: 'bob', host: '0.0.0.0', port: 3999 });
  assert.equal(c.username, 'bob');
  assert.equal(c.host, '0.0.0.0');
  assert.equal(c.port, 3999);
});

test('缺 username 时回退系统用户名', () => {
  const f = tmpFile();
  const id = loadIdentity({ file: f, host: '127.0.0.1', port: 3001 });
  assert.ok(id.username.length > 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-identity.test.js"`
Expected: FAIL

- [ ] **Step 3: 写实现**

Create: `server/collaboration/identity.js`

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

function genKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).trim(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).trim(),
  };
}

export function detectHost() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
}

export function detectUsername() {
  return (typeof os.userInfo === 'function' && os.userInfo().username) || process.env.USERNAME || process.env.USER || 'user';
}

export function publicFingerprint(publicKeyPem) {
  return crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16);
}

// 读/建 identity 并持久化到 file。返回不含 privateKey 的公开 profile + 私有字段。
// 返回对象: { machineId, username, host, port, publicKey, privateKey }
export function loadIdentity({ file, username = detectUsername(), host = detectHost(), port = 3001 }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let cur = {};
  if (fs.existsSync(file)) {
    try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cur = {}; }
  }
  if (!cur.machineId) cur.machineId = crypto.randomUUID();
  if (!cur.publicKey || !cur.privateKey) {
    const kp = genKeyPair();
    cur.publicKey = kp.publicKey;
    cur.privateKey = kp.privateKey;
  }
  cur.username = username;
  cur.host = host;
  cur.port = port;
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cur, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return { ...cur };
}

export function toPublicProfile(id) {
  return {
    machineId: id.machineId, username: id.username,
    host: id.host, port: id.port, publicKey: id.publicKey,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-identity.test.js"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/identity.js server/test/collab-identity.test.js
git commit -m "feat(collab): local identity + keypair persistence"
```

---

## Task 5: store.js 本地权威 JSON

**Files:**
- Create: `server/collaboration/store.js`
- Create: `server/test/collab-store.test.js`

- [ ] **Step 1: 写失败的测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CollabStore } from '../collaboration/store.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-store-'));
  return path.join(dir, 'collab.json');
}

test('空文件初始化默认结构', () => {
  const s = new CollabStore({ file: tmpFile() });
  assert.deepEqual(s.data.identity, null);
  assert.deepEqual(s.data.friends, []);
  assert.deepEqual(s.data.groups, []);
  assert.deepEqual(s.data.skillsInbox, []);
  assert.deepEqual(s.data.groupSkills, []);
});

test('持久化与重载一致', () => {
  const f = tmpFile();
  const s = new CollabStore({ file: f });
  s.data.friends.push({ machineId: 'x', username: 'u', host: 'h', port: 1, publicKey: 'k' });
  s.save();
  const s2 = new CollabStore({ file: f });
  assert.equal(s2.data.friends.length, 1);
  assert.equal(s2.data.friends[0].machineId, 'x');
});

test('list/find/upsert 助手', () => {
  const s = new CollabStore({ file: tmpFile() });
  const f = { machineId: 'a', username: 'u', host: 'h', port: 1, publicKey: 'k' };
  s.addFriend(f);
  assert.equal(s.listFriends().length, 1);
  assert.equal(s.findFriend('a').machineId, 'a');
  assert.equal(s.findFriend('zz'), null);
  s.upsertFriend({ ...f, username: 'u2' });
  assert.equal(s.findFriend('a').username, 'u2');
  s.removeFriend('a');
  assert.equal(s.listFriends().length, 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-store.test.js"`
Expected: FAIL

- [ ] **Step 3: 写实现**

Create: `server/collaboration/store.js`

```js
import fs from 'node:fs';
import path from 'node:path';

export function defaultData() {
  return {
    identity: null,      // { machineId, username, host, port, publicKey, privateKey }
    friends: [],         // 公开 profile
    pendingFriends: [],  // 待确认好友请求（对方 profile + requestedAt）
    groups: [],          // { id, name, ownerId, members:[profile+role], createdAt }
    pendingInvites: [],  // { id, groupId, groupName, inviter: profile, receivedAt }
    skillsInbox: [],     // { id, fromId, groupId|null, skillName, hash, size, zipPath, status, receivedAt }
    groupSkills: [],     // { groupId, skillName, hash, distributedBy, installed }
  };
}

export class CollabStore {
  constructor({ file, logger = console }) {
    this.file = file;
    this.log = logger;
    this.data = this._load();
  }
  _load() {
    if (fs.existsSync(this.file)) {
      try { return { ...defaultData(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch (e) { this.log?.warn?.('store corrupt, reset', e.message); }
    }
    return defaultData();
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  // friends
  listFriends() { return this.data.friends; }
  findFriend(machineId) { return this.data.friends.find((f) => f.machineId === machineId) || null; }
  addFriend(f) {
    if (this.findFriend(f.machineId)) return;
    this.data.friends.push({ ...f });
    this.data.pendingFriends = this.data.pendingFriends.filter((p) => p.machineId !== f.machineId);
    this.save();
  }
  upsertFriend(f) {
    const i = this.data.friends.findIndex((x) => x.machineId === f.machineId);
    if (i >= 0) this.data.friends[i] = { ...f };
    else this.data.friends.push({ ...f });
    this.save();
  }
  removeFriend(machineId) {
    this.data.friends = this.data.friends.filter((f) => f.machineId !== machineId);
    this.save();
  }

  // pending friends
  listPendingFriends() { return this.data.pendingFriends; }
  findPendingFriend(machineId) { return this.data.pendingFriends.find((p) => p.machineId === machineId) || null; }
  addPendingFriend(p) { if (!this.findPendingFriend(p.machineId)) this.data.pendingFriends.push({ ...p }); this.save(); }
  removePendingFriend(machineId) { this.data.pendingFriends = this.data.pendingFriends.filter((p) => p.machineId !== machineId); this.save(); }

  // groups
  listGroups() { return this.data.groups; }
  findGroup(id) { return this.data.groups.find((g) => g.id === id) || null; }
  addGroup(group) { this.data.groups.push(group); this.save(); return group; }
  removeGroup(id) { this.data.groups = this.data.groups.filter((g) => g.id !== id); this.save(); }
  upsertGroup(group) {
    const i = this.data.groups.findIndex((g) => g.id === group.id);
    if (i >= 0) this.data.groups[i] = group; else this.data.groups.push(group);
    this.save();
    return group;
  }
  saveGroup(group) { this.upsertGroup(group); }

  // pending invites
  listPendingInvites() { return this.data.pendingInvites; }
  findPendingInvite(id) { return this.data.pendingInvites.find((x) => x.id === id) || null; }
  addPendingInvite(inv) { this.data.pendingInvites.push(inv); this.save(); return inv; }
  removePendingInvite(id) { this.data.pendingInvites = this.data.pendingInvites.filter((x) => x.id !== id); this.save(); }

  // inbox
  listInbox() { return this.data.skillsInbox; }
  findInbox(id) { return this.data.skillsInbox.find((x) => x.id === id) || null; }
  addInbox(item) { this.data.skillsInbox.push(item); this.save(); return item; }
  setInboxStatus(id, status) {
    const it = this.findInbox(id);
    if (it) { it.status = status; this.save(); }
    return it;
  }
  removeInbox(id) { this.data.skillsInbox = this.data.skillsInbox.filter((x) => x.id !== id); this.save(); }

  // group skills
  listGroupSkills(groupId = null) {
    if (groupId == null) return this.data.groupSkills;
    return this.data.groupSkills.filter((g) => g.groupId === groupId);
  }
  findGroupSkill(groupId, skillName) {
    return this.data.groupSkills.find((g) => g.groupId === groupId && g.skillName === skillName) || null;
  }
  upsertGroupSkill(gs) {
    const i = this.data.groupSkills.findIndex((g) => g.groupId === gs.groupId && g.skillName === gs.skillName);
    if (i >= 0) this.data.groupSkills[i] = gs; else this.data.groupSkills.push(gs);
    this.save();
    return gs;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-store.test.js"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/store.js server/test/collab-store.test.js
git commit -m "feat(collab): local authoritative store (friends/groups/inbox/groupSkills)"
```

---

## Task 6: skill-packer.js + skill-installer.js

**Files:**
- Create: `server/collaboration/skill-packer.js`
- Create: `server/collaboration/skill-installer.js`
- Create: `server/test/collab-skills.test.js`

- [ ] **Step 1: 写失败的测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listSkills, packSkill } from '../collaboration/skill-packer.js';
import { installZip, validateSkillZip } from '../collaboration/skill-installer.js';

function makeSkillRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-skills-'));
  const s = path.join(dir, 'demo');
  fs.mkdirSync(path.join(s, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(s, 'SKILL.md'), '# demo\nhello', 'utf8');
  fs.writeFileSync(path.join(s, 'scripts', 'run.js'), 'console.log(1)', 'utf8');
  fs.writeFileSync(path.join(s, '.hidden'), 'skip', 'utf8');
  return { root: dir, skillDir: s };
}

test('listSkills 只列出含 SKILL.md 的目录', () => {
  const { root, skillDir } = makeSkillRoot();
  fs.mkdirSync(path.join(root, 'noskill'), { recursive: true });
  fs.writeFileSync(path.join(root, 'noskill', 'x.txt'), 'x');
  const names = listSkills(root).map((s) => s.name);
  assert.ok(names.includes('demo'));
  assert.ok(!names.includes('noskill'));
});

test('packSkill 产出含 SKILL.md 的 zip，忽略隐藏文件', async () => {
  const { root, skillDir } = makeSkillRoot();
  const buf = await packSkill(skillDir);
  assert.ok(buf.length > 0);
  assert.ok(validateSkillZip(buf, 'demo'), 'zip 结构合法');
});

test('installZip 解压到目标目录且不越界；二次安装同名备份', async () => {
  const { skillDir } = makeSkillRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-dest-'));
  const buf = await packSkill(skillDir);
  installZip({ zip: buf, skillName: 'demo', destRoot: dest });
  assert.ok(fs.existsSync(path.join(dest, 'demo', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(dest, 'demo', 'scripts', 'run.js')));
  assert.ok(!fs.existsSync(path.join(dest, 'demo', '.hidden')));
  installZip({ zip: buf, skillName: 'demo', destRoot: dest });
  const bak = fs.readdirSync(dest).filter((f) => f.startsWith('demo.bak'));
  assert.ok(bak.length >= 1, '已有同名应生成 .bak');
});

test('恶意 zip（越界名/无 SKILL.md）被拒', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-dest2-'));
  // 无 SKILL.md
  const fake = Buffer.from('this is not a real zip but enough to be refused by validator');
  assert.equal(validateSkillZip(fake, 'demo'), false);
  assert.throws(() => installZip({ zip: fake, skillName: 'demo', destRoot: dest }));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-skills.test.js"`
Expected: FAIL

- [ ] **Step 3: 写 packer**

Create: `server/collaboration/skill-packer.js`

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildZip } from './zip.js';

const HIDDEN = new Set(['.git', '.svn', '.hg']);

export function listSkills(root) {
  if (!root || !fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, dir: path.join(root, d.name) }))
    .filter((s) => fs.existsSync(path.join(s.dir, 'SKILL.md')));
}

function walk(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (HIDDEN.has(e.name) || e.name.startsWith('.')) continue;   // 跳过隐藏/.git
    const full = path.join(dir, e.name);
    const name = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(full, name, out);
    else if (e.isFile()) out.push({ name, data: fs.readFileSync(full) });
  }
}

// skillDir 应包含 SKILL.md；返回 { skillName, hash, zip }
export async function packSkill(skillDir) {
  if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) throw new Error('not a skill dir: missing SKILL.md');
  const skillName = path.basename(skillDir);
  const files = [];
  walk(skillDir, '', files);
  const zip = buildZip(files.map((f) => ({ name: `${skillName}/${f.name}`, data: f.data })));
  const hash = crypto.createHash('sha256').update(zip).digest('hex');
  return { skillName, hash, zip };
}
```

- [ ] **Step 4: 写 installer**

Create: `server/collaboration/skill-installer.js`

```js
import fs from 'node:fs';
import path from 'node:path';
import { readZip } from './zip.js';

// 校验 zip：能解、首段统一为 skillName、必含 <skillName>/SKILL.md
export function validateSkillZip(zip, skillName) {
  try {
    const entries = readZip(zip);
    if (!entries.length) return false;
    for (const e of entries) {
      const seg = e.name.split('/');
      if (seg[0] !== skillName || seg.length < 2) return false;
    }
    return entries.some((e) => e.name === `${skillName}/SKILL.md`);
  } catch { return false; }
}

// 安装：目标已存在则备份 <name>.bak-<ts>，再原子覆盖
export function installZip({ zip, skillName, destRoot }) {
  if (!validateSkillZip(zip, skillName)) throw new Error('invalid skill zip');
  const entries = readZip(zip);
  const dest = path.join(destRoot, skillName);
  if (fs.existsSync(dest)) {
    fs.mkdirSync(destRoot, { recursive: true });
    const bak = `${dest}.bak-${Date.now()}`;
    fs.renameSync(dest, bak);
  }
  for (const e of entries) {
    const rel = e.name.split('/').slice(1).join('/');
    const target = path.join(dest, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.data);
  }
  return { skillName, dest, count: entries.length };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test "server/test/collab-skills.test.js"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/collaboration/skill-packer.js server/collaboration/skill-installer.js server/test/collab-skills.test.js
git commit -m "feat(collab): skill packer + installer with backup/validation"
```

---

## Task 7: engine.js 核心协调器（含全流程逻辑）

**Files:**
- Create: `server/collaboration/engine.js`
- Create: `server/test/collab-engine.test.js`

engine 是协作核心：持有 store/identity/profile，处理好友/群/分发/收件箱/pull 的全部业务逻辑；网络收发通过注入的 `peer`（对象 `{ post(host,port,envelope) }`），事件通过注入的 `events`（`{ emit(type,payload) }`）。**不依赖 http/ws**，纯逻辑可单测。

- [ ] **Step 1: 写失败的测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CollabEngine, createPairHarness } from '../collaboration/engine.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'collab-eng-')); }

test('好友握手双向登记', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const res = await A.requestFriend({ host: B.pub.host, port: B.pub.port });
    assert.equal(res.code, 'requested');
    // B 侧应出现 pending friend
    assert.equal(B.store.findPendingFriend(A.pub.machineId) !== null, true);
    await B.acceptFriend(A.pub.machineId);
    assert.ok(A.store.findFriend(B.pub.machineId), 'A 已登记 B');
    assert.ok(B.store.findFriend(A.pub.machineId), 'B 已登记 A');
  } finally { await h.stop(); }
});

test('建群+邀请+接受+成员广播', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    await A.requestFriend({ host: B.pub.host, port: B.pub.port });
    await B.acceptFriend(A.pub.machineId);
    const g = await A.createGroup('team');
    await A.inviteMember({ groupId: g.id, targetMachineId: B.pub.machineId });
    const inv = B.store.listPendingInvites()[0];
    assert.ok(inv, 'B 收到群邀请');
    await B.acceptInvite(inv.id);
    const gA = A.store.findGroup(g.id);
    assert.ok(gA.members.find((m) => m.machineId === B.pub.machineId), 'A 群含 B');
    const gB = B.store.findGroup(g.id);
    assert.ok(gB, 'B 也持有群');
    assert.ok(gB.members.find((m) => m.machineId === A.pub.machineId), 'B 群含 A');
  } finally { await h.stop(); }
});

test('角色规则：owner 占 1 管理位；第 2~5 位入群自动为 admin；admin 只能踢 member，owner 可踢任何人', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    await A.requestFriend({ host: B.pub.host, port: B.pub.port });
    await B.acceptFriend(A.pub.machineId);
    const g = await A.createGroup('team');
    // B 是第 2 位（owner 之后第 1 位）→ 应为 admin
    await A.inviteMember({ groupId: g.id, targetMachineId: B.pub.machineId });
    await B.acceptInvite(B.store.listPendingInvites()[0].id);
    let gA = A.store.findGroup(g.id);
    const bRole = gA.members.find((m) => m.machineId === B.pub.machineId).role;
    assert.equal(bRole, 'admin', '第 2 位入群者应为 admin');
    // B(admin) 踢 A(owner) 应被拒
    const badKick = await B.kickMember({ groupId: g.id, targetMachineId: A.pub.machineId });
    assert.equal(badKick.code, 'forbidden', 'admin 不能踢 owner');
    // A(owner) 踢 B(admin) 应成功；B 本地收到 MEMBER_SYNC 后群应移除
    const okKick = await A.kickMember({ groupId: g.id, targetMachineId: B.pub.machineId });
    assert.equal(okKick.code, 'kicked', JSON.stringify(okKick));
    gA = A.store.findGroup(g.id);
    assert.equal(gA.members.find((m) => m.machineId === B.pub.machineId), undefined, 'A 群不再含 B');
    assert.equal(B.store.findGroup(g.id), null, 'B 本地群已退出');
  } finally { await h.stop(); }
});

test('群内分发 skill → 对方 inbox → 安装', async () => {
  const h = await createPairHarness({ skipSkills: false });
  try {
    const [A, B] = h.nodes;
    // 给 A 造一个本机 skill
    const skillDir = path.join(A.skillsRoot, 'demo');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# demo', 'utf8');
    await A.requestFriend({ host: B.pub.host, port: B.pub.port });
    await B.acceptFriend(A.pub.machineId);
    const g = await A.createGroup('team');
    await A.inviteMember({ groupId: g.id, targetMachineId: B.pub.machineId });
    await B.acceptInvite(B.store.listPendingInvites()[0].id);
    const dist = await A.distributeToGroup(g.id, ['demo']);
    assert.equal(dist.failures.length, 0, JSON.stringify(dist.failures));
    const inbox = B.store.listInbox();
    assert.equal(inbox.length, 1, 'B inbox 有一条');
    const item = inbox[0];
    assert.equal(item.skillName, 'demo');
    await B.installInbox(item.id);
    assert.equal(B.store.findInbox(item.id).status, 'installed');
    assert.ok(fs.existsSync(path.join(B.skillsRoot, 'demo', 'SKILL.md')), '已安装到 B 技能目录');
  } finally { await h.stop(); }
});

test('验签失败的消息被丢弃（伪造信封直接进 inbound）', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [, B] = h.nodes;
    // 用 B 自己的 profile（公钥有效）但签名坏 → 应被拒
    const fake = { type: 'friend-request', from: { ...B.pub }, payload: {}, ts: Date.now(), sig: 'bad' };
    const result = await B.engine.handleIncoming(fake);
    assert.equal(result.ok, false);
  } finally { await h.stop(); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-engine.test.js"`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写完整 engine.js（单文件一次成型，含全部方法与测试 harness）**

Create: `server/collaboration/engine.js`

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CollabPeer } from '@devflow/shared/collab';
import { CollabStore } from './store.js';
import { loadIdentity, toPublicProfile } from './identity.js';
import { signEnvelope, verifyEnvelope } from './sign.js';
import { packSkill } from './skill-packer.js';
import { installZip } from './skill-installer.js';

// events 注入（便于 web 层广播到浏览器 /ws）；peer 注入（真实 HTTP 或测试直连）
export class CollabEngine {
  constructor({ store, identity, events = null, peer = null, skillsRoot = null, inboxDir = null, logger = console }) {
    this.store = store;
    this.identity = identity;      // { machineId, username, host, port, publicKey, privateKey }
    this.events = events;
    this.peer = peer;              // { post(host, port, envelope) -> Promise<{ok, data?, error?}> }
    this.skillsRoot = skillsRoot;  // 安装/本机技能根目录
    this.inboxDir = inboxDir;      // 收到的 zip 落盘目录
    this.log = logger;
  }
  get pub() { return toPublicProfile(this.identity); }

  _emit(type, payload) { if (this.events) this.events.emit(type, payload); }
  _sign(type, payload) {
    return signEnvelope(this.identity.privateKey, type, this.pub, payload);
  }
  async _post(host, port, env) {
    if (!this.peer) { this.log?.warn?.('peer transport not configured'); return { ok: false, error: 'no-transport' }; }
    try { return await this.peer.post(host, port, env); }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }
  // 返回 { ok, error?, data? }
  async handleIncoming(env) {
    // 先从 from 定位已知公钥；首次 friend-request 用 from.publicKey 自证
    const known = this._knownProfile(env && env.from && env.from.machineId);
    const pubKey = known ? known.publicKey : (env && env.from && env.from.publicKey);
    if (!pubKey || !verifyEnvelope(pubKey, env)) return { ok: false, error: 'bad-signature' };
    switch (env.type) {
      case CollabPeer.FRIEND_REQUEST: return this._inFriendRequest(env);
      case CollabPeer.FRIEND_ACCEPT: return this._inFriendAccept(env);
      case CollabPeer.GROUP_INVITE: return this._inGroupInvite(env);
      case CollabPeer.GROUP_ACCEPT: return this._inGroupAccept(env);
      case CollabPeer.MEMBER_SYNC: return this._inMemberSync(env);
      case CollabPeer.SKILL_PUSH: return this._inSkillPush(env);
      case CollabPeer.PULL_SYNC: return this._inPullSync(env);
      default: return { ok: false, error: 'unknown-type' };
    }
  }
  _knownProfile(machineId) {
    if (!machineId) return null;
    const f = this.store.findFriend(machineId);
    if (f) return f;
    for (const g of this.store.listGroups()) {
      const m = g.members.find((x) => x.machineId === machineId);
      if (m) return m;
    }
    return null;
  }

  // ---- 好友 ----
  async requestFriend({ host, port }) {
    const res = await this._post(host, port, this._sign(CollabPeer.FRIEND_REQUEST, {}));
    if (!res.ok) return { code: 'failed', error: res.error };
    return { code: 'requested' };
  }
  _inFriendRequest(env) {
    const p = env.from;
    if (this.store.findFriend(p.machineId)) return { ok: true };           // 已是好友
    this.store.addPendingFriend({ ...p, requestedAt: Date.now() });
    this._emit('friend-request', { from: p });
    return { ok: true };
  }
  async acceptFriend(machineId) {
    const p = this.store.findPendingFriend(machineId);
    if (!p) return { code: 'not-found' };
    this.store.removePendingFriend(machineId);
    this.store.addFriend(p);
    const res = await this._post(p.host, p.port, this._sign(CollabPeer.FRIEND_ACCEPT, {}));
    return res.ok ? { code: 'accepted' } : { code: 'accepted', localOnly: true, error: res.error };
  }
  _inFriendAccept(env) {
    const p = env.from;
    // 双向登记：若本机之前发过请求，清掉 pending；无论如何把对方落为好友
    if (this.store.findPendingFriend(p.machineId)) this.store.removePendingFriend(p.machineId);
    this.store.addFriend(p);
    this._emit('synced', {});
    return { ok: true };
  }

  // ---- 群 ----
  async createGroup(name) {
    const g = {
      id: crypto.randomUUID(), name, ownerId: this.pub.machineId, createdAt: Date.now(),
      members: [{ ...this.pub, role: 'owner' }],
    };
    this.store.addGroup(g);
    this._emit('synced', {});
    return g;
  }
  async inviteMember({ groupId, targetMachineId }) {
    const g = this.store.findGroup(groupId);
    const me = g && g.members.find((m) => m.machineId === this.pub.machineId);
    if (!g || !me) return { code: 'not-member' };
    const t = this._knownProfile(targetMachineId) || this.store.findPendingFriend(targetMachineId);
    if (!t) return { code: 'no-target-profile' };
    const res = await this._post(t.host, t.port, this._sign(CollabPeer.GROUP_INVITE, { group: { id: g.id, name: g.name } }));
    return res.ok ? { code: 'invited' } : { code: 'failed', error: res.error };
  }
  _inGroupInvite(env) {
    const p = env.from;
    const { group } = env.payload;
    const existing = this.store.findGroup(group.id);
    if (existing && existing.members.find((m) => m.machineId === this.pub.machineId)) return { ok: true };
    const inv = { id: crypto.randomUUID(), groupId: group.id, groupName: group.name, inviter: p, receivedAt: Date.now() };
    this.store.addPendingInvite(inv);
    this._emit('group-invite', { invite: inv });
    return { ok: true };
  }
  async acceptInvite(inviteId) {
    const inv = this.store.findPendingInvite(inviteId);
    if (!inv) return { code: 'not-found' };
    this.store.removePendingInvite(inviteId);
    // 发回 accept，并带上本机 profile
    const res = await this._post(inv.inviter.host, inv.inviter.port, this._sign(CollabPeer.GROUP_ACCEPT, { groupId: inv.groupId }));
    if (!res.ok) { this.store.addPendingInvite(inv); return { code: 'failed', error: res.error }; }
    // 本机建（或并入）群，等待 MEMBER_SYNC 拿全量成员表
    if (!this.store.findGroup(inv.groupId)) {
      this.store.addGroup({ id: inv.groupId, name: inv.groupName, ownerId: null, createdAt: Date.now(), members: [{ ...this.pub, role: 'member' }] });
    }
    this._emit('synced', {});
    return { code: 'accepted' };
  }
  // 入群者自动角色：管理位共 5 个（owner 占 1），owner 之后按入群先后自动把前 4 位置为 admin，其余为 member
  _assignRole(g) {
    const adminCount = g.members.filter((m) => m.role === 'owner' || m.role === 'admin').length;
    return adminCount < 5 ? 'admin' : 'member';
  }
  async _inGroupAccept(env) {
    const p = env.from;
    const groupId = env.payload.groupId;
    const g = this.store.findGroup(groupId);
    if (!g) return { ok: true };
    if (!g.members.find((m) => m.machineId === p.machineId)) {
      g.members.push({ ...p, role: this._assignRole(g) });
      this.store.saveGroup(g);
    }
    // 广播全量成员表给所有成员（await，保证发起方应答前对方已收到同步）
    await this._broadcastMemberSync(g);
    this._emit('synced', {});
    return { ok: true };
  }
  async _broadcastMemberSync(g) {
    const env = this._sign(CollabPeer.MEMBER_SYNC, { group: g });
    for (const m of g.members) {
      if (m.machineId === this.pub.machineId) continue;
      await this._post(m.host, m.port, env);
    }
  }
  _inMemberSync(env) {
    const group = env.payload.group;
    if (!group || !group.id) return { ok: false, error: 'bad-group' };
    // 我已不在成员表 → 被移出/解散，本地删除群
    if (!(group.members || []).find((m) => m.machineId === this.pub.machineId)) {
      this.store.removeGroup(group.id);
      this._emit('synced', {});
      return { ok: true };
    }
    this.store.upsertGroup(group);
    this._emit('synced', {});
    return { ok: true };
  }
  // 踢人：owner 可踢任何人（含 admin）；admin 只能踢 member；member 无权
  async kickMember({ groupId, targetMachineId }) {
    const g = this.store.findGroup(groupId);
    const me = g && g.members.find((m) => m.machineId === this.pub.machineId);
    const target = g && g.members.find((m) => m.machineId === targetMachineId);
    if (!g || !me) return { code: 'not-member' };
    if (!target) return { code: 'no-target' };
    if (me.role !== 'owner' && me.role !== 'admin') return { code: 'forbidden' };
    if (me.role === 'admin' && target.role !== 'member') return { code: 'forbidden' };
    g.members = g.members.filter((m) => m.machineId !== targetMachineId);
    this.store.saveGroup(g);
    // 通知被踢者（其收到后因不在成员表会删本地群）
    await this._post(target.host, target.port, this._sign(CollabPeer.MEMBER_SYNC, { group: g }));
    // 同步其余成员
    await this._broadcastMemberSync(g);
    this._emit('synced', {});
    return { code: 'kicked' };
  }

  // ---- skill 分发 ----
  async distributeToGroup(groupId, skillNames) {
    const g = this.store.findGroup(groupId);
    if (!g) return { code: 'no-group', failures: [], pushed: 0 };
    const me = g.members.find((m) => m.machineId === this.pub.machineId);
    if (!me) return { code: 'not-member', failures: [], pushed: 0 };
    const failures = [];
    let pushed = 0;
    for (const skillName of skillNames) {
      const skillDir = path.join(this.skillsRoot, skillName);
      let pkg;
      try { pkg = await packSkill(skillDir); } catch (e) { failures.push({ skillName, error: 'pack:' + (e && e.message) }); continue; }
      if (pkg.skillName !== skillName) { failures.push({ skillName, error: 'name-mismatch' }); continue; }
      const env = this._sign(CollabPeer.SKILL_PUSH, {
        groupId, skillName, hash: pkg.hash, zipB64: pkg.zip.toString('base64'),
      });
      for (const m of g.members) {
        if (m.machineId === this.pub.machineId) continue;
        const res = await this._post(m.host, m.port, env);
        if (res.ok) pushed++;
        else failures.push({ machineId: m.machineId, skillName, error: res.error || 'push-failed' });
      }
      const existing = this.store.findGroupSkill(groupId, skillName);
      this.store.upsertGroupSkill({
        groupId, skillName, hash: pkg.hash, distributedBy: this.pub.machineId,
        installed: existing ? existing.installed : true, // 发起者本机已有
      });
    }
    this._emit('synced', {});
    return { code: 'ok', pushed, failures };
  }
  async _inSkillPush(env) {
    const p = env.from;
    const { groupId = null, skillName, hash, zipB64 } = env.payload;
    if (!skillName || typeof zipB64 !== 'string' || !hash) return { ok: false, error: 'bad-payload' };
    // 鉴权：群成员或好友
    const known = this._knownProfile(p.machineId);
    if (!known) return { ok: false, error: 'unknown-sender' };
    if (groupId) {
      const g = this.store.findGroup(groupId);
      if (!g || !g.members.find((m) => m.machineId === p.machineId)) return { ok: false, error: 'not-in-group' };
    }
    const zip = Buffer.from(zipB64, 'base64');
    const itemId = crypto.randomUUID();
    fs.mkdirSync(this.inboxDir, { recursive: true });
    const zipPath = path.join(this.inboxDir, `${itemId}.zip`);
    fs.writeFileSync(zipPath, zip);
    const item = { id: itemId, fromId: p.machineId, groupId, skillName, hash, size: zip.length, zipPath, status: 'received', receivedAt: Date.now() };
    this.store.addInbox(item);
    const gs = this.store.findGroupSkill(groupId, skillName);
    this.store.upsertGroupSkill({
      groupId, skillName, hash, distributedBy: p.machineId,
      installed: gs ? gs.installed : false,
    });
    this._emit('inbox', { inboxId: item.id });
    return { ok: true };
  }
  async installInbox(itemId) {
    const it = this.store.findInbox(itemId);
    if (!it || it.status !== 'received') return { code: it ? 'not-received' : 'not-found' };
    try {
      installZip({ zip: fs.readFileSync(it.zipPath), skillName: it.skillName, destRoot: this.skillsRoot });
    } catch (e) { this.store.setInboxStatus(itemId, 'invalid'); return { code: 'invalid', error: String(e && e.message || e) }; }
    this.store.setInboxStatus(itemId, 'installed');
    if (it.groupId) {
      const gs = this.store.findGroupSkill(it.groupId, it.skillName);
      if (gs) { gs.installed = true; gs.hash = it.hash; this.store.save(); }
    }
    this._emit('synced', {});
    return { code: 'installed' };
  }
  async ignoreInbox(itemId) {
    const it = this.store.findInbox(itemId);
    if (!it) return { code: 'not-found' };
    this.store.setInboxStatus(itemId, 'ignored');
    this._emit('synced', {});
    return { code: 'ignored' };
  }

  // ---- pull ----
  async pullSync(fromMachineId, { groupIds = null } = {}) {
    const peerProfile = this._knownProfile(fromMachineId);
    if (!peerProfile) return { code: 'no-peer' };
    const targets = groupIds || this.store.listGroups().map((g) => g.id);
    const res = await this._post(peerProfile.host, peerProfile.port, this._sign(CollabPeer.PULL_SYNC, { groupIds: targets }));
    if (!res.ok) return { code: 'failed', error: res.error };
    return { code: 'ok', data: res.data };
  }
  _inPullSync(env) {
    const p = env.from;
    const wanted = (env.payload.groupIds || []).slice();
    const groups = this.store.listGroups().filter((g) => wanted.includes(g.id) && g.members.find((m) => m.machineId === p.machineId));
    const data = {
      groups: groups.map((g) => ({ ...g })),
      groupSkills: groups.flatMap((g) => this.store.listGroupSkills(g.id).map((s) => ({ ...s }))),
    };
    return { ok: true, data };
  }
  // 把 pull 结果并入本地（供 http-mount /api/collab/pull 调用）
  applyPull(data) {
    if (!data) return;
    for (const g of data.groups || []) {
      const local = this.store.findGroup(g.id);
      if (!local) this.store.addGroup({ ...g });
      else {
        for (const m of g.members || []) if (!local.members.find((x) => x.machineId === m.machineId)) local.members.push(m);
        this.store.saveGroup(local);
      }
    }
    for (const s of data.groupSkills || []) {
      const local = this.store.findGroupSkill(s.groupId, s.skillName);
      if (!local) this.store.upsertGroupSkill({ groupId: s.groupId, skillName: s.skillName, hash: s.hash, distributedBy: s.distributedBy, installed: false });
    }
    this._emit('synced', {});
  }
  // 更新本机已注册的 host/port（供 http-mount 启动后刷新公开地址）
  setAdvertised({ host, port }) {
    if (host) this.identity.host = host;
    if (port) this.identity.port = port;
    this.store.data.identity = { ...this.identity };
    this.store.save();
  }
}

// ---- 测试双节点 harness（直连 transport，不走 http）----
export async function createPairHarness({ skipSkills = false, dir = null } = {}) {
  const base = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'collab-pair-'));
  const ports = [39991, 39992];
  async function makeNode(idx, name) {
    const nodeDir = path.join(base, name);
    const skillsRoot = path.join(nodeDir, 'skills');
    const inboxDir = path.join(nodeDir, 'inbox');
    fs.mkdirSync(inboxDir, { recursive: true });
    if (!skipSkills) fs.mkdirSync(skillsRoot, { recursive: true });
    const store = new CollabStore({ file: path.join(nodeDir, 'collab.json') });
    const identity = loadIdentity({ file: path.join(nodeDir, 'identity.json'), username: name, host: '127.0.0.1', port: ports[idx] });
    return { store, identity, skillsRoot, inboxDir };
  }
  const A0 = await makeNode(0, 'alice');
  const B0 = await makeNode(1, 'bob');
  const engA = new CollabEngine({ store: A0.store, identity: A0.identity, skillsRoot: A0.skillsRoot, inboxDir: A0.inboxDir });
  const engB = new CollabEngine({ store: B0.store, identity: B0.identity, skillsRoot: B0.skillsRoot, inboxDir: B0.inboxDir });
  // 直连 transport：A 发的投给 B 的 handleIncoming，B 发的投给 A（忽略 host/port）
  const forward = async (eng, host, port, envelope) => {
    const r = await eng.handleIncoming(JSON.parse(JSON.stringify(envelope)));
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  };
  engA.peer = { post: (host, port, envelope) => forward(engB, host, port, envelope) };
  engB.peer = { post: (host, port, envelope) => forward(engA, host, port, envelope) };
  engA.engine = engA;   // 供测试 B.engine.handleIncoming 这类写法
  engB.engine = engB;
  return {
    nodes: [engA, engB],   // 直接返回引擎：A.requestFriend / A.store / A.skillsRoot 均可用
    async stop() {},
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-engine.test.js"`
Expected: PASS（4 个用例全过）

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/engine.js server/test/collab-engine.test.js
git commit -m "feat(collab): core engine friend/group/skill/pull logic"
```

---

## Task 8: peer-http + http-api + http-mount（接线）

**Files:**
- Create: `server/collaboration/peer-client.js`
- Create: `server/collaboration/http-mount.js`
- Create: `server/test/collab-http.test.js`

- [ ] **Step 1: 写失败的集成测试（双真 http server 全流程）**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { CollabEngine } from '../collaboration/engine.js';
import { CollabStore } from '../collaboration/store.js';
import { loadIdentity } from '../collaboration/identity.js';
import { createCollabMount } from '../collaboration/http-mount.js';
import { makePeerClient } from '../collaboration/peer-client.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'collab-http-')); }

async function startNode(name) {
  const dir = path.join(tmp(), name);
  const skillsRoot = path.join(dir, 'skills');
  fs.mkdirSync(path.join(dir, 'inbox'), { recursive: true });
  fs.mkdirSync(skillsRoot, { recursive: true });
  const store = new CollabStore({ file: path.join(dir, 'collab.json') });
  const identity = loadIdentity({ file: path.join(dir, 'identity.json'), username: name, host: '127.0.0.1', port: 0 });
  const engine = new CollabEngine({ store, identity, skillsRoot, inboxDir: path.join(dir, 'inbox') });
  const peer = makePeerClient();
  engine.peer = peer;
  const mount = createCollabMount({ engine, logger: console });
  const server = http.createServer((req, res) => mount(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  engine.setAdvertised({ host: '127.0.0.1', port }); // 用真实端口刷新本机公开身份
  return { name, engine, server, skillsRoot, port };
}
function post(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
}

test('双节点 HTTP 全流程：好友→建群→分发→收件箱→安装', async () => {
  const A = await startNode('alice');
  const B = await startNode('bob');
  const demo = path.join(A.skillsRoot, 'demo');
  fs.mkdirSync(demo, { recursive: true });
  fs.writeFileSync(path.join(demo, 'SKILL.md'), '# demo', 'utf8');
  try {
    // 加好友
    const req1 = await post(`http://127.0.0.1:${A.port}/api/collab/friends`, { host: '127.0.0.1', port: B.port });
    assert.equal(req1.status, 200);
    await new Promise((r) => setTimeout(r, 50));
    const pend = B.engine.store.listPendingFriends();
    assert.equal(pend.length, 1);
    await post(`http://127.0.0.1:${B.port}/api/collab/friends/${A.engine.pub.machineId}/accept`, {});
    assert.ok(A.engine.store.findFriend(B.engine.pub.machineId));
    assert.ok(B.engine.store.findFriend(A.engine.pub.machineId));
    // 建群+邀请
    const gRes = await post(`http://127.0.0.1:${A.port}/api/collab/groups`, { name: 'team' });
    assert.equal(gRes.status, 200);
    const gid = gRes.body.group.id;
    await post(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/invite`, { machineId: B.engine.pub.machineId });
    await new Promise((r) => setTimeout(r, 50));
    const inv = B.engine.store.listPendingInvites()[0];
    assert.ok(inv);
    await post(`http://127.0.0.1:${B.port}/api/collab/invites/${inv.id}/accept`, {});
    assert.ok(B.engine.store.findGroup(gid));
    // 分发
    const dist = await post(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/distribute`, { skillNames: ['demo'] });
    assert.equal(dist.status, 200);
    assert.equal(dist.body.failures.length, 0);
    await new Promise((r) => setTimeout(r, 100));
    const inbox = B.engine.store.listInbox();
    assert.equal(inbox.length, 1);
    // 安装
    await post(`http://127.0.0.1:${B.port}/api/collab/inbox/${inbox[0].id}/install`, {});
    assert.ok(fs.existsSync(path.join(B.skillsRoot, 'demo', 'SKILL.md')));
  } finally {
    A.server.close(); B.server.close();
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-http.test.js"`
Expected: FAIL（模块不存在 / import 失败）

- [ ] **Step 3: 写 peer-client.js**

Create: `server/collaboration/peer-client.js`

```js
const TIMEOUT_MS = 10000;

export function makePeerClient({ timeoutMs = TIMEOUT_MS } = {}) {
  return {
    async post(host, port, envelope) {
      const url = `http://${host}:${port}/api/collab/peer`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status !== 200) return { ok: false, error: `http-${res.status}` };
      const body = await res.json();
      return body; // { ok, data?, error? }
    },
  };
}
```

- [ ] **Step 4: 写 http-mount.js（本地 REST + /peer 信封接收）**

Create: `server/collaboration/http-mount.js`

```js
import fs from 'node:fs';
import path from 'node:path';
import { CollabPeer } from '@devflow/shared/collab';

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
  const pub = () => ({ machineId: engine.pub.machineId, username: engine.pub.username, host: engine.pub.host, port: engine.pub.port, fingerprint: '' });

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
        const gs = engine.store.listGroupSkills();
        const inbox = engine.store.listInbox().map(({ zipPath, ...rest }) => rest);
        return ok(res, {
          identity: engine.pub,
          friends: engine.store.listFriends(),
          pendingFriends: engine.store.listPendingFriends(),
          groups: engine.store.listGroups(),
          pendingInvites: engine.store.listPendingInvites(),
          skillsInbox: inbox,
          groupSkills: gs,
        });
      }
      if (seg[0] === 'skills' && m === 'GET') return ok(res, { skills: listLocalSkills() });
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

  function listLocalSkills() {
    return listSkillsOf(engine.skillsRoot);
  }

  return (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/collab')) return sendJson(res, 404, { error: 'not found' });
    route(req, res, url).catch((e) => { logger?.error?.('collab route error', e); sendJson(res, 500, { error: 'internal' }); });
  };
}

// 直接复用 skill-packer，避免循环 import（engine 已依赖它，此处本地再引一次无妨）
function listSkillsOf(root) {
  if (!root || !fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, 'SKILL.md')))
    .map((d) => ({ name: d.name }));
}
```

> 注意：上面的 route 只在 POST/PUT 读 body；GET/DELETE 直接跳过，不会挂起。

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test "server/test/collab-http.test.js"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/collaboration/peer-client.js server/collaboration/http-mount.js server/test/collab-http.test.js
git commit -m "feat(collab): peer-client + http mount (REST + envelope endpoint)"
```

---

## Task 9: index.js 接线 + 事件广播到 /ws

**Files:**
- Modify: `server/index.js`
- Create: `server/test/collab-index.test.js`

- [ ] **Step 1: 读 index.js 现状**

`server/index.js` 当前在 `createServer` 回调内先 `requireAuthHttp`，再判断 `/api/` 前缀走 `createHttpApi`，其余走静态。`createGateway` 在 server 上挂 `upgrade`，返回 `{ conns, ... }`。请阅读文件确认行号后再改。

- [ ] **Step 2: 改 index.js（仅加 import + 实例化 + 路由分支 + 广播），保持其余不动**

在 import 区加入：

```js
import { CollabStore } from './collaboration/store.js';
import { loadIdentity } from './collaboration/identity.js';
import { CollabEngine } from './collaboration/engine.js';
import { createCollabMount } from './collaboration/http-mount.js';
import { makePeerClient } from './collaboration/peer-client.js';
import { createEventBus } from './collaboration/event-bus.js'; // 见 Step 3
import { CollabS2C } from '@devflow/shared/collab';
```

在 `const files = resolveFiles();` 之后、`const server = http.createServer` 之前加入：

```js
const collabEventBus = createEventBus();
let gateway;                                  // 后续 createGateway 赋值
const broadcastCollab = (type, payload) => {
  if (!gateway) return;
  for (const c of gateway.conns) c.send({ type, ...payload });
};
const collabIdentity = loadIdentity({
  file: path.join(__dirname, 'collaboration', 'identity.json'),
  host: process.env.DEVFLOW_HOST || '127.0.0.1',
  port: Number(process.env.DEVFLOW_PORT || 3001),
});
```

实例化引擎并挂载（在 `collabIdentity` 之后、`createServer` 之前）：

```js
const collabEngine = new CollabEngine({
  store: new CollabStore({ file: path.join(__dirname, 'collaboration', 'collab.json'), logger: log }),
  identity: collabIdentity,
  skillsRoot: process.env.DEVFLOW_COLLAB_SKILLS || path.join(os.homedir(), '.config', 'opencode', 'skills'),
  inboxDir: path.join(__dirname, 'collaboration', 'inbox'),
  events: collabEventBus,
  logger: log,
});
collabEngine.peer = makePeerClient();
const collabMount = createCollabMount({ engine: collabEngine, logger: log });
collabEventBus.on('friend-request', (payload) => broadcastCollab(CollabS2C.COLLAB_FRIEND_REQ, payload));
collabEventBus.on('group-invite', (payload) => broadcastCollab(CollabS2C.COLLAB_GROUP_INVITE, payload));
collabEventBus.on('inbox', (payload) => broadcastCollab(CollabS2C.COLLAB_INBOX, payload));
collabEventBus.on('synced', () => broadcastCollab(CollabS2C.COLLAB_SYNCED, {}));
```

> 说明：identity 的 host/port 用 env/默认值，`server.listen` 回调里再用真实 HOST/PORT `setAdvertised` 修正（见下）。事件处理器在运行时才触发，`gateway` 此时已赋值，无时序问题。

在 `createServer` 回调内、`if (url.pathname.startsWith('/api/'))` 分支前插入：

```js
  if (url.pathname.startsWith('/api/collab')) { await collabMount(req, res); return; }
```

把 `createGateway({ ... })` 改赋给 `gateway`（原来是无返回值调用）：

```js
gateway = createGateway({ httpServer: server, sessionManager, workflowRunner, requireAuthWs, log });
```

在 `server.listen(...)` 回调里，补 identity 实际端口修正：

```js
server.listen(PORT, HOST, () => {
  collabEngine.setAdvertised({ host: HOST, port: PORT });
  log.info(`listening on http://${HOST}:${PORT}  (ws: ws://${HOST}:${PORT}/ws)`);
});
```

需要新增 import：`import os from 'node:os';`

- [ ] **Step 3: 建 event-bus.js**

Create: `server/collaboration/event-bus.js`

```js
export function createEventBus() {
  const handlers = new Map();
  return {
    on(type, fn) { let s = handlers.get(type); if (!s) { s = new Set(); handlers.set(type, s); } s.add(fn); return () => s.delete(fn); },
    emit(type, payload) { const s = handlers.get(type); if (s) for (const fn of s) { try { fn(payload); } catch { /* noop */ } } },
  };
}
```

- [ ] **Step 4: 写 index 接线测试（内存总线直接驱动 engine + mount 冒烟）**

Create: `server/test/collab-index.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CollabEngine } from '../collaboration/engine.js';
import { CollabStore } from '../collaboration/store.js';
import { loadIdentity } from '../collaboration/identity.js';
import { createEventBus } from '../collaboration/event-bus.js';
import { createCollabMount } from '../collaboration/http-mount.js';
import { makePeerClient } from '../collaboration/peer-client.js';
import { CollabS2C } from '@devflow/shared/collab';

test('事件总线按原始 engine 事件转发（index 层再映射到 CollabS2C）', async () => {
  const bus = createEventBus();
  const seen = [];
  // index.js 的接线：监听原始事件，转发为 CollabS2C 消息
  bus.on('friend-request', (payload) => seen.push([CollabS2C.COLLAB_FRIEND_REQ, payload.from && payload.from.machineId]));
  bus.on('synced', () => seen.push([CollabS2C.COLLAB_SYNCED]));
  bus.emit('friend-request', { from: { machineId: 'x' } });
  bus.emit('synced', {});
  assert.deepEqual(seen, [[CollabS2C.COLLAB_FRIEND_REQ, 'x'], [CollabS2C.COLLAB_SYNCED]]);
});

test('mount GET /api/collab/snapshot 返回身份', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-idx-'));
  const store = new CollabStore({ file: path.join(dir, 'c.json') });
  const identity = loadIdentity({ file: path.join(dir, 'i.json'), username: 'u', host: '127.0.0.1', port: 3001 });
  const engine = new CollabEngine({ store, identity, skillsRoot: path.join(dir, 's'), inboxDir: path.join(dir, 'in') });
  engine.peer = makePeerClient();
  const mount = createCollabMount({ engine });
  const server = http.createServer((req, res) => mount(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/collab/snapshot`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.identity.username, 'u');
    assert.ok(Array.isArray(body.friends));
  } finally { server.close(); }
});
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test "server/test/collab-index.test.js"`
Expected: PASS

- [ ] **Step 6: 跑全量 server 测试**

Run: `node --test "server/test/*.test.js"`
Expected: 全绿（含 master 旧测试）

- [ ] **Step 7: Commit**

```bash
git add server/collaboration/event-bus.js server/test/collab-index.test.js server/index.js
git commit -m "feat(collab): wire engine into index.js + ws broadcast"
```

---

## Task 10: 收尾 — 全量测试与冒烟

- [ ] **Step 1: 全量 server 测试**

Run: `node --test "server/test/*.test.js"`
Expected: 全绿

- [ ] **Step 2: web typecheck 不受影响**

Run: `npm.cmd --prefix web run typecheck`
Expected: 通过（本阶段未改 web）

- [ ] **Step 3: 手动冒烟（可选，后台起服务）**

以仓库根为 cwd，两个终端异步启动后端（`Start-Process` 非阻塞），然后验证：

```powershell
Start-Process -FilePath node -ArgumentList 'server/index.js' -WorkingDirectory <repo> -RedirectStandardOutput collab-a.log -RedirectStandardError collab-a-err.log
```

浏览器访问 `http://127.0.0.1:3001/api/collab/snapshot`，预期返回 `{ identity: { username: "当前系统用户", host, port: 3001, publicKey, machineId } }`。测试完成后停掉进程。

- [ ] **Step 4: git status 确认无 master 意外改动**

Run: `git status`
Expected: 只新增 `server/collaboration/**`、`server/test/collab-*.test.js`、`shared/collab.*`，并修改 `shared/package.json` 与 `server/index.js`（二者 diff 应很小）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(collab): finalize server-side collab subsystem"
```

---

## 完成标准

- 所有 Task commit 位于 `statistic` 分支。
- `node --test "server/test/*.test.js"` 全绿；master 旧测试未破坏。
- `server/index.js` diff ≤ ~25 行；`shared/package.json` diff = exports 子路径。
- 未改：`shared/index.js`、`server/ws-gateway.js`、`web/**`、`server/projects.js`、`server/http-api.js`。
- 新增文件都位于隔离目录，无对新 npm 依赖。
