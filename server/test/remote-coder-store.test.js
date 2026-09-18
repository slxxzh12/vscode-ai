import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  REMOTE_DIR, SCREEN_FILE, MESSAGES_FILE, dirOf, decodePng, parseJsonc,
  readMessages, writeMessages, newId, makeEntry, appendMessage, inbox, markHandled,
  saveScreen, screenRev, commitScreen,
  artifactsDir, listArtifacts, resolveArtifact,
} from '../remote-coder-store.js';


function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-rc-')); }
const png = (s) => `data:image/png;base64,${Buffer.from(s).toString('base64')}`;

test('decodePng 接受合法 dataURL，拒绝非 PNG 或空', () => {
  const bytes = Buffer.from([137, 80, 78, 71]);
  assert.deepEqual(decodePng(`data:image/png;base64,${bytes.toString('base64')}`), bytes);
  for (const bad of ['data:image/jpeg;base64,AAAA', 'data:image/png;base64,', '', null, 123]) {
    assert.throws(() => decodePng(bad), (e) => e.code === 'bad-image');
  }
});

test('parseJsonc 支持 // 行注释；坏 JSON 抛错', () => {
  assert.deepEqual(parseJsonc('[\n  // c\n  {"a":1}\n]'), [{ a: 1 }]);
  assert.throws(() => parseJsonc('{ nope'), (e) => e instanceof SyntaxError);
});

test('makeEntry：消息必须有非空 text；截图无 text；都带 id/ts/handled', () => {
  const now = 1758000000000;
  const rand = () => 0.5;
  const m = makeEntry({ kind: 'message', text: '  继续  ' }, now, rand);
  assert.deepEqual(m, { id: 'm-1758000000000-8000', ts: now, kind: 'message', text: '继续', handled: false });
  const c = makeEntry({ kind: 'screenshot' }, now, rand);
  assert.deepEqual(c, { id: 'c-1758000000000-8000', ts: now, kind: 'screenshot', handled: false });
  assert.throws(() => makeEntry({ kind: 'message', text: '   ' }, now, rand), (e) => e.code === 'bad-message');
  assert.throws(() => makeEntry({ kind: 'message', text: 'x'.repeat(40000) }, now, rand), (e) => e.code === 'too-large');
});

test('newId 前缀按 kind 区分且随机段 4 位', () => {
  assert.match(newId('screenshot', 1, () => 0), /^c-1-0000$/);
  assert.equal(newId('message', 1, () => 0.999999999), 'm-1-ffff');
});

test('append/inbox/markHandled：只回未处理条目，处理后入库', () => {
  const dir = dirOf(tmp());
  assert.deepEqual(inbox(dir), []);
  const a = appendMessage(dir, makeEntry({ kind: 'message', text: 'a' }, 1, () => 0));
  appendMessage(dir, makeEntry({ kind: 'screenshot' }, 2, () => 0));
  assert.equal(readMessages(dir).length, 2);
  assert.equal(inbox(dir).length, 2);
  assert.equal(markHandled(dir, [a.id]), 1);
  assert.deepEqual(inbox(dir).map((x) => x.kind), ['screenshot']);
  assert.equal(markHandled(dir, [a.id]), 0);
  const raw = fs.readFileSync(path.join(dir, MESSAGES_FILE), 'utf8');
  assert.ok(raw.includes('"handled": true'));
});

test('坏 messages.jsonc：读抛 bad-jsonc，且不会被覆盖', () => {
  const dir = path.join(tmp(), REMOTE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, MESSAGES_FILE);
  fs.writeFileSync(file, '{ nope');
  assert.throws(() => readMessages(dir), (e) => e.code === 'bad-jsonc');
  assert.equal(fs.readFileSync(file, 'utf8'), '{ nope');
  assert.throws(() => appendMessage(dir, makeEntry({ kind: 'screenshot' }, 1, () => 0)), (e) => e.code === 'bad-jsonc');
});

