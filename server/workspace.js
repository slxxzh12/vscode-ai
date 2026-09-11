import fs from 'node:fs';
import path from 'node:path';
import { dataHome } from './data-home.js';

export const PROFILE_ID_RE = /^[A-Za-z0-9_-]+$/;

export function profilesRoot(root = dataHome()) { return path.join(root, 'ports'); }
export function stateFile(root = dataHome()) { return path.join(root, 'ports-state.json'); }

export function readState(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const by = j && typeof j.byListenPort === 'object' && j.byListenPort ? j.byListenPort : {};
    return { version: 1, byListenPort: { ...by } };
  } catch {
    return { version: 1, byListenPort: {} };
  }
}

export function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = JSON.stringify({ version: 1, byListenPort: (state && state.byListenPort) || {} }, null, 2);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, file);
}

export function readProfile(root, id) {
  if (typeof id !== 'string' || !PROFILE_ID_RE.test(id)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(profilesRoot(root), id, 'profile.json'), 'utf8'));
    return {
      id,
      name: String(j.name || id),
      port: Number(j.port) || 0,
      createdAt: Number(j.createdAt) || 0,
      lastUsedAt: Number(j.lastUsedAt) || 0,
    };
  } catch { return null; }
}

export function listProfiles(root = dataHome()) {
  let names = [];
  try {
    names = fs.readdirSync(profilesRoot(root), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch { return []; }
  return names.map((id) => readProfile(root, id)).filter(Boolean)
    .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
}

export function profilePaths(root, id) {
  const dir = path.join(profilesRoot(root), id);
  return {
    id,
    dir,
    profileFile: path.join(dir, 'profile.json'),
    projectsFile: path.join(dir, 'projects.json'),
    workflowsFile: path.join(dir, 'workflows.json'),
    schedulerDir: path.join(dir, 'scheduler'),
    collabDir: path.join(dir, 'collab'),
    identityFile: path.join(dir, 'collab', 'identity.json'),
    storeFile: path.join(dir, 'collab', 'collab.json'),
    uploadDir: path.join(dir, 'upload'),
    downloadDir: path.join(dir, 'download'),
    historyFile: path.join(dir, 'message-history.jsonc'),
    skillsRoot: path.join(dir, 'skills-opencode'),
  };
}

export function createProfile(root, { id, name, port }) {
  if (typeof id !== 'string' || !PROFILE_ID_RE.test(id)) {
    const e = new Error('invalid profile id'); e.code = 'bad-id'; throw e;
  }
  const dir = path.join(profilesRoot(root), id);
  if (fs.existsSync(path.join(dir, 'profile.json'))) {
    const e = new Error('profile exists'); e.code = 'exists'; throw e;
  }
  const now = Date.now();
  fs.mkdirSync(dir, { recursive: true });
  for (const sub of ['collab', 'upload', 'download', 'scheduler', 'skills-opencode']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  const meta = { id, name: name || `端口 ${port}`, port: Number(port) || 0, createdAt: now, lastUsedAt: now };
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

export function touchProfile(root, id) {
  const meta = readProfile(root, id);
  if (!meta) return null;
  meta.lastUsedAt = Date.now();
  try { fs.writeFileSync(path.join(profilesRoot(root), id, 'profile.json'), JSON.stringify(meta, null, 2), 'utf8'); }
  catch { /* ignore */ }
  return meta;
}

export function bindProfile(root, listenPort, id) {
  const st = readState(stateFile(root));
  st.byListenPort[String(listenPort)] = id;
  writeState(stateFile(root), st);
}
