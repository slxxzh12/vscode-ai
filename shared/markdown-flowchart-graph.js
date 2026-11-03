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
  const direction = spec.direction || 'TD';
  const byId = new Map((spec.nodes || []).map((n) => [n.id, n]));
  let maxX = 0;
  let maxY = 0;
  for (const n of spec.nodes || []) {
    maxX = Math.max(maxX, n.x + n.w / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  }
  for (const g of spec.groups || []) {
    maxX = Math.max(maxX, g.x + g.width);
    maxY = Math.max(maxY, g.y + g.height);
  }

  const LANE_BASE = 32;
  const LANE_GAP = 20;
  let bottomLanes = 0;
  let rightLanes = 0;

  // 回边（环形连线）绕到图外走一条独立通道，避免从节点/方框中间穿过去。
  function backEdgeVertices(e) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) return [];
    if (direction === 'LR' || direction === 'RL') {
      const back = direction === 'LR' ? t.x < s.x : t.x > s.x;
      if (!back) return [];
      const y = maxY + LANE_BASE + bottomLanes * LANE_GAP;
      bottomLanes += 1;
      return [{ x: s.x, y }, { x: t.x, y }];
    }
    const back = direction === 'TD' ? t.y < s.y : t.y > s.y;
    if (!back) return [];
    const x = maxX + LANE_BASE + rightLanes * LANE_GAP;
    rightLanes += 1;
    return [{ x, y: s.y }, { x, y: t.y }];
  }

  const edges = spec.edges.map((e, i) => {
    const vertices = backEdgeVertices(e);
    const edge = {
      id: `e${i}`,
      source: { cell: e.source, connectionPoint: { name: 'boundary' } },
      target: { cell: e.target, connectionPoint: { name: 'boundary' } },
      router: { name: 'manhattan', args: { padding: 12 } },
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
    };
    if (vertices.length) edge.vertices = vertices;
    return edge;
  });

  const bottomExtra = bottomLanes ? LANE_BASE + (bottomLanes - 1) * LANE_GAP : 0;
  const rightExtra = rightLanes ? LANE_BASE + (rightLanes - 1) * LANE_GAP : 0;
  return {
    nodes: groups.concat(nodes),
    edges,
    width: Math.max(240, Number(spec.width) || 240) + rightExtra,
    height: Math.max(160, Number(spec.height) || 160) + bottomExtra,
  };
}
