import dagre from '@dagrejs/dagre';

const NODE_MIN_W = 120;
const NODE_MAX_W = 220;
const NODE_H = 44;
const GROUP_GAP = 110;
const PAD = 24;
const GROUP_PAD_X = 18;
const GROUP_PAD_TOP = 32;
const GROUP_PAD_BOTTOM = 14;

function unquote(text) {
  const s = String(text || '').trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function flowLabel(raw) {
  let t = String(raw || '').trim();
  if (/^\(\([\s\S]*\)\)$/.test(t)) t = t.slice(2, -2);
  else if (/^\[\[[\s\S]*\]\]$/.test(t)) t = t.slice(2, -2);
  else if (/^\[[\s\S]*\]$/.test(t)) t = t.slice(1, -1);
  else if (/^\([\s\S]*\)$/.test(t)) t = t.slice(1, -1);
  else if (/^\{[\s\S]*\}$/.test(t)) t = t.slice(1, -1);
  else if (/^>[\s\S]*\]$/.test(t)) t = t.slice(1, -1);
  return unquote(t);
}

function readFlowNode(line, pos) {
  const m = /^\s*([A-Za-z0-9_-]+)\s*(\(\([\s\S]*?\)\)|\[\[[\s\S]*?\]\]|\[[\s\S]*?\]|\([\s\S]*?\)|\{[\s\S]*?\}|>[\s\S]*?\]|)\s*(?:::\s*([A-Za-z0-9_-]+))?/.exec(line.slice(pos));
  if (!m) return null;
  return { id: m[1], label: m[2] ? flowLabel(m[2]) : m[1], cls: m[3] || '', length: m[0].length };
}

function readFlowEdge(line, pos) {
  const rest = line.slice(pos);
  let m;
  if ((m = /^\s*--\s+(.+?)\s+-->\s*/.exec(rest))) return { label: m[1].trim(), length: m[0].length };
  if ((m = /^\s*-\.\s*(.+?)\s*\.->\s*/.exec(rest))) return { label: m[1].trim(), length: m[0].length };
  if ((m = /^\s*==\s*(.+?)\s*==>\s*/.exec(rest))) return { label: m[1].trim(), length: m[0].length };
  if ((m = /^\s*(-->|---|-\.->|==>)\s*\|([^|]*)\|\s*/.exec(rest))) return { label: m[2].trim(), length: m[0].length };
  if ((m = /^\s*(-->|---|-\.->|==>)\s*/.exec(rest))) return { label: '', length: m[0].length };
  return null;
}

function parseFlowLine(line) {
  const nodes = [];
  const edges = [];
  let pos = 0;
  const first = readFlowNode(line, pos);
  if (!first) return null;
  pos += first.length;
  nodes.push({ id: first.id, label: first.label, cls: first.cls });
  while (line.slice(pos).trim()) {
    const edge = readFlowEdge(line, pos);
    if (!edge) return null;
    pos += edge.length;
    const next = readFlowNode(line, pos);
    if (!next) return null;
    pos += next.length;
    edges.push({ source: nodes[nodes.length - 1].id, target: next.id, label: edge.label });
    nodes.push({ id: next.id, label: next.label, cls: next.cls });
  }
  return { nodes, edges };
}

function contrastText(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color || ''));
  if (!m) return '#ffffff';
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1f2937' : '#ffffff';
}

function nodeWidth(label) {
  const len = String(label || '').length;
  return Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, Math.round(len * 12 + 36)));
}

function parseDirection(value, fallback = 'TD') {
  const d = String(value || fallback).toUpperCase();
  return { LR: 'LR', RL: 'RL', TD: 'TD', TB: 'TD', BT: 'BT' }[d] || null;
}

function layoutGroup(group, edges) {
  const gd = new dagre.graphlib.Graph();
  gd.setGraph({ rankdir: group.direction, nodesep: 34, ranksep: 68, marginx: 0, marginy: 0 });
  gd.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(group.nodeIds);
  for (const id of ids) gd.setNode(id, { width: group.sizes.get(id).w, height: group.sizes.get(id).h });
  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target)) gd.setEdge(e.source, e.target);
  }
  dagre.layout(gd);
  return gd;
}

