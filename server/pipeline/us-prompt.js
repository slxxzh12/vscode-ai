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

export function renderUsPrompt(template, { us, branch, cwd, docs, commands }) {
  const body = docs.map((d) => `### ${d.rel}\n\n${d.text.trim()}`).join('\n\n');
  return String(template || '')
    .replaceAll('{{us}}', String(us || ''))
    .replaceAll('{{branch}}', String(branch || ''))
    .replaceAll('{{cwd}}', String(cwd || ''))
    .replaceAll('{{test}}', String(commands?.test || ''))
    .replaceAll('{{build}}', String(commands?.build || ''))
    .replaceAll('{{package}}', String(commands?.package || ''))
    .replaceAll('{{docs}}', body);
}
