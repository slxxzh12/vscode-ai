// 浏览器端 Markdown 增强（Mermaid / ECharts）：Web 预览与静态网站 Markdown 页面共用同一份实现。
import { enhanceCharts, parseMermaidChart } from './markdown-charts.js';
import { enhanceSimpleTables } from './markdown-table-sort.js';

export { enhanceCharts, parseMermaidChart, enhanceSimpleTables };
export { createPptPresenter } from './markdown-ppt.js';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ```mermaid row 标记的连续图块自动并排（外层 flex 容器）
export function groupMermaidSides(container) {
  for (const pre of Array.from(container.querySelectorAll('pre.mermaid.mermaid-side'))) {
    if (pre.closest('.mermaid-row')) continue;
    const group = [pre];
    let next = pre.nextElementSibling;
    while (next && next.matches('pre.mermaid.mermaid-side')) {
      group.push(next);
      next = next.nextElementSibling;
    }
    if (group.length < 2) continue;
    const wrap = document.createElement('div');
    wrap.className = 'mermaid-row';
    pre.before(wrap);
    for (const item of group) wrap.appendChild(item);
  }
}

export async function renderMermaidBlocks(container, mermaid, options = {}) {
  groupMermaidSides(container);
  const nodes = Array.from(container.querySelectorAll('pre.mermaid:not([data-processed="true"])'));
  if (!mermaid || !nodes.length) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: options.theme || 'dark',
  });
  let seq = 0;
  await Promise.all(nodes.map(async (pre) => {
    const code = pre.textContent || '';
    const id = `df-mm-${Date.now().toString(36)}-${seq++}`;
    try {
      const { svg } = await mermaid.render(id, code);
      const holder = document.getElementById(id);
      if (holder) holder.remove();
      pre.outerHTML = svg;
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      const text = options.errorText ? options.errorText(msg) : msg;
      pre.dataset.processed = 'error';
      pre.innerHTML = `<div class="mermaid-err">${escapeHtml(text)}</div>`;
    }
  }));
}

// Web 预览与静态网站共用的统一增强入口：分组 → 表格 → ECharts → Mermaid。
// echarts/mermaid 可由调用方直接传入，也可传 loadEcharts/loadMermaid 延迟加载。
export async function enhanceMarkdown(container, options = {}) {
  const items = [];
  groupMermaidSides(container);

  if (typeof options.enhanceTables === 'function') {
    const extra = await options.enhanceTables(container);
    if (extra && extra.length) items.push(...extra);
  }

  const hasChart = Array.from(container.querySelectorAll('pre.mermaid'))
    .some((pre) => parseMermaidChart(pre.textContent || ''));
  if (hasChart) {
    const echarts = options.echarts || (options.loadEcharts ? await options.loadEcharts() : null);
    if (echarts) items.push(...await enhanceCharts(container, echarts, { dark: options.dark }));
  }

  if (container.querySelector('pre.mermaid:not([data-processed="true"])')) {
    const mermaid = options.mermaid || (options.loadMermaid ? await options.loadMermaid() : null);
    if (mermaid) {
      await renderMermaidBlocks(container, mermaid, {
        theme: options.theme,
        errorText: options.errorText,
      });
    }
  }

  // 最后仍未处理（脚本缺失/超时/图表解析失败）的图块恢复显示原始代码，
  // 否则 CSS 的 [data-processed="false"] 隐藏规则会让它们永远不可见。
  for (const pre of Array.from(container.querySelectorAll('pre.mermaid:not([data-processed="true"])'))) {
    pre.dataset.processed = 'error';
  }
  return items;
}
