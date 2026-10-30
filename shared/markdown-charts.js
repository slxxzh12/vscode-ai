// Mermaid xychart-beta / pie 的解析与 ECharts 渲染（Web 预览与静态站点共用同一份实现）

function unquote(text) {
  const s = String(text || '').trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseNumberList(text) {
  const m = String(text || '').match(/\[([^\]]*)\]/);
  if (!m) return null;
  const parts = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const out = parts.map(Number);
  if (!out.length || out.some((n) => !Number.isFinite(n))) return null;
  return out;
}

function parseCategories(text) {
  const m = String(text || '').match(/\[([^\]]*)\]/);
  if (!m) return null;
  const items = m[1]
    .split(',')
    .map((s) => unquote(s))
    .filter((s) => s.length > 0);
  if (!items.length) return null;
  const label = text.match(/^\s*"([^"]*)"/) || text.match(/^\s*'([^']*)'/);
  return { label: label ? label[1] : '', items };
}

function parseXyChart(lines) {
  let title = '';
  let xTitle = '';
  let yTitle = '';
  let yMin;
  let yMax;
  let categories = null;
  const series = [];

  for (const line of lines.slice(1)) {
    const low = line.toLowerCase();
    if (low.startsWith('title')) {
      title = unquote(line.slice(5));
      continue;
    }
    if (low.startsWith('x-axis')) {
      const parsed = parseCategories(line.slice(6));
      if (parsed) {
        xTitle = parsed.label;
        categories = parsed.items;
      }
      continue;
    }
    if (low.startsWith('y-axis')) {
      const rest = line.slice(6);
      const label = rest.match(/^\s*"([^"]*)"/) || rest.match(/^\s*'([^']*)'/);
      yTitle = label ? label[1] : '';
      const range = rest.match(/(-?\d+(?:\.\d+)?)\s*-->\s*(-?\d+(?:\.\d+)?)/);
      if (range) {
        yMin = Number(range[1]);
        yMax = Number(range[2]);
      }
      continue;
    }
    if (low.startsWith('line ') || low.startsWith('bar ')) {
      const type = low.startsWith('line') ? 'line' : 'bar';
      const rest = line.slice(line.indexOf(' '));
      const label = rest.match(/^\s*"([^"]*)"/) || rest.match(/^\s*'([^']*)'/);
      const data = parseNumberList(rest);
      if (data) series.push(label ? { type, name: label[1], data } : { type, data });
    }
  }

  if (!categories || !series.length) return null;
  if (series.some((s) => s.data.length !== categories.length)) return null;
  return { kind: 'xychart', title, xTitle, categories, yTitle, yMin, yMax, series };
}

function parsePie(lines) {
  let title = '';
  const titleMatch = lines[0].match(/\btitle\s+(.+)$/i);
  if (titleMatch) title = unquote(titleMatch[1]);
  const data = [];
  for (const line of lines.slice(1)) {
    const m = line.match(/^["']?([^"':]+)["']?\s*:\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) data.push({ name: m[1].trim(), value: Number(m[2]) });
  }
  if (!data.length) return null;
  return { kind: 'pie', title, data };
}

// ---------- gantt ----------
const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i;
const DURATION_MS = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };

function parseDurationMs(text) {
  const m = DURATION_RE.exec(String(text || '').trim());
  if (!m) return null;
  return Number(m[1]) * DURATION_MS[m[2].toLowerCase()];
}

