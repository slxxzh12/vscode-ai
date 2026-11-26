import fs from 'node:fs';
import path from 'node:path';

export const MAX_US_DOC_BYTES = 200 * 1024;
const EXTS = new Set(['.md', '.json', '.txt']);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && EXTS.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
}

export function collectUsDocs(usDir, { maxBytes = MAX_US_DOC_BYTES } = {}) {
  const files = [];
  try {
    walk(usDir, files);
  } catch {
    return { docs: [], bytes: 0, truncated: false };
  }
  files.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const docs = [];
  let bytes = 0;
  let truncated = false;
  for (const file of files) {
    let buf;
    try {
      buf = fs.readFileSync(file);
    } catch {
      continue;
    }
    if (bytes + buf.length > maxBytes) {
      truncated = true;
      break;
    }
    bytes += buf.length;
    docs.push({ rel: path.relative(usDir, file), text: buf.toString('utf8') });
  }
  return { docs, bytes, truncated };
}

export function renderUsPrompt(template, { us, branch, base, cwd, docs, commands }) {
  const body = docs.map((d) => `### ${d.rel}\n\n${d.text.trim()}`).join('\n\n');
  return String(template || '')
    .replaceAll('{{us}}', String(us || ''))
    .replaceAll('{{branch}}', String(branch || ''))
    .replaceAll('{{base}}', String(base || ''))
    .replaceAll('{{cwd}}', String(cwd || ''))
    .replaceAll('{{test}}', String(commands?.test || ''))
    .replaceAll('{{build}}', String(commands?.build || ''))
    .replaceAll('{{package}}', String(commands?.package || ''))
    .replaceAll('{{docs}}', body);
}

// 用户自定义提示词模板覆盖文件（存在则优先于内置默认模板）。
export const PROMPT_OVERRIDE_FILE = 'us-prompt.md';

function overrideFileOf(dir) {
  return dir ? path.join(dir, PROMPT_OVERRIDE_FILE) : '';
}

// 读内置默认模板（随应用发布）。
export function readDefaultTemplate(templateFile) {
  try {
    return templateFile ? fs.readFileSync(templateFile, 'utf8') : '';
  } catch {
    return '';
  }
}

// 读实际生效模板：有自定义覆盖则用覆盖，否则用内置默认。
export function readEffectiveTemplate({ dir, templateFile } = {}) {
  const file = overrideFileOf(dir);
  try {
    if (file && fs.existsSync(file)) {
      return { template: fs.readFileSync(file, 'utf8'), isDefault: false };
    }
  } catch { /* fall through to default */ }
  return { template: readDefaultTemplate(templateFile), isDefault: true };
}

// 保存自定义模板（内容为空/全空白时视为恢复默认）。
export function writeCustomTemplate(dir, template) {
  const text = String(template ?? '');
  if (!text.trim()) {
    resetCustomTemplate(dir);
    return { isDefault: true };
  }
  const file = overrideFileOf(dir);
  if (!file) return { isDefault: false };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
  return { isDefault: false };
}

// 删除自定义模板，恢复内置默认。
export function resetCustomTemplate(dir) {
  const file = overrideFileOf(dir);
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch { /* ignore */ }
}
