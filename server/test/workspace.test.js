import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  profilesRoot, stateFile, readState, writeState, listProfiles,
  readProfile, profilePaths, createProfile, touchProfile, bindProfile,
  migrateLegacy, resolveProfile,
} from '../workspace.js';

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-ws-')); }

test('writeState/readState 原子读写', () => {
  const root = tmpRoot();
  writeState(stateFile(root), { byListenPort: { '22222': '22222' } });
  assert.deepEqual(readState(stateFile(root)), { version: 1, byListenPort: { '22222': '22222' } });
});

test('readState 坏文件返回空状态', () => {
  const root = tmpRoot();
  fs.writeFileSync(stateFile(root), '{not json', 'utf8');
  assert.deepEqual(readState(stateFile(root)), { version: 1, byListenPort: {} });
});

test('createProfile 建目录与 profile.json，重复报 exists', () => {
  const root = tmpRoot();
  const p = createProfile(root, { id: '22222', name: '端口 22222', port: 22222 });
  assert.equal(p.id, '22222');
  assert.ok(fs.existsSync(path.join(profilesRoot(root), '22222', 'profile.json')));
  assert.ok(fs.existsSync(path.join(profilesRoot(root), '22222', 'collab')));
  assert.throws(() => createProfile(root, { id: '22222', port: 22222 }), /exists/);
});

test('createProfile 拒绝非法 id', () => {
  const root = tmpRoot();
  assert.throws(() => createProfile(root, { id: '../x', port: 1 }), /invalid/);
});

test('listProfiles 按 lastUsedAt 倒序', () => {
  const root = tmpRoot();
  createProfile(root, { id: 'a', port: 1 });
  createProfile(root, { id: 'b', port: 2 });
  touchProfile(root, 'a');
  const list = listProfiles(root);
  assert.equal(list[0].id, 'a');
});

test('bindProfile 写入监听端口映射', () => {
  const root = tmpRoot();
  createProfile(root, { id: '22222', port: 22222 });
  bindProfile(root, 33333, '22222');
  assert.equal(readState(stateFile(root)).byListenPort['33333'], '22222');
});

test('profilePaths 指向档案内各路径', () => {
  const root = tmpRoot();
  const p = profilePaths(root, '22222');
  assert.ok(p.projectsFile.endsWith(path.join('22222', 'projects.json')));
  assert.ok(p.historyFile.endsWith(path.join('22222', 'message-history.jsonc')));
});

test('readProfile 对未创建档案返回 null', () => {
  const root = tmpRoot();
  assert.equal(readProfile(root, 'nope'), null);
});

test('migrateLegacy 复制旧数据为档案 22222 并写标记', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'projects.json'), JSON.stringify({ projects: [{ id: 'local', name: '本地', root: '.' }] }), 'utf8');
  fs.mkdirSync(path.join(root, 'scheduler'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scheduler', 'tasks.json'), '[]', 'utf8');
  const p = migrateLegacy(root);
  assert.equal(p.id, '22222');
  assert.ok(fs.existsSync(path.join(profilesRoot(root), '22222', 'projects.json')));
  assert.ok(fs.existsSync(path.join(root, 'ports', '.migrated')));
  assert.equal(migrateLegacy(root), null);   // 幂等：ports/ 已存在不再迁移
});

test('migrateLegacy 无旧数据返回 null', () => {
  const root = tmpRoot();
  assert.equal(migrateLegacy(root), null);
});

test('resolveProfile: 0 份 ready 且 profile 为 null', () => {
  const root = tmpRoot();
  const r = resolveProfile({ root, listenPort: 22222 });
  assert.equal(r.status, 'ready');
  assert.equal(r.profile, null);
});

test('resolveProfile: 1 份自动使用', () => {
  const root = tmpRoot();
  createProfile(root, { id: '22222', port: 22222 });
  const r = resolveProfile({ root, listenPort: 33333 });
  assert.equal(r.status, 'ready');
  assert.equal(r.profile.id, '22222');
});

test('resolveProfile: 映射命中直接使用', () => {
  const root = tmpRoot();
  createProfile(root, { id: 'a', port: 1 });
  createProfile(root, { id: 'b', port: 2 });
  bindProfile(root, 22222, 'b');
  const r = resolveProfile({ root, listenPort: 22222 });
  assert.equal(r.status, 'ready');
  assert.equal(r.profile.id, 'b');
});

test('resolveProfile: 映射指向缺失档案则重新判断', () => {
  const root = tmpRoot();
  createProfile(root, { id: 'a', port: 1 });
  createProfile(root, { id: 'b', port: 2 });
  bindProfile(root, 22222, 'gone');
  const r = resolveProfile({ root, listenPort: 22222 });
  assert.equal(r.status, 'select');
  assert.equal(r.profiles.length, 2);
});

test('resolveProfile: 多份且未映射 -> select', () => {
  const root = tmpRoot();
  createProfile(root, { id: 'a', port: 1 });
  createProfile(root, { id: 'b', port: 2 });
  assert.equal(resolveProfile({ root, listenPort: 22222 }).status, 'select');
});

test('resolveProfile: nodeMode 直接 node', () => {
  const root = tmpRoot();
  assert.equal(resolveProfile({ root, listenPort: 22222, nodeMode: true }).status, 'node');
});
