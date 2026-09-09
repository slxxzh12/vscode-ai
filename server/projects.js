import fs from 'node:fs';
import path from 'node:path';

export class Projects {
  constructor({ projects = [], logger = console } = {}) {
    this.projects = projects;
    this.log = logger;
    this._byId = new Map(projects.map((p) => [p.id, p]));
  }
  listProjects() {
    return this.projects.map((p) => ({ id: p.id, name: p.name, root: path.resolve(p.root) }));
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
    return { name, path: rel, abs, size: st.size, mtime: st.mtimeMs, isDir };
  }
  readText(projectId, rel, maxBytes = 1024 * 1024) {
    const file = this._filePath(projectId, rel);
    const st = fs.statSync(file);
    if (st.size > maxBytes) { const e = new Error('file too large'); e.code = 'too-large'; throw e; }
    return { name: path.basename(file), path: rel, size: st.size, mtime: st.mtimeMs, abs: file, content: fs.readFileSync(file, 'utf8') };
  }
  rawFile(projectId, rel) {
    const file = this._filePath(projectId, rel);
    return { file, size: fs.statSync(file).size, name: path.basename(file) };
  }
  writeText(projectId, rel, content, maxBytes = 2 * 1024 * 1024) {
    const file = this._filePath(projectId, rel);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > maxBytes) { const e = new Error('content too large'); e.code = 'too-large'; throw e; }
    const tmp = file + '.devflow-tmp';
    fs.writeFileSync(tmp, content, 'utf8');   // 先写临时文件
    fs.renameSync(tmp, file);                 // 再原子替换，避免半写文件
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
