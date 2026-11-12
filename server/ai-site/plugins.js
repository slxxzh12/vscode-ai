import fs from 'node:fs';
import path from 'node:path';

const FIELD_TYPES = new Set(['text', 'textarea', 'select', 'number', 'checkbox', 'date', 'color', 'password', 'email', 'url', 'tel', 'range']);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }
function inside(root, file) { return file === root || file.startsWith(root + path.sep); }

function normalizeFields(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const f of raw) {
    const key = String(f?.key || '').trim();
    const type = String(f?.type || 'text').trim();
    if (!key || seen.has(key)) continue;
    if (!FIELD_TYPES.has(type)) continue;
    const field = { key, label: String(f?.label || key), type, required: !!f?.required };
    if (type === 'select') {
      const options = Array.isArray(f?.options) ? f.options.map((x) => String(x)).filter(Boolean) : [];
      if (!options.length) continue;
      field.options = options;
    }
    if (f?.placeholder !== undefined) field.placeholder = String(f.placeholder);
    if (f?.default !== undefined) field.default = String(f.default);
    for (const k of ['min', 'max', 'step']) if (f?.[k] !== undefined) field[k] = Number(f[k]);
    out.push(field);
    seen.add(key);
  }
  return out;
}

export function resolvePluginPath(root, plugin, rel) {
  const rootAbs = path.resolve(root);
  const pluginName = String(plugin || '').trim();
  if (!pluginName || pluginName.includes('/') || pluginName.includes('\\') || pluginName === '.' || pluginName === '..') throw err('not-found');
  const pluginDir = path.join(rootAbs, pluginName);
  if (!inside(rootAbs, pluginDir)) throw err('bad-path');
  const r = String(rel || '').trim();
  if (!r || path.isAbsolute(r) || r.includes('\0')) throw err('bad-path');
  const target = path.resolve(pluginDir, r);
  if (!inside(pluginDir, target)) throw err('bad-path');
  return target;
}

export function normalizeManifest(raw, dirName) {
  const title = String(raw?.name || dirName || '').trim() || dirName;
  const workflow = String(raw?.workflow || '').trim();
  const logo = String(raw?.logo || '').trim();
  return {
    name: dirName,
    title,
    description: String(raw?.description || ''),
    workflow,
    logo,
    fields: normalizeFields(raw?.fields),
  };
}

export function readPlugin(root, plugin) {
  const pluginName = String(plugin || '').trim();
  if (!pluginName || pluginName.includes('/') || pluginName.includes('\\') || pluginName === '.' || pluginName === '..') throw err('not-found');
  const rootAbs = path.resolve(root);
  const dir = path.resolve(rootAbs, pluginName);
  if (!inside(rootAbs, dir) || !fs.existsSync(dir)) throw err('not-found');
  const manifestFile = path.join(dir, 'manifest.json');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { throw err('bad-manifest', 'manifest.json missing or invalid'); }
  const pluginData = normalizeManifest(raw, pluginName);
  if (!pluginData.workflow) throw err('bad-manifest', 'workflow required');
  return { ...pluginData, dir };
}

export function listPlugins(root) {
  const rootAbs = path.resolve(String(root || ''));
  let entries = [];
  try { entries = fs.readdirSync(rootAbs, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    if (!fs.existsSync(path.join(rootAbs, e.name, 'manifest.json'))) continue;
    let item;
    try {
      const p = readPlugin(rootAbs, e.name);
      item = {
        name: p.name, title: p.title, description: p.description, fields: p.fields,
        workflow: p.workflow, logo: p.logo,
        hasLogo: !!(p.logo && fs.existsSync(resolvePluginPath(rootAbs, p.name, p.logo))),
        error: null,
      };
    } catch (e2) {
      item = { name: e.name, title: e.name, description: '', fields: [], workflow: '', logo: '', hasLogo: false, error: (e2 && e2.code) || 'bad-manifest' };
    }
    out.push(item);
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

export function readLogo(root, plugin) {
  const p = readPlugin(root, plugin);
  if (!p.logo) return null;
  let file;
  try { file = resolvePluginPath(root, p.name, p.logo); } catch { return null; }
  let st = null;
  try { st = fs.statSync(file); } catch { return null; }
  if (!st.isFile()) return null;
  const ext = path.extname(file).toLowerCase();
  if (!MIME[ext]) return null;
  return { data: fs.readFileSync(file), contentType: MIME[ext] };
}
