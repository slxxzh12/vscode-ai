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
