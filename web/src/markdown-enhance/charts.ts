import { parseMermaidChart } from '@devflow/shared/markdown-charts';

export { parseMermaidChart };
export type { ChartHandle, ChartSpec } from '@devflow/shared/markdown-charts';

type EChartsCore = typeof import('echarts/core');

let echartsCore: EChartsCore | null = null;

export async function loadEcharts(): Promise<EChartsCore> {
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
    charts.CustomChart,
    components.GridComponent,
    components.TooltipComponent,
    components.LegendComponent,
    components.TitleComponent,
    renderers.CanvasRenderer,
  ]);
  echartsCore = core;
  return core;
}
