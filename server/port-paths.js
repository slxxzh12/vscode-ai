import fs from 'node:fs';
import path from 'node:path';
import { dataHome } from './data-home.js';

// 端口数据根：<dataHome>/ports/<端口>
export function portRoot(port, root = dataHome()) {
  return path.join(root, 'ports', String(port));
}

// 纯路径推导：一个端口一份数据，全部在 ports/<端口>/ 下
export function portPaths(port, { root = dataHome() } = {}) {
  const dir = portRoot(port, root);
  return {
    id: String(port),
    port: Number(port),
    dir,
    projectsFile: path.join(dir, 'projects.json'),
    workflowsFile: path.join(dir, 'workflows.json'),
    workflowsDir: path.join(dir, 'workflows'),
    schedulerDir: path.join(dir, 'scheduler'),
    collabDir: path.join(dir, 'collab'),
    identityFile: path.join(dir, 'collab', 'identity.json'),
    storeFile: path.join(dir, 'collab', 'collab.json'),
    uploadDir: path.join(dir, 'upload'),
    downloadDir: path.join(dir, 'download'),
    downloadsDir: path.join(dir, 'downloads'),
    relayPluginsDir: path.join(dir, 'downloads', 'relay-plugins'),
    historyFile: path.join(dir, 'message-history.jsonc'),
    sessionProjectsFile: path.join(dir, 'session-projects.json'),
    windowStateFile: path.join(dir, 'window-state.json'),
    sessionsFile: path.join(dir, 'sessions.json'),
    sessionLogsDir: path.join(dir, 'session-logs'),
    usagePeersFile: path.join(dir, 'usage-peers.json'),
    usageReportFile: path.join(dir, 'usage-report.json'),
    inviteFile: path.join(dir, 'collab', 'invite.json'),
    fileAssocFile: path.join(dir, 'file-assoc.json'),
    codeGroupsFile: path.join(dir, 'code-groups.json'),
    codePrefsFile: path.join(dir, 'code-prefs.json'),
    composerPrefsFile: path.join(dir, 'composer-prefs.json'),
    skillsRoot: path.join(dir, 'skills-opencode'),
    toolsDir: path.join(dir, 'tools'),
    postmanDir: path.join(dir, 'tools', 'postman'),
    notepadDir: path.join(dir, 'tools', 'notepad'),
    yamlDir: path.join(dir, 'tools', 'yaml'),
    jsDir: path.join(dir, 'tools', 'js'),
    translateDir: path.join(dir, 'tools', 'translate'),
    navicatDir: path.join(dir, 'tools', 'navicat'),
  };
}

export function ensurePortDirs(paths) {
  for (const d of [paths.dir, paths.schedulerDir, paths.collabDir, paths.uploadDir, paths.downloadDir, paths.downloadsDir, paths.workflowsDir, paths.skillsRoot, paths.sessionLogsDir, paths.postmanDir, paths.notepadDir, paths.yamlDir, paths.jsDir, paths.translateDir, paths.navicatDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
  return paths;
}