export function parseFlowchart(lines) {
  const head = lines[0].trim().split(/\s+/);
  const direction = parseDirection(head[1] || 'TD');
  if (!direction) return null;

  const nodes = new Map();
  const edges = [];
  const groups = new Map();
  const groupStack = [];
  const classDefs = new Map();
  const classAssign = new Map();

  for (const raw of lines.slice(1)) {
    let line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    line = line.replace(/;+\s*$/, '').trim();
    if (!line) continue;

    let m;
    if ((m = /^subgraph\s+(.+)$/.exec(line))) {
      let spec = m[1].trim();
      let id = spec;
      let label = spec;
      const lm = /^([A-Za-z0-9_-]+)\s*\[\s*["']?(.+?)["']?\s*\]$/.exec(spec);
      if (lm) {
        id = lm[1];
        label = lm[2];
      } else {
        spec = unquote(spec);
        id = spec;
        label = spec;
      }
      groups.set(id, { id, label, direction, nodeIds: new Set(), sizes: new Map() });
      groupStack.push(id);
      continue;
    }
    if (/^end\b/.test(line)) {
      groupStack.pop();
      continue;
    }
    if ((m = /^direction\s+(LR|RL|TD|TB|BT)\s*$/i.exec(line))) {
      const gid = groupStack[groupStack.length - 1];
      const dir = parseDirection(m[1]);
      if (gid && groups.has(gid) && dir) groups.get(gid).direction = dir;
      continue;
    }
    if (/^classDef\b/.test(line)) {
      const cm = /^classDef\s+([A-Za-z0-9_-]+)\s+(.+)$/.exec(line);
      if (!cm) return null;
      const styles = {};
      for (const part of cm[2].split(',')) {
        const ci = part.indexOf(':');
        if (ci < 0) continue;
        const k = part.slice(0, ci).trim().toLowerCase();
        const v = part.slice(ci + 1).trim();
        if (k && v) styles[k] = v;
      }
      classDefs.set(cm[1], styles);
      continue;
    }
    if (/^class\b/.test(line)) {
      const cm = /^class\s+([A-Za-z0-9_,\s-]+?)\s+([A-Za-z0-9_-]+)$/.exec(line);
      if (!cm) return null;
      for (const id of cm[1].split(',').map((s) => s.trim()).filter(Boolean)) classAssign.set(id, cm[2]);
      continue;
    }
    if (/^(style|linkStyle|click)\b/.test(line)) return null;
    if (/^(accTitle|accDescr)\b/.test(line)) continue;
    if (line.includes('&')) return null;

    const parsed = parseFlowLine(line);
    if (!parsed) return null;
    const gid = groupStack[groupStack.length - 1] || '';
    for (const n of parsed.nodes) {
      const ex = nodes.get(n.id);
      if (ex) {
        if (n.label && n.label !== n.id) ex.label = n.label;
        if (n.cls) ex.cls = n.cls;
        if (gid) ex.group = gid;
      } else {
        nodes.set(n.id, { id: n.id, label: n.label || n.id, cls: n.cls || '', group: gid });
      }
      if (gid && groups.has(gid)) groups.get(gid).nodeIds.add(n.id);
    }
    edges.push(...parsed.edges);
  }
  if (!nodes.size) return null;

  const rootIds = [...nodes.values()].filter((n) => !n.group).map((n) => n.id);
  if (rootIds.length) {
    const root = { id: '__root__', label: '', direction, nodeIds: new Set(rootIds), sizes: new Map() };
    groups.set(root.id, root);
  }
  const activeGroups = [...groups.values()].filter((g) => g.nodeIds.size > 0);
  if (!activeGroups.length) return null;

  for (const g of activeGroups) {
    for (const id of g.nodeIds) {
      const n = nodes.get(id);
      g.sizes.set(id, { w: nodeWidth(n.label), h: NODE_H });
    }
  }

  const laid = new Map();
  for (const g of activeGroups) laid.set(g.id, layoutGroup(g, edges));

  const horizontal = direction === 'LR' || direction === 'RL';
  let cursor = 0;
  for (const g of activeGroups) {
    const gd = laid.get(g.id);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of g.nodeIds) {
      const n = nodes.get(id);
      const size = g.sizes.get(id);
      const p = gd.node(id);
      n.x = p.x;
      n.y = p.y;
      n.w = size.w;
      n.h = size.h;
      minX = Math.min(minX, p.x - size.w / 2);
      minY = Math.min(minY, p.y - size.h / 2);
      maxX = Math.max(maxX, p.x + size.w / 2);
      maxY = Math.max(maxY, p.y + size.h / 2);
    }
    const padTop = g.label ? GROUP_PAD_TOP : GROUP_PAD_BOTTOM;
    for (const id of g.nodeIds) {
      const n = nodes.get(id);
      n.x += -minX + GROUP_PAD_X;
      n.y += -minY + padTop;
    }
    g.rect = {
      x: 0,
      y: 0,
      width: maxX - minX + GROUP_PAD_X * 2,
      height: maxY - minY + padTop + GROUP_PAD_BOTTOM,
    };
    if (horizontal) {
      g.rect.x = cursor;
      g.rect.y = 0;
      cursor += g.rect.width + GROUP_GAP;
    } else {
      g.rect.x = 0;
      g.rect.y = cursor;
      cursor += g.rect.height + GROUP_GAP;
    }
  }

  if (direction === 'RL' || direction === 'BT') {
    const total = cursor - GROUP_GAP;
    for (const g of activeGroups) {
      if (horizontal) g.rect.x = total - g.rect.x - g.rect.width;
      else g.rect.y = total - g.rect.y - g.rect.height;
    }
  }

  for (const g of activeGroups) {
    for (const id of g.nodeIds) {
      const n = nodes.get(id);
      n.x += g.rect.x;
      n.y += g.rect.y;
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes.values()) {
    minX = Math.min(minX, n.x - n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  }
  for (const g of activeGroups) {
    minX = Math.min(minX, g.rect.x);
    minY = Math.min(minY, g.rect.y);
    maxX = Math.max(maxX, g.rect.x + g.rect.width);
    maxY = Math.max(maxY, g.rect.y + g.rect.height);
  }
  const dx = PAD - minX;
  const dy = PAD - minY;
  for (const n of nodes.values()) { n.x += dx; n.y += dy; }
  for (const g of activeGroups) { g.rect.x += dx; g.rect.y += dy; }

  for (const n of nodes.values()) {
    const styles = classDefs.get(n.cls || classAssign.get(n.id)) || {};
    n.fill = styles.fill || '#e6f3ff';
    n.stroke = styles.stroke || '#8ab8e6';
    n.color = styles.color || (styles.fill ? contrastText(styles.fill) : '#1f2937');
  }

  return {
    kind: 'flowchart',
    direction,
    nodes: [...nodes.values()].map((n) => ({
      id: n.id, label: n.label, group: n.group || '',
      x: n.x, y: n.y, w: n.w, h: n.h,
      fill: n.fill, stroke: n.stroke, color: n.color,
    })),
    edges,
    groups: activeGroups.map((g) => ({
      id: g.id, label: g.label,
      x: g.rect.x, y: g.rect.y, width: g.rect.width, height: g.rect.height,
    })),
    width: maxX - minX + PAD * 2,
    height: maxY - minY + PAD * 2,
  };
}

function sidePoints(src, dst) {
  const dx = dst.x - src.x;
  const dy = dst.y - src.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const right = dx >= 0;
    return {
      a: { x: src.x + (right ? src.w / 2 : -src.w / 2), y: src.y },
      b: { x: dst.x + (right ? -dst.w / 2 : dst.w / 2), y: dst.y },
    };
  }
  const down = dy >= 0;
  return {
    a: { x: src.x, y: src.y + (down ? src.h / 2 : -src.h / 2) },
    b: { x: dst.x, y: dst.y + (down ? -dst.h / 2 : dst.h / 2) },
  };
}

function edgePoints(src, dst) {
  const { a, b } = sidePoints(src, dst);
  if (src.group === dst.group) return [a, b];
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
    const midX = (a.x + b.x) / 2;
    return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
  }
  const midY = (a.y + b.y) / 2;
  return [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b];
}

function arrowHead(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = to.x - ux * 9;
  const by = to.y - uy * 9;
  return [
    [to.x, to.y],
    [bx - uy * 4.5, by + ux * 4.5],
    [bx + uy * 4.5, by - ux * 4.5],
  ];
}

export function flowchartOption(spec, th) {
  const nodes = spec.nodes || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups = spec.groups || [];
  const xs = nodes.map((n) => [n.x - n.w / 2, n.x + n.w / 2]).flat().concat(groups.length ? groups.map((g) => [g.x, g.x + g.width]).flat() : []);
  const ys = nodes.map((n) => [n.y - n.h / 2, n.y + n.h / 2]).flat().concat(groups.length ? groups.map((g) => [g.y, g.y + g.height]).flat() : []);
  const minX = Math.min(...xs) - 20;
  const maxX = Math.max(...xs) + 20;
  const minY = Math.min(...ys) - 20;
  const maxY = Math.max(...ys) + 20;

  const groupSeries = {
    type: 'custom',
    z: 0,
    silent: true,
    data: groups.map((g) => ({ value: [g.x + g.width / 2, g.y + g.height / 2], group: g })),
    renderItem: (params, api) => {
      const g = groups[params.dataIndex];
      if (!g) return null;
      const p1 = api.coord([g.x, g.y]);
      const p2 = api.coord([g.x + g.width, g.y + g.height]);
      const x = Math.min(p1[0], p2[0]);
      const y = Math.min(p1[1], p2[1]);
      const w = Math.abs(p2[0] - p1[0]);
      const h = Math.abs(p2[1] - p1[1]);
      const children = [{ type: 'rect', shape: { x, y, width: w, height: h, r: 10 }, style: { fill: '#f2f8ff', stroke: '#a9ccef', lineWidth: 1.5 } }];
      if (g.label) {
        children.push({ type: 'text', style: { text: g.label, x: x + 12, y: y + 16, fill: '#1f4f7a', fontSize: 11, fontWeight: 600, align: 'left', verticalAlign: 'middle' } });
      }
      return { type: 'group', children };
    },
  };

  const edgeSeries = {
    type: 'custom',
    name: 'flow-edges',
    z: 1,
    silent: true,
    data: spec.edges.map((e) => ({ value: [0, 0] })),
    renderItem: (params, api) => {
      const e = spec.edges[params.dataIndex];
      const src = byId.get(e.source);
      const dst = byId.get(e.target);
      if (!src || !dst) return null;
      const pts = edgePoints(src, dst).map((p) => api.coord([p.x, p.y]));
      const children = [{ type: 'polyline', shape: { points: pts }, style: { stroke: '#8ab8e6', lineWidth: 1.6, fill: null } }];
      const head = arrowHead(pts[pts.length - 2], pts[pts.length - 1]);
      children.push({ type: 'polygon', shape: { points: head }, style: { fill: '#8ab8e6' } });
      if (e.label) {
        const mid = pts[Math.floor((pts.length - 1) / 2)];
        const next = pts[Math.floor((pts.length - 1) / 2) + 1] || pts[pts.length - 1];
        children.push({
          type: 'text',
          style: {
            text: e.label, x: (mid[0] + next[0]) / 2, y: (mid[1] + next[1]) / 2 - 8,
            fill: th.text, fontSize: 11, align: 'center', verticalAlign: 'bottom',
          },
        });
      }
      return { type: 'group', children };
    },
  };

  const nodeSeries = {
    type: 'custom',
    name: 'flow-nodes',
    z: 2,
    data: nodes.map((n) => ({ value: [n.x, n.y] })),
    renderItem: (params, api) => {
      const n = nodes[params.dataIndex];
      const p = api.coord([n.x, n.y]);
      const w = Math.abs(api.coord([n.x + n.w / 2, n.y])[0] - api.coord([n.x - n.w / 2, n.y])[0]);
      const h = Math.abs(api.coord([n.x, n.y + n.h / 2])[1] - api.coord([n.x, n.y - n.h / 2])[1]);
      return {
        type: 'group',
        children: [
          { type: 'rect', shape: { x: p[0] - w / 2, y: p[1] - h / 2, width: w, height: h, r: 8 }, style: { fill: n.fill, stroke: n.stroke, lineWidth: 2 } },
          { type: 'text', style: { text: n.label, x: p[0], y: p[1], fill: n.color, fontSize: 12, fontWeight: 600, fontFamily: 'sans-serif', align: 'center', verticalAlign: 'middle', width: w - 16, overflow: 'truncate' } },
        ],
      };
    },
  };

  return {
    backgroundColor: 'transparent',
    textStyle: { color: th.text },
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        if (p.seriesName === 'flow-edges') {
          const e = spec.edges[p.dataIndex];
          return e ? (e.label || `${e.source} → ${e.target}`) : '';
        }
        const n = nodes[p.dataIndex];
        return n ? n.label : '';
      },
    },
    grid: { left: 12, right: 12, top: 12, bottom: 12, containLabel: false },
    xAxis: { type: 'value', show: false, min: minX, max: maxX },
    yAxis: { type: 'value', show: false, inverse: true, min: minY, max: maxY },
    series: groups.length ? [groupSeries, edgeSeries, nodeSeries] : [edgeSeries, nodeSeries],
  };
}