function parseGanttDate(text) {
  const s = String(text || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function parseGantt(lines) {
  let title = '';
  let section = '';
  const tasks = [];
  const byId = new Map();
  let lastEnd = null;
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^title\b/i.test(line)) { title = unquote(line.replace(/^title\s*/i, '')); continue; }
    if (/^section\b/i.test(line)) { section = line.replace(/^section\s*/i, '').trim(); continue; }
    if (/^(dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker|weekday)\b/i.test(line)) continue;
    const ci = line.indexOf(':');
    if (ci < 0) continue;
    const name = line.slice(0, ci).trim();
    if (!name) continue;
    const meta = line.slice(ci + 1).trim();
    let tag = '';
    let id = '';
    let dep = null;
    let startMs = null;
    let endMs = null;
    let durMs = null;
    let hasStart = false;
    for (const tok of meta.split(',').map((s) => s.trim()).filter(Boolean)) {
      const low = tok.toLowerCase();
      if (['done', 'active', 'crit', 'milestone'].includes(low)) { tag = low; continue; }
      const after = /^after\s+([A-Za-z0-9_-]+)$/i.exec(tok);
      if (after) { dep = after[1]; continue; }
      const dur = parseDurationMs(tok);
      if (dur !== null) { durMs = dur; continue; }
      const date = parseGanttDate(tok);
      if (date !== null) {
        if (!hasStart) { startMs = date; hasStart = true; }
        else endMs = date;
        continue;
      }
      if (!id) id = tok;
    }
    let start;
    if (dep) start = byId.get(dep)?.end ?? null;
    else if (startMs !== null) start = startMs;
    else start = lastEnd;
    if (start === null || start === undefined) return null;
    let end;
    if (tag === 'milestone') end = start;
    else if (endMs !== null) end = endMs;
    else if (durMs !== null) end = start + durMs;
    else return null;
    if (end < start) return null;
    const task = { name, section, tag, start, end };
    tasks.push(task);
    if (id) byId.set(id, task);
    lastEnd = end;
  }
  if (!tasks.length) return null;
  return { kind: 'gantt', title, tasks, height: Math.max(180, tasks.length * 36 + 90) };
}

// ---------- timeline ----------
function parseTimeline(lines) {
  let title = '';
  let section = '';
  const periods = [];
  let last = null;
  let sectionPeriod = null;
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^title\b/i.test(line)) { title = unquote(line.replace(/^title\s*/i, '')); continue; }
    if (/^section\b/i.test(line)) {
      section = line.replace(/^section\s*/i, '').trim();
      last = null;
      sectionPeriod = null;
      continue;
    }
    const ci = line.indexOf(':');
    if (ci >= 0) {
      const left = line.slice(0, ci).trim();
      const events = line.slice(ci + 1).split(':').map((s) => s.trim()).filter(Boolean);
      if (!left) {
        if (last) last.events.push(...events);
        else {
          if (!sectionPeriod) { sectionPeriod = { period: section || '', section, events: [] }; periods.push(sectionPeriod); }
          sectionPeriod.events.push(...events);
          last = sectionPeriod;
        }
        continue;
      }
      const existing = periods.find((p) => p.period === left && p.section === section);
      if (existing) { existing.events.push(...events); last = existing; }
      else { const p = { period: left, section, events }; periods.push(p); last = p; }
      sectionPeriod = null;
      continue;
    }
    if (!sectionPeriod) { sectionPeriod = { period: section || '', section, events: [] }; periods.push(sectionPeriod); }
    sectionPeriod.events.push(line);
    last = sectionPeriod;
  }
  const out = periods.filter((p) => p.period || p.events.length);
  if (!out.length) return null;
  const maxEvents = Math.max(...out.map((p) => p.events.length));
  return { kind: 'timeline', title, periods: out, height: Math.max(210, 130 + maxEvents * 22) };
}

// ---------- 线性阶段流程图（A --> B --> C） ----------
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
    edges.push({ from: nodes[nodes.length - 1].id, to: next.id, label: edge.label });
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

