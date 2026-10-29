export type ChartSeries = { type: 'line' | 'bar'; data: number[] };

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
      const data = parseNumberList(line.slice(line.indexOf(' ')));
      const type = low.startsWith('line') ? 'line' : 'bar';
      if (data) series.push({ type, data });
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
