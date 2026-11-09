type EChartsCore = typeof import('echarts/core');

let cached: EChartsCore | null = null;

export async function loadEcharts(): Promise<EChartsCore> {
  if (cached) return cached;
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
  cached = core;
  return core;
}
