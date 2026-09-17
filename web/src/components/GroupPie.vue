<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue';
import * as echarts from 'echarts/core';
import { PieChart } from 'echarts/charts';
import { TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useTheme } from '../theme';
import { t } from '../i18n';

echarts.use([PieChart, TooltipComponent, LegendComponent, CanvasRenderer]);

const props = defineProps<{ slices: { name: string; value: number }[]; title?: string }>();
const { isDark } = useTheme();
const el = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;

const label = (name: string) => (name ? name : t('codestat.groups.ungrouped'));

function draw() {
  if (!el.value || !props.slices.length) return;
  if (!chart) chart = echarts.init(el.value, isDark.value ? 'dark' : null);
  chart.setOption({
    tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}: ${p.value} (${p.percent}%)` },
    legend: { bottom: 0, textStyle: { color: isDark.value ? '#8b96a5' : '#6b7280', fontSize: 11 } },
    series: [{
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['50%', '42%'],
      data: props.slices.map((s) => ({ name: label(s.name), value: s.value })),
      label: { formatter: '{b} {d}%', fontSize: 11 },
    }],
  }, true);
  chart.resize();
}

onMounted(async () => { await nextTick(); draw(); });
watch(() => [props.slices, isDark.value], async () => { await nextTick(); draw(); }, { deep: true });
function onResize() { chart?.resize(); }
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); chart?.dispose(); chart = null; });
</script>

<template>
  <section v-if="slices.length" class="pie">
    <h3 v-if="title" class="sub">{{ title }}</h3>
    <div ref="el" class="chart" />
  </section>
</template>

<style scoped>
.pie { margin: 8px 0 12px; }
.sub { color: var(--tx1); font-size: 13px; margin: 4px 0 6px; }
.chart { height: 240px; }
</style>
