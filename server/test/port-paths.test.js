import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { portPaths, portRoot, ensurePortDirs } from '../port-paths.js';

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-portpaths-')); }

test('portPaths 全部落在 ports/<端口> 下', () => {
  const root = tmpRoot();
  const p = portPaths(44444, { root });
  const base = path.join(root, 'ports', '44444');
  assert.equal(p.id, '44444');
  assert.equal(p.port, 44444);
  assert.equal(p.dir, base);
  assert.equal(p.projectsFile, path.join(base, 'projects.json'));
  assert.equal(p.workflowsFile, path.join(base, 'workflows.json'));
  assert.equal(p.schedulerDir, path.join(base, 'scheduler'));
  assert.equal(p.collabDir, path.join(base, 'collab'));
  assert.equal(p.identityFile, path.join(base, 'collab', 'identity.json'));
  assert.equal(p.storeFile, path.join(base, 'collab', 'collab.json'));
  assert.equal(p.uploadDir, path.join(base, 'upload'));
  assert.equal(p.downloadDir, path.join(base, 'download'));
  assert.equal(p.downloadsDir, path.join(base, 'downloads'));
  assert.equal(p.relayPluginsDir, path.join(base, 'downloads', 'relay-plugins'));
  assert.equal(p.historyFile, path.join(base, 'message-history.jsonc'));
  assert.equal(p.usagePeersFile, path.join(base, 'usage-peers.json'));
  assert.equal(p.usageReportFile, path.join(base, 'usage-report.json'));
  assert.equal(p.inviteFile, path.join(base, 'collab', 'invite.json'));
  assert.equal(p.skillsRoot, path.join(base, 'skills-opencode'));
  assert.equal(portRoot(44444, root), base);
});

test('同端口推导稳定，不同端口互不重叠', () => {
  const root = tmpRoot();
  assert.deepEqual(portPaths(22222, { root }), portPaths('22222', { root }));
  assert.notEqual(portPaths(22222, { root }).dir, portPaths(33333, { root }).dir);
});

test('ensurePortDirs 幂等创建必需子目录', () => {
  const root = tmpRoot();
  const p = ensurePortDirs(portPaths(22222, { root }));
  for (const d of [p.dir, p.schedulerDir, p.collabDir, p.uploadDir, p.downloadDir, p.downloadsDir, p.skillsRoot]) {
    assert.ok(fs.existsSync(d), d + ' 应存在');
  }
  ensurePortDirs(p);   // 第二次不抛
});