function parseFlowchart(lines) {
  const dirRaw = (lines[0].trim().split(/\s+/)[1] || 'TD').toUpperCase();
  const direction = { LR: 'LR', RL: 'RL', TD: 'TD', TB: 'TD', BT: 'BT' }[dirRaw];
  if (!direction) return null;
  const nodes = new Map();
  const edges = [];
  const classDefs = new Map();
  const classAssign = new Map();
  for (const raw of lines.slice(1)) {
    let line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    line = line.replace(/;+\s*$/, '').trim();
    if (!line) continue;
    if (/^classDef\b/.test(line)) {
      const m = /^classDef\s+([A-Za-z0-9_-]+)\s+(.+)$/.exec(line);
      if (!m) return null;
      const styles = {};
      for (const part of m[2].split(',')) {
        const ci = part.indexOf(':');
        if (ci < 0) continue;
        const k = part.slice(0, ci).trim().toLowerCase();
        const v = part.slice(ci + 1).trim();
        if (k && v) styles[k] = v;
      }
      classDefs.set(m[1], styles);
      continue;
    }
    if (/^class\b/.test(line)) {
      const m = /^class\s+([A-Za-z0-9_,\s-]+?)\s+([A-Za-z0-9_-]+)$/.exec(line);
      if (!m) return null;
      for (const id of m[1].split(',').map((s) => s.trim()).filter(Boolean)) classAssign.set(id, m[2]);
      continue;
    }
    if (/^(style|linkStyle|click|subgraph)\b/.test(line)) return null;
    if (/^(end|direction|accTitle|accDescr)\b/.test(line)) continue;
    if (line.includes('&')) return null;
    const parsed = parseFlowLine(line);
    if (!parsed) return null;
    for (const n of parsed.nodes) {
      const ex = nodes.get(n.id);
      if (ex) {
        if (n.label && n.label !== n.id) ex.label = n.label;
        if (n.cls) ex.cls = n.cls;
      } else nodes.set(n.id, { ...n });
    }
    edges.push(...parsed.edges);
  }
  if (!nodes.size) return null;

  const outDeg = new Map();
  const inDeg = new Map();
  for (const e of edges) {
    outDeg.set(e.from, (outDeg.get(e.from) || 0) + 1);
    inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
    if (outDeg.get(e.from) > 1 || inDeg.get(e.to) > 1) return null;
  }
  const ids = [...nodes.keys()];
  let order;
  if (ids.length === 1) order = ids.slice();
  else {
    if (edges.length !== ids.length - 1) return null;
    const starts = ids.filter((id) => !inDeg.has(id));
    if (starts.length !== 1) return null;
    order = [];
    const seen = new Set();
    let cur = starts[0];
    while (cur) {
      if (seen.has(cur)) return null;
      seen.add(cur);
      order.push(cur);
      const e = edges.find((x) => x.from === cur);
      cur = e ? e.to : null;
    }
    if (order.length !== ids.length) return null;
  }

  const step = direction === 'LR' || direction === 'RL' ? 190 : 90;
  const outNodes = order.map((id, i) => {
    const n = nodes.get(id);
    const styles = classDefs.get(n.cls || classAssign.get(id)) || {};
    const fill = styles.fill || SERIES_COLORS[i % SERIES_COLORS.length];
    const stroke = styles.stroke || fill;
    const color = styles.color || contrastText(fill);
    const k = direction === 'RL' ? -i : i;
    return {
      id: n.id,
      label: n.label || n.id,
      fill,
      stroke,
      color,
      x: direction === 'LR' || direction === 'RL' ? k * step : 0,
      y: direction === 'LR' || direction === 'RL' ? 0 : i * step,
    };
  });
  return {
    kind: 'flowchart',
    direction,
    nodes: outNodes,
    edges: edges.map((e) => ({ source: e.from, target: e.to, label: e.label })),
    height: direction === 'LR' || direction === 'RL' ? 190 : Math.max(160, order.length * 90 + 40),
  };
}

function isChevron(head) {
  return /\bchevron\b/i.test(head);
}

function ganttChevron(spec) {
  const day = 86400000;
  return spec.tasks.map((t, i) => {
    const days = (t.end - t.start) / day;
    const tagColor = t.tag === 'milestone' ? '#ec4899'
      : t.tag === 'crit' ? '#e5484d'
        : t.tag === 'active' ? '#f5a524'
          : t.tag === 'done' ? '#2ea043'
            : SERIES_COLORS[i % SERIES_COLORS.length];
    return {
      label: t.name,
      sub: `${fmtDay(t.start)} → ${fmtDay(t.end)}`,
      weight: Math.max(days, t.tag === 'milestone' ? 2.5 : 1.5),
      color: tagColor,
    };
  });
}

