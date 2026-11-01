// 浏览器端 Markdown 增强（Mermaid / ECharts）：Web 预览与静态网站 Markdown 页面共用同一份实现。
import { enhanceCharts, parseMermaidChart } from './markdown-charts.js';
import { enhanceSimpleTables } from './markdown-table-sort.js';

export { enhanceCharts, parseMermaidChart, enhanceSimpleTables };
export { createPptPresenter } from './markdown-ppt.js';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function defaultReadAsset(rel) {
  const url = new URL(String(rel), document.baseURI).toString();
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
}

function relativePath(path) {
  const rel = String(path || '').trim();
  if (!rel || /^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.startsWith('/') || rel.startsWith('\\')) {
    throw new Error('only relative paths are allowed');
  }
  return rel;
}

function runDataScript(code, readAsset) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const safeFetch = async (path) => {
    const text = await readAsset(relativePath(path));
    return new Response(String(text), { status: 200, headers: { 'Content-Type': 'text/plain' } });
  };
  const readFile = (path) => Promise.resolve(readAsset(relativePath(path)));
  const fn = new AsyncFunction('fetch', 'readFile', code);
  return fn(safeFetch, readFile);
}

export async function enhanceDataCharts(container, options = {}) {
  const nodes = Array.from(container.querySelectorAll('pre.mermaid-data:not([data-processed="true"])'));
  if (!nodes.length) return;
  const readAsset = options.readAsset || defaultReadAsset;
  for (const pre of nodes) {
    try {
      const out = await runDataScript(pre.textContent || '', readAsset);
      if (typeof out !== 'string' || !out.trim()) throw new Error('empty mermaid source');
      const next = document.createElement('pre');
      next.className = 'mermaid';
      next.dataset.processed = 'false';
      next.textContent = out;
      pre.replaceWith(next);
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      pre.dataset.processed = 'error';
      pre.classList.remove('mermaid-data');
      pre.classList.add('mermaid-data-error');
      pre.textContent = options.dataErrorText ? options.dataErrorText(msg) : msg;
    }
  }
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

const BLUE_PIE = [
  '#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#0ea5e9', '#38bdf8',
  '#0284c7', '#0891b2', '#06b6d4', '#0f766e', '#14b8a6', '#22d3ee',
];

// 统一图表配色：偏蓝色科技风，不使用粉/紫背景
function mermaidThemeVariables(dark) {
  const pie = {};
  BLUE_PIE.forEach((c, i) => { pie[`pie${i + 1}`] = c; });
  if (dark) {
    return {
      background: '#0e1726',
      primaryColor: '#0f2a4d',
      primaryTextColor: '#e5edff',
      primaryBorderColor: '#3b82f6',
      lineColor: '#60a5fa',
      secondaryColor: '#10243d',
      tertiaryColor: '#0b1f33',
      noteBkgColor: '#10243d',
      noteTextColor: '#dbeafe',
      noteBorderColor: '#3b82f6',
      ...pie,
    };
  }
  return {
    background: '#f6f9ff',
    primaryColor: '#dbeafe',
    primaryTextColor: '#1e3a8a',
    primaryBorderColor: '#3b82f6',
    lineColor: '#2563eb',
    secondaryColor: '#eff6ff',
    tertiaryColor: '#e0f2fe',
    noteBkgColor: '#eff6ff',
    noteTextColor: '#1e3a8a',
    noteBorderColor: '#3b82f6',
    ...pie,
  };
}

// Mermaid 初始化配置：蓝色科技主题 + 紧凑布局；classDef/linkStyle 由图中定义，优先级高于主题。
export function mermaidInitOptions(theme = 'dark') {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme,
    themeVariables: mermaidThemeVariables(theme === 'dark'),
    // 横排/竖排都收紧间距，避免大片空白
    flowchart: { htmlLabels: true, curve: 'linear', nodeSpacing: 24, rankSpacing: 24, padding: 2, useMaxWidth: true },
    sequence: { useMaxWidth: true, wrap: true, diagramMarginX: 6, diagramMarginY: 6, actorMargin: 30, messageMargin: 18 },
    gantt: { useMaxWidth: true, barHeight: 18, fontSize: 12, gridLineStartPadding: 12, leftPadding: 60 },
    pie: { useMaxWidth: true, textPosition: 0.62 },
    mindmap: { useMaxWidth: true, padding: 4 },
  };
}

export async function renderMermaidBlocks(container, mermaid, options = {}) {
  groupMermaidSides(container);
  const nodes = Array.from(container.querySelectorAll('pre.mermaid:not([data-processed="true"])'));
  if (!mermaid || !nodes.length) return;
  mermaid.initialize(mermaidInitOptions(options.theme || 'dark'));
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
  await enhanceDataCharts(container, options);
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
