export type ChartSeries = { type: 'line' | 'bar'; name?: string; data: number[] };

export type ChartSpec =
  | {
      kind: 'xychart';
      title: string;
      xTitle: string;
      categories: string[];
      yTitle: string;
      yMin?: number;
      yMax?: number;
      series: ChartSeries[];
    }
  | { kind: 'pie'; title: string; data: { name: string; value: number }[] };

export type ChartHandle = { dispose(): void };

function unquote(text: string): string {
  const s = text.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseNumberList(text: string): number[] | null {
  const m = text.match(/\[([^\]]*)\]/);
  if (!m) return null;
  const parts = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const out = parts.map(Number);
  if (!out.length || out.some((n) => !Number.isFinite(n))) return null;
  return out;
}

function parseCategories(text: string): { label: string; items: string[] } | null {
  const m = text.match(/\[([^\]]*)\]/);
  if (!m) return null;
  const items = m[1]
    .split(',')
    .map((s) => unquote(s))
    .filter((s) => s.length > 0);
  if (!items.length) return null;
  const label = text.match(/^\s*"([^"]*)"/) || text.match(/^\s*'([^']*)'/);
  return { label: label ? label[1] : '', items };
}

function parseXyChart(lines: string[]): ChartSpec | null {
  let title = '';
  let xTitle = '';
  let yTitle = '';
  let yMin: number | undefined;
  let yMax: number | undefined;
  let categories: string[] | null = null;
  const series: ChartSeries[] = [];

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
  if (series.some((s) => s.data.length !== categories!.length)) return null;
  return { kind: 'xychart', title, xTitle, categories, yTitle, yMin, yMax, series };
}

function parsePie(lines: string[]): ChartSpec | null {
  let title = '';
  const titleMatch = lines[0].match(/\btitle\s+(.+)$/i);
  if (titleMatch) title = unquote(titleMatch[1]);
  const data: { name: string; value: number }[] = [];
  for (const line of lines.slice(1)) {
    const m = line.match(/^["']?([^"':]+)["']?\s*:\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) data.push({ name: m[1].trim(), value: Number(m[2]) });
  }
  if (!data.length) return null;
  return { kind: 'pie', title, data };
}

export function parseMermaidChart(code: string): ChartSpec | null {
  const lines = String(code || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const head = lines[0].toLowerCase();
  if (head.startsWith('pie')) return parsePie(lines);
  if (head.startsWith('xychart-beta')) return parseXyChart(lines);
  return null;
}

type EChartsCore = typeof import('echarts/core');

let echartsCore: EChartsCore | null = null;

async function loadEcharts(): Promise<EChartsCore> {
  if (echartsCore) return echartsCore;
  const [core, charts, components, renderers] = await Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers'),
  ]);
  core.use([
    charts.LineChart,
    charts.BarChart,
    charts.PieChart,
    components.GridComponent,
    components.TooltipComponent,
    components.LegendComponent,
    components.TitleComponent,
    renderers.CanvasRenderer,
  ]);
  echartsCore = core;
  return core;
}

function chartTheme() {
  const dark = document.documentElement.dataset.theme !== 'light';
  return {
    text: dark ? '#d5dae1' : '#1f2937',
    axis: dark ? '#3a4250' : '#d7dce3',
    split: dark ? '#242b36' : '#eef1f5',
  };
}

export async function renderChart(el: HTMLElement, spec: ChartSpec): Promise<ChartHandle> {
  const core = await loadEcharts();
  const th = chartTheme();
  const chart = core.init(el);
  const base = {
    backgroundColor: 'transparent',
    textStyle: { color: th.text },
    title: spec.title
      ? { text: spec.title, left: 'center', textStyle: { color: th.text, fontSize: 14 } }
      : undefined,
  };

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
  } else {
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
  }

  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(el);
  return {
    dispose() {
      ro.disconnect();
      chart.dispose();
    },
  };
}