function timelineChevron(spec) {
  return spec.periods.map((p, i) => ({
    label: p.period || p.section || '',
    sub: p.events.join(' · '),
    weight: 1,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
  }));
}

export function parseMermaidChart(code) {
  const lines = String(code || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const head = lines[0].toLowerCase();
  if (head.startsWith('pie')) return parsePie(lines);
  if (head.startsWith('xychart-beta')) return parseXyChart(lines);
  if (head.startsWith('gantt')) {
    const spec = parseGantt(lines);
    if (!spec) return null;
    if (!isChevron(head)) return spec;
    return { kind: 'chevron', title: spec.title, segments: ganttChevron(spec), height: 150 };
  }
  if (head.startsWith('timeline')) {
    const spec = parseTimeline(lines);
    if (!spec) return null;
    if (!isChevron(head)) return spec;
    return { kind: 'chevron', title: spec.title, segments: timelineChevron(spec), height: 150 };
  }
  if (/^(flowchart|graph)\b/.test(head)) return parseFlowchart(lines);
  return null;
}

function chartTheme(dark) {
  return dark
    ? { text: '#d5dae1', axis: '#3a4250', split: '#242b36' }
    : { text: '#1f2937', axis: '#d7dce3', split: '#eef1f5' };
}

// 多系列（尤其柱状图对比）使用高对比度色板，避免默认配色相邻颜色过于接近
export const SERIES_COLORS = [
  '#2f6feb', // 蓝
  '#e5484d', // 红
  '#2ea043', // 绿
  '#f5a524', // 橙
  '#8b5cf6', // 紫
  '#06b6d4', // 青
  '#ec4899', // 粉
  '#84cc16', // 黄绿
  '#f97316', // 深橙
  '#14b8a6', // 蓝绿
];

function chartBase(spec, th) {
  return {
    backgroundColor: 'transparent',
    color: SERIES_COLORS,
    textStyle: { color: th.text },
    title: spec.title
      ? { text: spec.title, left: 'center', textStyle: { color: th.text, fontSize: 14 } }
      : undefined,
  };
}

function fmtDay(ms) {
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function ganttOption(spec, th) {
  const tasks = spec.tasks;
  const colorOf = (t, i) => {
    if (t.tag === 'milestone') return '#8b5cf6';
    if (t.tag === 'crit') return '#e5484d';
    if (t.tag === 'active') return '#f5a524';
    if (t.tag === 'done') return '#2ea043';
    return SERIES_COLORS[i % SERIES_COLORS.length];
  };
  return {
    ...chartBase(spec, th),
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const t = tasks[p.dataIndex];
        return t ? `${t.name}<br/>${fmtDay(t.start)} → ${fmtDay(t.end)}` : '';
      },
    },
    grid: { left: 12, right: 24, top: spec.title ? 58 : 26, bottom: 16, containLabel: true },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: th.axis } },
      axisLabel: { color: th.text, hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'category',
      data: tasks.map((t) => t.name),
      inverse: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: th.text, width: 150, overflow: 'truncate' },
      splitLine: { lineStyle: { color: th.split } },
    },
    series: [{
      type: 'custom',
      encode: { x: [1, 2], y: 0 },
      data: tasks.map((t, i) => ({ value: [i, t.start, t.end], name: t.name, itemStyle: { color: colorOf(t, i) } })),
      renderItem: (params, api) => {
        const row = api.value(0);
        const start = api.coord([api.value(1), row]);
        const end = api.coord([api.value(2), row]);
        const band = api.size([0, 1])[1];
        const h = Math.max(10, band * 0.52);
        if (Math.abs(end[0] - start[0]) < 1.5) {
          const s = Math.max(6, h * 0.36);
          return {
            type: 'polygon',
            shape: { points: [[start[0], start[1] - s], [start[0] + s, start[1]], [start[0], start[1] + s], [start[0] - s, start[1]]] },
            style: api.style(),
          };
        }
        const x = Math.min(start[0], end[0]);
        const w = Math.max(2, Math.abs(end[0] - start[0]));
        return { type: 'rect', shape: { x, y: start[1] - h / 2, width: w, height: h, r: Math.min(5, h / 2) }, style: api.style() };
      },
    }],
  };
}

