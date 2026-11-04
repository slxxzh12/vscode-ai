import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// SQLite 库文件头：前 16 字节固定为 "SQLite format 3\0"
function isSqliteHeader(abs, size) {
  if (!size || size < 16) return false;
  const buf = Buffer.alloc(16);
  const fd = fs.openSync(abs, 'r');
  try { fs.readSync(fd, buf, 0, 16, 0); } finally { fs.closeSync(fd); }
  return buf.toString('latin1') === 'SQLite format 3\u0000';
}

export class Projects {
  constructor({ projects = [], logger = console } = {}) {
    this.projects = projects;
    this.log = logger;
    this._byId = new Map(projects.map((p) => [p.id, p]));
  }
  listProjects() {
    return this.projects.map((p) => ({ id: p.id, name: p.name, root: path.resolve(p.root), ...(p.temp ? { temp: true } : {}) }));
  }
  rawProjects() {
    return this.projects.map((p) => ({ id: p.id, name: p.name, root: p.root }));
  }
  addProject({ id, name, root }, front = false) {
    const proj = { id, name, root };
    if (front) this.projects.unshift(proj);
    else this.projects.push(proj);
    this._byId.set(id, proj);
    return proj;
  }
  addTempProject({ root, name }) {
    const rootReal = this._realOrResolved(root);
    const id = 'tmp:' + crypto.createHash('sha1').update(rootReal).digest('hex').slice(0, 8);
    const exist = this._byId.get(id);
    if (exist) return exist;
    const proj = { id, name: name || path.basename(rootReal), root, temp: true };
    this.projects.push(proj);
    this._byId.set(id, proj);
    return proj;
  }
  // 绝对路径 → 命中已有项目则返回其 projectId/rel；否则以所在目录建内存临时项目
  resolveAbsolute(abs) {
    const target = path.resolve(abs);
    let st;
    try { st = fs.statSync(target); } catch { const e = new Error('file not found'); e.code = 'not-found'; throw e; }
    if (st.isDirectory()) { const e = new Error('is a directory'); e.code = 'not-file'; throw e; }
    const targetReal = this._realOrResolved(target);
    for (const p of this.projects) {
      const rootReal = this._realOrResolved(p.root);
      if (targetReal === rootReal || !targetReal.startsWith(rootReal + path.sep)) continue;
      const rel = path.relative(rootReal, targetReal).split(path.sep).join('/');
      return { projectId: p.id, rel, project: { id: p.id, name: p.name, root: path.resolve(p.root), temp: !!p.temp } };
    }
    const root = path.dirname(targetReal);
    const proj = this.addTempProject({ root, name: path.basename(root) });
    return { projectId: proj.id, rel: path.basename(targetReal), project: { id: proj.id, name: proj.name, root: path.resolve(root), temp: true } };
  }
  _project(id) {
    const p = this._byId.get(id);
    if (!p) { const e = new Error('project not found'); e.code = 'not-found'; throw e; }
    return p;
  }
  _realOrResolved(p) {
    try { return fs.realpathSync(p); } catch { return path.resolve(p); }
  }
  // 校验 rel 落在项目 root 内且是文件，返回绝对路径；越界/不存在抛对应 code
  _filePath(projectId, rel) {
    const proj = this._project(projectId);
    const rootReal = this._realOrResolved(proj.root);
    let target = path.resolve(proj.root, rel || '.');
    if (target !== rootReal && !target.startsWith(rootReal + path.sep)) {
      const e = new Error('path escapes project root'); e.code = 'forbidden'; throw e;
    }
    if (!fs.existsSync(target)) { const e = new Error('file not found'); e.code = 'not-found'; throw e; }
    const st = fs.statSync(target);
    if (st.isDirectory()) { const e = new Error('is a directory'); e.code = 'not-file'; throw e; }
    const targetReal = this._realOrResolved(target);
    if (targetReal !== rootReal && !targetReal.startsWith(rootReal + path.sep)) {
      const e = new Error('symlink escapes project root'); e.code = 'forbidden'; throw e;
    }
    return target;
  }
  // 校验 rel 落在项目 root 内（允许目标尚不存在），返回绝对目标路径；供新建文件/目录用
  _safeTarget(projectId, rel) {
    const proj = this._project(projectId);
    const rootReal = this._realOrResolved(proj.root);
    const target = path.resolve(proj.root, rel || '.');
    if (target !== rootReal && !target.startsWith(rootReal + path.sep)) {
      const e = new Error('path escapes project root'); e.code = 'forbidden'; throw e;
    }
    return target;
  }
  createFile(projectId, rel, content = '', maxBytes = 2 * 1024 * 1024) {
    const target = this._safeTarget(projectId, rel);
    if (fs.existsSync(target)) { const e = new Error('already exists'); e.code = 'exists'; throw e; }
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > maxBytes) { const e = new Error('content too large'); e.code = 'too-large'; throw e; }
    const parent = path.dirname(target);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
    return { name: path.basename(target), path: rel, size: bytes };
  }
  createDir(projectId, rel) {
    const target = this._safeTarget(projectId, rel);
    if (fs.existsSync(target)) { const e = new Error('already exists'); e.code = 'exists'; throw e; }
    fs.mkdirSync(target, { recursive: true });
    return { name: path.basename(target), path: rel };
  }
  // 供 OS 资源管理器 reveal 用：解析到项目内已存在的绝对路径（文件或目录均可）
  revealTarget(projectId, rel) {
    const proj = this._project(projectId);
    const rootReal = this._realOrResolved(proj.root);
    const target = this._safeTarget(projectId, rel);
    if (!fs.existsSync(target)) { const e = new Error('file not found'); e.code = 'not-found'; throw e; }
    const real = this._realOrResolved(target);
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
      const e = new Error('symlink escapes project root'); e.code = 'forbidden'; throw e;
    }
    return { abs: real, name: path.basename(real), isDir: fs.statSync(real).isDirectory() };
  }
  // 供详细信息用：解析到项目内已存在路径（文件或目录均可），返回 stat 概要，不读内容
  meta(projectId, rel) {
    const { abs, name, isDir } = this.revealTarget(projectId, rel);
    const st = fs.statSync(abs);
    const out = { name, path: rel, abs, size: st.size, mtime: st.mtimeMs, isDir };
    if (!isDir) out.sqlite = isSqliteHeader(abs, st.size);
    return out;
  }
  // 单趟流式计算 MD5+SHA256（仅文件；目录抛 not-file）
  hash(projectId, rel) {
    const { abs, isDir } = this.revealTarget(projectId, rel);
    if (isDir) { const e = new Error('is a directory'); e.code = 'not-file'; throw e; }
    const md5 = crypto.createHash('md5');
    const sha = crypto.createHash('sha256');
    return new Promise((resolve, reject) => {
      const s = fs.createReadStream(abs, { highWaterMark: 64 * 1024 });
      s.on('data', (c) => { md5.update(c); sha.update(c); });
      s.on('error', (err) => { const e = new Error(`read failed: ${err.message}`); e.code = 'internal'; reject(e); });
      s.on('end', () => resolve({ md5: md5.digest('hex'), sha256: sha.digest('hex') }));
    });
  }
  // 项目根解析路径（供目录搜索用）
  rootOf(projectId) {
    const proj = this._project(projectId);
    return this._realOrResolved(proj.root);
  }
  readText(projectId, rel, maxBytes = 1024 * 1024) {
    const file = this._filePath(projectId, rel);
    const st = fs.statSync(file);
    const size = st.size;
    const base = { name: path.basename(file), path: rel, size, mtime: st.mtimeMs, abs: file };
    // 二进制探测：读文件前 64KB，含 NUL 即视为二进制（不读全文，大文件不再 413）
    if (size > 0) {
      const probeLen = Math.min(size, 64 * 1024);
      const buf = Buffer.alloc(probeLen);
      const fd = fs.openSync(file, 'r');
      try {
        fs.readSync(fd, buf, 0, probeLen, 0);
        if (buf.includes(0)) return { ...base, binary: true };
      } finally {
        fs.closeSync(fd);
      }
    }
    if (size > maxBytes) { const e = new Error('file too large'); e.code = 'too-large'; throw e; }
    return { ...base, binary: false, content: fs.readFileSync(file, 'utf8') };
  }
  rawFile(projectId, rel) {
    const file = this._filePath(projectId, rel);
    return { file, size: fs.statSync(file).size, name: path.basename(file) };
  }
  writeText(projectId, rel, content, maxBytes = 2 * 1024 * 1024) {
    const file = this._filePath(projectId, rel);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > maxBytes) { const e = new Error('content too large'); e.code = 'too-large'; throw e; }
    const tmp = `${file}.devflow-tmp`;
    fs.writeFileSync(tmp, content, 'utf8');   // 先写临时文件
    // Windows 上目标被占用/杀软扫描时 rename 可能瞬时失败(EPERM/EBUSY)，重试几次；仍失败则回退为直接覆盖写
    let lastErr;
    for (let i = 0; i < 4; i++) {
      try {
        fs.renameSync(tmp, file);             // 原子替换，避免半写文件
        return { name: path.basename(file), path: rel, size: bytes };
      } catch (e) {
        lastErr = e;
        if (i < 3) { const t = Date.now() + 30; while (Date.now() < t) { /* brief spin */ } }
      }
    }
    try {
      fs.writeFileSync(file, content, 'utf8');
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      throw e;
    }
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    if (lastErr && process.env.DEVFLOW_DEBUG) this.log.warn?.('rename fallback used:', lastErr.message);
    return { name: path.basename(file), path: rel, size: bytes };
  }
  tree(projectId, rel = '') {
    const proj = this._project(projectId);
    const rootReal = this._realOrResolved(proj.root);
    let target = path.resolve(proj.root, rel || '.');
    if (target !== rootReal && !target.startsWith(rootReal + path.sep)) {
      const e = new Error('path escapes project root'); e.code = 'forbidden'; throw e;
    }
    if (!fs.existsSync(target)) { const e = new Error('dir not found'); e.code = 'not-found'; throw e; }
    const targetReal = this._realOrResolved(target);
    if (targetReal !== rootReal && !targetReal.startsWith(rootReal + path.sep)) {
      const e = new Error('symlink escapes project root'); e.code = 'forbidden'; throw e;
    }
    const entries = fs.readdirSync(target, { withFileTypes: true });
    const items = entries
      .map((d) => ({ name: d.name, type: d.isDirectory() ? 'dir' : d.isFile() ? 'file' : 'file' }))
      .sort((a, b) =>
        (a.type === b.type ? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
          : a.type === 'dir' ? -1 : 1));
    return items;
  }
}