test('saveScreen 反复写同一文件：目录里只有一个 png，内容为最后一次，rev 会变', async () => {
  const root = tmp();
  const dir = dirOf(root);
  const r1 = saveScreen(dir, png('first'));
  assert.ok(r1.bytes > 0);
  assert.equal(screenRev(dir), r1.rev);
  await new Promise((r) => setTimeout(r, 12));
  const r2 = saveScreen(dir, png('second'));
  assert.deepEqual(fs.readdirSync(dir), [SCREEN_FILE]);
  assert.equal(fs.readFileSync(path.join(dir, SCREEN_FILE), 'utf8'), 'second');
  assert.notEqual(r2.rev, r1.rev);
  fs.rmSync(root, { recursive: true, force: true });
});

test('commitScreen：非 git 返回 not-a-repo 且不调 git', async () => {
  const root = tmp();
  let called = 0;
  const r = await commitScreen(root, { git: async () => { called += 1; }, isGitRepoFn: () => false });
  assert.deepEqual(r, { uploaded: false, reason: 'not-a-repo' });
  assert.equal(called, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('commitScreen：依次 add/commit/push；失败标 git-failed', async () => {
  const root = tmp();
  const calls = [];
  const ok = await commitScreen(root, { isGitRepoFn: () => true, git: async (repo, args) => { calls.push(args); return ''; } });
  assert.deepEqual(ok, { uploaded: true, reason: '' });
  assert.deepEqual(calls, [
    ['add', '--', `${REMOTE_DIR}/${SCREEN_FILE}`],
    ['commit', '-m', `snapshot(remote): ${SCREEN_FILE}`, '--', `${REMOTE_DIR}/${SCREEN_FILE}`],
    ['push', 'origin', 'HEAD'],
  ]);
  const bad = await commitScreen(root, { isGitRepoFn: () => true, git: async () => { const e = new Error('rejected'); e.code = 'git-failed'; throw e; } });
  assert.deepEqual(bad, { uploaded: false, reason: 'git-failed' });
  fs.rmSync(root, { recursive: true, force: true });
});

test('deliver 条目：无 text、id 前缀 d-', () => {
  const now = 1758000000000;
  const rand = () => 0.5;
  const d = makeEntry({ kind: 'deliver' }, now, rand);
  assert.deepEqual(d, { id: 'd-1758000000000-8000', ts: now, kind: 'deliver', handled: false });
  assert.equal(newId('deliver', 1, () => 0), 'd-1-0000');
  assert.equal(newId('message', 1, () => 0), 'm-1-0000');
  assert.equal(newId('screenshot', 1, () => 0), 'c-1-0000');
});

test('listArtifacts：按 mtime 倒序、忽略子目录、目录不存在返回 []', async () => {
  const root = tmp();
  const dir = artifactsDir(root);
  assert.equal(dir, path.join(root, 'dist-portable'));
  assert.deepEqual(listArtifacts(dir), []);
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.zip'), 'aa');
  await new Promise((r) => setTimeout(r, 12));
  fs.writeFileSync(path.join(dir, 'b.zip'), 'bbb');
  const items = listArtifacts(dir);
  assert.deepEqual(items.map((x) => x.name), ['b.zip', 'a.zip']);
  assert.equal(items[0].size, 3);
  assert.ok(items[0].mtime > items[1].mtime);
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolveArtifact：返回绝对路径；拒绝穿越/分隔符名；不存在抛 not-found', () => {
  const root = tmp();
  const dir = artifactsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'a.zip');
  fs.writeFileSync(f, 'x');
  assert.equal(resolveArtifact(dir, 'a.zip'), f);
  for (const bad of ['../a.zip', '..', 'a/b.zip', '..\\a.zip', 'sub/../a.zip', '', null]) {
    assert.throws(() => resolveArtifact(dir, bad), (e) => e.code === 'bad-name', `expected bad-name for ${bad}`);
  }
  assert.throws(() => resolveArtifact(dir, 'nope.zip'), (e) => e.code === 'not-found');
  assert.throws(() => resolveArtifact(dir, 'sub'), (e) => e.code === 'not-found');
  fs.rmSync(root, { recursive: true, force: true });
});