function timelineOption(spec, th, dark) {
  const periods = spec.periods;
  return {
    ...chartBase(spec, th),
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const it = periods[p.dataIndex];
        if (!it) return '';
        return [it.period || it.section, ...it.events].filter(Boolean).join('<br/>');
      },
    },
    grid: { left: 24, right: 24, top: spec.title ? 78 : 58, bottom: 54, containLabel: true },
    xAxis: {
      type: 'category',
      data: periods.map((p) => p.period || p.section || ''),
      axisLine: { lineStyle: { color: th.axis } },
      axisTick: { show: false },
      axisLabel: { color: th.text, interval: 0, fontSize: 12, rotate: periods.length > 6 ? 30 : 0 },
    },
    yAxis: { type: 'value', min: 0, max: 1, show: false },
    series: [{
      type: 'line',
      symbol: 'circle',
      symbolSize: 14,
      lineStyle: { width: 3, color: th.axis },
      data: periods.map((p, i) => ({
        value: 0.35,
        itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] },
        label: { show: p.events.length > 0 },
      })),
      label: {
        show: true,
        position: 'top',
        distance: 14,
        color: th.text,
        fontSize: 12,
        lineHeight: 18,
        backgroundColor: dark ? '#1a2230' : '#f6f8fc',
        borderColor: th.axis,
        borderWidth: 1,
        borderRadius: 8,
        padding: [7, 10],
        width: 160,
        overflow: 'break',
        formatter: (p) => {
          const it = periods[p.dataIndex];
          return it ? it.events.join('\n') : '';
        },
      },
    }],
  };
}

function flowchartOption(spec, th) {
  const nodes = spec.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const vertical = spec.direction === 'TD' || spec.direction === 'BT';
  const W = 140;
  const H = 44;
  const HW = W / 2;
  const HH = H / 2;
  return {
    ...chartBase({ title: '' }, th),
    grid: { left: 20, right: 20, top: 20, bottom: 20, containLabel: false },
    xAxis: {
      type: 'value',
      show: false,
      min: vertical ? -W : Math.min(...xs) - 110,
      max: vertical ? W : Math.max(...xs) + 110,
    },
    yAxis: {
      type: 'value',
      show: false,
      inverse: spec.direction === 'TD',
      min: vertical ? Math.min(...ys) - HH - 30 : -HH - 30,
      max: vertical ? Math.max(...ys) + HH + 30 : HH + 30,
    },
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        if (p.seriesIndex === 0) {
          const e = spec.edges[p.dataIndex];
          return e ? (e.label || `${e.source} → ${e.target}`) : '';
        }
        const n = nodes[p.dataIndex];
        return n ? n.label : '';
      },
    },
    series: [
      {
        type: 'custom',
        z: 1,
        data: spec.edges.map((e) => ({ value: [0, 0] })),
        renderItem: (params, api) => {
          const e = spec.edges[params.dataIndex];
          const a = byId.get(e.source);
          const b = byId.get(e.target);
          if (!a || !b) return null;
          const p1 = api.coord([a.x, a.y]);
          const p2 = api.coord([b.x, b.y]);
          const dx = p2[0] - p1[0];
          const dy = p2[1] - p1[1];
          const horizontal = Math.abs(dx) >= Math.abs(dy);
          const sx = horizontal ? Math.sign(dx) * HW : 0;
          const sy = horizontal ? 0 : Math.sign(dy) * HH;
          const x1 = p1[0] + sx;
          const y1 = p1[1] + sy;
          const x2 = p2[0] - sx;
          const y2 = p2[1] - sy;
          const len = Math.hypot(x2 - x1, y2 - y1) || 1;
          const ux = (x2 - x1) / len;
          const uy = (y2 - y1) / len;
          const bx = x2 - ux * 8;
          const by = y2 - uy * 8;
          const children = [
            { type: 'line', shape: { x1, y1, x2: bx, y2: by }, style: { stroke: th.axis, lineWidth: 2 } },
            { type: 'polygon', shape: { points: [[x2, y2], [bx - uy * 4, by + ux * 4], [bx + uy * 4, by - ux * 4]] }, style: { fill: th.axis } },
          ];
          if (e.label) {
            children.push({
              type: 'text',
              style: {
                text: e.label,
                x: (x1 + x2) / 2,
                y: (y1 + y2) / 2 - 9,
                fill: th.text,
                fontSize: 11,
                align: 'center',
                verticalAlign: 'bottom',
              },
            });
          }
          return { type: 'group', children };
        },
      },
      {
        type: 'custom',
        z: 2,
        data: nodes.map((n) => ({ kind: 'node', node: n, value: [n.x, n.y] })),
        renderItem: (params, api) => {
          const n = nodes[params.dataIndex];
          const p = api.coord([n.x, n.y]);
          return {
            type: 'group',
            children: [
              {
                type: 'rect',
                shape: { x: p[0] - HW, y: p[1] - HH, width: W, height: H, r: 8 },
                style: { fill: n.fill, stroke: n.stroke, lineWidth: 2 },
              },
              {
                type: 'text',
                style: {
                  text: n.label,
                  x: p[0],
                  y: p[1],
                  fill: n.color,
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: 'sans-serif',
                  align: 'center',
                  verticalAlign: 'middle',
                  width: W - 16,
                  overflow: 'truncate',
                },
              },
            ],
          };
        },
      },
    ],
  };
}

