import fs from 'node:fs';
import path from 'node:path';

// 用户输入历史：以 jsonc（带注释的 JSON）形式存到用户数据目录，便于人工查看/编辑。
// 默认每节点一份（<dataHome>/nodes/<公钥指纹>/message-history.jsonc）。

const MAX_MESSAGES = 200;
const HEADER = [
  '// DevFlow 输入历史（用户在底部输入框发送过的消息）',
  '// 按时间倒序排列，最新在前；由服务端自动维护，可手工编辑。',
].join('\n');

// 极简 JSONC 解析：去掉 // 与 /* */ 注释（跳过字符串内），再去掉尾随逗号后交给 JSON.parse。
export function parseJsonc(text) {
  let out = '';
  let inStr = false; let esc = false; let inLine = false; let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; const n = text[i + 1];
    if (inLine) { if (c === '\n') { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(out);
}

// 统一的条目形状：{ text, ts }。兼容旧的纯字符串（ts 记 0）。
function normEntry(x) {
  if (typeof x === 'string') return { text: x, ts: 0 };
  if (x && typeof x.text === 'string') return { text: x.text, ts: Number(x.ts) || 0 };
  return null;
}

export function readHistory(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const j = parseJsonc(fs.readFileSync(file, 'utf8'));
    const arr = Array.isArray(j) ? j : (j && Array.isArray(j.messages) ? j.messages : []);
    return arr.map(normEntry).filter(Boolean);
  } catch {
    return [];
  }
}

export function writeHistory(file, messages, max = MAX_MESSAGES) {
  const list = (Array.isArray(messages) ? messages : [])
    .map(normEntry)
    .filter(Boolean)
    .slice(0, max);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = `${HEADER}\n${JSON.stringify(list, null, 2)}\n`;
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, file);
  return list;
}

// 追加一条到最前（去重连续重复），返回最新列表。
export function appendHistory(file, message, max = MAX_MESSAGES) {
  const t = String(message || '').trim();
  if (!t) return readHistory(file);
  const cur = readHistory(file);
  const next = [{ text: t, ts: Date.now() }, ...cur.filter((x) => x.text !== t)].slice(0, max);
  return writeHistory(file, next, max);
}
