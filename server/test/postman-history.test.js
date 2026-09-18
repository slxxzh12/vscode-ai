import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPostmanHistory, postmanRecordName } from '../postman-history.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-postman-')); }

const RESULT = { ok: true, code: 0, error: '', timedOut: false, stdout: 'hello', stderr: '' };

test('postmanRecordName：同 curl（trim 后）同名，不同 curl 不同名', () => {
  assert.equal(postmanRecordName('curl https://a.com'), postmanRecordName('  curl https://a.com  '));
  assert.notEqual(postmanRecordName('curl https://a.com'), postmanRecordName('curl https://b.com'));
});

test('record：写入文件并保存 curl + 最近一次结果', () => {
  const dir = tmpDir();
  const h = createPostmanHistory({ dir });
  const file = h.record('curl https://a.com', RESULT);
  assert.equal(file, path.join(dir, postmanRecordName('curl https://a.com')));
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(rec.command, 'curl https://a.com');
  assert.deepEqual(rec.result, RESULT);
  assert.ok(rec.updatedAt);
});

test('record：同一 curl 只保留一条，后跑覆盖旧结果', () => {
  const dir = tmpDir();
  const h = createPostmanHistory({ dir });
  h.record('curl https://a.com', RESULT, { now: 1000 });
  h.record('  curl https://a.com  ', { ...RESULT, stdout: 'second' }, { now: 2000 });
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 1);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
  assert.equal(rec.result.stdout, 'second');
  assert.equal(rec.updatedAt, new Date(2000).toISOString());
});

test('record：空命令不落盘', () => {
  const dir = tmpDir();
  const h = createPostmanHistory({ dir });
  assert.equal(h.record('   ', RESULT), null);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('list：读回全部记录并带 id', () => {
  const dir = tmpDir();
  const h = createPostmanHistory({ dir });
  h.record('curl https://a.com', RESULT);
  h.record('curl https://b.com', RESULT);
  const all = h.list();
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((r) => r.command).sort(), ['curl https://a.com', 'curl https://b.com']);
  for (const r of all) assert.equal(r.id, postmanRecordName(r.command));
});

test('remove：删除指定记录；非法 id 或不存在返回 false', () => {
  const dir = tmpDir();
  const h = createPostmanHistory({ dir });
  const id = path.basename(h.record('curl https://a.com', RESULT));
  assert.equal(h.remove(id), true);
  assert.equal(h.list().length, 0);
  assert.equal(h.remove(id), false);
  assert.equal(h.remove('../evil.json'), false);
});

test('createFolder/listFolders：支持嵌套子目录并拒绝越界路径', () => {
  const dir = tmpDir();
  const h = createPostmanHistory({ dir });
  assert.equal(h.createFolder('foo'), 'foo');
  assert.equal(h.createFolder('foo/bar'), 'foo/bar');
  assert.deepEqual(h.listFolders().sort(), ['foo', 'foo/bar']);
  assert.throws(() => h.createFolder('../evil'), (e) => e.code === 'bad-path');
  assert.throws(() => h.createFolder('a/b c'), (e) => e.code === 'bad-path');
  assert.throws(() => h.createFolder(''), (e) => e.code === 'empty');
});

test('record：按目录去重；list 带 folder；不同目录同名 curl 各一条', () => {
  const dir = tmpDir();
  const h = createPostmanHistory({ dir });
  h.createFolder('foo');
  h.record('curl https://a.com', RESULT);
  h.record('curl https://a.com', { ...RESULT, stdout: 'in-foo' }, { folder: 'foo' });
  const all = h.list();
  assert.equal(all.length, 2);
  const rootRec = all.find((r) => r.folder === '');
  const fooRec = all.find((r) => r.folder === 'foo');
  assert.equal(rootRec.id, postmanRecordName('curl https://a.com'));
  assert.equal(fooRec.id, `foo/${postmanRecordName('curl https://a.com')}`);
  assert.equal(fooRec.result.stdout, 'in-foo');
});

test('move：把记录移到目标目录', () => {
  const dir = tmpDir();
  const h = createPostmanHistory({ dir });
  h.createFolder('foo');
  const id = postmanRecordName('curl https://a.com');
  h.record('curl https://a.com', RESULT);
  assert.equal(h.move(id, 'foo'), true);
  assert.deepEqual(h.list().map((r) => r.id), [`foo/${id}`]);
  assert.equal(h.move('foo/nope.json', 'foo'), false);
});

test('removeFolder：递归删除目录及其记录', () => {
  const dir = tmpDir();
  const h = createPostmanHistory({ dir });
  h.createFolder('foo/bar');
  h.record('curl https://a.com', RESULT, { folder: 'foo/bar' });
  assert.equal(h.removeFolder('foo'), true);
  assert.deepEqual(h.listFolders(), []);
  assert.deepEqual(h.list(), []);
  assert.equal(h.removeFolder('foo'), false);
});
