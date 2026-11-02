// 把 parseFlowchart 的结果转成 X6 图模型；纯函数，便于单测。
export function buildFlowGraphModel(spec, theme = {}) {
  const text = theme.text || '#d5dae1';
  const axis = theme.axis || '#3a4250';
  const nodes = spec.nodes.map((n) => ({
    id: n.id,
    shape: 'rect',
    x: n.x - n.w / 2,
    y: n.y - n.h / 2,
    width: n.w,
    height: n.h,
    zIndex: 2,
    attrs: {
      body: { fill: n.fill, stroke: n.stroke, strokeWidth: 1.5, rx: 8, ry: 8 },
      label: { text: n.label, fill: n.color, fontSize: 12 },
    },
  }));
  const groups = (spec.groups || []).map((g) => ({
    id: g.id,
    shape: 'rect',
    x: g.x,
    y: g.y,
    width: g.width,
    height: g.height,
    zIndex: 0,
    attrs: {
      body: { fill: 'transparent', stroke: axis, strokeDasharray: '4 3', rx: 10, ry: 10 },
      label: { text: g.label || '', fill: text, fontSize: 11, refY: 12 },
    },
  }));
  const edges = spec.edges.map((e, i) => ({
    id: `e${i}`,
    source: e.source,
    target: e.target,
    router: { name: 'manhattan' },
    connector: { name: 'rounded' },
    zIndex: 1,
    attrs: {
      line: {
        stroke: axis,
        strokeWidth: 1.4,
        targetMarker: { name: 'block', width: 7, height: 7 },
      },
    },
    labels: e.label
      ? [{ attrs: { label: { text: e.label, fill: text, fontSize: 11 } } }]
      : [],
  }));
  return {
    nodes: groups.concat(nodes),
    edges,
    width: Math.max(240, Number(spec.width) || 240),
    height: Math.max(160, Number(spec.height) || 160),
  };
}
