import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// 粘贴图片落地：把剪贴板里的 data:image/...;base64 URL 写成临时文件，返回绝对路径。
// 供终端输入框「粘贴图片」用；路径再由前端插回输入框交给 Agent 读取。
export const MAX_PASTE_BYTES = 20 * 1024 * 1024;

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

const DATA_URL_RE = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i;

function fail(code, message = '') {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function decodePastedImage(dataUrl) {
  if (typeof dataUrl !== 'string') throw fail('bad-image', 'dataUrl required');
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) throw fail('bad-image', 'expected data:image/...;base64 URL');
  const mime = m[1].toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) throw fail('bad-image', `unsupported image type: ${mime}`);
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw fail('bad-image', 'empty image');
  if (buf.length > MAX_PASTE_BYTES) throw fail('too-large', `image exceeds ${MAX_PASTE_BYTES} bytes`);
  return { buf, mime, ext };
}

export function savePastedImage({ dataUrl, dir, now = new Date(), rand = () => crypto.randomBytes(3).toString('hex') } = {}) {
  const { buf, mime, ext } = decodePastedImage(dataUrl);
  if (!dir) throw fail('bad-dir', 'dir required');
  fs.mkdirSync(dir, { recursive: true });
  const name = `pasted-${stamp(now)}-${rand()}.${ext}`;
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, buf);
  return { path: abs, bytes: buf.length, mime };
}
