// 全屏 X6 流程图编辑器：框架无关，Web 与静态页共用。
import { Graph, Shape } from '@antv/x6';
import dagre from '@dagrejs/dagre';
import { parseFlowchartModel, serializeFlowchartModel } from './markdown-flowchart-model.js';

const DEFAULT_LABELS = {
  title: 'Flowchart editor',
  save: 'Save',
  cancel: 'Cancel',
  addNode: 'Add node',
  addEdge: 'Add edge',
  addGroup: 'Add group',
  del: 'Delete',
  layout: 'Auto layout',
  reconnectSource: 'Reconnect source',
  reconnectTarget: 'Reconnect target',
};

const STYLE = `
.df-flowedit{position:fixed;inset:0;z-index:2147483647;background:var(--bg1,#181d24);color:var(--tx,#d5dae1);display:flex;flex-direction:column;font:13px/1.5 system-ui,sans-serif}
.df-flowedit-head{flex:none;display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--bd,#2a323e);background:var(--bg4,#222932)}
.df-flowedit-title{font-weight:600;margin-right:auto}
.df-flowedit button{background:var(--bg5,#262c34);color:var(--tx,#d5dae1);border:1px solid var(--bd,#2a323e);border-radius:6px;padding:5px 12px;cursor:pointer}
.df-flowedit button:hover{border-color:var(--ac2,#4c9aff);color:var(--ac2,#4c9aff)}
.df-flowedit button.on{background:var(--ac,#2f6feb);border-color:var(--ac,#2f6feb);color:#fff}
.df-flowedit-canvas{flex:1;min-height:0;position:relative}
.df-flowedit-hint{padding:6px 12px;color:var(--tx3,#9aa4b2);border-top:1px solid var(--bd,#2a323e)}
`;

function nodeAttrs(label, dark) {
  return {
    body: {
      fill: dark ? '#1a2230' : '#e6f3ff',
      stroke: dark ? '#4c9aff' : '#8ab8e6',
      strokeWidth: 1.5,
      rx: 8,
      ry: 8,
    },
    label: { text: label, fill: dark ? '#d5dae1' : '#1f2937', fontSize: 12 },
  };
}

function groupAttrs(label) {
  return {
    body: { fill: 'transparent', stroke: '#4c9aff', strokeDasharray: '4 3', rx: 10, ry: 10 },
    label: { text: label, fill: '#9aa4b2', fontSize: 11, refY: 12 },
  };
}

function isDark() {
  return typeof document === 'undefined' || document.documentElement.dataset.theme !== 'light';
}

