export type ChartSeries = { type: 'line' | 'bar'; name?: string; data: number[] };

export interface GanttTask {
  name: string;
  section: string;
  tag: '' | 'done' | 'active' | 'crit' | 'milestone';
  start: number;
  end: number;
}

export interface TimelinePeriod {
  period: string;
  section: string;
  events: string[];
}

export interface FlowNode {
  id: string;
  label: string;
  fill: string;
  stroke: string;
  color: string;
  x: number;
  y: number;
}

export interface FlowEdge {
  source: string;
  target: string;
  label: string;
}

export interface ChevronSegment {
  label: string;
  sub: string;
  weight: number;
  color: string;
}

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
      height?: number;
    }
  | { kind: 'pie'; title: string; data: { name: string; value: number }[]; height?: number }
  | { kind: 'gantt'; title: string; tasks: GanttTask[]; height?: number }
  | { kind: 'timeline'; title: string; periods: TimelinePeriod[]; height?: number }
  | { kind: 'flowchart'; direction: 'LR' | 'RL' | 'TD' | 'BT'; nodes: FlowNode[]; edges: FlowEdge[]; height?: number }
  | { kind: 'chevron'; title: string; segments: ChevronSegment[]; height?: number };

export type ChartHandle = { dispose(): void };

export interface EChartsLike {
  init(el: HTMLElement): {
    setOption(option: unknown): void;
    resize(): void;
    dispose(): void;
  };
}

export function parseMermaidChart(code: string): ChartSpec | null;

export function renderChart(
  el: HTMLElement,
  spec: ChartSpec,
  echarts: EChartsLike,
  options?: { dark?: boolean },
): Promise<ChartHandle>;

export function enhanceCharts(
  container: HTMLElement,
  echarts: EChartsLike | null | undefined,
  options?: { dark?: boolean },
): Promise<Array<{ host: HTMLElement; dispose(): void }>>;
