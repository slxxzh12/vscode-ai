// Mermaid flowchart 的可编辑模型：保留原始形状/箭头/classDef，序列化时尽量不丢属性。
import { parseFlowchart } from './markdown-flowchart.js';

const NODE_TOKEN_RE = /([A-Za-z0-9_-]+)\s*(\(\([\s\S]*?\)\)|\[\[[\s\S]*?\]\]|\[[\s\S]*?\]|\([\s\S]*?\)|\{[\s\S]*?\}|>[\s\S]*?\])/g;
const ARROW_RE = /(-->|---|-\.->|==>)/g;
const EXTRA_RE = /^(classDef|class\s|style\s|linkStyle\s|click\s)/i;

function shapePrefix(shapeRaw) {
  if (!shapeRaw) return ['[', ']'];
  if (shapeRaw.startsWith('[[')) return ['[[', ']]'];
  if (shapeRaw.startsWith('((')) return ['((', '))'];
  if (shapeRaw.startsWith('>')) return ['>', ']'];
  if (shapeRaw.startsWith('{')) return ['{', '}'];
  if (shapeRaw.startsWith('(')) return ['(', ')'];
  return ['[', ']'];
}

function wrapLabel(shapeRaw, label) {
  const [a, b] = shapePrefix(shapeRaw);
  return a + label + b;
}

function readPositions(lines) {
  const positions = {};
  for (const line of lines) {
    const m = /^%%\s*x6-positions:\s*(\{.*\})\s*$/.exec(line.trim());
    if (!m) continue;
    try { Object.assign(positions, JSON.parse(m[1])); } catch { /* ignore */ }
  }
  return positions;
}

export function parseFlowchartModel(code) {
  const sourceLines = String(code || '').replace(/\r\n?/g, '\n').split('\n');
  const spec = parseFlowchart(sourceLines.map((l) => l.trim()));
  if (!spec) return null;

  const shapes = new Map();
  const arrows = [];
  const extras = [];
  for (const raw of sourceLines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (EXTRA_RE.test(line)) { extras.push(line); continue; }
    NODE_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = NODE_TOKEN_RE.exec(line))) {
      if (!shapes.has(m[1])) shapes.set(m[1], m[2]);
    }
    ARROW_RE.lastIndex = 0;
    while ((m = ARROW_RE.exec(line))) arrows.push(m[1]);
  }

  const nodes = spec.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    shapeRaw: shapes.get(n.id) || '',
    group: n.group || '',
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
  }));
  const edges = spec.edges.map((e, i) => ({
    source: e.source,
    target: e.target,
    label: e.label || '',
    arrow: arrows[i] || '-->',
  }));
  const groups = (spec.groups || [])
    .filter((g) => g.id !== '__root__' && g.label)
    .map((g) => ({ id: g.id, label: g.label, x: g.x, y: g.y, width: g.width, height: g.height }));

  return {
    direction: spec.direction,
    nodes,
    edges,
    groups,
    extras,
    positions: readPositions(sourceLines),
  };
}

export function serializeFlowchartModel(model) {
  if (!model) return '';
  const lines = [`flowchart ${model.direction || 'TD'}`];
  const groups = model.groups || [];
  const grouped = new Set(groups.map((g) => g.id));
  const nodesByGroup = new Map(groups.map((g) => [g.id, []]));
  const rootNodes = [];
  for (const n of model.nodes) {
    if (n.group && nodesByGroup.has(n.group)) nodesByGroup.get(n.group).push(n);
    else rootNodes.push(n);
  }
  const emitNode = (n) => {
    lines.push(`  ${n.id}${n.shapeRaw ? wrapLabel(n.shapeRaw, n.label) : `[${n.label}]`}`);
  };
  for (const g of groups) {
    lines.push(`  subgraph ${g.id}["${g.label}"]`);
    for (const n of nodesByGroup.get(g.id)) emitNode(n);
    lines.push('  end');
  }
  for (const n of rootNodes) emitNode(n);
  for (const e of model.edges) {
    const label = e.label ? `|${e.label}|` : '';
    lines.push(`  ${e.source} ${e.arrow || '-->'}${label} ${e.target}`);
  }
  if (model.extras && model.extras.length) lines.push(...model.extras);
  const keys = Object.keys(model.positions || {});
  if (keys.length) lines.push('%% x6-positions: ' + JSON.stringify(model.positions));
  return lines.join('\n');
}

export function replaceMermaidBlock(markdown, blockIndex, newCode) {
  const re = /```mermaid[^\n]*\n([\s\S]*?)```/g;
  let i = 0;
  return String(markdown || '').replace(re, (full) => {
    if (i++ !== blockIndex) return full;
    return '```mermaid\n' + newCode + '\n```';
  });
}
