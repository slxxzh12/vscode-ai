// 流程图只读渲染（X6）。由调用方按需加载，避免首屏引入 X6。
import { Graph } from '@antv/x6';
import { buildFlowGraphModel } from './markdown-flowchart-graph.js';

export function renderFlowchartX6(el, spec, options = {}) {
  const model = buildFlowGraphModel(spec, options.theme || {});
  el.style.height = `${Math.max(240, Math.min(760, model.height))}px`;
  const graph = new Graph({
    container: el,
    width: el.clientWidth || model.width,
    height: el.clientHeight || Math.max(240, Math.min(760, model.height)),
    background: { color: 'transparent' },
    panning: { enabled: true },
    mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'], minScale: 0.3, maxScale: 2.5 },
    grid: { visible: false },
    interacting: false,
  });
  graph.fromJSON({ nodes: model.nodes, edges: model.edges });
  graph.zoomToFit({ padding: 16, maxScale: 1 });
  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => {
      graph.resize(el.clientWidth || model.width, el.clientHeight || 240);
    })
    : null;
  if (ro) ro.observe(el);
  return {
    dispose() {
      if (ro) ro.disconnect();
      graph.dispose();
    },
  };
}