function chevronOption(spec, th, dark) {
  const segs = spec.segments || [];
  const weights = segs.map((s) => Math.max(Number(s.weight) || 1, 0.0001));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const ranges = [];
  let acc = 0;
  for (const w of weights) { ranges.push([acc, acc + w]); acc += w; }
  return {
    ...chartBase(spec, th),
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const s = segs[p.dataIndex];
        return s ? `${s.label}${s.sub ? `<br/>${s.sub}` : ''}` : '';
      },
    },
    grid: { left: 16, right: 16, top: spec.title ? 52 : 24, bottom: 16 },
    xAxis: { type: 'value', min: 0, max: total, show: false },
    yAxis: { type: 'value', min: 0, max: 1, show: false },
    series: [{
      type: 'custom',
      data: segs.map((s, i) => ({ value: ranges[i] })),
      renderItem: (params, api) => {
        const i = params.dataIndex;
        const s = segs[i];
        if (!s) return null;
        const [a, b] = ranges[i];
        const x0 = api.coord([a, 0])[0];
        const x1 = api.coord([b, 0])[0];
        const top = api.coord([0, 0.82])[1];
        const bottom = api.coord([0, 0.18])[1];
        const mid = (top + bottom) / 2;
        const w = Math.max(2, x1 - x0);
        const tip = Math.min(16, w * 0.3);
        const left = i === 0 ? x0 : x0 + tip;
        const right = x1 - tip;
        const points = [[x0, top], [right, top], [x1, mid], [right, bottom], [x0, bottom]];
        if (i > 0) points.push([x0 + tip, mid]);
        const color = s.color || SERIES_COLORS[i % SERIES_COLORS.length];
        const textColor = contrastText(color);
        const cx = (left + right) / 2;
        const textWidth = Math.max(12, w - tip * 1.8);
        const showSub = !!s.sub && w > 110;
        const children = [
          {
            type: 'polygon',
            shape: { points },
            style: { fill: color, stroke: dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.10)', lineWidth: 1 },
          },
          {
            type: 'text',
            style: {
              text: s.label,
              x: cx,
              y: showSub ? mid - 9 : mid,
              fill: textColor,
              fontSize: 12,
              fontWeight: 600,
              align: 'center',
              verticalAlign: 'middle',
              width: textWidth,
              overflow: 'break',
            },
          },
        ];
        if (showSub) {
          children.push({
            type: 'text',
            style: {
              text: s.sub,
              x: cx,
              y: mid + 10,
              fill: textColor,
              fontSize: 10,
              opacity: 0.85,
              align: 'center',
              verticalAlign: 'middle',
              width: textWidth,
              overflow: 'truncate',
            },
          });
        }
        return { type: 'group', children };
      },
    }],
  };
}

