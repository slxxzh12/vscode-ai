import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseManifest, manifestSummary } from './asset-manifest.js';
import { installBundleZip } from './bundle-installer.js';

function importError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

// 暂存 zip 到 dir 并解析 Manifest；解析失败不留文件
export function stageImport({ zip, dir }) {
  if (!Buffer.isBuffer(zip) || zip.length === 0) throw importError('invalid-zip');
  const manifest = parseManifest(zip);   // 抛 invalid-zip / manifest-missing / bad-manifest / bad-format
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomUUID();
  const file = path.join(dir, `import-${id}.zip`);
  fs.writeFileSync(file, zip);
  return { id, file, manifest, summary: manifestSummary(manifest) };
}

// 严格校验后安装：skills/command/agent 落位，workflow 交给 installWorkflows 合并
export function applyImport({ id, file, manifest, skillRoot, configRoot, installWorkflows = null }) {
  if (!file || !fs.existsSync(file)) return { code: 'not-found' };
  try { manifest = manifest || parseManifest(fs.readFileSync(file)); }
  catch (e) { return { code: (e && e.code) || 'bad-manifest' }; }
  try {
    const r = installBundleZip({ zip: fs.readFileSync(file), skillRoot, configRoot, installWorkflows });
    return { code: 'ok', counts: r.counts, manifest };
  } catch (e) { return { code: 'invalid', error: String((e && e.message) || e) }; }
}

export function discardImport(file) {
  try { if (file) fs.unlinkSync(file); } catch { /* 不存在也算成功 */ }
  return { code: 'ok' };
}

export function cleanupStagedImports(dir) {
  if (!dir || !fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith('import-') || !f.endsWith('.zip')) continue;
    try { fs.unlinkSync(path.join(dir, f)); n++; } catch { /* ignore */ }
  }
  return n;
}
