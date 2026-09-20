import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// 小工具「Postman」的 curl 记录：按 curl 原文去重，同一条只落一个文件（后跑覆盖旧的），
// 文件名 = curl 原文 sha256 前 16 位，存 <端口>/tools/postman/ 下（可分子目录）。
export function postmanRecordName(command) {
  const h = crypto.createHash('sha256').update(String(command ?? '').trim(), 'utf8').digest('hex');
  return `${h.slice(0, 16)}.json`;
}

// 只接受本 store 生成的文件名，防止路径穿越 / 删到无关文件
function isRecordName(name) {
  return /^[0-9a-f]{16}\.json$/.test(String(name ?? ''));
}

const SEG = /^[A-Za-z0-9_.-]+$/;

// 归一化相对目录：禁止绝对路径、..、盘符等，统一用 /
function normalizeRel(rel) {
  const raw = String(rel ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!raw) return '';
  const parts = raw.split('/');
  for (const p of parts) {
    if (!p || p === '.' || p === '..' || !SEG.test(p)) { const e = new Error('bad path'); e.code = 'bad-path'; throw e; }
  }
  return parts.join('/');
}

function normalizeResult(result) {
  return {
    ok: !!result?.ok,
    code: Number.isFinite(result?.code) ? result.code : 0,
    error: String(result?.error ?? ''),
    timedOut: !!result?.timedOut,
    stdout: String(result?.stdout ?? ''),
    stderr: String(result?.stderr ?? ''),
  };
}

export function createPostmanHistory({ dir }) {
  const dirOf = (rel) => path.join(dir, ...(rel ? rel.split('/') : []));

  const resolveRecord = (id) => {
    const r = normalizeRel(id);
    if (!r || !isRecordName(r.slice(r.lastIndexOf('/') + 1))) { const e = new Error('bad id'); e.code = 'bad-id'; throw e; }
    return dirOf(r);
  };

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

  // 记录一次执行：同一 curl（trim 后完全一致）在同一目录只保留最新结果，覆盖同一个文件
  const record = (command, result, { now = Date.now(), folder = '' } = {}) => {
    const cmd = String(command ?? '').trim();
    if (!cmd) return null;
    const rel = normalizeRel(folder);
    const target = dirOf(rel);
    fs.mkdirSync(target, { recursive: true });
    const file = path.join(target, postmanRecordName(cmd));
    let title = '';
    try {
      const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof prev?.title === 'string') title = prev.title.trim();
    } catch { /* 新文件或坏文件：无标题可保留 */ }
    const rec = { command: cmd, ...(title ? { title } : {}), result: normalizeResult(result), updatedAt: new Date(now).toISOString() };
    fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`, 'utf8');
    return file;
  };

  const list = () => {
    const out = [];
    const walk = (abs, rel) => {
      let entries = [];
      try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (SEG.test(e.name)) walk(path.join(abs, e.name), rel ? `${rel}/${e.name}` : e.name);
          continue;
        }
        if (!isRecordName(e.name)) continue;
        try {
          const rec = JSON.parse(fs.readFileSync(path.join(abs, e.name), 'utf8'));
          out.push({ id: rel ? `${rel}/${e.name}` : e.name, folder: rel, name: e.name, ...rec });
        } catch { /* 跳过坏文件 */ }
      }
    };
    walk(dir, '');
    return out;
  };

  const remove = (id) => {
    let file;
    try { file = resolveRecord(id); } catch { return false; }
    try { fs.unlinkSync(file); return true; } catch { return false; }
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

  const move = (id, folder) => {
    let from;
    try { from = resolveRecord(id); } catch { return false; }
    if (!fs.existsSync(from)) return false;
    const rel = normalizeRel(folder);
    const target = dirOf(rel);
    fs.mkdirSync(target, { recursive: true });
    const to = path.join(target, path.basename(from));
    if (from === to) return true;
    try { fs.renameSync(from, to); return true; } catch { return false; }
  };

  // 只改目录最后一段名字；返回新相对路径。重名抛 exists，非法名抛 bad-path，目标不存在抛 not-found。
  const renameFolder = (rel, name) => {
    const r = normalizeRel(rel);
    if (!r) { const e = new Error('empty path'); e.code = 'empty'; throw e; }
    const abs = dirOf(r);
    if (!fs.existsSync(abs)) { const e = new Error('missing'); e.code = 'not-found'; throw e; }
    const seg = String(name ?? '').trim();
    if (!SEG.test(seg) || seg === '.' || seg === '..') { const e = new Error('bad name'); e.code = 'bad-path'; throw e; }
    const parent = r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : '';
    const next = parent ? `${parent}/${seg}` : seg;
    if (next === r) return r;
    const to = dirOf(next);
    if (fs.existsSync(to)) { const e = new Error('exists'); e.code = 'exists'; throw e; }
    fs.renameSync(abs, to);
    return next;
  };

  // 记录的显示标题；空标题清除该字段，回退显示 curl 原文。文件名（哈希）不变。
  const setRecordTitle = (id, title) => {
    let file;
    try { file = resolveRecord(id); } catch { return false; }
    let rec;
    try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
    const name = String(title ?? '').trim();
    if (name) rec.title = name; else delete rec.title;
    try { fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`, 'utf8'); return true; } catch { return false; }
  };

  return { dir, record, list, listFolders, remove, createFolder, removeFolder, move, renameFolder, setRecordTitle };
}
