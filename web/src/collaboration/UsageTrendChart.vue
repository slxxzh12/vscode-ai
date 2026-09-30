<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch, nextTick } from 'vue';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useTheme } from '../theme';
import { machineLabel, mergeMachines, fmtNum } from './usagePeers';
import type { CollabApi } from './useCollab';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabUsage } from './types';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

// 趋势图最多画多少台机器（按所选指标合计从高到低）
const TOP_N = 10;
type MetricKey = 'messages' | 'output' | 'input' | 'sessions';
type Days = Record<string, Record<string, number | undefined> | undefined>;

const props = defineProps<{ collab: CollabApi; peers: Record<string, CollabUsage> }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const machines = computed(() => mergeMachines(props.peers, snap.value.group?.members || []));
const metric = ref<MetricKey>('messages');
const daily = ref<Record<string, Days>>({});
const { isDark } = useTheme();
const el = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;

// machineId -> 展示名（工号/用户名，兜底机器号）
const labelOf = computed(() => {
  const m = new Map<string, string>();
  for (const x of machines.value) m.set(x.machineId, machineLabel(x) || x.machineId);
  return m;
});

async function loadDaily() {
  try {
    const r = await fetch('/api/usage/daily').then((x) => x.json());
    daily.value = r.daily || {};
  } catch { /* ignore */ }
}

// 按所选指标在窗口内的合计排序，取前 TOP_N 台
function topMachines() {
  const rows = Object.entries(daily.value).map(([id, days]) => {
    const total = Object.values(days || {}).reduce((s, d) => s + (Number(d?.[metric.value]) || 0), 0);
    return { id, total, days: days || {} };
  }).filter((r) => Object.keys(r.days).length > 0);
  rows.sort((a, b) => b.total - a.total);
  return rows.slice(0, TOP_N);
}

function draw() {
  if (!el.value) return;
  if (!chart) chart = echarts.init(el.value, isDark.value ? 'dark' : null);
  const axis = isDark.value ? '#8b96a5' : '#6b7280';
  const split = isDark.value ? '#2a323e' : '#e5e7eb';
  const top = topMachines();
  const daySet = new Set<string>();
  for (const r of top) for (const d of Object.keys(r.days)) daySet.add(d);
  const days = [...daySet].sort();
  const used = new Map<string, number>();
  const series = top.map((r) => {
    const base = labelOf.value.get(r.id) || r.id;
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    return {
      name: n > 1 ? `${base} (${n})` : base,
      type: 'line' as const,
      smooth: true,
      symbolSize: 5,
      data: days.map((d) => {
        const v = r.days[d]?.[metric.value];
        return v == null ? null : v;
      }),
    };
  });
  chart.setOption({
    grid: { left: 46, right: 16, top: 28, bottom: 24 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmtNum(v) },
    legend: { type: 'scroll', right: 0, top: 0, textStyle: { color: axis, fontSize: 11 } },
    xAxis: { type: 'category', data: days, axisLabel: { color: axis, fontSize: 10 }, axisLine: { lineStyle: { color: split } } },
    yAxis: { type: 'value', axisLabel: { color: axis, fontSize: 10, formatter: (v: number) => fmtNum(v) }, splitLine: { lineStyle: { color: split } } },
    series,
  }, true);
  chart.resize();
}

onMounted(async () => { await loadDaily(); await nextTick(); draw(); });
watch(metric, draw);
watch(isDark, draw);
watch(() => props.peers, async () => { await loadDaily(); await nextTick(); draw(); }, { deep: true });
function onResize() { chart?.resize(); }
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); chart?.dispose(); chart = null; });
</script>

<template>
  <section class="trend">
    <h4 class="ttitle">
      <span class="thint">{{ $t('usage.trend_top', { metric: $t('usage.' + metric) }) }}</span>
      <el-select v-model="metric" size="small" class="pickm">
        <el-option value="messages" :label="$t('usage.messages')" />
        <el-option value="output" :label="$t('usage.output')" />
        <el-option value="input" :label="$t('usage.input')" />
        <el-option value="sessions" :label="$t('usage.sessions')" />
      </el-select>
    </h4>
    <div ref="el" class="chart" />
  </section>
</template>

<style scoped>
.trend { display: flex; flex-direction: column; min-height: 0; border-top: 1px solid var(--bd); flex: none; }
.ttitle { display: flex; align-items: center; gap: 8px; margin: 0; padding: 8px 12px 0; font-size: 12px; font-weight: 600; color: var(--tx2); }
.thint { font-weight: 400; color: var(--tx6); }
.pickm { margin-left: auto; width: 150px; }
.chart { height: 190px; }
</style>