export async function renderChart(el, spec, echarts, options = {}) {
  const dark = options.dark === undefined
    ? document.documentElement.dataset.theme !== 'light'
    : Boolean(options.dark);
  const th = chartTheme(dark);
  if (spec.height) el.style.height = `${spec.height}px`;
  const chart = echarts.init(el);
  const base = chartBase(spec, th);

  if (spec.kind === 'xychart') {
    const multiple = spec.series.length > 1;
    chart.setOption({
      ...base,
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend: multiple ? { bottom: 0, type: 'scroll', textStyle: { color: th.text } } : undefined,
      grid: {
        left: 12,
        right: 18,
        top: spec.title ? 42 : 16,
        bottom: multiple ? 42 : 12,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: spec.categories,
        name: spec.xTitle,
        nameLocation: 'middle',
        nameGap: 26,
        axisLine: { lineStyle: { color: th.axis } },
        axisLabel: { color: th.text },
        splitLine: { lineStyle: { color: th.split } },
      },
      yAxis: {
        type: 'value',
        name: spec.yTitle,
        min: spec.yMin,
        max: spec.yMax,
        axisLine: { lineStyle: { color: th.axis } },
        axisLabel: { color: th.text },
        splitLine: { lineStyle: { color: th.split } },
      },
      series: spec.series.map((s, i) => ({
        name: s.name || `${s.type} ${i + 1}`,
        type: s.type,
        data: s.data,
        smooth: s.type === 'line',
        symbol: 'circle',
        symbolSize: 5,
        showSymbol: s.type === 'line' && spec.series.filter((x) => x.type === 'line').length <= 2,
        barMaxWidth: 26,
        emphasis: { focus: 'series' },
      })),
    });
  } else if (spec.kind === 'pie') {
    chart.setOption({
      ...base,
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, textStyle: { color: th.text } },
      series: [
        {
          type: 'pie',
          radius: ['38%', '65%'],
          center: ['50%', '46%'],
          data: spec.data,
          label: { color: th.text, formatter: '{b}: {c} ({d}%)' },
        },
      ],
    });
  } else if (spec.kind === 'gantt') {
    chart.setOption(ganttOption(spec, th));
  } else if (spec.kind === 'timeline') {
    chart.setOption(timelineOption(spec, th, dark));
  } else if (spec.kind === 'flowchart') {
    chart.setOption(flowchartOption(spec, th));
  } else if (spec.kind === 'chevron') {
    chart.setOption(chevronOption(spec, th, dark));
  }

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
  }
  return {
    dispose() {
      if (ro) ro.disconnect();
      chart.dispose();
    },
  };
}

// 把容器里所有 xychart-beta / pie 的 pre.mermaid 换成 ECharts 容器
export async function enhanceCharts(container, echarts, options = {}) {
  const items = [];
  if (!echarts) return items;
  for (const pre of Array.from(container.querySelectorAll('pre.mermaid'))) {
    const spec = parseMermaidChart(pre.textContent || '');
    if (!spec) continue;
    const host = document.createElement('div');
    host.className = 'md-echart';
    pre.before(host);
    try {
      const chart = await renderChart(host, spec, echarts, options);
      pre.remove();
      items.push({ host, ...chart });
    } catch {
      host.remove();
      try { pre.dataset.processed = 'error'; } catch { /* ignore */ }
    }
  }
  return items;
}
