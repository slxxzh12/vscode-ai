import { readZip } from './zip.js';

export const ASSET_FORMAT = 'devflow-assets';
export const ASSET_FORMAT_VERSION = 1;
export const MANIFEST_NAME = 'Manifest.json';

function manifestError(code, cause) {
  const e = new Error(code);
  e.code = code;
  if (cause) e.cause = cause;
  return e;
}

// 由四类明细推导导出类型：仅有 skills/command/agent → skills；仅 workflow → workflow；两者都有 → mixed
export function deriveType(manifest) {
  const hasSkills = ['skills', 'command', 'agent'].some((k) => ((manifest && manifest[k]) || []).length > 0);
  const hasWorkflow = ((manifest && manifest.workflow) || []).length > 0;
  if (hasSkills && hasWorkflow) return 'mixed';
  if (hasWorkflow) return 'workflow';
  return 'skills';
}

// selection: { skills, command, agent, workflow }；details: { skills:[{name,files,hash}], command:[{name}], agent:[{name}], workflow:[{id,label,stages}] }
export function buildManifest({ selection = {}, details = {}, source = null, now = Date.now() } = {}) {
  const skills = (details.skills || []).map((s) => ({ name: s.name, files: s.files ?? 0, hash: s.hash ?? null }));
  const command = (details.command || (selection.command || []).map((name) => ({ name }))).map((c) => ({ name: c.name }));
  const agent = (details.agent || (selection.agent || []).map((name) => ({ name }))).map((a) => ({ name: a.name }));
  const workflow = (details.workflow || []).map((w) => ({ id: w.id, label: w.label, stages: w.stages ?? 0 }));
  const draft = { skills, command, agent, workflow };
  const manifest = {
    format: ASSET_FORMAT,
    version: ASSET_FORMAT_VERSION,
    exportedAt: now,
    source: source || null,
    kinds: ['skills', 'command', 'agent', 'workflow'].filter((k) => draft[k].length > 0),
    skills, command, agent, workflow,
  };
  manifest.type = deriveType(manifest);
  return manifest;
}

// 严格解析 zip 内的 Manifest.json；任何不合规都抛带 .code 的错误
export function parseManifest(zip) {
  let entries;
  try { entries = readZip(zip); } catch (e) { throw manifestError('invalid-zip', e); }
  const entry = entries.find((e) => e.name === MANIFEST_NAME);
  if (!entry) throw manifestError('manifest-missing');
  let manifest;
  try { manifest = JSON.parse(entry.data.toString('utf8')); } catch (e) { throw manifestError('bad-manifest', e); }
  if (!manifest || typeof manifest !== 'object') throw manifestError('bad-manifest');
  if (manifest.format !== ASSET_FORMAT || !Number.isFinite(Number(manifest.version))) throw manifestError('bad-format');
  return manifest;
}

export function manifestSummary(manifest) {
  const m = manifest || {};
  return {
    type: m.type || deriveType(m),
    kinds: m.kinds || [],
    exportedAt: m.exportedAt || 0,
    source: m.source || null,
    counts: {
      skills: (m.skills || []).length,
      command: (m.command || []).length,
      agent: (m.agent || []).length,
      workflow: (m.workflow || []).length,
    },
  };
}
