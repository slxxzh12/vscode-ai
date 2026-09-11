import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  profilesRoot, stateFile, readState, writeState, listProfiles,
  readProfile, profilePaths, createProfile, touchProfile, bindProfile,
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
