// 流程图只读渲染（X6）。由调用方按需加载，避免首屏引入 X6。
import { Graph } from '@antv/x6';
import { buildFlowGraphModel } from './markdown-flowchart-graph.js';

const MIN_HEIGHT = 240;
const MAX_HEIGHT = 1600;
const FIT_PADDING = 16;
const MIN_READABLE_SCALE = 0.8;

export function renderFlowchartX6(el, spec, options = {}) {
  const model = buildFlowGraphModel(spec, options.theme || {});
  const height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, model.height));
  el.style.height = `${height}px`;
  // 表格单元格会按内容收缩：图表放进单元格时给一个不小于模型宽度的下限，
  // 否则 X6 画布被单元格裁掉，流程图只显示一部分（表格本身可横向滚动）。
  if (typeof el.closest === 'function' && el.closest('td, th')) {
    const need = Math.max(240, Math.ceil(model.width));
    if (!el.style.minWidth) el.style.minWidth = `${need}px`;
  }
  const graph = new Graph({
    container: el,
    width: el.clientWidth || model.width,
    height: el.clientHeight || height,
    background: { color: 'transparent' },
    panning: { enabled: true },
    mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'], minScale: 0.3, maxScale: 2.5 },
    grid: { visible: false },
    interacting: false,
  });
  graph.fromJSON({ nodes: model.nodes, edges: model.edges });
  const fit = () => graph.zoomToFit({
    padding: FIT_PADDING,
    maxScale: 1,
    minScale: MIN_READABLE_SCALE,
  });
  fit();
  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => {
      graph.resize(el.clientWidth || model.width, el.clientHeight || height);
      fit();
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
