import fs from 'node:fs';
import path from 'node:path';

// 小工具「记事本」的纯文本文件树：读写 <端口>/tools/notepad/ 下的 .txt 之类文本文件，
// 支持文件夹增删改与文件重命名/移动；所有路径经 normalizeRel 校验，杜绝路径穿越。
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

const SEG = /^[A-Za-z0-9_.-]+$/;

// 归一化相对路径：禁绝对路径、..、盘符、非法字符，统一用 /
function normalizeRel(rel) {
  const raw = String(rel ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!raw) return '';
  const parts = raw.split('/');
  for (const p of parts) {
    if (!p || p === '.' || p === '..' || !SEG.test(p)) { const e = new Error('bad path'); e.code = 'bad-path'; throw e; }
  }
  return parts.join('/');
}

function assertFileName(name) {
  const n = String(name ?? '').trim();
  if (!SEG.test(n) || n === '.' || n === '..') { const e = new Error('bad name'); e.code = 'bad-path'; throw e; }
  return n;
}

export function createNotepadStore({ dir }) {
  const dirOf = (rel) => path.join(dir, ...(rel ? rel.split('/') : []));
  const last = (rel) => rel.slice(rel.lastIndexOf('/') + 1);

  const listFolders = () => {
    const out = [];
    const walk = (abs, rel) => {
      let entries = [];
      try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (!e.isDirectory() || !SEG.test(e.name)) continue;
        const child = rel ? `${rel}/${e.name}` : e.name;
        out.push(child);
        walk(path.join(abs, e.name), child);
      }
    };
    walk(dir, '');
    return out;
  };

  const list = () => {
    const items = [];
    const walk = (abs, rel) => {
      let entries = [];
      try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (SEG.test(e.name)) walk(path.join(abs, e.name), rel ? `${rel}/${e.name}` : e.name);
          continue;
        }
        if (!SEG.test(e.name)) continue;
        const id = rel ? `${rel}/${e.name}` : e.name;
        let updatedAt = '';
        try { updatedAt = new Date(fs.statSync(path.join(abs, e.name)).mtimeMs).toISOString(); } catch { /* ignore */ }
        items.push({ id, folder: rel, name: e.name, updatedAt });
      }
    };
    walk(dir, '');
    return { items, folders: listFolders() };
  };

  const read = (id) => {
    const rel = normalizeRel(id);
    if (!rel) { const e = new Error('bad id'); e.code = 'bad-id'; throw e; }
    const abs = dirOf(rel);
    let stat;
    try { stat = fs.statSync(abs); } catch { const e = new Error('missing'); e.code = 'not-found'; throw e; }
    if (!stat.isFile()) { const e = new Error('not a file'); e.code = 'not-found'; throw e; }
    if (stat.size > MAX_FILE_BYTES) { const e = new Error('too large'); e.code = 'too-large'; throw e; }
    return { content: fs.readFileSync(abs, 'utf8'), size: stat.size };
  };

  const write = (id, content) => {
    const rel = normalizeRel(id);
    if (!rel) { const e = new Error('bad id'); e.code = 'bad-id'; throw e; }
    assertFileName(last(rel));
    const text = String(content ?? '');
    const size = Buffer.byteLength(text, 'utf8');
    if (size > MAX_FILE_BYTES) { const e = new Error('too large'); e.code = 'too-large'; throw e; }
    const abs = dirOf(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
    return { size };
  };

  const createFile = (folder, name) => {
    const rel = normalizeRel(folder);
    const file = assertFileName(name);
    const id = rel ? `${rel}/${file}` : file;
    const abs = dirOf(id);
    if (fs.existsSync(abs)) { const e = new Error('exists'); e.code = 'exists'; throw e; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '', 'utf8');
    return { id };
  };

  const createFolder = (rel) => {
    const r = normalizeRel(rel);
    if (!r) { const e = new Error('empty path'); e.code = 'empty'; throw e; }
    fs.mkdirSync(dirOf(r), { recursive: true });
    return r;
  };

  const removeFolder = (rel) => {
    const r = normalizeRel(rel);
    if (!r) return false;
    const abs = dirOf(r);
    if (!fs.existsSync(abs)) return false;
    try { fs.rmSync(abs, { recursive: true, force: true }); return true; } catch { return false; }
  };

  const renameFolder = (rel, name) => {
    const r = normalizeRel(rel);
    if (!r) { const e = new Error('empty path'); e.code = 'empty'; throw e; }
    const abs = dirOf(r);
    if (!fs.existsSync(abs)) { const e = new Error('missing'); e.code = 'not-found'; throw e; }
    const seg = assertFileName(name);
    const parent = r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : '';
    const next = parent ? `${parent}/${seg}` : seg;
    if (next === r) return r;
    const to = dirOf(next);
    if (fs.existsSync(to)) { const e = new Error('exists'); e.code = 'exists'; throw e; }
    fs.renameSync(abs, to);
    return next;
  };

  const renameItem = (id, name) => {
    const rel = normalizeRel(id);
    if (!rel) { const e = new Error('bad id'); e.code = 'bad-id'; throw e; }
    const abs = dirOf(rel);
    if (!fs.existsSync(abs)) { const e = new Error('missing'); e.code = 'not-found'; throw e; }
    const file = assertFileName(name);
    const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const next = parent ? `${parent}/${file}` : file;
    if (next === rel) return rel;
    const to = dirOf(next);
    if (fs.existsSync(to)) { const e = new Error('exists'); e.code = 'exists'; throw e; }
    fs.renameSync(abs, to);
    return next;
  };

  const removeItem = (id) => {
    let rel;
    try { rel = normalizeRel(id); } catch { return false; }
    if (!rel) return false;
    try { fs.unlinkSync(dirOf(rel)); return true; } catch { return false; }
  };

  const moveItem = (id, folder) => {
    let rel;
    try { rel = normalizeRel(id); } catch { return false; }
    if (!rel) return false;
    const from = dirOf(rel);
    if (!fs.existsSync(from)) return false;
    let target;
    try { target = normalizeRel(folder); } catch { return false; }
    const to = path.join(dirOf(target), last(rel));
    if (from === to) return true;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try { fs.renameSync(from, to); return true; } catch { return false; }
  };

  return { dir, list, listFolders, read, write, createFile, createFolder, removeFolder, renameFolder, renameItem, removeItem, moveItem };
}
