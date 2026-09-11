import fs from 'node:fs';
import path from 'node:path';
import { dataHome } from './data-home.js';
import { t } from './i18n.js';

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
    downloadsDir: path.join(dir, 'downloads'),
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
  const meta = { id, name: name || t('ws.default_profile_name', { port }), port: Number(port) || 0, createdAt: now, lastUsedAt: now };
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

function copyFileIf(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (fs.existsSync(dst)) return false;   // 幂等：已存在跳过
  fs.copyFileSync(src, dst);
  return true;
}

function copyDirIf(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name); const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDirIf(s, d);
    else copyFileIf(s, d);
  }
  return true;
}

// 在 nodes/<fp>/ 下取最近修改的 message-history.jsonc
function findNewestMessageHistory(nodesDir) {
  let best = null; let bestM = -1;
  let fps = [];
  try { fps = fs.readdirSync(nodesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return null; }
  for (const fp of fps) {
    const f = path.join(nodesDir, fp, 'message-history.jsonc');
    try { const m = fs.statSync(f).mtimeMs; if (m > bestM) { bestM = m; best = f; } } catch { /* skip */ }
  }
  return best;
}

// 旧数据 -> ports/<id>（只在 ports/ 不存在时执行；复制不删除，幂等）
export function migrateLegacy(root = dataHome(), id = '22222') {
  const proot = profilesRoot(root);
  if (fs.existsSync(proot)) return null;
  const legacy = ['projects.json', 'workflows.json', 'scheduler', 'collab']
    .map((n) => path.join(root, n));
  if (!legacy.some((p) => fs.existsSync(p))) return null;
  const dir = path.join(proot, id);
  for (const sub of ['collab', 'upload', 'download', 'scheduler', 'skills-opencode']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  copyFileIf(path.join(root, 'projects.json'), path.join(dir, 'projects.json'));
  copyFileIf(path.join(root, 'workflows.json'), path.join(dir, 'workflows.json'));
  copyDirIf(path.join(root, 'scheduler'), path.join(dir, 'scheduler'));
  copyDirIf(path.join(root, 'collab'), path.join(dir, 'collab'));
  const hist = findNewestMessageHistory(path.join(root, 'nodes'));
  if (hist) copyFileIf(hist, path.join(dir, 'message-history.jsonc'));
  const now = Date.now();
  fs.writeFileSync(path.join(dir, 'profile.json'),
    JSON.stringify({ id, name: t('ws.migrated_profile_name', { port: 22222 }), port: 22222, createdAt: now, lastUsedAt: now }, null, 2), 'utf8');
  fs.writeFileSync(path.join(proot, '.migrated'), String(now), 'utf8');
  return readProfile(root, id);
}

// 解析：node 模式 / 命中映射 / 单份 / 零份 / 多份
export function resolveProfile({ root = dataHome(), listenPort, nodeMode = false } = {}) {
  if (nodeMode) return { status: 'node' };
  const mapped = readState(stateFile(root)).byListenPort[String(listenPort)];
  if (mapped) {
    const meta = readProfile(root, mapped);
    if (meta) return { status: 'ready', profile: meta };
  }
  const profiles = listProfiles(root);
  if (profiles.length === 1) return { status: 'ready', profile: profiles[0] };
  if (profiles.length === 0) return { status: 'ready', profile: null };
  return { status: 'select', profiles };
}

export function createWorkspaceService({ root = dataHome(), listenPort, onProfile, logger = console } = {}) {
  const proot = profilesRoot(root);
  const sfile = stateFile(root);

  function countProjects(id) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(proot, id, 'projects.json'), 'utf8'));
      return Array.isArray(j.projects) ? j.projects.length : 0;
    } catch { return 0; }
  }
  function bind(id) {
    const st = readState(sfile);
    st.byListenPort[String(listenPort)] = id;
    writeState(sfile, st);
    touchProfile(root, id);
  }
  return {
    state() {
      const current = readState(sfile).byListenPort[String(listenPort)] || null;
      const profiles = listProfiles(root).map((p) => ({ ...p, projectCount: countProjects(p.id) }));
      return { ready: false, needSelect: true, listenPort, current, profiles };
    },
    select(id) {
      const meta = readProfile(root, id);
      if (!meta) { const e = new Error('profile not found'); e.code = 'not-found'; throw e; }
      bind(meta.id);
      logger?.info?.(`workspace: port ${listenPort} -> profile ${meta.id}`);
      onProfile(profilePaths(root, meta.id));
      return { ok: true, profile: meta };
    },
    create(name) {
      let id = String(listenPort);
      let n = 2;
      while (readProfile(root, id)) id = `${listenPort}-${n++}`;
      const meta = createProfile(root, { id, name: typeof name === 'string' && name.trim() ? name.trim() : t('ws.default_profile_name', { port: listenPort }), port: listenPort });
      bind(meta.id);
      logger?.info?.(`workspace: created profile ${meta.id} for port ${listenPort}`);
      onProfile(profilePaths(root, meta.id));
      return { ok: true, profile: meta };
    },
  };
}
