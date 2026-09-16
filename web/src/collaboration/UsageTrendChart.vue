<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch, nextTick } from 'vue';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useTheme } from '../theme';
import { t } from '../i18n';
import { machineLabel, mergeMachines } from './usagePeers';
import type { CollabApi } from './useCollab';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabUsage } from './types';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const props = defineProps<{ collab: CollabApi; peers: Record<string, CollabUsage> }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const machines = computed(() => mergeMachines(props.peers, snap.value.group?.members || []));
const picked = ref('');
const metric = ref<'messages_output' | 'input_output' | 'sessions_messages'>('messages_output');
const daily = ref<Record<string, Record<string, { messages?: number; output?: number }>>>({});
const { isDark } = useTheme();
const el = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;

watch(machines, (list) => {
  const ids = list.map((m) => m.machineId);
  if (!picked.value || !ids.includes(picked.value)) picked.value = ids[0] || '';
}, { immediate: true });

async function loadDaily() {
  try {
    const id = picked.value;
    const r = await fetch(`/api/usage/daily${id ? `?machineId=${encodeURIComponent(id)}` : ''}`).then((x) => x.json());
    daily.value = r.daily || {};
  } catch { /* ignore */ }
}

function draw() {
  if (!el.value) return;
  if (!chart) chart = echarts.init(el.value, isDark.value ? 'dark' : null);
  const days = Object.keys(daily.value[picked.value] || {}).sort();
  const rows = days.map((d) => daily.value[picked.value][d]);
  const axis = isDark.value ? '#8b96a5' : '#6b7280';
  const split = isDark.value ? '#2a323e' : '#e5e7eb';
  const groups = {
    messages_output: { keys: ['messages', 'output'], labels: [t('usage.messages'), t('usage.output')] },
    input_output: { keys: ['input', 'output'], labels: [t('usage.input'), t('usage.output')] },
    sessions_messages: { keys: ['sessions', 'messages'], labels: [t('usage.sessions'), t('usage.messages')] },
  } as const;
  const g = groups[metric.value] || groups.messages_output;
  chart.setOption({
    grid: { left: 46, right: 16, top: 28, bottom: 24 },
    tooltip: { trigger: 'axis' },
    legend: { right: 0, top: 0, textStyle: { color: axis, fontSize: 11 } },
    xAxis: { type: 'category', data: days, axisLabel: { color: axis, fontSize: 10 }, axisLine: { lineStyle: { color: split } } },
    yAxis: { type: 'value', axisLabel: { color: axis, fontSize: 10 }, splitLine: { lineStyle: { color: split } } },
    series: [
      { name: g.labels[0], type: 'line', smooth: true, symbolSize: 5, data: rows.map((r) => (r as any)[g.keys[0]] ?? null) },
      { name: g.labels[1], type: 'line', smooth: true, symbolSize: 5, data: rows.map((r) => (r as any)[g.keys[1]] ?? null) },
    ],
  }, true);
  chart.resize();
}

onMounted(async () => { await loadDaily(); await nextTick(); draw(); });
watch([picked, isDark], async () => { await loadDaily(); await nextTick(); draw(); });
watch(() => props.peers, async () => { await loadDaily(); await nextTick(); draw(); }, { deep: true });
function onResize() { chart?.resize(); }
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); chart?.dispose(); chart = null; });
</script>

<template>
  <section class="trend">
    <h4 class="ttitle">
      <el-select v-model="metric" size="small" class="pickm">
        <el-option value="messages_output" :label="$t('usage.metric_messages_output')" />
        <el-option value="input_output" :label="$t('usage.metric_input_output')" />
        <el-option value="sessions_messages" :label="$t('usage.metric_sessions_messages')" />
      </el-select>
      <el-select v-model="picked" size="small" class="pick" :placeholder="$t('usage.machine')">
        <el-option v-for="m in machines" :key="m.machineId" :value="m.machineId" :label="machineLabel(m)" />
      </el-select>
    </h4>
    <div ref="el" class="chart" />
  </section>
</template>

<style scoped>
.trend { display: flex; flex-direction: column; min-height: 0; border-top: 1px solid var(--bd); flex: none; }
.ttitle { display: flex; align-items: center; gap: 8px; margin: 0; padding: 8px 12px 0; font-size: 12px; font-weight: 600; color: var(--tx2); }
.pick { margin-left: auto; width: 150px; }
.pickm { margin-left: auto; width: 150px; }
.chart { height: 190px; }
</style>