export function openFlowchartEditor(options = {}) {
  if (typeof document === 'undefined') return null;
  const model = parseFlowchartModel(options.code || '');
  if (!model) return null;
  const labels = { ...DEFAULT_LABELS, ...(options.labels || {}) };
  const dark = options.dark === undefined ? isDark() : Boolean(options.dark);

  const root = document.createElement('div');
  root.className = 'df-flowedit';
  root.innerHTML = `<style>${STYLE}</style>
    <div class="df-flowedit-head">
      <span class="df-flowedit-title">${labels.title}</span>
      <button data-act="node">${labels.addNode}</button>
      <button data-act="edge">${labels.addEdge}</button>
      <button data-act="group">${labels.addGroup}</button>
      <button data-act="del">${labels.del}</button>
      <button data-act="layout">${labels.layout}</button>
      <button data-act="rsrc">${labels.reconnectSource}</button>
      <button data-act="rtgt">${labels.reconnectTarget}</button>
      <button data-act="cancel">${labels.cancel}</button>
      <button data-act="save">${labels.save}</button>
    </div>
    <div class="df-flowedit-canvas"></div>
    <div class="df-flowedit-hint">${labels.hint || ''}</div>`;
  document.body.appendChild(root);

  const canvas = root.querySelector('.df-flowedit-canvas');
  const graph = new Graph({
    container: canvas,
    width: canvas.clientWidth || 1200,
    height: canvas.clientHeight || 720,
    background: { color: 'transparent' },
    grid: { visible: true, type: 'dot', size: 12 },
    panning: true,
    mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'], minScale: 0.2, maxScale: 2.5 },
    connecting: {
      snap: true,
      allowBlank: false,
      allowLoop: false,
      allowEdge: false,
      allowNode: true,
      router: 'manhattan',
      connector: 'rounded',
      createEdge() {
        return new Shape.Edge({
          attrs: { line: { stroke: '#4c9aff', strokeWidth: 1.5, targetMarker: { name: 'block', width: 7, height: 7 } } },
        });
      },
    },
    embedding: { enabled: true, findParent: 'bbox' },
    interacting: { edgeLabelMovable: false },
  });

  const positions = model.positions || {};
  const modelNode = new Map(model.nodes.map((n) => [n.id, n]));
  const nodes = [];
  for (const g of model.groups || []) {
    const p = positions[g.id] || {};
    nodes.push({
      id: g.id,
      shape: 'rect',
      x: p.x ?? g.x,
      y: p.y ?? g.y,
      width: p.w ?? g.width,
      height: p.h ?? g.height,
      zIndex: 0,
      label: g.label,
      attrs: groupAttrs(g.label),
      data: { isGroup: true },
    });
  }
  for (const n of model.nodes) {
    const p = positions[n.id] || {};
    const x = p.x ?? n.x - n.w / 2;
    const y = p.y ?? n.y - n.h / 2;
    nodes.push({
      id: n.id,
      shape: 'rect',
      x,
      y,
      width: n.w || 120,
      height: n.h || 44,
      zIndex: 2,
      label: n.label,
      attrs: nodeAttrs(n.label, dark),
      data: { isGroup: false },
    });
  }
  const edges = model.edges.map((e, i) => ({
    id: `e${i}`,
    source: e.source,
    target: e.target,
    router: { name: 'manhattan' },
    connector: { name: 'rounded' },
    labels: e.label ? [{ attrs: { label: { text: e.label, fill: dark ? '#d5dae1' : '#1f2937', fontSize: 11 } } }] : [],
    attrs: { line: { stroke: '#4c9aff', strokeWidth: 1.5, targetMarker: { name: 'block', width: 7, height: 7 } } },
    data: { arrow: e.arrow || '-->' },
  }));
  graph.fromJSON({ nodes, edges });
  graph.zoomToFit({ padding: 40, maxScale: 1 });

  let mode = '';
  let edgeSource = '';
  let lastSelected = null;
  let reconnect = null;

  const setMode = (next) => {
    mode = next;
    for (const b of root.querySelectorAll('[data-act]')) b.classList.toggle('on', b.dataset.act === next);
    if (next !== 'edge') edgeSource = '';
  };
  const selected = () => (lastSelected ? [lastSelected] : []);

  graph.on('blank:click', () => { lastSelected = null; });
  graph.on('cell:click', ({ cell }) => {
    lastSelected = cell;
    if (mode === 'edge' && cell.isNode() && !cell.getData()?.isGroup) {
      if (!edgeSource) {
        edgeSource = cell.id;
      } else if (edgeSource !== cell.id) {
        const id = `e${Date.now()}`;
        graph.addEdge({
          id,
          source: edgeSource,
          target: cell.id,
          router: { name: 'manhattan' },
          connector: { name: 'rounded' },
          attrs: { line: { stroke: '#4c9aff', strokeWidth: 1.5, targetMarker: { name: 'block', width: 7, height: 7 } } },
          data: { arrow: '-->' },
        });
        edgeSource = '';
      }
      return;
    }
    if (reconnect && cell.isNode() && !cell.getData()?.isGroup) {
      if (reconnect.end === 'source') reconnect.edge.setSource({ cell: cell.id });
      else reconnect.edge.setTarget({ cell: cell.id });
      reconnect = null;
      return;
    }
  });

  graph.on('cell:dblclick', ({ cell }) => {
    if (!cell.isNode() && !cell.isEdge()) return;
    const cur = cell.isEdge()
      ? (cell.getLabels()[0]?.attrs?.label?.text || '')
      : (cell.getAttrByPath('label/text') || '');
    const next = window.prompt('Label', cur);
    if (next == null) return;
    if (cell.isEdge()) {
      cell.setLabels(next ? [{ attrs: { label: { text: next, fill: dark ? '#d5dae1' : '#1f2937', fontSize: 11 } } }] : []);
    } else {
      cell.setAttrByPath('label/text', next);
    }
  });

  graph.on('node:change:position', ({ cell }) => {
    if (cell.getData()?.isGroup) return;
    const c = cell.getBBox().center;
    let parent = null;
    for (const g of graph.getNodes()) {
      if (g.id === cell.id || !g.getData()?.isGroup) continue;
      const b = g.getBBox();
      if (c.x >= b.x && c.x <= b.x + b.width && c.y >= b.y && c.y <= b.y + b.height) { parent = g; break; }
    }
    try {
      if (parent && cell.getParent() !== parent) graph.embed(parent, cell);
      else if (!parent && cell.getParent()) graph.unembed(cell);
    } catch { /* ignore */ }
  });

  const toolbar = (act) => root.querySelector(`[data-act="${act}"]`);
  toolbar('node').addEventListener('click', () => {
    const id = `n${Date.now()}`;
    graph.addNode({
      id, shape: 'rect', x: 80, y: 80, width: 140, height: 44, label: 'Node',
      attrs: nodeAttrs('Node', dark), data: { isGroup: false }, zIndex: 2,
    });
    setMode('');
  });
  toolbar('edge').addEventListener('click', () => setMode('edge'));
  toolbar('group').addEventListener('click', () => {
    const id = `g${Date.now()}`;
    graph.addNode({
      id, shape: 'rect', x: 40, y: 40, width: 320, height: 220, zIndex: 0, label: 'Group',
      attrs: groupAttrs('Group'), data: { isGroup: true },
    });
    setMode('');
  });
  toolbar('del').addEventListener('click', () => {
    for (const cell of selected()) cell.remove();
  });
  toolbar('layout').addEventListener('click', () => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: model.direction || 'TD', nodesep: 40, ranksep: 70 });
    g.setDefaultEdgeLabel(() => ({}));
    const ns = graph.getNodes().filter((c) => !c.getData()?.isGroup);
    for (const n of ns) g.setNode(n.id, { width: n.getSize().width, height: n.getSize().height });
    for (const e of graph.getEdges()) {
      const s = e.getSourceCellId();
      const t = e.getTargetCellId();
      if (s && t) g.setEdge(s, t);
    }
    dagre.layout(g);
    for (const n of ns) {
      const p = g.node(n.id);
      if (p) n.setPosition(p.x - p.width / 2, p.y - p.height / 2);
    }
  });
  toolbar('rsrc').addEventListener('click', () => {
    const e = selected().find((c) => c.isEdge());
    if (e) { reconnect = { edge: e, end: 'source' }; setMode(''); }
  });
  toolbar('rtgt').addEventListener('click', () => {
    const e = selected().find((c) => c.isEdge());
    if (e) { reconnect = { edge: e, end: 'target' }; setMode(''); }
  });

  const close = () => {
    graph.dispose();
    root.remove();
  };
  toolbar('cancel').addEventListener('click', () => { close(); if (options.onCancel) options.onCancel(); });
  toolbar('save').addEventListener('click', () => {
    const next = { ...model, nodes: [], edges: [], groups: [], positions: {}, extras: model.extras || [] };
    const groupCells = graph.getNodes().filter((c) => c.getData()?.isGroup);
    for (const g of groupCells) {
      const pos = g.getPosition();
      const size = g.getSize();
      next.groups.push({ id: g.id, label: g.getAttrByPath('label/text') || '', x: pos.x, y: pos.y, width: size.width, height: size.height });
      next.positions[g.id] = { x: pos.x, y: pos.y, w: size.width, h: size.height };
    }
    const groupIds = new Set(groupCells.map((g) => g.id));
    for (const n of graph.getNodes()) {
      if (n.getData()?.isGroup) continue;
      const pos = n.getPosition();
      const size = n.getSize();
      const orig = modelNode.get(n.id);
      const parent = n.getParent();
      next.nodes.push({
        id: n.id,
        label: n.getAttrByPath('label/text') || '',
        shapeRaw: orig ? orig.shapeRaw : '',
        group: parent && groupIds.has(parent.id) ? parent.id : '',
        x: pos.x + size.width / 2,
        y: pos.y + size.height / 2,
        w: size.width,
        h: size.height,
      });
      next.positions[n.id] = { x: pos.x, y: pos.y };
    }
    const nodeIds = new Set(next.nodes.map((n) => n.id));
    for (const e of graph.getEdges()) {
      const s = e.getSourceCellId();
      const t = e.getTargetCellId();
      if (!nodeIds.has(s) || !nodeIds.has(t)) continue;
      next.edges.push({
        source: s,
        target: t,
        label: e.getLabels()[0]?.attrs?.label?.text || '',
        arrow: e.getData()?.arrow || '-->',
      });
    }
    const code = serializeFlowchartModel(next);
    close();
    if (options.onSave) options.onSave(code);
  });

  return { close };
}
