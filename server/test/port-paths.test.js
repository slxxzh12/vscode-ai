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
  assert.equal(p.sessionProjectsFile, path.join(base, 'session-projects.json'));
  assert.equal(p.windowStateFile, path.join(base, 'window-state.json'));
  assert.equal(p.sessionsFile, path.join(base, 'sessions.json'));
  assert.equal(p.sessionLogsDir, path.join(base, 'session-logs'));
  assert.equal(p.usagePeersFile, path.join(base, 'usage-peers.json'));
  assert.equal(p.usageReportFile, path.join(base, 'usage-report.json'));
  assert.equal(p.inviteFile, path.join(base, 'collab', 'invite.json'));
  assert.equal(p.codeGroupsFile, path.join(base, 'code-groups.json'));
  assert.equal(p.codePrefsFile, path.join(base, 'code-prefs.json'));
  assert.equal(p.composerPrefsFile, path.join(base, 'composer-prefs.json'));
  assert.equal(p.skillsRoot, path.join(base, 'skills-opencode'));
  assert.equal(p.toolsDir, path.join(base, 'tools'));
  assert.equal(p.postmanDir, path.join(base, 'tools', 'postman'));
  assert.equal(p.notepadDir, path.join(base, 'tools', 'notepad'));
  assert.equal(p.yamlDir, path.join(base, 'tools', 'yaml'));
  assert.equal(p.jsDir, path.join(base, 'tools', 'js'));
  assert.equal(p.translateDir, path.join(base, 'tools', 'translate'));
  assert.equal(p.navicatDir, path.join(base, 'tools', 'navicat'));
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
  for (const d of [p.dir, p.schedulerDir, p.collabDir, p.uploadDir, p.downloadDir, p.downloadsDir, p.skillsRoot, p.sessionLogsDir, p.postmanDir, p.notepadDir, p.yamlDir, p.jsDir, p.translateDir, p.navicatDir]) {
    assert.ok(fs.existsSync(d), d + ' 应存在');
  }
  ensurePortDirs(p);   // 第二次不抛
});
