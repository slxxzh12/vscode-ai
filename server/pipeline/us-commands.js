const FIELDS = ['test', 'build', 'package'];
const REQUIREMENT_DOC = '01-\u9700\u6c42\u5206\u6790.md';
const BUILD_DOC = '05-\u6784\u5efa\u53d1\u5e03.md';

function clean(v) {
  if (typeof v !== 'string') return '';
  let s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  return s;
}

function fromJson(text) {
  try {
    const data = JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
    const out = {};
    for (const f of FIELDS) out[f] = clean(data?.[f]);
    return out;
  } catch {
    return {};
  }
}

function fromFrontmatter(text) {
  const m = String(text || '').replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const hit = line.match(/^(test|build|package)\s*:\s*(.*)$/i);
    if (hit) out[hit[1].toLowerCase()] = clean(hit[2]);
  }
  return out;
}

function sectionCode(text, names) {
  const lines = String(text || '').split(/\r?\n/);
  let inSection = false;
  let inFence = false;
  const buf = [];
  for (const line of lines) {
    const h = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (h) {
      if (inSection && !inFence) return buf.join('\n').trim();
      inSection = names.includes(h[1].trim().toLowerCase());
      inFence = false;
      continue;
    }
    if (!inSection) continue;
    if (/^```/.test(line)) {
      inFence = !inFence;
      if (!inFence && buf.length) return buf.join('\n').trim();
      continue;
    }
    if (inFence) buf.push(line);
  }
  return inSection && buf.length ? buf.join('\n').trim() : '';
}

function fromBuildDoc(text) {
  return {
    test: sectionCode(text, ['\u6d4b\u8bd5', 'test', 'tests']),
    build: sectionCode(text, ['\u6784\u5efa', 'build']),
    package: sectionCode(text, ['\u6253\u5305', 'package', 'pack', 'release']),
  };
}

export function extractUsCommands(files = {}) {
  const sources = [
    fromJson(files['pipeline.json'] || ''),
    fromFrontmatter(files[REQUIREMENT_DOC] || ''),
    fromBuildDoc(files[BUILD_DOC] || ''),
  ];
  const out = {};
  for (const f of FIELDS) out[f] = sources.map((s) => s[f]).find((v) => !!v) || '';
  if (!out.build) return { ...out, error: 'missing_build' };
  return out;
}
